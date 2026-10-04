// Cliffs and risers (#241): a one-level edge is a riser (a nosing at the edge
// over a riser set back under it), two levels or more or a drop into the void a
// cliff (a rim at the edge over a face set back by noise, never past
// MAX_NOISE), faces made by unexplored cells plain; the same arrays on every
// build; chunks of their own cells only; and on seeded random tables, fogged and
// not, the invariant harness and rays from above that never fall through. The
// fixtures are in fixtures.spec.ts.

import { describe, expect, it } from 'vitest';
import { FLOOR_IDS, VOID } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import {
	chunkWorld,
	DEEPEST,
	LIP,
	NOSING,
	profile,
	FACE,
	RECESS,
	SET_BACK,
	styleOf,
	tableWorld
} from './cliffs';
import { checkEmitter } from './invariants';
import { cracks, hit, randomTable, topAt } from './random-table';
import { CHUNK, chunksAcross, MAX_NOISE, worldShape, type ShapeInput } from './shape';

const LEVEL = 0.4; // STEP_HEIGHT at a cell size of 1
const grid = (width: number, height: number): SquareGrid => ({
	kind: 'square',
	cellSize: 1,
	width,
	height
});
const shapeOf = (over: Partial<ShapeInput> & { grid: SquareGrid }) =>
	worldShape({ levels: null, floor: null, objects: [], known: null, ...over });
const bytes = (...v: number[]) => Uint8Array.from(v);

/**
 * How far behind the edge at x = -0.5 a ray from the west at height y meets a face, on a 3x5
 * table whose rows are all `row` (so the middle row's faces run on, far from any corner).
 */
function setBack(row: Uint8Array, y: number, z = 0.1) {
	const levels = new Uint8Array(15);
	for (let r = 0; r < 5; r++) levels.set(row, r * 3);
	const m = tableWorld(shapeOf({ grid: grid(3, 5), levels }));
	return hit(m, [-1.5, y, z], [1, 0, 0]) - 1;
}

