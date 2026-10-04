// The floor splat (#242) drawn: a 4x4 table of grass, grass, dirt and stone columns, seen straight
// down, on the terrain kind with stand-in arrays of one flat colour per floor. A soft border
// (grass and dirt) is a blend on the grid line, straight without noise and wandering with it (the
// anti-tiled graph), and moved by height (the higher surface shows through); a hard one (dirt and
// stone) is crisp on the line with a darker kerb inside the stone; neither blends nor kerbs
// toward an unexplored cell or across a level. None of it compiles anything after the first frame
// of each graph: painting floors, the arrays coming and going, the fog and the kerb's width.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it } from 'vitest';
import { FLOOR_IDS, type FloorId } from '$lib/game/floor';
import { encodeMask } from '$lib/game/visibility';
import { CellMaps, cellUniforms } from './cell-maps';
import { EDGE_BAND, EDGE_NOISE } from './fog-soft';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import { createMaterial, prepareSlotTexture, SLOTS } from './materials';
import { splatUniforms, wearFloors, type FloorMap } from './materials/floors';
import { BACKEND } from './testing';

const SIZE = 256;
/** Pixels per cell: the table is 4 cells across the view. */
const CELL = SIZE / 4;
const GRID = { kind: 'square' as const, width: 4, height: 4, cellSize: 1 };
/** Each column's floor, west to east. */
const COLUMNS: FloorId[] = ['grass', 'grass', 'dirt', 'stone'];
const COLOURS: Partial<Record<FloorId, [number, number, number]>> = {
	grass: [40, 200, 40],
	dirt: [200, 110, 30],
	stone: [170, 170, 170]
};
const LAYERED: FloorId[] = ['grass', 'dirt', 'stone'];

let renderer: THREE.WebGPURenderer | null = null;
let maps: CellMaps | null = null;
afterEach(() => {
	wearFloors(null, 1);
	maps?.dispose();
	renderer?.dispose();
	renderer = maps = null;
	splatUniforms.kerbWidth.value = 0.05;
	cellUniforms.edgeBand.value = EDGE_BAND;
	cellUniforms.edgeNoise.value = EDGE_NOISE;
});

/** One array per map: a flat colour per layer, its height in alpha. */
function arrays(heights: Partial<Record<FloorId, number>> = {}): Record<FloorMap, THREE.Texture> {
	const make = (map: FloorMap, texel: (id: FloorId) => number[]) => {
		const n = 4 * 4;
		const data = new Uint8Array(n * 4 * LAYERED.length);
		LAYERED.forEach((id, layer) => {
			for (let i = 0; i < n; i++) data.set(texel(id), (layer * n + i) * 4);
		});
		const t = new THREE.DataArrayTexture(data, 4, 4, LAYERED.length);
		return prepareSlotTexture(t, SLOTS[map]);
	};
	return {
		albedo: make('albedo', (id) => [...COLOURS[id]!, heights[id] ?? 128]),
		normal: make('normal', () => [128, 128, 255, 255]),
		orm: make('orm', () => [255, 255, 0, 255])
	};
}

const floorOf = (columns: FloorId[]) =>
	Uint8Array.from({ length: 16 }, (_, i) => FLOOR_IDS.indexOf(columns[i % 4]));

async function setup(antiTiled: boolean) {
	const canvas = document.createElement('canvas');
	const r = await createNodeRenderer(canvas, {
		pixelRatio: 1,
		antialias: false,
		backend: BACKEND === 'webgpu' ? 'webgpu' : 'webgl'
	});
	renderer = r;
	r.setSize(SIZE, SIZE, false);
	const cells = new CellMaps();
	maps = cells;
	cells.setGrid(GRID);
	cells.setFog(null, 'gm');
	cells.setGround(floorOf(COLUMNS), null);
	const scene = new THREE.Scene();
	scene.add(new THREE.AmbientLight(0xffffff, 3));
	const plane = new THREE.PlaneGeometry(4, 4);
	plane.rotateX(-Math.PI / 2);
	scene.add(new THREE.Mesh(plane, createMaterial('terrain', { antiTiled })));
	// Straight down, x to the right.
	const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 20);
	camera.position.set(0, 5, 0);
	camera.up.set(0, 0, -1);
	camera.lookAt(0, 0, 0);
	const target = new THREE.RenderTarget(SIZE, SIZE);
	return {
		cells,
		async draw() {
			advanceNodeFrame(r);
			r.setRenderTarget(target);
			r.render(scene, camera);
			r.setRenderTarget(null);
			const px = (await r.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE)) as Uint8Array;
			return px.slice();
		},
		programs: () => r.info.memory.programs
	};
}

const pixel = (px: Uint8Array, x: number, y: number) => {
	const i = (y * SIZE + Math.round(x)) * 4;
	return [px[i], px[i + 1], px[i + 2]];
};
/** How much of a pixel is dirt rather than grass, by its red over green: 0 grass, 1 dirt. */
const dirtness = ([r, g]: number[]) => {
	const d = (r - g) / Math.max(1, r + g);
	const [lo, hi] = [-0.8, 0.45]; // grass and dirt as drawn, about
	return Math.min(1, Math.max(0, (d - lo) / (hi - lo)));
};
const brightness = ([r, g, b]: number[]) => r + g + b;
/** Rows across the middle of every cell row, away from the cells' own centre lines. */
const ROWS = Array.from({ length: 48 }, (_, i) => 8 + Math.floor((i * (SIZE - 16)) / 47));

