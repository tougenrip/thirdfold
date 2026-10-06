// Hips, cross-gables, caps, chimneys and dormers (#258): wings as maximal rectangles, hip heights
// on a rectangle and on L and T houses (the roof's top is the max-norm distance to the outline: a
// straight skeleton's, with no gap or overlap at a valley), caps on every ridge and hip that shows,
// chimneys that stay put as a footprint grows, with their smoke sockets, dormers on long slopes,
// and Bellweather's houses.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { KitRoof } from '$lib/assets/kit';
import type { SquareGrid } from '$lib/game/grid';
import { parseSceneFile } from '$lib/game/scene-file';
import { decodeMask } from '$lib/game/visibility';
import { WALL_HEIGHT } from '../ground';
import {
	CAP_SCALE,
	DORMER_RUN,
	roofMesh,
	type RoofMesh,
	type RoofPieceRole,
	type RoofPieces
} from './roof-mesh';
import { MAX_WINGS, rectsOf, roofRegions, wingsOf } from './roofs';
import { worldShape } from './shape';
import { boxes } from './wall-batch';

const HIP: KitRoof = { style: 'hip', pitch: 45, eave: 0.25, material: 'thatch' };
const GABLE: KitRoof = { ...HIP, style: 'gable' };
/** Where a one-cell roof's ridge is at 45°: the caps' and chimney's pivot. */
const APEX = WALL_HEIGHT + 0.5;
/** Each role a tiny box round its pivot, in a colour of its own. */
const COLOURS: Record<RoofPieceRole, number[]> = {
	'roof.ridge': [1, 0, 0],
	'roof.hip': [0, 1, 0],
	'roof.chimney': [0, 0, 1],
	'roof.dormer': [1, 1, 0]
};
const PIVOTS: Record<RoofPieceRole, number[]> = {
	'roof.ridge': [0, APEX, 0],
	'roof.hip': [0, APEX, 0],
	'roof.chimney': [0, APEX, 0],
	'roof.dormer': [0, WALL_HEIGHT, 0.5]
};
const PIECES: RoofPieces = Object.fromEntries(
	(Object.keys(COLOURS) as RoofPieceRole[]).map((role) => {
		const [x, y, z] = PIVOTS[role];
		const mesh = boxes([[x - 0.01, y - 0.01, z - 0.01, x + 0.01, y + 0.01, z + 0.01]]);
		const colors = new Float32Array(mesh.positions.length).map((_, i) => COLOURS[role][i % 3]);
		const smoke = role === 'roof.chimney' ? ([x, y + 1, z] as const) : undefined;
		return [role, [{ mesh: { ...mesh, colors }, weight: 1, ...(smoke ? { smoke } : {}) }]];
	})
);
const BOX = 24;

const grid = (width: number, height: number): SquareGrid => ({
	kind: 'square',
	cellSize: 1,
	width,
	height
});
/** A footprint from rows of `#` (roofed) and `.`. */
function plan(rows: string[]) {
	const g = grid(rows[0].length, rows.length);
	const footprint = Uint8Array.from(rows.join(''), (c) => (c === '#' ? 1 : 0));
	const shape = worldShape({ grid: g, levels: null, floor: null, objects: [], known: null });
	return { g, footprint, shape, regions: roofRegions(shape, footprint) };
}
const roofOf = (rows: string[], roof: KitRoof, pieces: RoofPieces = {}) => {
	const p = plan(rows);
	return { ...p, mesh: roofMesh(p.shape, p.regions, roof, p.footprint, pieces) };
};

/** The highest roof triangle over (x, z), straight down, or -Infinity. */
function topAt(m: RoofMesh, x: number, z: number): number {
	let best = -Infinity;
	const P = m.positions;
	for (let t = 0; t < m.indices.length; t += 3) {
		const [a, b, c] = [0, 1, 2].map((k) => m.indices[t + k] * 3);
		const d = (P[b + 2] - P[c + 2]) * (P[a] - P[c]) + (P[c] - P[b]) * (P[a + 2] - P[c + 2]);
		if (Math.abs(d) < 1e-9) continue;
		const l1 = ((P[b + 2] - P[c + 2]) * (x - P[c]) + (P[c] - P[b]) * (z - P[c + 2])) / d;
		const l2 = ((P[c + 2] - P[a + 2]) * (x - P[c]) + (P[a] - P[c]) * (z - P[c + 2])) / d;
		const l3 = 1 - l1 - l2;
		if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
		best = Math.max(best, l1 * P[a + 1] + l2 * P[b + 1] + l3 * P[c + 1]);
	}
	return best;
}