describe('cliffs and risers', () => {
	it('draws a one-level edge as a riser: a nosing at the edge, the riser set back under it', () => {
		const levels = bytes(0, 1, 0);
		expect(setBack(levels, LEVEL - NOSING / 2)).toBeCloseTo(0, 5);
		expect(setBack(levels, LEVEL / 2)).toBeCloseTo(RECESS, 5);
		// No noise: the same set-back all along the edge.
		for (const z of [-0.2, 0, 0.2]) expect(setBack(levels, LEVEL / 2, z)).toBeCloseTo(RECESS, 5);
	});

	it('draws two levels or more as a cliff: a rim at the edge, a face set back by noise', () => {
		for (const level of [2, 5]) {
			const levels = bytes(0, level, 0);
			expect(setBack(levels, level * LEVEL - LIP / 2)).toBeCloseTo(0, 5);
			const depths = [0.2, 0.35, 0.5, 0.65].map((k) => setBack(levels, k * level * LEVEL));
			for (const d of depths) {
				expect(d).toBeGreaterThanOrEqual(SET_BACK - 1e-6);
				expect(d).toBeLessThanOrEqual(MAX_NOISE);
			}
			// Noise: not one flat face.
			expect(Math.max(...depths) - Math.min(...depths)).toBeGreaterThan(0.002);
		}
		// Cliffs and risers differ in shape: under the rim the riser is straight, the cliff is not.
		expect(DEEPEST).toBeLessThan(MAX_NOISE);
	});

	it('draws a drop into the void as a cliff, even a step down', () => {
		const levels = bytes(1, 1, 1);
		const m = tableWorld(shapeOf({ grid: grid(3, 1), levels, floor: bytes(VOID, 0, 0) }));
		// The cell at x = 0 stands a step above the void's floor at x = -1.
		const y = LEVEL - (LIP + SET_BACK) - 0.05;
		expect(hit(m, [-1.5, y, 0.1], [1, 0, 0]) - 1).toBeGreaterThanOrEqual(SET_BACK - 1e-6);
		expect(profile(FACE.cliff, 0, LEVEL, 1).some((r) => r.noisy)).toBe(true);
	});

	it('keeps every top at its floor and stands nothing over the lower cell', () => {
		const levels = bytes(0, 3, 1);
		const m = tableWorld(shapeOf({ grid: grid(3, 1), levels }));
		expect(topAt(m, 0, 0)).toBeCloseTo(3 * LEVEL);
		expect(topAt(m, -0.45, 0.2)).toBeCloseTo(3 * LEVEL);
		expect(topAt(m, -0.55, 0.2)).toBeCloseTo(0);
		expect(topAt(m, 0.55, 0.2)).toBeCloseTo(LEVEL);
	});

	it('tapers a face to the edge where it ends alone, so a corner never opens', () => {
		// A lone raised block: its faces end at sharp corners (stone: chamfered, not rounded).
		const stone = FLOOR_IDS.indexOf('stone');
		const s = shapeOf({
			grid: grid(3, 3),
			levels: bytes(0, 0, 0, 0, 3, 0, 0, 0, 0),
			floor: new Uint8Array(9).fill(stone)
		});
		const m = tableWorld(s);
		expect(checkEmitter(s, m)).toEqual([]);
		expect(cracks(m, s.grid, 7, 400)).toEqual([]);
	});

	it('styles faces by the floor of the cell that makes them', () => {
		expect(styleOf(FLOOR_IDS.indexOf('stone'))).toBe(1);
		expect(styleOf(FLOOR_IDS.indexOf('wood'))).toBe(1);
		for (const id of ['plain', 'grass', 'dirt', 'sand', 'water'] as const)
			expect(styleOf(FLOOR_IDS.indexOf(id)), id).toBe(0);
		const s = shapeOf({
			grid: grid(3, 1),
			levels: bytes(0, 2, 0),
			floor: bytes(0, FLOOR_IDS.indexOf('stone'), 0)
		});
		const { sides } = chunkWorld(s, 0);
		expect(sides[0].indices.length).toBe(0);
		expect(sides[1].indices.length).toBeGreaterThan(0);
	});

	it('leaves faces made by unexplored cells plain, and none toward them from known ones', () => {
		const t = randomTable(11);
		const s = worldShape(t);
		const { sides } = chunkWorld(s, 0);
		for (const mesh of sides)
			for (let v = 0; v < mesh.owners.length; v++)
				if (!s.known![mesh.owners[v]]) expect(mesh.colors[v * 3]).toBe(1);
		expect(checkEmitter(s, tableWorld(s))).toEqual([]);
	});

	it('builds the same arrays every time', () => {
		const s = worldShape({ ...randomTable(5, 40, 20), known: null });
		const across = chunksAcross(s.grid);
		for (let c = 0; c < across.x * across.y; c++)
			expect(chunkWorld(s, c)).toEqual(chunkWorld(s, c));
	});

	it('builds each chunk from its own cells only', () => {
		const s = worldShape({ ...randomTable(3, 40, 20), known: null });
		const across = chunksAcross(s.grid);
		for (let c = 0; c < across.x * across.y; c++) {
			const { top, sides } = chunkWorld(s, c);
			const [x0, y0] = [(c % across.x) * CHUNK, Math.floor(c / across.x) * CHUNK];
			const stray = [top, ...sides]
				.flatMap((m) => [...m.owners])
				.filter((i) => {
					const [x, y] = [i % s.grid.width, Math.floor(i / s.grid.width)];
					return x < x0 || y < y0 || x >= x0 + CHUNK || y >= y0 + CHUNK;
				});
			expect(stray, `chunk ${c}`).toEqual([]);
		}
	});
});

describe('cliffs on seeded random tables', () => {
	const tables = Array.from({ length: 120 }, (_, seed) => randomTable(seed + 1));

	it('pass the harness and never let a ray through, fogged and not', () => {
		for (const [k, t] of tables.entries()) {
			for (const known of [t.known, null]) {
				const s = worldShape({ ...t, known });
				const m = tableWorld(s);
				const name = `seed ${k + 1}${known ? '' : ', all known'}`;
				expect(checkEmitter(s, m), name).toEqual([]);
				expect(cracks(m, s.grid, k, 120), name).toEqual([]);
			}
		}
	}, 120_000);
});
