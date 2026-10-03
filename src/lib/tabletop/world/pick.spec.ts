// The cell DDA (#246): unit rays (straight down, grazing, side, void, border,
// off the grid, a cut), and its equivalence with the picker it replaces, an
// analytic copy of it here (a ray against one box per raised cell, from y = 0
// to its floor, and the y = 0 plane, the nearer winning), over thousands of
// seeded rays from every fixture's named poses: on each scene and GM view as
// sent, and on each fogged player's view over the continued, drawn levels.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeFloor } from '$lib/game/floor';
import { gridToWorld, worldToGrid, type GridPos, type SquareGrid } from '$lib/game/grid';
import { parseSceneFile } from '$lib/game/scene-file';
import { decodeLevels } from '$lib/game/terrain';
import type { FogView } from '$lib/game/visibility';
import { groundFor, STEP_HEIGHT } from '../ground';
import { poseFor, type GridPose } from '../poses';
import { pickCell, type Vec3 } from './pick';
import { knownOf, worldShape } from './shape';

const grid = (width: number, height: number, cellSize = 1): SquareGrid => ({
	kind: 'square',
	width,
	height,
	cellSize
});
/** Heights from levels, as `Ground.floorY` gives them. */
const heights = (g: SquareGrid, levels: ArrayLike<number> | null) => {
	const ground = groundFor(g, levels ? Uint8Array.from(levels) : null);
	return (x: number, y: number) => ground.floorY({ x, y });
};
const down = { x: 0, y: -1, z: 0 };
const above = (g: SquareGrid, c: GridPos, y = 10) => ({ ...gridToWorld(g, c), y });