/** The max-norm distance from (x, z) to the cells outside the footprint (and the table's edge). */
function distanceOut(g: SquareGrid, footprint: Uint8Array, x: number, z: number): number {
	const [px, pz] = [x + g.width / 2, z + g.height / 2];
	let best = Infinity;
	for (let cy = -1; cy <= g.height; cy++)
		for (let cx = -1; cx <= g.width; cx++) {
			const inside = cx >= 0 && cy >= 0 && cx < g.width && cy < g.height;
			if (inside && footprint[cy * g.width + cx]) continue;
			const dx = Math.max(cx - px, 0, px - cx - 1);
			const dz = Math.max(cy - pz, 0, pz - cy - 1);
			best = Math.min(best, Math.max(dx, dz));
		}
	return best;
}

/** Each piece drawn, by its colour: the centre of its box and the role. */
function piecesIn(m: RoofMesh): { role: RoofPieceRole; at: number[] }[] {
	const out: { role: RoofPieceRole; at: number[] }[] = [];
	for (let v = 0; v < m.colors.length / 3; v++) {
		const c = [...m.colors.slice(v * 3, v * 3 + 3)];
		const role = (Object.keys(COLOURS) as RoofPieceRole[]).find((r) =>
			COLOURS[r].every((k, i) => k === c[i])
		);
		if (!role) continue;
		const at = [0, 1, 2].map(
			(k) => [...Array(BOX)].reduce((s, _, i) => s + m.positions[(v + i) * 3 + k], 0) / BOX
		);
		out.push({ role, at });
		v += BOX - 1;
	}
	return out;
}
const count = (m: RoofMesh, role: RoofPieceRole) => piecesIn(m).filter((p) => p.role === role);

/** Samples a region's cells away from their edges, where the roof must be the skeleton's. */
function expectSkeleton(rows: string[]) {
	const { g, footprint, mesh } = roofOf(rows, HIP);
	let checked = 0;
	for (let i = 0; i < footprint.length; i++) {
		if (!footprint[i]) continue;
		for (const [fx, fz] of [
			[0.25, 0.25],
			[0.5, 0.5],
			[0.75, 0.4],
			[0.3, 0.8]
		]) {
			const x = (i % g.width) + fx - g.width / 2;
			const z = Math.floor(i / g.width) + fz - g.height / 2;
			const want = WALL_HEIGHT + distanceOut(g, footprint, x, z);
			expect(topAt(mesh, x, z), `${rows.join('/')} at ${x},${z}`).toBeCloseTo(want, 6);
			checked++;
		}
	}
	return checked;
}

describe('wings', () => {
	it('are the maximal rectangles: one for a rectangle, two crossing for an L and a T', () => {
		// ###
		// #..
		// #..
		expect(wingsOf([0, 1, 2, 5, 10], 5)).toEqual([
			{ x: 0, y: 0, w: 1, h: 3 },
			{ x: 0, y: 0, w: 3, h: 1 }
		]);
		expect(wingsOf([0, 1, 2, 5, 6, 7], 5)).toEqual([{ x: 0, y: 0, w: 3, h: 2 }]);
		// #####
		// ..#..
		// ..#..
		expect(wingsOf([0, 1, 2, 3, 4, 7, 12], 5)).toEqual([
			{ x: 0, y: 0, w: 5, h: 1 },
			{ x: 2, y: 0, w: 1, h: 3 }
		]);
	});

	it('fall back to the greedy rectangles past MAX_WINGS', () => {
		// A staircase of cells has a wing per step pair.
		const cells: number[] = [];
		for (let y = 0; y < 20; y++) for (let x = 0; x <= y; x++) cells.push(y * 20 + x);
		expect(wingsOf(cells, 20)).toEqual(rectsOf(cells, 20));
		expect(rectsOf(cells, 20).length).toBeGreaterThan(0);
		expect(MAX_WINGS).toBeLessThan(20);
	});
});

