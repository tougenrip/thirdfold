// Wall instances (#252): the built-in pieces inside their roles' envelopes and wound outward,
// matrices at #250's pivots, a kit's variants and caps, and on every fixture scene and view every
// piece clear of every walkable cell's base disk below FIGURE_CLEAR, standing exactly WALL_HEIGHT
// over the higher floor (mn-tower-w on the belfry), and nothing below the lowest floor.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeFloor, VOID } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import { parseSceneFile } from '$lib/game/scene-file';
import { decodeLevels } from '$lib/game/terrain';
import type { FogView } from '$lib/game/visibility';
import { ENVELOPES, envelopeProblem, FIGURE_CLEAR, TOKEN_DISK } from '../../assets/kit';
import { STEP_HEIGHT, WALL_HEIGHT } from '../ground';
import { autotile, tileInput, TILE_ROLES, variantOf } from './autotile';
import { knownOf, worldShape, type ShapeInput, type WorldShape } from './shape';
import {
	BATCH_ROLES,
	edgeIndex,
	KIT_LIFT,
	pieceKey,
	proceduralPiece,
	roleOfKey,
	VARIANTS,
	wallInstances,
	type PieceMesh
} from './wall-batch';

const boundsOf = (p: PieceMesh, from = 0, to = p.positions.length / 3) => {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let v = from; v < to; v++)
		for (let k = 0; k < 3; k++) {
			min[k] = Math.min(min[k], p.positions[v * 3 + k]);
			max[k] = Math.max(max[k], p.positions[v * 3 + k]);
		}
	return { min, max } as { min: [number, number, number]; max: [number, number, number] };
};

describe('the built-in pieces', () => {
	it('lie inside their roles’ envelopes, a wall’s merged cap inside the cap’s', () => {
		for (const role of BATCH_ROLES) {
			const mesh = proceduralPiece(role);
			for (let b = 0; b < mesh.positions.length / 3; b += 24) {
				const box = boundsOf(mesh, b, b + 24);
				const own = envelopeProblem(box, ENVELOPES[role]);
				expect(own && envelopeProblem(box, ENVELOPES.cap), role).toBeNull();
			}
		}
	});

	it('wind every triangle round its outward normal', () => {
		for (const role of BATCH_ROLES) {
			const { positions: p, normals: n, indices } = proceduralPiece(role);
			for (let t = 0; t < indices.length; t += 3) {
				const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]].map((i) => i * 3);
				const u = [0, 1, 2].map((k) => p[b + k] - p[a + k]);
				const w = [0, 1, 2].map((k) => p[c + k] - p[a + k]);
				const cross = [
					u[1] * w[2] - u[2] * w[1],
					u[2] * w[0] - u[0] * w[2],
					u[0] * w[1] - u[1] * w[0]
				];
				expect(cross[0] * n[a] + cross[1] * n[a + 1] + cross[2] * n[a + 2]).toBeGreaterThan(0);
			}
		}
	});
});

const grid = (width: number, height: number): SquareGrid => ({
	kind: 'square',
	cellSize: 1,
	width,
	height
});
const wall = (a: [number, number], b: [number, number]): SceneObject => ({
	id: `w${a}${b}`,
	kind: 'wall',
	a: { x: a[0], y: a[1] },
	b: { x: b[0], y: b[1] }
});
const tiled = (input: ShapeInput) => {
	const shape = worldShape(input);
	return { shape, pieces: autotile(tileInput(shape, input.objects, null)) };
};

const near = (a: number[], b: number[]) => a.forEach((v, k) => expect(v).toBeCloseTo(b[k], 5));

/** Instance `i`'s matrix applied to a point. */
function apply(m: Float32Array, i: number, [x, y, z]: number[]): number[] {
	const o = i * 16;
	return [0, 1, 2].map((r) => m[o + r] * x + m[o + 4 + r] * y + m[o + 8 + r] * z + m[o + 12 + r]);
}

