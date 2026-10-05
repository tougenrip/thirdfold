// Edge autotiling (#251) on synthetic tables: every corner mask with its
// rotation, ends, overlaps by the rules' precedence, drops, the void and the
// border, building context, the clearance envelope and the dirty chunks.

import { describe, expect, it } from 'vitest';
import { VOID } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import { cutWall, type SceneObject } from '$lib/game/objects';
import { STEP_HEIGHT, WALL_HEIGHT } from '../ground';
import {
	ARCADE,
	ARM,
	autotile,
	chunkPieces,
	dirtyPieceChunks,
	JAMB,
	JOINT,
	jointOf,
	SITE,
	tileInput,
	TILE_ROLES,
	variantOf,
	type TileInput,
	type WallPieces
} from './autotile';
import { checkWallPieces } from './invariants';
import { wallTable } from './random-table';
import { worldShape, type ShapeInput } from './shape';

const grid = (width: number, height: number): SquareGrid => ({
	kind: 'square',
	cellSize: 1,
	width,
	height
});
const P = (x: number, y: number) => ({ x, y });
let n = 0;
const wall = (a: [number, number], b: [number, number], window = false): SceneObject => ({
	id: `w${n++}`,
	kind: 'wall',
	a: P(...a),
	b: P(...b),
	window
});
const door = (a: [number, number], b: [number, number], open = false): SceneObject => ({
	id: `d${n++}`,
	kind: 'door',
	a: P(...a),
	b: P(...b),
	open
});

interface Table extends Partial<ShapeInput> {
	grid: SquareGrid;
	building?: Uint8Array | null;
}
function input(t: Table, objects: SceneObject[]): TileInput {
	const shape = worldShape({ levels: null, floor: null, known: null, ...t, objects });
	return tileInput(shape, objects, t.building ?? null);
}
const tile = (t: Table, objects: SceneObject[]) => autotile(input(t, objects));

interface Rec {
	role: string;
	site: number;
	x: number;
	y: number;
	rotation: number;
	y0: number;
	y1: number;
	flags: number;
}
function records(pieces: Map<number, WallPieces>): Rec[] {
	const out: Rec[] = [];
	for (const p of pieces.values())
		for (let k = 0; k < p.count; k++)
			out.push({
				role: TILE_ROLES[p.role[k]],
				site: p.site[k],
				x: p.x[k],
				y: p.y[k],
				rotation: p.rotation[k],
				y0: p.y0[k],
				y1: p.y1[k],
				flags: p.flags[k]
			});
	return out;
}
const posts = (r: Rec[]) => r.filter((p) => p.site === SITE.corner);
const postAt = (r: Rec[], x: number, y: number) => posts(r).find((p) => p.x === x && p.y === y);
const edgeAt = (r: Rec[], site: number, x: number, y: number) =>
	r.filter((p) => p.site === site && p.x === x && p.y === y);
const WH = WALL_HEIGHT;
const close = (a: number, b: number) => Math.abs(a - b) < 1e-5;

/** Where a world direction (x, z) points after turning by r quarter turns about +Y. */
function turned(dx: number, dz: number, r: number): [number, number] {
	const t = (r * Math.PI) / 2;
	return [
		Math.round(dx * Math.cos(t) + dz * Math.sin(t)),
		Math.round(-dx * Math.sin(t) + dz * Math.cos(t))
	];
}
const ARM_OF: Record<string, number> = { '0,-1': ARM.N, '1,0': ARM.E, '0,1': ARM.S, '-1,0': ARM.W };
const CANONICAL_ARMS: Record<number, [number, number][]> = {
	[JOINT.end]: [[0, 1]],
	[JOINT.L]: [
		[0, 1],
		[1, 0]
	],
	[JOINT.T]: [
		[1, 0],
		[0, 1],
		[-1, 0]
	],
	[JOINT.X]: [
		[1, 0],
		[0, 1],
		[-1, 0],
		[0, -1]
	]
};