describe('hips', () => {
	it('hip a rectangle in closed form: a ridge half the depth in from each end', () => {
		const { mesh } = roofOf(['.......', '.#####.', '.#####.', '.#####.', '.......'], HIP);
		// 5 x 3 at 45°: the ridge 1.5 up, from 1.5 in at each end, the eave 0.25 below the walls.
		const ys = [...mesh.positions].filter((_, i) => i % 3 === 1);
		expect(Math.max(...ys)).toBeCloseTo(WALL_HEIGHT + 1.5);
		expect(Math.min(...ys)).toBeCloseTo(WALL_HEIGHT - 0.25);
		const ridge = [];
		for (let i = 0; i < mesh.positions.length; i += 3)
			if (mesh.positions[i + 1] > WALL_HEIGHT + 1.49) ridge.push(mesh.positions[i]);
		// The house is x -2.5..2.5 in world units: the ridge from -1 to 1.
		expect(Math.min(...ridge)).toBeCloseTo(-1);
		expect(Math.max(...ridge)).toBeCloseTo(1);
		// No gable: every face slopes.
		for (let i = 0; i < mesh.normals.length; i += 3)
			expect(Math.abs(mesh.normals[i + 1])).toBeGreaterThan(0.5);
		expect(expectSkeleton(['.......', '.#####.', '.#####.', '.#####.', '.......'])).toBe(60);
		// A square comes to a point.
		const { mesh: square } = roofOf(['....', '.##.', '.##.', '....'], HIP);
		expect(topAt(square, 0, 0)).toBeCloseTo(WALL_HEIGHT + 1);
	});

	it('roof L and T houses as a straight skeleton would: no gap or overlap at the valleys', () => {
		// An L and a T of two-cell-deep wings, as in ref 8's houses, and a wide L.
		const L = ['........', '.######.', '.######.', '.##.....', '.##.....', '.##.....', '........'];
		const T = ['.........', '.#######.', '.#######.', '...###...', '...###...', '.........'];
		const wide = ['.......', '.###...', '.###...', '.#####.', '.#####.', '.#####.', '.......'];
		for (const rows of [L, T, wide]) expect(expectSkeleton(rows)).toBeGreaterThan(40);
	});

	it('cross gables where a gable kit’s wings meet', () => {
		const L = ['........', '.######.', '.######.', '.##.....', '.##.....', '.##.....', '........'];
		const { mesh, regions } = roofOf(L, GABLE);
		expect(regions[0].rects).toHaveLength(2);
		// Both ridges stand 1 up (two cells deep), crossing over the corner, never a gap below.
		expect(topAt(mesh, -3 + 1, -3.5 + 2.9)).toBeCloseTo(WALL_HEIGHT + 1);
		expect(topAt(mesh, -2, 4.5 - 3.5)).toBeCloseTo(WALL_HEIGHT + 1);
		for (const [x, z] of [
			[-2.9, -2.4],
			[-1.9, 0.9],
			[1.9, -1.6]
		])
			expect(topAt(mesh, x, z)).toBeGreaterThanOrEqual(WALL_HEIGHT - 1e-6);
	});
});

