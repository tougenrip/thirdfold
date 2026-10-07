// Window glow (#260) drawn: a village house's glazed window dark at noon and glowing at night,
// above 1 in the half-float target (what bloom catches, #160); a window the hash leaves unlit
// dark at night too; a lit window into a dark area dark; the floor in front of a glowing window
// lit exactly as without the glow (emissive only, no light); and none of it compiling a program
// after the walls' stand-in (noon, night, a dark area, a new sync).

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import { CellMaps } from './cell-maps';
import { loadEnvironment } from './environment';
import { groundFor } from './ground';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import { createMaterial } from './materials';
import { shaderStages } from './perf';
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

const SIZE = 16;
const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 34, height: 6 };
let n = 0;
const wall = (a: [number, number], b: [number, number]): SceneObject => ({
	id: `w${n++}`,
	kind: 'wall',
	a: { x: a[0], y: a[1] },
	b: { x: b[0], y: b[1] }
});
/** A long house, cells (1-32, 2-3): sixty-odd facade units, enough for lit and unlit windows. */
const HOUSE = [
	wall([1, 2], [33, 2]),
	wall([1, 2], [1, 4]),
	wall([33, 2], [33, 4]),
	wall([1, 4], [33, 4])
];
const inside = (i: number) => {
	const [x, y] = [i % grid.width, Math.floor(i / grid.width)];
	return x >= 1 && x < 33 && y >= 2 && y < 4 ? 1 : 0;
};
const INTERIOR = Uint8Array.from({ length: grid.width * grid.height }, (_, i) => inside(i));
/** The sky's night glow by day and at night (every sky's keys). */
const [NOON, NIGHT] = [0.5, 1];

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
	scene.add(new SkyHemisphere(0xffffff, 0xffffff, 2));
	// The ground in front of the house, to see that the glow lights nothing.
	const floor = new THREE.Mesh(
		new THREE.PlaneGeometry(grid.width, grid.height).rotateX(-Math.PI / 2),
		createMaterial('surface', { params: { color: 0x808080 } })
	);
	scene.add(floor);
	const camera = new THREE.OrthographicCamera(-0.08, 0.08, 0.08, -0.08, 0.05, 20);
	const target = new THREE.RenderTarget(SIZE, SIZE, { type: THREE.HalfFloatType });
	maps = new CellMaps();
	maps.update(grid, { fog: null, mode: 'gm' }, 'day', null, null, null, null);
	const village = await loadEnvironment('village');
	const layer = new WallLayer(build);
	layer.setLook(village!.walls, village!.kit, village!.roof);
	scene.add(layer.group, ...layer.gallery());
	const shape = build.worldShape({ grid, levels: null, floor: null, objects: HOUSE, known: null });
	const show = () => {
		layer.setInterior(INTERIOR);
		layer.sync(HOUSE, shape, groundFor(grid, null));
	};
	show();
	// The panes as the layer drew them: glazed facades, which the hash lights.
	const building = build.roofFootprint(shape, HOUSE, INTERIOR, true);
	const glass = build.glazing(build.tileInput(shape, HOUSE, building));
	const lit = build.litPanes(glass, null);
	/** A pane's opening centre and the way out of the house. */
	const pane = (i: number) => {
		const m = new THREE.Matrix4().fromArray(glass.matrices, i * 16);
		const out = new THREE.Vector3().setFromMatrixColumn(m, 2).normalize();
		const at = new THREE.Vector3().setFromMatrixPosition(m).add(new THREE.Vector3(0, 1.25, 0));
		return { at, out };
	};
	const read = async (): Promise<number[]> => {
		advanceNodeFrame(r);
		r.setRenderTarget(target);
		r.setClearColor(0x000000, 1);
		r.render(scene, camera);
		r.setRenderTarget(null);
		const px = await r.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE);
		const row = px.length === SIZE * SIZE * 4 ? SIZE * 4 : Math.ceil((SIZE * 8) / 256) * 128;
		const i = (SIZE / 2) * row + (SIZE / 2) * 4;
		const half = (v: number) => (px instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat(v) : v);
		return [0, 1, 2].map((k) => half(px[i + k] as number));
	};
	return {
		layer,
		glass,
		lit,
		show,
		/** The pane's centre, seen straight on from outside. */
		async window(i: number) {
			const { at, out } = pane(i);
			camera.position.copy(at).addScaledVector(out, 3);
			camera.up.set(0, 1, 0);
			camera.lookAt(at);
			return read();
		},
		/** The floor a cell out from the pane, straight down. */
		async floorBefore(i: number) {
			const { at, out } = pane(i);
			const spot = at.clone().addScaledVector(out, 0.6).setY(0);
			camera.position.copy(spot).setY(1);
			camera.up.set(0, 0, -1);
			camera.lookAt(spot);
			return read();
		},
		stages: () => new Set(shaderStages(r).keys())
	};
}

const brightness = (rgb: number[]) => Math.max(...rgb);

describe('window glow', () => {
	it('glows after dusk where the hash lights it, dark by day and into a dark area', async () => {
		const t = await setUp();
		const on = [...t.lit.keys()].find((i) => t.lit[i] === 1)!;
		const off = [...t.lit.keys()].find((i) => t.lit[i] === 0)!;
		expect(on).toBeDefined();
		expect(off).toBeDefined();
		expect(t.layer.glass.stats()).toMatchObject({ panes: t.glass.count, glow: 0 });

		t.layer.setGlow(NOON);
		const noon = await t.window(on);
		const noonOff = await t.window(off);
		const noonFloor = await t.floorBefore(on);
		const before = t.stages();
		const fresh = () => [...t.stages()].filter((code) => !before.has(code));
		// By day a pane is lit by the sky alone: never above 1.
		expect(brightness(noon)).toBeGreaterThan(0);
		expect(brightness(noon)).toBeLessThan(1);

		t.layer.setGlow(NIGHT);
		expect(t.layer.glass.stats().glow).toBe(1);
		const night = await t.window(on);
		// Warm, and over 1 in the scene's half floats: bloom takes it.
		expect(brightness(night)).toBeGreaterThan(1);
		expect(night[0]).toBeGreaterThan(night[2]);
		// The hash's unlit window stays as it was by day.
		(await t.window(off)).forEach((c, k) => expect(c).toBeCloseTo(noonOff[k], 2));
		// Emissive only: the floor in front of the glowing window is lit as at noon.
		(await t.floorBefore(on)).forEach((c, k) => expect(c).toBeCloseTo(noonFloor[k], 3));

		// The house a dark area: its windows stay dark.
		t.layer.setDarkness(INTERIOR);
		expect(t.layer.glass.stats().lit).toBe(0);
		(await t.window(on)).forEach((c, k) => expect(c).toBeCloseTo(noon[k], 2));
		t.layer.setDarkness(null);
		expect(brightness(await t.window(on))).toBeGreaterThan(1);

		// A new sync and the day again: the same programs.
		t.show();
		t.layer.setGlow(NOON);
		(await t.window(on)).forEach((c, k) => expect(c).toBeCloseTo(noon[k], 2));
		expect(fresh()).toEqual([]);
		t.layer.dispose();
	});
});