describe('instances', () => {
	it('stand edge pieces at the edge’s midpoint and posts at their corner, turned and scaled', () => {
		const g = { ...grid(4, 4), cellSize: 2 };
		const levels = new Uint8Array(16).fill(0);
		levels[0] = levels[1] = 2; // the north-west cells raised two levels
		const { pieces } = tiled({
			grid: g,
			levels,
			floor: null,
			objects: [wall([0, 1], [2, 1])],
			known: null
		});
		const inst = wallInstances(pieces.get(0)!, g, {});
		const roles = Array.from(inst.key, (k) => roleOfKey(k));
		expect(roles).toEqual([
			'wall.straight',
			'wall.retaining',
			'plinth',
			'post.end',
			'wall.straight',
			'wall.retaining',
			'plinth',
			'post.end'
		]);
		const high = 2 * STEP_HEIGHT * 2;
		// The first straight piece: midpoint of h:0:1 (world x -3, z -2), on the higher floor.
		near(apply(inst.matrices, 0, [0, 0, 0]), [-3, high, -2]);
		near(apply(inst.matrices, 0, [0.5, WALL_HEIGHT, 0]), [-2, high + WALL_HEIGHT * 2, -2]);
		// The retaining piece hangs from the higher floor, one wall deep (a drop of 1.6 needs one), facing down (+z).
		expect(apply(inst.matrices, 1, [0, 0, 0])[1]).toBeCloseTo(high);
		expect(apply(inst.matrices, 1, [0, -WALL_HEIGHT, 0])[1]).toBeCloseTo(high - WALL_HEIGHT * 2);
		expect(apply(inst.matrices, 1, [0, 0, 1])[2]).toBeCloseTo(0);
		// The post at corner (0, 1) runs from the lowest floor round it to the wall's top.
		const post = apply(inst.matrices, 3, [0, WALL_HEIGHT, 0]);
		near(post, [-4, high + WALL_HEIGHT * 2, -2]);
		expect(apply(inst.matrices, 3, [0, 0, 0])[1]).toBe(0);
		expect(inst.edge[0]).toBe(edgeIndex(g, 'h', 0, 1));
		expect(inst.edge[3]).toBe(-1);
	});

	it('repeat retaining pieces down a deeper drop and lift a kit’s caps and posts', () => {
		const g = grid(4, 4);
		const levels = new Uint8Array(16);
		levels[0] = levels[1] = 12; // 4.8 u over the cells south: three retaining pieces
		const { pieces } = tiled({
			grid: g,
			levels,
			floor: null,
			objects: [wall([0, 1], [2, 1])],
			known: null
		});
		const p = pieces.get(0)!;
		const retaining = BATCH_ROLES.indexOf('wall.retaining');
		const built = wallInstances(p, g, {});
		const tops = [...built.key.keys()]
			.filter((k) => built.key[k] === pieceKey(retaining, -1))
			.map((k) => apply(built.matrices, k, [0, 0, 0])[1]);
		expect(tops.slice(0, 3).map((y) => +y.toFixed(5))).toEqual([4.8, 2.8, 0.8]);
		const kit = wallInstances(p, g, { 'wall.straight': [1], cap: [1], 'post.end': [1] });
		const cap = [...kit.key.keys()].find((k) => roleOfKey(kit.key[k]) === 'cap')!;
		const post = [...kit.key.keys()].find((k) => roleOfKey(kit.key[k]) === 'post.end')!;
		expect(apply(kit.matrices, cap, [0, 0, 0])[1]).toBeCloseTo(4.8 + KIT_LIFT.cap, 5);
		expect(apply(kit.matrices, post, [0, 0, 0])[1]).toBeCloseTo(KIT_LIFT.post, 5);
	});

	it('draw a kit’s variants by seed and its cap on its own walls only', () => {
		const g = grid(6, 6);
		const { pieces } = tiled({
			grid: g,
			levels: null,
			floor: null,
			objects: [wall([1, 1], [5, 1])],
			known: null
		});
		const p = pieces.get(0)!;
		const kit = { 'wall.straight': [1, 3], cap: [1] };
		const inst = wallInstances(p, g, kit);
		const straight = BATCH_ROLES.indexOf('wall.straight');
		const cap = BATCH_ROLES.indexOf('cap');
		let k = 0;
		for (let i = 0; i < p.count; i++) {
			const role = TILE_ROLES[p.role[i]];
			if (role === 'wall.straight') {
				expect(inst.key[k++]).toBe(pieceKey(straight, variantOf(p.seed[i], [1, 3])));
				expect(inst.key[k++]).toBe(pieceKey(cap, 0));
			} else expect(inst.key[k++]).toBe(pieceKey(BATCH_ROLES.indexOf(role), -1));
		}
		expect(k).toBe(inst.count);
		expect(roleOfKey(pieceKey(cap, 0))).toBe('cap');
		expect(pieceKey(straight, -1) % VARIANTS).toBe(0);
		// Without the straight wall's variants the kit's cap stays off: the built-in wall has one.
		expect(wallInstances(p, g, { cap: [1] }).count).toBe(p.count);
	});
});

interface Sent {
	grid: SquareGrid;
	terrain: string | null;
	floor: string | null;
	objects: SceneObject[];
	fog?: FogView;
}
const input = (sent: Sent, known: ShapeInput['known']): ShapeInput => {
	const n = sent.grid.width * sent.grid.height;
	return {
		grid: sent.grid,
		levels: sent.terrain ? decodeLevels(sent.terrain, n) : null,
		floor: sent.floor ? decodeFloor(sent.floor, n) : null,
		objects: sent.objects,
		known
	};
};
const SCENES = 'tests/fixtures/scenes';
const VIEWS = 'tests/fixtures/views';
const scenes = readdirSync(SCENES)
	.filter((f) => f.endsWith('.json') && !f.endsWith('.poses.json'))
	.map((f) => {
		const parsed = parseSceneFile(JSON.parse(readFileSync(path.join(SCENES, f), 'utf8')));
		if (!parsed.ok) throw new Error(`${f}: ${parsed.error}`);
		return { name: f.replace('.json', ''), input: input(parsed.scene as unknown as Sent, null) };
	});