/** Where, in each row, the grass-dirt border (x = 0, column SIZE / 2) turns to dirt: in px. */
function borders(px: Uint8Array): number[] {
	return ROWS.map((y) => {
		for (let x = CELL; x < 3 * CELL; x++) if (dirtness(pixel(px, x, y)) >= 0.5) return x;
		return -1;
	});
}

describe('the floor splat', () => {
	it.each([
		['without noise (low)', false],
		['with noise (medium and up)', true]
	] as const)('blends soft borders, keeps hard ones crisp and kerbed, %s', async (_, antiTiled) => {
		const { cells, draw, programs } = await setup(antiTiled);
		wearFloors({ maps: arrays(), layers: { grass: 0, dirt: 1, stone: 2 } }, 1);
		let px = await draw();
		const p0 = programs();
		const line = SIZE / 2;

		// Soft: grass well inside its cell, dirt well inside its own, a blend near the line.
		const at = borders(px);
		expect(at.every((x) => x > 0)).toBe(true);
		for (const y of ROWS) {
			expect(dirtness(pixel(px, line - CELL / 3, y))).toBeLessThan(0.1);
			expect(dirtness(pixel(px, line + CELL / 3, y))).toBeGreaterThan(0.9);
		}
		const spread = Math.max(...at) - Math.min(...at);
		const off = Math.max(...at.map((x) => Math.abs(x - line)));
		if (antiTiled) {
			// It wanders, but never by more than the noise's reach and the blend's band.
			expect(spread).toBeGreaterThan(2);
			expect(off).toBeLessThanOrEqual(Math.ceil(CELL * 0.25));
		} else {
			expect(spread).toBeLessThanOrEqual(1);
			expect(off).toBeLessThanOrEqual(1);
		}

		// Hard: dirt to the line, stone from it, a darker kerb inside the stone.
		const edge = (3 * SIZE) / 4;
		for (const y of ROWS) {
			expect(dirtness(pixel(px, edge - 2, y))).toBeGreaterThan(0.9);
			const [r, g, b] = pixel(px, edge + 1, y);
			expect(Math.max(Math.abs(r - g), Math.abs(g - b))).toBeLessThan(12); // grey
			expect(brightness([r, g, b])).toBeLessThan(0.85 * brightness(pixel(px, edge + CELL / 2, y)));
		}

		// Height: dirt standing higher shows through further into the grass.
		const tall = arrays({ grass: 40, dirt: 250 });
		wearFloors({ maps: tall, layers: { grass: 0, dirt: 1, stone: 2 } }, 1);
		px = await draw();
		const higher = borders(px);
		const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
		expect(mean(higher)).toBeLessThan(mean(at) - 1);

		// Across a level: the dirt a step up, so its border is the grid line.
		cells.setGround(
			floorOf(COLUMNS),
			Uint8Array.from({ length: 16 }, (_, i) => (i % 4 === 2 ? 1 : 0))
		);
		px = await draw();
		for (const y of ROWS) expect(dirtness(pixel(px, line - 2, y))).toBeLessThan(0.1);
		cells.setGround(floorOf(COLUMNS), null);

		// Toward an unexplored column (the dirt): no blend from the grass, no kerb on the stone
		// (the fog's soft edge, which would darken both, held to the line for this).
		cellUniforms.edgeBand.value = 1e-3;
		cellUniforms.edgeNoise.value = 0;
		const known = encodeMask(Uint8Array.from({ length: 16 }, (_, i) => (i % 4 === 2 ? 0 : 1)));
		cells.setFog({ enabled: true, visible: known, explored: known, shared: false }, 'player');
		px = await draw();
		for (const y of ROWS) {
			expect(dirtness(pixel(px, line - 2, y))).toBeLessThan(0.1);
			expect(brightness(pixel(px, line + CELL / 2, y))).toBe(0); // unexplored: black
			expect(brightness(pixel(px, edge + 1, y))).toBeGreaterThan(
				0.95 * brightness(pixel(px, edge + CELL / 2, y))
			);
		}
		cells.setFog(null, 'gm');

		// Data only from here: floors painted every way, the kerb's width, the arrays gone and back.
		for (const id of FLOOR_IDS) {
			cells.setGround(floorOf([id, 'grass', id, 'stone']), null);
			await draw();
		}
		splatUniforms.kerbWidth.value = 0.2;
		wearFloors(null, 1);
		await draw();
		wearFloors({ maps: arrays(), layers: { grass: 0, dirt: 1, stone: 2 } }, 1);
		await draw();
		expect(programs()).toBe(p0);
	});

	it('falls back to the floor colours, blended too, while the arrays are away', async () => {
		const { draw } = await setup(false);
		wearFloors(null, 1);
		const px = await draw();
		const line = SIZE / 2;
		const y = SIZE / 2 + 8;
		// FLOOR_LOOKS' grass and dirt, mixed on the line, each its own away from it.
		const [grass, dirt, mid] = [line - CELL / 3, line + CELL / 3, line].map((x) => pixel(px, x, y));
		expect(grass[1]).toBeGreaterThan(grass[0]);
		expect(dirt[0]).toBeGreaterThan(dirt[1]);
		expect(mid[0]).toBeGreaterThan(Math.min(grass[0], dirt[0]) - 2);
		expect(mid[0]).toBeLessThan(Math.max(grass[0], dirt[0]) + 2);
	});
});
