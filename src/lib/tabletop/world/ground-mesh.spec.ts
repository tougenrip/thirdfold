// The dual-grid ground (#240): rounded and chamfered corners, filled concave
// corners, saddles as dualCase joins them, the void's plane, chunks that hold
// only their own cells, and on seeded random tables (fogged and not) the
// invariant harness and rays from above that never fall through. The fixtures
// are in fixtures.spec.ts.

import { describe, expect, it } from 'vitest';
import { FLOOR_IDS, VOID } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import { chunkGround, tableGround, type GroundMesh } from './ground-mesh';
import { checkEmitter } from './invariants';
import { random, randomTable } from './random-table';
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

/** The first hit along a ray from `o` in direction `d` (any facing), as its distance, or Infinity. */
function hit(m: GroundMesh, o: number[], d: number[]): number {
	const p = m.positions;
	let best = Infinity;
	for (let t = 0; t < m.indices.length; t += 3) {
		const [a, b, c] = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3];
		const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
		const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
		const q = [
			d[1] * e2[2] - d[2] * e2[1],
			d[2] * e2[0] - d[0] * e2[2],
			d[0] * e2[1] - d[1] * e2[0]
		];
		const det = e1[0] * q[0] + e1[1] * q[1] + e1[2] * q[2];
		if (Math.abs(det) < 1e-12) continue;
		const s = [o[0] - p[a], o[1] - p[a + 1], o[2] - p[a + 2]];
		const u = (s[0] * q[0] + s[1] * q[1] + s[2] * q[2]) / det;
		if (u < -1e-7 || u > 1 + 1e-7) continue;
		const r = [
			s[1] * e1[2] - s[2] * e1[1],
			s[2] * e1[0] - s[0] * e1[2],
			s[0] * e1[1] - s[1] * e1[0]
		];
		const v = (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / det;
		if (v < -1e-7 || u + v > 1 + 1e-7) continue;
		const dist = (e2[0] * r[0] + e2[1] * r[1] + e2[2] * r[2]) / det;
		if (dist > 0 && dist < best) best = dist;
	}
	return best;
}

/** The height of the ground straight below (x, z). */
const topAt = (m: GroundMesh, x: number, z: number) => 10 - hit(m, [x, 10, z], [0, -1, 0]);

/** Rays slanting down from above the table that reach the lowest ground still over it, unhit. */
function cracks(m: GroundMesh, g: SquareGrid, seed: number, rays = 60): string[] {
	const rnd = random(seed);
	const [hw, hd] = [g.width / 2, g.height / 2];
	let [lo, hi] = [Infinity, -Infinity];
	for (let i = 1; i < m.positions.length; i += 3) {
		lo = Math.min(lo, m.positions[i]);
		hi = Math.max(hi, m.positions[i]);
	}
	const out: string[] = [];
	for (let k = 0; k < rays; k++) {
		const o = [(rnd() * 2 - 1) * hw * 0.98, hi + 1, (rnd() * 2 - 1) * hd * 0.98];
		const [tilt, turn] = [0.3 + rnd(), rnd() * Math.PI * 2];
		const d = [Math.sin(tilt) * Math.cos(turn), -Math.cos(tilt), Math.sin(tilt) * Math.sin(turn)];
		const reach = (o[1] - lo + 0.01) / -d[1];
		const [ex, ez] = [o[0] + d[0] * reach, o[2] + d[2] * reach];
		if (Math.abs(ex) > hw - 1e-3 || Math.abs(ez) > hd - 1e-3) continue;
		if (hit(m, o, d) > reach) out.push(`ray ${k} from ${o} along ${d}`);
	}
	return out;
}

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

	it('closes the void with a plane a step below its floor, with sides down to it', () => {
		const s = shapeOf({ grid: grid(3, 1), levels: bytes(1, 1, 1), floor: bytes(0, VOID, 0) });
		const m = tableGround(s);
		expect(topAt(m, 0, 0)).toBeCloseTo(0);
		expect(topAt(m, 1, 0)).toBeCloseTo(LEVEL);
		expect(hit(m, [0, 0.2, 0], [1, 0, 0])).toBeCloseTo(0.5);
		expect(checkEmitter(s, m)).toEqual([]);
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
