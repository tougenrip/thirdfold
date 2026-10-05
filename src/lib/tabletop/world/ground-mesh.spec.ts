// The dual-grid ground (#240): rounded and chamfered corners, filled concave
// corners, saddles as dualCase joins them, the void's plane, chunks that hold
// only their own cells, and on seeded random tables (fogged and not) the
// invariant harness and rays from above that never fall through. The fixtures
// are in fixtures.spec.ts.

import { describe, expect, it } from 'vitest';
import { FLOOR_IDS, VOID } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import { chunkGround } from './ground-mesh';
import { chasmOf, CHASM_DEPTH, OPEN_REACH, SCROLL_DEPTH } from './chasm';
import { tableGround } from './join';
import { checkEmitter } from './invariants';
import { cracks, hit, randomTable, topAt } from './random-table';
import { CHUNK, chunksAcross, worldShape, type ShapeInput } from './shape';

const STONE = FLOOR_IDS.indexOf('stone');
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

describe('the dual-grid ground', () => {
	it("rounds a lone raised cell's corners, flat over its middle", () => {
		const m = tableGround(shapeOf({ grid: grid(3, 3), levels: bytes(0, 0, 0, 0, 2, 0, 0, 0, 0) }));
		expect(topAt(m, 0, 0)).toBeCloseTo(2 * LEVEL);
		expect(topAt(m, -0.3, -0.3)).toBeCloseTo(2 * LEVEL); // inside the quarter circle
		expect(topAt(m, -0.45, -0.45)).toBeCloseTo(0); // beyond it: cut down
		expect(topAt(m, 0.45, 0.2)).toBeCloseTo(2 * LEVEL); // along a side, square
	});

	it('chamfers a man-made floor instead, by 0.05 of a cell', () => {
		const floor = new Uint8Array(9).fill(STONE);
		const m = tableGround(
			shapeOf({ grid: grid(3, 3), levels: bytes(0, 0, 0, 0, 2, 0, 0, 0, 0), floor })
		);
		expect(topAt(m, -0.47, -0.47)).toBeCloseTo(2 * LEVEL);
		expect(topAt(m, -0.48, -0.48)).toBeCloseTo(0);
	});

	it('fills a concave corner up to the ground round it', () => {
		const m = tableGround(shapeOf({ grid: grid(3, 3), levels: bytes(0, 2, 2, 2, 2, 2, 2, 2, 2) }));
		// Cell (0, 0) is the low one; its corner at (-0.5, -0.5) meets three raised cells.
		expect(topAt(m, -0.55, -0.55)).toBeCloseTo(2 * LEVEL);
		expect(topAt(m, -0.7, -0.7)).toBeCloseTo(0);
	});

	it('pinches a saddle nobody can cross and joins one everybody can, the higher pair', () => {
		const pinched = tableGround(shapeOf({ grid: grid(2, 2), levels: bytes(3, 0, 0, 3) }));
		expect(topAt(pinched, -0.03, -0.03)).toBeCloseTo(3 * LEVEL); // square to the corner
		expect(topAt(pinched, 0.03, -0.03)).toBeCloseTo(0);
		const joined = tableGround(shapeOf({ grid: grid(2, 2), levels: bytes(1, 0, 0, 1) }));
		expect(topAt(joined, 0.03, -0.03)).toBeCloseTo(LEVEL); // the low quarter filled
		expect(topAt(joined, -0.03, -0.03)).toBeCloseTo(LEVEL);
	});

	it("drops the void to the chasm's floor (#243), with sides down to it", () => {
		const s = shapeOf({ grid: grid(3, 1), levels: bytes(1, 1, 1), floor: bytes(0, VOID, 0) });
		const m = tableGround(s);
		expect(topAt(m, 0, 0)).toBeCloseTo(-CHASM_DEPTH * LEVEL);
		expect(topAt(m, 1, 0)).toBeCloseTo(LEVEL);
		expect(hit(m, [0, 0.2, 0], [1, 0, 0])).toBeCloseTo(0.5);
		expect(hit(m, [0, -4, 0], [1, 0, 0])).toBeCloseTo(0.5);
		expect(checkEmitter(s, m)).toEqual([]);
		// Its floor is the chunk's `bottom`, apart from the tops; the moving ground's is higher.
		const { top, bottom } = chunkGround(s, 0);
		expect(Math.min(...top.positions.filter((_, i) => i % 3 === 1))).toBeCloseTo(LEVEL);
		expect(new Set(bottom.positions.filter((_, i) => i % 3 === 1))).toEqual(
			new Set([Math.fround(-CHASM_DEPTH * LEVEL)])
		);
		const scroll = chasmOf({ kind: 'prairie-scroll', level: 0 });
		expect(topAt(tableGround(s, scroll), 0, 0)).toBeCloseTo(-SCROLL_DEPTH * LEVEL);
	});

	it('opens a known void on the border outward when the backdrop beyond is no land', () => {
		const s = shapeOf({ grid: grid(3, 1), levels: null, floor: bytes(VOID, VOID, 0) });
		const abyss = chasmOf({ kind: 'abyss', level: 0 });
		// Closed: a wall up to the border's 0. Open: none, the floor running on past the edge.
		expect(hit(tableGround(s), [-1.4, -1, 0], [-1, 0, 0])).toBeCloseTo(0.1);
		const open = tableGround(s, abyss);
		expect(hit(open, [-1.4, -1, 0], [-1, 0, 0])).toBe(Infinity);
		expect(topAt(open, -1.5 - OPEN_REACH / 2, 0)).toBeCloseTo(-CHASM_DEPTH * LEVEL);
		expect(topAt(open, -1.5 - OPEN_REACH / 2, 0.45)).toBeCloseTo(-CHASM_DEPTH * LEVEL);
		expect(checkEmitter(s, open)).toEqual([]);
		// Unexplored, it stays shut: nothing is drawn past an edge nobody has seen.
		const fogged = shapeOf({
			grid: grid(3, 1),
			floor: bytes(VOID, VOID, 0),
			known: bytes(0, 1, 1)
		});
		expect(topAt(tableGround(fogged, abyss), -1.6, 0)).toBe(-Infinity);
	});

	it('builds each chunk from its own cells only, and the chunks make the whole table', () => {
		const s = worldShape({ ...randomTable(3, 40, 20), known: null });
		const across = chunksAcross(s.grid);
		expect(across).toEqual({ x: 3, y: 2 });
		let triangles = 0;
		for (let c = 0; c < across.x * across.y; c++) {
			const { top, sides } = chunkGround(s, c);
			const [x0, y0] = [(c % across.x) * CHUNK, Math.floor(c / across.x) * CHUNK];
			const stray = [...top.owners, ...sides.owners].filter((i) => {
				const [x, y] = [i % s.grid.width, Math.floor(i / s.grid.width)];
				return x < x0 || y < y0 || x >= x0 + CHUNK || y >= y0 + CHUNK;
			});
			expect(stray, `chunk ${c}`).toEqual([]);
			triangles += (top.indices.length + sides.indices.length) / 3;
		}
		expect(tableGround(s).indices.length / 3).toBe(triangles);
	});
});

describe('seeded random tables', () => {
	const tables = Array.from({ length: 120 }, (_, seed) => randomTable(seed + 1));

	it('pass the harness and never let a ray through, fogged and not', () => {
		for (const [k, t] of tables.entries()) {
			for (const known of [t.known, null]) {
				const s = worldShape({ ...t, known });
				const m = tableGround(s);
				const name = `seed ${k + 1}${known ? '' : ', all known'}`;
				expect(checkEmitter(s, m), name).toEqual([]);
				expect(cracks(m, s.grid, k), name).toEqual([]);
			}
		}
	}, 60_000);
});