describe('corner joints', () => {
	const KIND: Record<number, number> = { 0: 0, 1: 1, 2: 1, 4: 1, 8: 1, 5: 2, 10: 2, 15: 5 };
	for (const m of [3, 6, 12, 9]) KIND[m] = JOINT.L;
	for (const m of [7, 11, 13, 14]) KIND[m] = JOINT.T;

	it('name all 16 masks, and turning the canonical arms by the rotation gives the mask', () => {
		for (let mask = 0; mask < 16; mask++) {
			const { joint, rotation } = jointOf(mask);
			expect(joint, `mask ${mask}`).toBe(KIND[mask]);
			const arms = CANONICAL_ARMS[joint];
			if (!arms) continue;
			const got = arms.reduce((m, [x, z]) => m | ARM_OF[turned(x, z, rotation).join(',')], 0);
			expect(got, `mask ${mask}`).toBe(mask);
		}
	});

	it('place the right post at a corner for each of the 16 masks of walls round it', () => {
		const ARMS: [number, [number, number], [number, number]][] = [
			[ARM.N, [2, 1], [2, 2]],
			[ARM.E, [2, 2], [3, 2]],
			[ARM.S, [2, 2], [2, 3]],
			[ARM.W, [1, 2], [2, 2]]
		];
		const ROLE: Record<number, string | undefined> = {
			[JOINT.end]: 'post.end',
			[JOINT.L]: 'post.L',
			[JOINT.T]: 'post.T',
			[JOINT.X]: 'post.X'
		};
		for (let mask = 0; mask < 16; mask++) {
			const objects = ARMS.filter(([bit]) => mask & bit).map(([, a, b]) => wall(a, b));
			const r = records(tile({ grid: grid(4, 4) }, objects));
			const post = postAt(r, 2, 2);
			expect(post?.role, `mask ${mask}`).toBe(ROLE[KIND[mask]]);
			if (post) expect(post.rotation, `mask ${mask}`).toBe(jointOf(mask).rotation);
			// Every arm's far end is an end post; nothing else.
			expect(posts(r).length, `mask ${mask}`).toBe(
				[1, 2, 4, 8].filter((b) => mask & b).length + (post ? 1 : 0)
			);
		}
	});

	it('give a lone edge two ends facing each other along it', () => {
		const r = records(tile({ grid: grid(3, 3) }, [wall([1, 1], [2, 1])]));
		expect(posts(r).map((p) => [p.role, p.x, p.y, p.rotation])).toEqual([
			['post.end', 1, 1, 1], // its arm runs E
			['post.end', 2, 1, 3] // and W
		]);
		const [straight] = edgeAt(r, SITE.h, 1, 1);
		expect(straight).toMatchObject({ role: 'wall.straight', y0: 0, rotation: 0 });
		expect(close(straight.y1, WH)).toBe(true);
	});

	it('put no post on a straight corner, so a split wall shows no seam', () => {
		const whole = tile({ grid: grid(5, 3) }, [wall([0, 1], [5, 1])]);
		const split = tile({ grid: grid(5, 3) }, [wall([0, 1], [2, 1]), wall([2, 1], [5, 1])]);
		expect(split).toEqual(whole);
		expect(posts(records(whole)).map((p) => p.x)).toEqual([0, 5]);
	});

	it('span a post from the lowest floor round it to the highest top of its walls', () => {
		const levels = Uint8Array.from([0, 0, 0, 2, 2, 2, 1, 1, 1]);
		const r = records(
			tile({ grid: grid(3, 3), levels }, [wall([1, 1], [1, 2]), wall([1, 1], [2, 1])])
		);
		const post = postAt(r, 1, 1)!;
		expect(post.role).toBe('post.L');
		expect(post.y0).toBe(0);
		expect(close(post.y1, 2 * STEP_HEIGHT + WH)).toBe(true);
	});
});

