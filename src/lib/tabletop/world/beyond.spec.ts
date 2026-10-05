// Beyond the grid (#244): the skirt meets the grid and runs to the horizon with the camera always
// above it, the silhouettes stand beyond the camera's reach facing the grid, everything comes from
// scene-level data only (identical for every viewer of every fixture), and the same input always
// builds the same arrays.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SquareGrid } from '$lib/game/grid';
import { BACKDROPS, DEFAULT_WORLD, type WorldLook } from '$lib/game/world';
import { STEP_HEIGHT } from '../ground';
import { spanOf, worldExtents } from '../world-ground';
import {
	beyondHeightAt,
	beyondOf,
	beyondSample,
	crestAt,
	ridgeMesh,
	skirtMesh,
	SKIRT,
	type Beyond,
	type BeyondInput,
	type BeyondMesh
} from './beyond';
import { RECIPES } from './recipes';

const grid = (width: number, height: number, cellSize = 1): SquareGrid => ({
	kind: 'square',
	cellSize,
	width,
	height
});
// 4×4 to 64×64, the Hollow (48×36) and the train (68×7), at two cell sizes.
const GRIDS = [
	...[4, 8, 16, 32, 64].map((n) => grid(n, n)),
	grid(48, 36),
	grid(68, 7),
	grid(10, 6, 2)
];
const label = (g: SquareGrid) => `${g.width}×${g.height} at ${g.cellSize}`;
const ENVIRONMENTS = [null, ...Object.keys(RECIPES), 'not-an-environment'];
const backdrop = (kind: WorldLook['backdrop']['kind'], level = 0) => ({ kind, level });
const make = (g: SquareGrid, environment: string | null, b = DEFAULT_WORLD.backdrop): Beyond =>
	beyondOf({ environment, backdrop: b, span: spanOf(worldExtents(g)) });

/** Byte for byte the same arrays. */
const same = (p: BeyondMesh, q: BeyondMesh) =>
	(['positions', 'uvs', 'indices'] as const).every((k) =>
		Buffer.from(p[k].buffer).equals(Buffer.from(q[k].buffer))
	);

const point = (m: BeyondMesh, v: number) => ({
	x: m.positions[v * 3],
	y: m.positions[v * 3 + 1],
	z: m.positions[v * 3 + 2]
});

