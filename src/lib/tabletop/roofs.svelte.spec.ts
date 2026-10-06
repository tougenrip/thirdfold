// Roofs (#257) drawn: a player's presumed roof over a room they walked round, lit by the known
// cell outside it while the ground under it stays black; a roof left out while the viewer sees
// into it; the gable's ridge where world/roofs.ts puts it; and none of it compiling a program
// after the warm-up's stand-in (roofs appearing, a new chunk, the village's kit, a sight change).

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KitRoof } from '$lib/assets/kit';
import type { SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import { encodeMask, type FogView } from '$lib/game/visibility';
import { CellMaps } from './cell-maps';
import { loadEnvironment } from './environment';
import { groundFor, WALL_HEIGHT } from './ground';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import { shaderStages } from './perf';
import { PICK_LAYER } from './picking';
import type { RoofKit } from './roofs';
import { SkyHemisphere, registerSkyLights } from './sky-light';
import { BACKEND } from './testing';
import { WallLayer } from './walls';
import { loadWorld } from './world-layer';

vi.setConfig({ testTimeout: 120_000 });

let renderer: THREE.WebGPURenderer | null = null;
let maps: CellMaps | null = null;
afterEach(() => {
	maps?.dispose();
	renderer?.dispose();
	[maps, renderer] = [null, null];
});

const SIZE = 32;
const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 40, height: 10 };
let n = 0;
const wall = (a: [number, number], b: [number, number]): SceneObject => ({
	id: `w${n++}`,
	kind: 'wall',
	a: { x: a[0], y: a[1] },
	b: { x: b[0], y: b[1] }
});
/** A closed room from corner (x0, y0) to (x1, y1), a door in its south wall. */
const room = (x0: number, y0: number, x1: number, y1: number): SceneObject[] => [
	wall([x0, y0], [x1, y0]),
	wall([x0, y0], [x0, y1]),
	wall([x1, y0], [x1, y1]),
	{ id: `d${n++}`, kind: 'door', a: { x: x0, y: y1 }, b: { x: x0 + 1, y: y1 }, open: false },
	wall([x0 + 1, y1], [x1, y1])
];
/** Cells (4-6, 3-4) in chunk 0, and (34-36, 3-4) in chunk 2. */
const HOUSE = room(4, 3, 7, 5);
const FAR = room(34, 3, 37, 5);
const inHouse = (x: number, y: number) =>
	y >= 3 && y < 5 && ((x >= 4 && x < 7) || (x >= 34 && x < 37));
const mask = (inside: (x: number, y: number) => boolean) =>
	Uint8Array.from({ length: grid.width * grid.height }, (_, i) =>
		inside(i % grid.width, Math.floor(i / grid.width)) ? 1 : 0
	);
/** A player who walked round both houses: everything explored and in sight but their insides. */
const OUTSIDE = mask((x, y) => !inHouse(x, y));
const FOG: FogView = {
	enabled: true,
	shared: false,
	visible: encodeMask(OUTSIDE),
	explored: encodeMask(OUTSIDE)
};
const GABLE: KitRoof = { style: 'gable', pitch: 45, eave: 0.25, material: 'thatch' };
const KIT: RoofKit = { roof: GABLE, presume: true, look: null };
/** The world's x and z of a cell's centre. */
const at = (x: number, y: number) => [x + 0.5 - grid.width / 2, y + 0.5 - grid.height / 2] as const;

async function setUp() {
	const build = await loadWorld();
	const r = await createNodeRenderer(document.createElement('canvas'), {
		pixelRatio: 1,
		antialias: false,
		backend: BACKEND === 'webgpu' ? 'webgpu' : 'webgl'
	});
	renderer = r;
	registerSkyLights(r);
	r.setSize(SIZE, SIZE, false);
	const scene = new THREE.Scene();
	scene.add(new SkyHemisphere(0xffffff, 0xffffff, 3));
	const camera = new THREE.OrthographicCamera(-0.3, 0.3, 0.3, -0.3, 0.1, 20);
	camera.up.set(0, 0, -1);
	const target = new THREE.RenderTarget(SIZE, SIZE);
	maps = new CellMaps();
	const layer = new WallLayer(build);
	scene.add(layer.group);
	const ground = groundFor(grid, null);
	return {
		layer,
		maps,
		/** The view as a player: their fog on the cell maps, the shape, the sight, the walls. */
		show(objects: SceneObject[], fog: FogView | null, interior: Uint8Array | null = null) {
			maps!.update(grid, { fog, mode: 'player' }, 'day', null, null, null, null);
			const known = fog ? build.knownOf(grid, fog, false) : null;
			const shape = build.worldShape({ grid, levels: null, floor: null, objects, known });
			layer.roofs.setSight(fog);
			layer.setInterior(interior);
			layer.sync(objects, shape, ground);
		},
		/** The centre pixel's rgb, looking straight down on a cell. */
		async pixel(x: number, y: number): Promise<number[]> {
			const [wx, wz] = at(x, y);
			camera.position.set(wx, 10, wz);
			camera.lookAt(wx, 0, wz);
			advanceNodeFrame(r);
			r.setRenderTarget(target);
			r.setClearColor(0x000000, 1);
			r.render(scene, camera);
			r.setRenderTarget(null);
			const px = (await r.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE)) as Uint8Array;
			const row = px.length === SIZE * SIZE * 4 ? SIZE * 4 : Math.ceil((SIZE * 4) / 256) * 256;
			const i = (SIZE / 2) * row + (SIZE / 2) * 4;
			return [px[i], px[i + 1], px[i + 2]];
		},
		stages: () => new Set(shaderStages(r).keys()),
		gallery: () => scene.add(...layer.gallery()),
		/** The top of the roofs at a cell's centre, straight down. */
		roofTop(x: number, y: number): number | null {
			const [wx, wz] = at(x, y);
			const ray = new THREE.Raycaster(new THREE.Vector3(wx, 20, wz), new THREE.Vector3(0, -1, 0));
			const hits = ray.intersectObjects(layer.roofs.group.children, false);
			return hits.length ? 20 - hits[0].distance : null;
		}
	};
}