describe('caps, chimneys and dormers', () => {
	it('cap every ridge and hip a cell at a time, on the roof, never twice in a spot', () => {
		const rect = ['.......', '.#####.', '.#####.', '.#####.', '.......'];
		const { mesh } = roofOf(rect, HIP, PIECES);
		// A ridge 2 long: two caps; four hips of 1.75 run, caps half a cell apart from both ends.
		expect(count(mesh, 'roof.ridge')).toHaveLength(2);
		expect(count(mesh, 'roof.hip')).toHaveLength(14);
		const L = ['........', '.######.', '.######.', '.##.....', '.##.....', '.##.....', '........'];
		for (const [rows, roof] of [
			[rect, HIP],
			[L, HIP],
			[L, GABLE]
		] as const) {
			const { mesh: m } = roofOf(rows, roof, PIECES);
			const { mesh: bare } = roofOf(rows, roof);
			const caps = piecesIn(m).filter((p) => p.role === 'roof.ridge' || p.role === 'roof.hip');
			expect(caps.length).toBeGreaterThan(0);
			const spots = new Set(caps.map((p) => p.at.map((v) => v.toFixed(3)).join()));
			expect(spots.size).toBe(caps.length);
			// Each sits on the roof's top there, lifted a little: never buried under another wing.
			for (const { at } of caps) expect(at[1] - topAt(bare, at[0], at[2])).toBeCloseTo(0.015, 4);
		}
		// The gable L caps both ridges, one cap per cell along each where it shows.
		expect(count(roofOf(L, GABLE, PIECES).mesh, 'roof.ridge').length).toBeGreaterThanOrEqual(9);
	});

	it('put a chimney on some houses by a ridge cell’s hash, staying put as the footprint grows', () => {
		let found = 0;
		for (let dx = 0; dx < 16; dx++) {
			const pad = '.'.repeat(dx);
			const bar = [`${pad}..........`, `${pad}.####.....`, `${pad}.####.....`, `${pad}..........`];
			const grown = [
				...bar.slice(0, 3),
				`${pad}.##.......`,
				`${pad}.##.......`,
				`${pad}..........`
			];
			const before = count(roofOf(bar, GABLE, PIECES).mesh, 'roof.chimney');
			if (!before.length) continue;
			found++;
			const after = roofOf(grown, GABLE, PIECES).mesh;
			// The same spot (the grown table is one row longer, so its centre is half a cell lower).
			const moved = before.map((p) =>
				[p.at[0], p.at[1], p.at[2] - 1].map((v) => v.toFixed(4)).join()
			);
			const now = count(after, 'roof.chimney').map((p) => p.at.map((v) => v.toFixed(4)).join());
			expect(now).toEqual(expect.arrayContaining(moved));
			// Its smoke socket, one up from its pivot.
			expect(after.smoke.length).toBe(now.length * 3);
			expect(after.smoke[1]).toBeCloseTo(count(after, 'roof.chimney')[0].at[1] + 1);
			// Down the slope from the ridge, on the roof, and the same every time.
			expect(roofOf(bar, GABLE, PIECES).mesh).toEqual(roofOf(bar, GABLE, PIECES).mesh);
		}
		expect(found).toBeGreaterThan(2);
		expect(found).toBeLessThan(16);
	});

	it('put dormers only on slopes longer than DORMER_RUN, at an outer wall’s eave', () => {
		let dormers = 0;
		for (let dx = 0; dx < 8; dx++) {
			const pad = '.'.repeat(dx);
			const long = [
				`${pad}..........`,
				`${pad}.########.`,
				`${pad}.########.`,
				`${pad}.########.`,
				`${pad}..........`
			];
			const { mesh, g } = roofOf(long, GABLE, PIECES);
			for (const { at } of count(mesh, 'roof.dormer')) {
				dormers++;
				// At the wall's eave line (its pivot), half a cell above the ground's walls.
				expect(at[1]).toBeCloseTo(WALL_HEIGHT);
				expect([1, 4].map((y) => y - g.height / 2)).toContainEqual(at[2]);
			}
			const short = roofOf(
				[`${pad}.......`, `${pad}.####..`, `${pad}.####..`, `${pad}.......`],
				GABLE,
				PIECES
			);
			expect(count(short.mesh, 'roof.dormer')).toHaveLength(0);
		}
		expect(dormers).toBeGreaterThan(0);
		expect(DORMER_RUN).toBe(4);
		expect(CAP_SCALE).toBeLessThan(1);
	});

	it("give Bellweather's houses ridge caps and some of them chimneys and dormers", () => {
		const raw = JSON.parse(readFileSync('tests/fixtures/scenes/village.json', 'utf8'));
		const parsed = parseSceneFile(raw);
		if (!parsed.ok) throw new Error(parsed.error);
		const { grid: g, interior, objects } = parsed.scene;
		const footprint = decodeMask(interior!, g.width * g.height);
		const shape = worldShape({ grid: g, levels: null, floor: null, objects, known: null });
		const regions = roofRegions(shape, footprint);
		const per = regions.map((r) => piecesIn(roofMesh(shape, [r], GABLE, footprint, PIECES)));
		expect(per).toHaveLength(5);
		for (const [i, list] of per.entries()) {
			const ridge = list.filter((p) => p.role === 'roof.ridge').length;
			expect(ridge, `house ${i}`).toBe(Math.max(regions[i].rects[0].w, regions[i].rects[0].h));
		}
		const chimneys = per.filter((l) => l.some((p) => p.role === 'roof.chimney')).length;
		expect(chimneys).toBeGreaterThanOrEqual(2);
		expect(per.flat().some((p) => p.role === 'roof.dormer')).toBe(true);
	});
});