describe('pickCell', () => {
	const g = grid(4, 3);
	const levels = [0, 0, 0, 0, 0, 2, 5, 0, 0, 0, 0, 0];
	const h = heights(g, levels);

	it('picks the cell straight below, on its floor', () => {
		expect(pickCell(g, h, above(g, { x: 0, y: 0 }), down)).toEqual({
			cell: { x: 0, y: 0 },
			point: { x: -1.5, y: 0, z: -1 },
			face: 'top'
		});
		const raised = pickCell(g, h, above(g, { x: 2, y: 1 }), down);
		expect(raised).toMatchObject({ cell: { x: 2, y: 1 }, face: 'top' });
		expect(raised.point!.y).toBeCloseTo(5 * STEP_HEIGHT);
	});

	it('picks a raised column by its side when the ray comes in under its top', () => {
		// Level from the west at y 1, under the top of (1, 1) (0.8), into its side.
		const p = pickCell(g, h, { x: -5, y: 0.5, z: 0 }, { x: 1, y: 0, z: 0 });
		expect(p).toMatchObject({ cell: { x: 1, y: 1 }, face: 'side', point: { x: -1, y: 0.5 } });
	});

	it('grazes over the lower column to the side of the higher one', () => {
		// Over (1, 1) at 0.8, below the top of (2, 1) at 2.
		const p = pickCell(g, h, { x: -5, y: 1, z: 0 }, { x: 1, y: 0, z: 0 });
		expect(p).toMatchObject({ cell: { x: 2, y: 1 }, face: 'side', point: { x: 0 } });
		// Just above both, it leaves the grid and never meets the plane.
		expect(pickCell(g, h, { x: -5, y: 2.5, z: 0 }, { x: 1, y: 0, z: 0 })).toEqual({
			cell: null,
			point: null
		});
	});

	it('lands on the top of a column it drops onto before leaving it', () => {
		const p = pickCell(g, h, { x: -1.9, y: 1.7, z: 0 }, { x: 1, y: -0.5, z: 0 });
		expect(p).toMatchObject({ cell: { x: 1, y: 1 }, face: 'top' });
		expect(p.point!.y).toBeCloseTo(0.8);
		expect(p.point!.x).toBeCloseTo(-0.1);
	});

	it('gives no cell beyond the grid, but the point on the plane for corners and edges', () => {
		expect(pickCell(g, h, { x: 10, y: 5, z: 0 }, down)).toEqual({
			cell: null,
			point: { x: 10, y: 0, z: 0 }
		});
		// Pointing up from above everything: no cell and no point.
		expect(pickCell(g, h, { x: 0, y: 5, z: 0 }, { x: 0.3, y: 0.2, z: 0 })).toEqual({
			cell: null,
			point: null
		});
		// Across the whole grid above everything, onto the plane beyond.
		const p = pickCell(g, h, { x: -30, y: 3, z: -1 }, { x: 1, y: -0.05, z: 0 });
		expect(p.cell).toBeNull();
		expect(p.point!.x).toBeCloseTo(30);
	});

	it('picks a border cell exactly on the table edge, and a border column by its outer side', () => {
		expect(pickCell(g, h, { x: -2, y: 5, z: -1.5 }, down)).toMatchObject({
			cell: { x: 0, y: 0 }
		});
		const tall = heights(g, [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
		const p = pickCell(g, tall, { x: -5, y: 0.5, z: -1 }, { x: 1, y: 0, z: 0 });
		expect(p).toMatchObject({ cell: { x: 0, y: 0 }, face: 'side', point: { x: -2 } });
	});

	it('falls into void below the table: the void cell, or the side of the column it meets', () => {
		const chasm = (x: number, y: number) => (x === 1 && y === 1 ? -2 : 0);
		const into = pickCell(g, chasm, above(g, { x: 1, y: 1 }), down);
		expect(into).toMatchObject({ cell: { x: 1, y: 1 }, face: 'top', point: { y: -2 } });
		// Slanting into the hole, it meets the far rim's side under the table.
		const slant = pickCell(g, chasm, { x: -1, y: 1, z: 0 }, { x: 1, y: -1.5, z: 0 });
		expect(slant).toMatchObject({ cell: { x: 2, y: 1 }, face: 'side', point: { x: 0 } });
	});

	it('cuts every column above the cut level down to it', () => {
		const p = pickCell(g, h, above(g, { x: 2, y: 1 }), down, 1);
		expect(p).toMatchObject({ cell: { x: 2, y: 1 }, face: 'top' });
		expect(p.point!.y).toBeCloseTo(STEP_HEIGHT);
		// Level 0 stays where it is.
		expect(pickCell(g, h, above(g, { x: 0, y: 2 }), down, 1).point!.y).toBe(0);
	});

	it('scales with the cell size', () => {
		const big = grid(4, 3, 2);
		const p = pickCell(big, heights(big, levels), above(big, { x: 2, y: 1 }), down);
		expect(p).toMatchObject({ cell: { x: 2, y: 1 }, face: 'top' });
		expect(p.point!.y).toBeCloseTo(5 * STEP_HEIGHT * 2);
	});
});

// The picker before #246, in plain maths: the nearest of a box per raised cell and the y = 0 plane.
function reference(g: SquareGrid, levels: Uint8Array | null, o: Vec3, d: Vec3) {
	const ground = groundFor(g, levels);
	let best: { t: number; cell: GridPos; face: 'top' | 'side' } | null = null;
	if (levels)
		for (let i = 0; i < levels.length; i++) {
			if (!levels[i]) continue;
			const cell = { x: i % g.width, y: Math.floor(i / g.width) };
			const c = gridToWorld(g, cell);
			const s = g.cellSize / 2;
			const box = [
				[c.x - s, c.x + s, o.x, d.x],
				[0, ground.floorY(cell), o.y, d.y],
				[c.z - s, c.z + s, o.z, d.z]
			];
			let [tn, tf, axis] = [-Infinity, Infinity, -1];
			for (let k = 0; k < 3; k++) {
				const [lo, hi, ok, dk] = box[k];
				if (dk === 0) {
					if (ok < lo || ok > hi) tn = Infinity;
					continue;
				}
				const [a, b] = [(lo - ok) / dk, (hi - ok) / dk];
				if (Math.min(a, b) > tn) [tn, axis] = [Math.min(a, b), k];
				tf = Math.min(tf, Math.max(a, b));
			}
			if (tn > tf || tn < 0 || (best && best.t <= tn)) continue;
			best = { t: tn, cell, face: axis === 1 ? 'top' : 'side' };
		}
	const tPlane = d.y * o.y < 0 ? -o.y / d.y : Infinity;
	if (best && best.t <= tPlane) return { cell: best.cell, face: best.face };
	if (tPlane === Infinity) return { cell: null };
	const cell = worldToGrid(g, { x: o.x + d.x * tPlane, z: o.z + d.z * tPlane });
	return cell ? { cell, face: 'top' } : { cell: null };
}

/**
 * Seeded rays through a 16:10 view at 45 degrees from each pose, overshooting the frame; and as many
 * again at random points of raised columns (their tops and sides, or past them), where cells differ.
 */
function* raysFrom(g: SquareGrid, levels: Uint8Array | null, poses: GridPose[], n: number) {
	let seed = 246;
	const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
	const ground = groundFor(g, levels);
	const tan = Math.tan((45 * Math.PI) / 360);
	for (const pose of poses) {
		const { target, position: o } = poseFor(g, ground, pose);
		const f = norm({ x: target.x - o.x, y: target.y - o.y, z: target.z - o.z });
		const r = norm({ x: -f.z, y: 0, z: f.x });
		const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
		for (let k = 0; k < n; k++) {
			const [sx, sy] = [(rnd() * 2.4 - 1.2) * tan * 1.6, (rnd() * 2.4 - 1.2) * tan];
			yield {
				o,
				d: norm({
					x: f.x + r.x * sx + u.x * sy,
					y: f.y + r.y * sx + u.y * sy,
					z: f.z + r.z * sx + u.z * sy
				})
			};
		}
		const raised = levels ? [...levels.keys()].filter((i) => levels[i] > 0) : [];
		for (let k = 0; raised.length && k < n; k++) {
			const i = raised[Math.floor(rnd() * raised.length)];
			const cell = { x: i % g.width, y: Math.floor(i / g.width) };
			const c = gridToWorld(g, cell);
			const at = {
				x: c.x + (rnd() - 0.5) * g.cellSize,
				y: rnd() * ground.floorY(cell),
				z: c.z + (rnd() - 0.5) * g.cellSize
			};
			yield { o, d: norm({ x: at.x - o.x, y: at.y - o.y, z: at.z - o.z }) };
		}
	}
}
function norm(v: Vec3): Vec3 {
	const l = Math.hypot(v.x, v.y, v.z);
	return { x: v.x / l, y: v.y / l, z: v.z / l };
}

const SCENES = 'tests/fixtures/scenes';
const VIEWS = 'tests/fixtures/views';
const RAYS_PER_POSE = 1000;
const posesOf = (name: string) =>
	Object.values(
		JSON.parse(readFileSync(path.join(SCENES, `${name}.poses.json`), 'utf8')).poses
	) as GridPose[];

interface Sent {
	grid: SquareGrid;
	terrain: string | null;
	floor: string | null;
	fog?: FogView;
}
const levelsOf = (s: Sent) =>
	s.terrain ? decodeLevels(s.terrain, s.grid.width * s.grid.height) : null;

/** The same cell and face as the reference for every ray; returns how many rays were cast. */
function agree(g: SquareGrid, levels: Uint8Array | null, poses: GridPose[]) {
	const h = heights(g, levels);
	let rays = 0;
	const wrong: string[] = [];
	for (const { o, d } of raysFrom(g, levels, poses, RAYS_PER_POSE)) {
		rays++;
		const got = pickCell(g, h, o, d);
		const want = reference(g, levels, o, d);
		if (JSON.stringify({ cell: got.cell, face: got.face }) !== JSON.stringify(want))
			wrong.push(
				`${JSON.stringify(o)} ${JSON.stringify(d)}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`
			);
	}
	expect(wrong.slice(0, 3)).toEqual([]);
	return rays;
}

const sceneNames = readdirSync(SCENES)
	.filter((f) => f.endsWith('.json') && !f.endsWith('.poses.json'))
	.map((f) => f.replace('.json', ''));

describe('the DDA against the picker it replaces', () => {
	it.each(sceneNames)('%s: every scene ray picks the same cell and face', (name) => {
		const parsed = parseSceneFile(
			JSON.parse(readFileSync(path.join(SCENES, `${name}.json`), 'utf8'))
		);
		if (!parsed.ok) throw new Error(parsed.error);
		const s = parsed.scene as unknown as Sent;
		expect(agree(s.grid, levelsOf(s), posesOf(name))).toBeGreaterThanOrEqual(3000);
	});

	const viewFiles = readdirSync(VIEWS).filter((f) => f.endsWith('.json'));
	it.each(viewFiles)('%s: the GM view as sent, and the player on the continued levels', (f) => {
		const all = JSON.parse(readFileSync(path.join(VIEWS, f), 'utf8')) as Record<string, Sent>;
		const poses = posesOf(f.split('.')[0]);
		agree(all.gm.grid, levelsOf(all.gm), poses);
		// A fogged player's pick follows the drawn, continued surface (#239), never the levels as sent.
		const p = all.player;
		const size = p.grid.width * p.grid.height;
		const shape = worldShape({
			grid: p.grid,
			levels: levelsOf(p),
			floor: p.floor ? decodeFloor(p.floor, size) : null,
			objects: [],
			known: p.fog ? knownOf(p.grid, p.fog, false) : null
		});
		agree(p.grid, shape.levels, poses);
	});
});