describe('roofs', () => {
	it('presume a roof over a room the player walked round, lit by the cell outside it', async () => {
		const t = await setUp();
		t.gallery();
		// Without roofs in the kit nothing stands over the room (the clear colour shows).
		t.show(HOUSE, FOG);
		await t.pixel(5, 3);
		const before = t.stages();
		const fresh = () => [...t.stages()].filter((code) => !before.has(code));
		expect(await t.pixel(5, 3)).toEqual([0, 0, 0]);
		expect(t.layer.roofs.stats().regions).toBe(0);

		// A kit with roofs that presumes them: the gable over the room, drawn, not black.
		t.layer.setLook(null, null, KIT);
		t.show(HOUSE, FOG);
		expect(t.layer.roofs.stats()).toMatchObject({ chunks: 1, regions: 1, built: 1 });
		// Shaded by the visible cell outside it: as the same roof with fog off, never the black of
		// the unexplored cells under it.
		const roof = await t.pixel(5, 3);
		expect(Math.max(...roof)).toBeGreaterThan(10);
		t.show(HOUSE, null, mask(inHouse));
		const open = await t.pixel(5, 3);
		roof.forEach((c, i) => expect(Math.abs(c - open[i])).toBeLessThanOrEqual(2));
		t.show(HOUSE, FOG);
		// Its ridge along x over the room's middle line (3 wide, 2 deep: 1 up at 45°).
		const ridge = t.roofTop(5, 3)!;
		expect(ridge).toBeGreaterThan(WALL_HEIGHT);
		expect(ridge).toBeLessThanOrEqual(WALL_HEIGHT + 1 + 1e-4);
		// Never on the pick layer.
		for (const m of t.layer.roofs.group.children)
			expect(m.layers.isEnabled(PICK_LAYER)).toBe(false);
		expect(fresh()).toEqual([]);

		// A second house in another chunk: that chunk alone is built.
		const built = t.layer.roofs.stats().built;
		t.show([...HOUSE, ...FAR], FOG);
		expect(t.layer.roofs.stats()).toMatchObject({ chunks: 2, regions: 2, built: built + 1 });
		await t.pixel(35, 3);
		// The village's own kit: its thatch, still no program.
		const village = await loadEnvironment('village');
		expect(village?.roof).toMatchObject({ presume: true, roof: { style: 'gable' } });
		t.layer.setLook(village!.walls, village!.kit, village!.roof);
		t.show([...HOUSE, ...FAR], FOG);
		expect(Math.max(...(await t.pixel(5, 3)))).toBeGreaterThan(10);
		expect(fresh()).toEqual([]);
		t.layer.dispose();
	});

	it('leave a roof out while the viewer sees into it, and keep the GM’s', async () => {
		const t = await setUp();
		t.gallery();
		t.layer.setLook(null, null, KIT);
		// The player steps in at the door: the room is explored, roofed as sent, and in sight.
		const all = mask(() => true);
		const roofed = mask((x, y) => inHouse(x, y) && x < 20);
		const inside: FogView = { ...FOG, visible: encodeMask(all), explored: encodeMask(all) };
		t.show(HOUSE, inside, roofed);
		expect(t.layer.roofs.stats()).toMatchObject({ chunks: 0, regions: 1 });
		// Out of sight again (remembered): the roof is back.
		t.layer.roofs.setSight({ ...inside, visible: encodeMask(OUTSIDE) });
		expect(t.layer.roofs.stats().chunks).toBe(1);
		// The GM with fog off: the mask, roofed.
		t.show(HOUSE, null, roofed);
		expect(t.layer.roofs.stats()).toMatchObject({ chunks: 1, regions: 1 });
		expect(Math.max(...(await t.pixel(5, 3)))).toBeGreaterThan(10);
		t.layer.dispose();
	});
});
