// The cell maps read back on the GPU (#171), on both backends: each cell's fog lands on that cell
// (visible only at (1, 0), explored only at (0, 1), the rest exactly black), darkness and the flash
// match `cellLight`, a hidden emissive surface adds nothing, the cut discards, and none of it
// (nor a new grid size) adds a program. The sky's lights (#219, sky-light.ts) leave a dark area
// as dark as no light at all, keep a roof's fill without the sun, and the flash lifts both.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gridToWorld, type GridPos, type SquareGrid } from '$lib/game/grid';
import { encodeMask, type FogView } from '$lib/game/visibility';
import { AMBIENT_DARK, CellMaps, cellLight } from './cell-maps';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import { createMaterial } from './materials';
import { SkyHemisphere, SkyLight, registerSkyLights } from './sky-light';
import { BACKEND } from './testing';

vi.setConfig({ testTimeout: 120_000 });

const SIZE = 16;
const GRID: SquareGrid = { kind: 'square', cellSize: 1, width: 3, height: 2 };
const cells = (list: GridPos[]) => {
	const mask = new Uint8Array(GRID.width * GRID.height);
	for (const c of list) mask[c.y * GRID.width + c.x] = 1;
	return encodeMask(mask);
};
const FOG: FogView = {
	enabled: true,
	shared: false,
	visible: cells([{ x: 1, y: 0 }]),
	explored: cells([{ x: 0, y: 1 }])
};

let renderer: THREE.WebGPURenderer | null = null;
let maps: CellMaps | null = null;
afterEach(() => {
	maps?.dispose();
	renderer?.dispose();
	[maps, renderer] = [null, null];
});

/** A small square of a kind's material that the camera looks straight down on, cell by cell. */
async function setup() {
	const canvas = document.createElement('canvas');
	const r = await createNodeRenderer(canvas, {
		pixelRatio: 1,
		antialias: false,
		backend: BACKEND === 'webgpu' ? 'webgpu' : 'webgl'
	});
	renderer = r;
	registerSkyLights(r);
	r.setSize(SIZE, SIZE, false);
	const scene = new THREE.Scene();
	const ambient = new THREE.AmbientLight(0xffffff, 1);
	scene.add(ambient);
	const plain = createMaterial('overlay');
	// Its glow is the emissive tint input (the emissive slot's blank is black).
	const glow = createMaterial('emissive', { params: { color: 0x000000, tint: 0xffffff } });
	const quad = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), plain);
	quad.rotation.x = -Math.PI / 2;
	scene.add(quad);
	const camera = new THREE.OrthographicCamera(-0.2, 0.2, 0.2, -0.2, 0.1, 10);
	camera.up.set(0, 0, -1);
	const target = new THREE.RenderTarget(SIZE, SIZE);
	maps = new CellMaps();
	const m = maps;
	return {
		maps: m,
		scene,
		ambient,
		quad,
		plain,
		glow,
		programs: () => r.info.memory.programs,
		/** The centre pixel's rgb over a cell (symmetric, so either backend's row order reads it). */
		async at(cell: GridPos): Promise<number[]> {
			const w = gridToWorld(GRID, cell);
			quad.position.set(w.x, 0, w.z);
			camera.position.set(w.x, 5, w.z);
			camera.lookAt(w.x, 0, w.z);
			advanceNodeFrame(r);
			r.setRenderTarget(target);
			r.setClearColor(0x000000, 1);
			r.render(scene, camera);
			r.setRenderTarget(null);
			const px = (await r.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE)) as Uint8Array;
			// WebGPU pads each row of a readback to 256 bytes (all but the last).
			const row = px.length === SIZE * SIZE * 4 ? SIZE * 4 : Math.ceil((SIZE * 4) / 256) * 256;
			const i = (SIZE / 2) * row + (SIZE / 2) * 4;
			return [px[i], px[i + 1], px[i + 2]];
		}
	};
}

const ALL: GridPos[] = [0, 1].flatMap((y) => [0, 1, 2].map((x) => ({ x, y })));
const same = (a: GridPos, b: GridPos) => a.x === b.x && a.y === b.y;