describe('the skirt', () => {
	it.each(GRIDS.map((g) => [label(g), g] as const))(
		'meets the grid of %s with no gap or overlap and reaches the horizon',
		(_, g) => {
			const b = make(g, 'village');
			const { halfX: hw, halfZ: hd, horizon } = b.span;
			const m = skirtMesh(b, false);
			const { positions, uvs, indices } = m;
			const count = positions.length / 3;
			expect(uvs.length).toBe(count * 2);
			expect(Math.max(...indices)).toBeLessThan(count);
			// Every triangle faces up seen from above; together they cover the disc less the grid.
			let area = 0;
			for (let i = 0; i < indices.length; i += 3) {
				const [a, p, c] = [indices[i], indices[i + 1], indices[i + 2]].map((v) => point(m, v));
				const up = (p.z - a.z) * (c.x - a.x) - (p.x - a.x) * (c.z - a.z);
				expect(up).toBeGreaterThan(0);
				area += up / 2;
			}
			const rows = 3 + SKIRT.other.loops;
			const around = count / rows;
			let rim = 0;
			for (let i = 0; i < around; i++) {
				const o = point(m, i * rows + rows - 1);
				const n = point(m, ((i + 1) % around) * rows + rows - 1);
				rim += (o.x * n.z - n.x * o.z) / 2;
			}
			expect(Math.abs(area - (rim - 4 * hw * hd))).toBeLessThan(1e-4 * rim);
			expect(rim).toBeGreaterThan(0.99 * Math.PI * horizon * horizon);
			// The inner loop runs round the rectangle's edge at y = 0, through its four corners.
			const inner = Array.from({ length: around }, (_, i) => point(m, i * rows));
			for (const p of inner) {
				expect(Math.abs(Math.abs(p.x) - hw) < 1e-4 || Math.abs(Math.abs(p.z) - hd) < 1e-4).toBe(
					true
				);
				expect(p.y === 0).toBe(true);
			}
			for (const x of [-1, 1])
				for (const z of [-1, 1])
					expect(inner.some((p) => Math.hypot(p.x - x * hw, p.z - z * hd) < 1e-4)).toBe(true);
			// Each vertex is the height function's, to float precision.
			for (let v = 0; v < count; v++) {
				const p = point(m, v);
				expect(p.y).toBeCloseTo(beyondHeightAt(b, p.x, p.z) ?? 0, 3);
			}
		}
	);

	it('has fewer triangles on the low tier', () => {
		const b = make(grid(48, 36), 'cavern');
		expect(skirtMesh(b, true).indices.length).toBeLessThan(skirtMesh(b, false).indices.length / 4);
	});

	it.each(BACKDROPS.flatMap((k) => [0, 3].map((level) => [k, level] as const)))(
		'keeps the camera above it within its reach (%s at level %d)',
		(kind, level) => {
			let [over, inside] = [-Infinity, 0];
			for (const g of GRIDS)
				for (const env of ENVIRONMENTS) {
					const b = make(g, env, backdrop(kind, level));
					const { reach, halfX, halfZ } = b.span;
					const top = Math.max(0, level * STEP_HEIGHT * g.cellSize);
					for (let r = 0; r <= reach; r += reach / 24)
						for (let a = 0; a < 2 * Math.PI; a += Math.PI / 32) {
							const [x, z] = [r * Math.cos(a), r * Math.sin(a)];
							const y = beyondHeightAt(b, x, z);
							if (Math.abs(x) < halfX && Math.abs(z) < halfZ) inside += y === null ? 0 : 1;
							else over = Math.max(over, y! - top);
						}
				}
			expect(inside).toBe(0);
			expect(over).toBeLessThanOrEqual(1e-9);
		}
	);

	it('lies half a level below the backdrop just past the edge, or opens onto the abyss', () => {
		const g = grid(20, 20);
		const step = STEP_HEIGHT;
		const at = (b: Beyond, out: number) => beyondHeightAt(b, 10 + out, 0)!;
		expect(at(make(g, 'village'), 0) === 0).toBe(true);
		expect(at(make(g, 'village'), 0.5)).toBeCloseTo(-step / 2, 9);
		expect(at(make(g, 'village', backdrop('plains', 2)), 0.5)).toBeCloseTo(1.5 * step, 9);
		expect(at(make(g, 'village', backdrop('sea')), 3)).toBeCloseTo(-step / 2, 9);
		const abyss = make(g, 'cavern', backdrop('abyss'));
		expect(at(abyss, 3)).toBeLessThan(-step);
		expect(at(abyss, abyss.span.frame / 2)).toBeLessThan(-10);
		// No wall down into the abyss: a gap from the lip to its plane, which runs on under the grid
		// (two more triangles), all of it in the haze.
		const [land, gap] = [skirtMesh(make(g, 'cavern'), false), skirtMesh(abyss, false)];
		expect(gap.indices.length).toBe(land.indices.length + 6);
		const ys = Array.from({ length: gap.positions.length / 3 }, (_, v) => gap.positions[v * 3 + 1]);
		expect(Math.min(...ys)).toBe(Math.fround(at(abyss, 3)));
		expect(at(make(g, 'railcar', backdrop('prairie-scroll')), 3)).toBeCloseTo(-2.5 * step, 9);
	});
});

describe('backdrop kinds', () => {
	it('sample land, water or the void beyond the border', () => {
		const samples = Object.fromEntries(BACKDROPS.map((k) => [k, beyondSample(k)]));
		expect(samples).toEqual({
			none: 'land',
			plains: 'land',
			hills: 'land',
			forest: 'land',
			mountains: 'land',
			sea: 'water',
			abyss: 'void',
			cavern: 'land',
			'prairie-scroll': 'void'
		});
		expect(beyondSample(null)).toBe('land');
	});

	it('pick their own silhouettes, or keep the environment’s (null, sea, abyss, moving ground)', () => {
		const g = grid(24, 24);
		for (const env of Object.keys(RECIPES)) {
			const own = make(g, env).recipe;
			expect(own).toBe(RECIPES[env]);
			for (const k of ['sea', 'abyss', 'prairie-scroll'] as const)
				expect(make(g, env, backdrop(k)).recipe).toBe(own);
			expect(make(g, env, backdrop('none')).recipe.ridges).toEqual([]);
			expect(make(g, env, backdrop('cavern')).recipe.ridges[0].style).toBe('cave');
		}
	});
});