describe('overlaps follow the rules', () => {
	const g = { grid: grid(4, 4) };

	it('tile two walls on one edge as one', () => {
		expect(tile(g, [wall([1, 1], [3, 1]), wall([2, 1], [3, 1])])).toEqual(
			tile(g, [wall([1, 1], [3, 1])])
		);
	});

	it('make an edge a window when any window covers it, in either order (sight wins)', () => {
		const alone = tile(g, [wall([1, 1], [2, 1], true)]);
		for (const objects of [
			[wall([1, 1], [2, 1]), wall([1, 1], [2, 1], true)],
			[wall([1, 1], [2, 1], true), wall([1, 1], [2, 1])]
		])
			expect(tile(g, objects)).toEqual(alone);
		expect(edgeAt(records(alone), SITE.h, 1, 1)[0].role).toBe('window.frame');
	});

	it('draw a door under a wall or window on its edge as that wall or window', () => {
		expect(tile(g, [door([1, 1], [2, 1]), wall([1, 1], [2, 1])])).toEqual(
			tile(g, [wall([1, 1], [2, 1])])
		);
		expect(tile(g, [wall([1, 1], [2, 1], true), door([1, 1], [2, 1], true)])).toEqual(
			tile(g, [wall([1, 1], [2, 1], true)])
		);
	});

	it('frame a door, open or shut, and mark the posts beside it as jambs', () => {
		const shut = records(tile(g, [door([1, 1], [2, 1]), wall([1, 1], [1, 3])]));
		expect(tile(g, [door([1, 1], [2, 1], true), wall([1, 1], [1, 3])])).toEqual(
			tile(g, [door([1, 1], [2, 1]), wall([1, 1], [1, 3])])
		);
		expect(edgeAt(shut, SITE.h, 1, 1)[0].role).toBe('door.frame');
		expect(postAt(shut, 1, 1)).toMatchObject({ role: 'post.L', flags: JAMB });
		expect(postAt(shut, 2, 1)).toMatchObject({ role: 'post.end', flags: JAMB });
		expect(postAt(shut, 1, 3)).toMatchObject({ role: 'post.end', flags: 0 });
	});

	it('put no post between two doors meeting at a corner, or a door beside a window', () => {
		const doors = records(tile(g, [door([1, 1], [1, 2]), door([1, 2], [1, 3])]));
		expect(postAt(doors, 1, 2)).toBeUndefined();
		expect(posts(doors).map((p) => [p.y, p.flags])).toEqual([
			[1, JAMB],
			[3, JAMB]
		]);
		const mixed = records(tile(g, [door([1, 1], [1, 2]), wall([1, 2], [1, 3], true)]));
		expect(postAt(mixed, 1, 2)).toBeUndefined();
	});

	it('keep every seed when cutWall splits a wall or the objects are reordered', () => {
		const long = wall([0, 2], [4, 2]);
		const parts = cutWall(long as never, { a: P(2, 2), b: P(3, 2) }, () => 'cut');
		const rest = [wall([1, 0], [1, 4]), door([3, 0], [3, 1])];
		const whole = tile(g, [long, ...rest]);
		expect(tile(g, [...parts, wall([2, 2], [3, 2]), ...rest])).toEqual(whole);
		expect(tile(g, [...rest, long].reverse())).toEqual(whole);
	});
});