describe('the cell maps on the GPU', () => {
	it('put each cell’s fog on that cell, hidden exactly black', async () => {
		const t = await setup();
		t.maps.update(GRID, { fog: FOG, mode: 'player' }, 'day', null, null, null, null);
		for (const cell of ALL) {
			const [r, g, b] = await t.at(cell);
			if (same(cell, { x: 1, y: 0 })) expect([r, g, b]).toEqual([255, 255, 255]);
			else if (same(cell, { x: 0, y: 1 })) {
				// Dim, and cool: blue keeps the most.
				expect(b).toBeGreaterThan(40);
				expect(b).toBeLessThan(150);
				expect(b).toBeGreaterThanOrEqual(r);
			} else expect([cell, r, g, b]).toEqual([cell, 0, 0, 0]);
		}
		// The GM sees the party's unseen cells tinted, never black.
		t.maps.setFog(FOG, 'gm');
		for (const cell of ALL) expect((await t.at(cell))[2]).toBeGreaterThan(100);
	});

	it('darken by the light level and thin with the flash, as cellLight says', async () => {
		const t = await setup();
		const levels = new Float32Array(GRID.width * GRID.height);
		levels[2] = 1; // (2, 0) lit
		const dark = new Uint8Array(GRID.width * GRID.height);
		dark[3] = 1; // (0, 1) in a dark area
		t.maps.update(GRID, { fog: null, mode: 'player' }, 'dusk', levels, dark, null, null);
		const expected = (cell: GridPos, flash: number) =>
			255 *
			cellLight({
				ambientDark: AMBIENT_DARK.dusk,
				level: levels[cell.y * GRID.width + cell.x],
				sky: dark[cell.y * GRID.width + cell.x] ? 0 : 1,
				fill: 0,
				flash
			});
		// At a cell's centre the linear sample is the cell's own value.
		const read: number[][] = [];
		const want: number[][] = [];
		for (const flash of [0, 1]) {
			t.maps.setFlash(flash);
			for (const cell of [
				{ x: 1, y: 0 },
				{ x: 2, y: 0 },
				{ x: 0, y: 1 }
			]) {
				read.push([cell.x, cell.y, flash, (await t.at(cell))[0]]);
				want.push([cell.x, cell.y, flash, Math.round(expected(cell, flash))]);
			}
		}
		const off = read.map((r, i) => Math.abs(r[3] - want[i][3]));
		expect({ read, close: Math.max(...off) < 4 }).toMatchObject({ close: true });
		t.maps.setFlash(0);
		const [unlit, lit, deep] = [
			(await t.at({ x: 1, y: 0 }))[0],
			(await t.at({ x: 2, y: 0 }))[0],
			(await t.at({ x: 0, y: 1 }))[0]
		];
		expect(lit).toBeGreaterThan(250);
		expect(unlit).toBeLessThan(lit);
		expect(deep).toBeLessThan(unlit);
	});

	it('add nothing from an emissive surface in a hidden cell', async () => {
		const t = await setup();
		t.quad.material = t.glow;
		t.maps.update(GRID, { fog: FOG, mode: 'player' }, 'dark', null, null, null, null);
		expect(await t.at({ x: 2, y: 1 })).toEqual([0, 0, 0]);
		expect((await t.at({ x: 1, y: 0 }))[0]).toBeGreaterThan(200);
	});

	it('cut above the cut height, and compile nothing', async () => {
		const t = await setup();
		t.quad.material = t.plain;
		t.maps.update(GRID, { fog: FOG, mode: 'player' }, 'day', null, null, null, null);
		const visible = { x: 1, y: 0 };
		const hidden = { x: 2, y: 1 };
		expect(await t.at(visible)).toEqual([255, 255, 255]);
		const programs = t.programs();

		t.maps.setCut(-0.1);
		expect(await t.at(visible)).toEqual([0, 0, 0]);
		t.maps.setCut(0.1);
		expect(await t.at(visible)).toEqual([255, 255, 255]);
		t.maps.setCut(null);

		expect(await t.at(hidden)).toEqual([0, 0, 0]);

		// Fog off and on, GM and player, every ambient, the flash, a new grid size.
		t.maps.setFog(null, 'player');
		expect(await t.at(hidden)).toEqual([255, 255, 255]);
		t.maps.setFog(FOG, 'gm');
		await t.at(hidden);
		for (const ambient of ['dusk', 'dark', 'day'] as const) {
			t.maps.setLight(ambient, null, null);
			await t.at(hidden);
		}
		t.maps.setFlash(0.5);
		await t.at(hidden);
		const bigger = { ...GRID, width: 7, height: 5 };
		t.maps.update(bigger, { fog: null, mode: 'player' }, 'day', null, null, null, null);
		await t.at(hidden);
		expect(t.programs()).toBe(programs);
	});
});

describe('the sky’s lights on the GPU', () => {
	it('keep sun and sky out of a dark area and the sun off a roof; the flash lifts both', async () => {
		const t = await setup();
		t.scene.remove(t.ambient);
		const sun = new SkyLight(0xffffff, 0);
		sun.position.set(0, 5, 0);
		const sky = new SkyHemisphere(0xffffff, 0x000000, 0);
		t.scene.add(sun, sun.target, sky);
		t.quad.material = createMaterial('surface', { params: { color: 0xffffff } });
		const dark = new Uint8Array(GRID.width * GRID.height);
		const roof = new Uint8Array(GRID.width * GRID.height);
		dark[0] = 1; // (0, 0), with open ground beside it
		roof[4] = 1; // (1, 1)
		t.maps.setInterior(roof);
		t.maps.update(GRID, { fog: null, mode: 'player' }, 'day', null, dark, null, null);
		const [darkCell, roofCell, openCell] = [
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
			{ x: 2, y: 0 }
		];
		const read = async (cell: GridPos) => (await t.at(cell))[0];
		const light = (s: number, h: number) => {
			sun.intensity = s;
			sky.intensity = h;
		};
		light(0, 0);
		const none = await read(darkCell);
		light(3, 0);
		const programs = t.programs();
		const sunOnly = [await read(darkCell), await read(roofCell), await read(openCell)];
		light(0, 2);
		const skyOnly = [await read(darkCell), await read(roofCell), await read(openCell)];
		t.maps.setFlash(1);
		light(3, 2);
		const flashed = await read(darkCell);
		t.maps.setFlash(0);
		expect({ none, sunOnly, skyOnly, flashed }).toMatchObject({
			none: 0,
			sunOnly: [0, 0, expect.any(Number)],
			skyOnly: [0, expect.any(Number), expect.any(Number)]
		});
		expect(sunOnly[2]).toBeGreaterThan(100);
		// The roof keeps the sky's fill, less than the open sky, and more than nothing.
		expect(skyOnly[1]).toBeGreaterThan(20);
		expect(skyOnly[1]).toBeLessThan(skyOnly[2]);
		expect(flashed).toBeGreaterThan(100);
		// No lift, no interior, no dark: values only.
		t.maps.setInterior(null);
		t.maps.setLight('day', null, null);
		await read(roofCell);
		expect(t.programs()).toBe(programs);
	});
});