const views = readdirSync(VIEWS)
	.filter((f) => f.endsWith('.json'))
	.flatMap((f) => {
		const all = JSON.parse(readFileSync(path.join(VIEWS, f), 'utf8')) as Record<string, Sent>;
		return (['gm', 'player', 'spectator'] as const).map((viewer) => {
			const v = all[viewer];
			const known = v.fog ? knownOf(v.grid, v.fog, viewer === 'gm') : null;
			return { name: `${f} ${viewer}`, input: input(v, known) };
		});
	});

/**
 * Every box of every drawn piece, in the world: its horizontal extent and heights. Built-in pieces
 * are boxes of 24 vertices each.
 */
function drawnBoxes(shape: WorldShape, objects: readonly SceneObject[]) {
	const out: { role: string; min: number[]; max: number[] }[] = [];
	for (const p of autotile(tileInput(shape, objects, null)).values()) {
		const inst = wallInstances(p, shape.grid, {});
		for (let i = 0; i < inst.count; i++) {
			const role = roleOfKey(inst.key[i]);
			const mesh = proceduralPiece(role);
			for (let b = 0; b < mesh.positions.length / 3; b += 24) {
				const { min, max } = boundsOf(mesh, b, b + 24);
				const corners = [min, max].map((c) => apply(inst.matrices, i, c));
				out.push({
					role,
					min: [0, 1, 2].map((k) => Math.min(corners[0][k], corners[1][k])),
					max: [0, 1, 2].map((k) => Math.max(corners[0][k], corners[1][k]))
				});
			}
		}
	}
	return out;
}

describe('every fixture', () => {
	it('keeps every piece out of every walkable cell’s base disk below FIGURE_CLEAR', () => {
		let checked = 0;
		for (const { name, input: t } of [...scenes, ...views]) {
			const shape = worldShape(t);
			const { width: w, height: h, cellSize: cs } = shape.grid;
			const floorY = (i: number) => shape.levels[i] * STEP_HEIGHT * cs;
			for (const box of drawnBoxes(shape, t.objects)) {
				checked++;
				// The cells it could reach: those round its extent.
				const [gx0, gz0] = [box.min[0] / cs + w / 2, box.min[2] / cs + h / 2];
				const [gx1, gz1] = [box.max[0] / cs + w / 2, box.max[2] / cs + h / 2];
				for (let y = Math.max(0, Math.floor(gz0) - 1); y <= Math.min(h - 1, Math.ceil(gz1)); y++)
					for (
						let x = Math.max(0, Math.floor(gx0) - 1);
						x <= Math.min(w - 1, Math.ceil(gx1));
						x++
					) {
						const i = y * w + x;
						if (shape.floor[i] === VOID && (!shape.known || shape.known[i])) continue;
						const floor = floorY(i);
						if (box.max[1] <= floor + 1e-6 || box.min[1] >= floor + FIGURE_CLEAR * cs - 1e-6)
							continue;
						const dx = Math.max(gx0 - (x + 0.5), 0, x + 0.5 - gx1);
						const dz = Math.max(gz0 - (y + 0.5), 0, y + 0.5 - gz1);
						expect(Math.hypot(dx, dz), `${name} ${box.role} near ${x},${y}`).toBeGreaterThanOrEqual(
							TOKEN_DISK - 1e-6
						);
					}
			}
		}
		expect(checked).toBeGreaterThan(1000);
	}, 30_000);

	it('stands mn-tower-w on the belfry, WALL_HEIGHT tall, its retaining piece down to the ledge', () => {
		const f = scenes.find((s) => s.name === 'monastery')!;
		const shape = worldShape(f.input);
		const cs = shape.grid.cellSize;
		const tower = f.input.objects.find((o) => o.id === 'mn-tower-w')!;
		const drawn = drawnBoxes(shape, [tower]);
		const main = drawn.filter((b) => b.role === 'wall.boundary' || b.role === 'wall.straight');
		const belfry = 10 * STEP_HEIGHT * cs;
		expect(main.length).toBeGreaterThan(0);
		expect(Math.min(...main.map((b) => b.min[1]))).toBeCloseTo(belfry, 5);
		expect(Math.max(...main.map((b) => b.max[1]))).toBeCloseTo(belfry + WALL_HEIGHT * cs, 5);
		const retaining = drawn.filter((b) => b.role === 'wall.retaining');
		expect(Math.max(...retaining.map((b) => b.max[1]))).toBeCloseTo(belfry, 5);
		expect(Math.min(...retaining.map((b) => b.min[1]))).toBeCloseTo(5 * STEP_HEIGHT * cs, 5);
	});
});