describe('drops, the void, the border and buildings', () => {
	it('stand a wall on the higher floor over a retaining piece and plinth facing down', () => {
		const levels = Uint8Array.from([0, 1, 1]);
		const r = records(tile({ grid: grid(3, 1), levels }, [wall([1, 0], [1, 1])]));
		const [main, retaining, plinth] = edgeAt(r, SITE.v, 1, 0);
		expect(main.role).toBe('wall.straight');
		expect(main.rotation).toBe(3); // facing W, down the drop
		expect([close(main.y0, STEP_HEIGHT), close(main.y1, STEP_HEIGHT + WH)]).toEqual([true, true]);
		expect(retaining).toMatchObject({ role: 'wall.retaining', rotation: 3, y0: 0 });
		expect(close(retaining.y1, STEP_HEIGHT)).toBe(true);
		expect(plinth).toMatchObject({ role: 'plinth', rotation: 3, y0: 0 });
		expect(close(plinth.y1, STEP_HEIGHT)).toBe(true);
	});

	it('frame a window between different floors as a sill', () => {
		const levels = Uint8Array.from([5, 0]);
		const r = records(tile({ grid: grid(2, 1), levels }, [wall([1, 0], [1, 1], true)]));
		expect(edgeAt(r, SITE.v, 1, 0).map((p) => p.role)).toEqual([
			'window.sill',
			'wall.retaining',
			'plinth'
		]);
	});

	it('mark windows in line between equal floors as an arcade (#253), never a lone one or a sill', () => {
		const flags = (objects: SceneObject[], levels: Uint8Array | null = null) =>
			records(tile({ grid: grid(5, 3), levels }, objects))
				.filter((p) => p.role === 'window.frame' || p.role === 'window.sill')
				.map((p) => [p.x, p.role, p.flags & ARCADE]);
		// Two units of one window, and two windows meeting end to end, either way round.
		expect(flags([wall([1, 1], [3, 1], true)])).toEqual([
			[1, 'window.frame', ARCADE],
			[2, 'window.frame', ARCADE]
		]);
		expect(flags([wall([3, 1], [2, 1], true), wall([1, 1], [2, 1], true)])).toEqual([
			[1, 'window.frame', ARCADE],
			[2, 'window.frame', ARCADE]
		]);
		// A lone window, and one beside a wall or a door in line, is a framed window.
		expect(flags([wall([1, 1], [2, 1], true), wall([2, 1], [3, 1])])).toEqual([
			[1, 'window.frame', 0]
		]);
		expect(flags([wall([1, 1], [2, 1], true), door([2, 1], [3, 1])])).toEqual([
			[1, 'window.frame', 0]
		]);
		// In line across a drop: sills, never an arcade.
		const levels = Uint8Array.from([2, 2, 2, 2, 2, ...new Array(10).fill(0)]);
		expect(flags([wall([1, 1], [3, 1], true)], levels)).toEqual([
			[1, 'window.sill', 0],
			[2, 'window.sill', 0]
		]);
	});

	it('thicken a wall toward the void or beyond the grid, never toward unexplored ground', () => {
		const floor = Uint8Array.from([0, VOID, VOID]);
		const objects = [wall([0, 0], [0, 1]), wall([1, 0], [1, 1]), wall([2, 0], [2, 1])];
		const r = records(tile({ grid: grid(3, 1), floor }, objects));
		expect(r.filter((p) => p.site === SITE.v).map((p) => [p.x, p.role, p.rotation])).toEqual([
			[0, 'wall.outer', 3], // the border, west
			[1, 'wall.outer', 1], // the void, east
			[2, 'wall.outer', 1] // between two void cells: outer, facing E by default
		]);
		// The same void cell unexplored counts as walkable ground.
		const fog = records(
			tile({ grid: grid(3, 1), floor, known: Uint8Array.from([1, 0, 0]) }, objects)
		);
		expect(fog.filter((p) => p.site === SITE.v).map((p) => [p.x, p.role])).toEqual([
			[0, 'wall.outer'],
			[1, 'wall.straight']
		]);
	});

	it('face a building wall out, and make a wall between outside cells a boundary', () => {
		const building = Uint8Array.from([0, 1, 1, 0]);
		const objects = [wall([1, 0], [1, 1]), wall([3, 0], [3, 1]), wall([2, 0], [2, 1])];
		const r = records(tile({ grid: grid(4, 1), building }, objects));
		expect(r.filter((p) => p.site === SITE.v).map((p) => [p.x, p.role, p.rotation])).toEqual([
			[1, 'wall.straight', 3],
			[2, 'wall.straight', 1],
			[3, 'wall.straight', 1]
		]);
		const house = Uint8Array.from([0, 0, 0, 0, 1]);
		const out = records(tile({ grid: grid(5, 1), building: house }, objects));
		expect(new Set(out.filter((p) => p.site === SITE.v).map((p) => p.role))).toEqual(
			new Set(['wall.boundary'])
		);
		// Without any building context nothing is a boundary: no mask, an empty one, or one
		// whose only building cell is unexplored (as views send it: nothing).
		for (const t of [
			{ grid: grid(5, 1) },
			{ grid: grid(5, 1), building: new Uint8Array(5) },
			{ grid: grid(5, 1), building: house, known: Uint8Array.from([1, 1, 1, 1, 0]) }
		]) {
			const none = records(tile(t, objects));
			expect(none.some((p) => p.role === 'wall.boundary')).toBe(false);
		}
	});
});