describe('the silhouettes', () => {
	it.each(Object.keys(RECIPES))(
		'of %s stand round the play area under the horizon, facing in',
		(env) => {
			for (const g of GRIDS) {
				const b = make(g, env);
				b.recipe.ridges.forEach((ridge, i) => {
					const m = ridgeMesh(b, i, false);
					const { indices } = m;
					const count = m.positions.length / 3;
					const { halfX, halfZ, cellSize, horizon } = b.span;
					let [near, far] = [Infinity, 0];
					for (let v = 0; v < count; v++) {
						const p = point(m, v);
						near = Math.min(near, Math.hypot(p.x, p.z));
						far = Math.max(far, Math.hypot(p.x, p.z));
					}
					expect(near).toBeGreaterThan(Math.hypot(halfX, halfZ) + 4 * cellSize);
					expect(far).toBeLessThan(horizon);
					let away = 0;
					// Every triangle faces the grid or the sky, so from beyond the ring (where the camera
					// may stand) it is culled and never hides the grid (a mesa's sides between columns
					// stand edge-on to it, within 3 degrees).
					for (let t = 0; t < indices.length; t += 3) {
						const [a, p, c] = [indices[t], indices[t + 1], indices[t + 2]].map((v) => point(m, v));
						const u = [p.x - a.x, p.y - a.y, p.z - a.z];
						const w = [c.x - a.x, c.y - a.y, c.z - a.z];
						const n = [
							u[1] * w[2] - u[2] * w[1],
							u[2] * w[0] - u[0] * w[2],
							u[0] * w[1] - u[1] * w[0]
						];
						const inward = -(n[0] * a.x + n[2] * a.z) / Math.hypot(a.x, a.z);
						if (inward < -0.05 * Math.hypot(...n)) away++;
					}
					expect(away, `${label(g)} ridge ${i}`).toBe(0);
				});
			}
		}
	);

	it('put the village’s mountain and its monastery up the path the first bell looks along', () => {
		const g = grid(36, 28); // Bellweather; MOUNTAIN_PATH is cell (11, 2) in bellweather.ts
		const b = make(g, 'village');
		const path = Math.atan2(2.5 - 14, 11.5 - 18);
		const landmark = RECIPES.village.landmark!;
		expect(Math.abs(path - landmark.azimuth)).toBeLessThan(landmark.width / 2);
		const far = b.recipe.ridges.length - 1;
		const crests = Array.from({ length: 360 }, (_, d) => (d * Math.PI) / 180 - Math.PI).map(
			(a) => ({
				a,
				y: crestAt(b, b.recipe.ridges[far], a, landmark)
			})
		);
		const top = crests.reduce((p, q) => (q.y > p.y ? q : p));
		expect(Math.abs(top.a - landmark.azimuth)).toBeLessThan(0.02);
		// The hall and the tower: a card of four corners each, past the ridge's own vertices.
		const without = ridgeMesh({ ...b, recipe: { ...b.recipe, landmark: undefined } }, far, false);
		const withIt = ridgeMesh(b, far, false);
		expect(withIt.positions.length - without.positions.length).toBe(2 * 4 * 3);
	});
});

describe('the backdrop’s inputs', () => {
	it('are deterministic: the same scene builds the same arrays', () => {
		for (const env of ENVIRONMENTS)
			for (const kind of [null, ...BACKDROPS]) {
				const [b1, b2] = [0, 1].map(() => make(grid(30, 20), env, backdrop(kind, 1)));
				expect(same(skirtMesh(b1, false), skirtMesh(b2, false))).toBe(true);
				b1.recipe.ridges.forEach((_, i) =>
					expect(same(ridgeMesh(b1, i, false), ridgeMesh(b2, i, false))).toBe(true)
				);
			}
	});

	it('do not change with the height of what stands on the grid', () => {
		for (const g of GRIDS)
			expect(spanOf(worldExtents(g, { top: 0.5 }))).toEqual(spanOf(worldExtents(g, { top: 40 })));
	});

	// Every fixture view, as the GM, a player and a spectator are sent it: the backdrop's input is
	// only the environment, the world look's backdrop and the grid, so it is the same for all three.
	const VIEWS = 'tests/fixtures/views';
	const files = readdirSync(VIEWS).filter((f) => f.endsWith('.json'));
	it.each(files)('are scene-level only: %s builds one backdrop for every viewer', (file) => {
		const all = JSON.parse(readFileSync(path.join(VIEWS, file), 'utf8')) as Record<
			string,
			{ grid: SquareGrid; environment: string | null; world: WorldLook }
		>;
		const built = (['gm', 'player', 'spectator'] as const).map((viewer) => {
			const v = all[viewer];
			const input: BeyondInput = {
				environment: v.environment,
				backdrop: v.world.backdrop,
				span: spanOf(worldExtents(v.grid))
			};
			expect(Object.keys(input).sort()).toEqual(['backdrop', 'environment', 'span']);
			const b = beyondOf(input);
			return {
				skirt: skirtMesh(b, true),
				ridges: b.recipe.ridges.map((_, i) => ridgeMesh(b, i, true))
			};
		});
		expect(built[1]).toEqual(built[0]);
		expect(built[2]).toEqual(built[0]);
	});
});