describe('the clearance envelope', () => {
	it('passes a room with posts, a door, a window, a drop and the void', () => {
		const levels = Uint8Array.from({ length: 25 }, (_, i) => (i % 5 > 2 ? 1 : 0));
		const floor = Uint8Array.from({ length: 25 }, (_, i) => (i < 5 ? VOID : 0));
		const objects = [
			wall([1, 1], [4, 1]),
			wall([1, 1], [1, 4], true),
			door([4, 1], [4, 2]),
			wall([4, 2], [4, 4]),
			wall([3, 0], [3, 5])
		];
		const t = input({ grid: grid(5, 5), levels, floor }, objects);
		expect(checkWallPieces(t.shape, autotile(t).values())).toEqual([]);
	});

	it('catches a thick wall facing walkable ground, and a piece with no known side', () => {
		const t = input({ grid: grid(3, 1), known: Uint8Array.from([1, 1, 0]) }, [
			wall([1, 0], [1, 1])
		]);
		const p = chunkPieces(t, 0);
		p.role[0] = TILE_ROLES.indexOf('wall.outer');
		expect(checkWallPieces(t.shape, [p]).map((v) => v.rule)).toContain('wall-disk');
		p.x[0] = 3; // move it onto the edge beside the unexplored cell only
		expect(checkWallPieces(t.shape, [p]).map((v) => v.rule)).toContain('wall-unexplored');
	});
});

describe('seeded wall tables', () => {
	const tables = Array.from({ length: 20 }, (_, k) => wallTable(k + 1));

	it('pass the clearance envelope', () => {
		for (const [k, t] of tables.entries()) {
			const i = input(t, t.objects);
			expect(checkWallPieces(i.shape, autotile(i).values()), `seed ${k + 1}`).toEqual([]);
		}
	});

	it('recompute only dirty chunks: every other chunk is unchanged', () => {
		for (const [k, t] of tables.entries()) {
			const prev = input(t, t.objects);
			const objects = t.objects.filter((_, j) => j !== k);
			objects.push(wall([3, 3], [3, 9]), door([30, 25], [31, 25]));
			const at = (k * 131) % t.known!.length;
			const known = t.known!.map((v, i) => (i === at ? 1 : v));
			const levels = t.levels!.map((v, i) => (i === at + 7 ? v + 1 : v));
			const building = t.building!.map((v, i) => (i === at + 3 ? 1 - v : v));
			const next = input({ ...t, known, levels, building }, objects);
			const dirty = new Set(dirtyPieceChunks(prev, next));
			const [a, b] = [autotile(prev), autotile(next)];
			for (const [c, pieces] of b)
				if (!dirty.has(c)) expect(pieces, `seed ${k + 1} chunk ${c}`).toEqual(a.get(c));
			expect(dirty.size).toBeLessThan(b.size);
		}
	});

	it('pick variants by weight from the seed alone', () => {
		expect(variantOf(0, [1, 1])).toBe(0);
		expect(variantOf(0xffffffff, [1, 1])).toBe(1);
		expect(variantOf(0x80000000, [1, 3])).toBe(1);
		expect(variantOf(0x10000000, [1, 3])).toBe(0);
	});

	it('tile about 2,000 edges on a 64x64 table well under a frame (informational: 0.5 ms target)', () => {
		const t = wallTable(7, 64, 64);
		const objects = [7, 8, 9, 10].flatMap((seed) => wallTable(seed, 64, 64).objects);
		const i = input(t, objects);
		autotile(i);
		const start = performance.now();
		const runs = 20;
		for (let k = 0; k < runs; k++) autotile(i);
		const ms = (performance.now() - start) / runs;
		const edges = [...i.kinds.h, ...i.kinds.v].filter(Boolean).length;
		console.log(`autotile: ${edges} built edges on 64x64 in ${ms.toFixed(2)} ms`);
		expect(edges).toBeGreaterThan(1500);
		expect(ms).toBeLessThan(100);
	});
});
