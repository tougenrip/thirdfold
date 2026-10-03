// The world's shape (#239): edge classes, the continuation rule, saddles
// against canStep, dirty chunks, and the harness itself, on small tables, every
// 2x2 pattern and seeded random tables. The fixtures are in fixtures.spec.ts.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLOOR_IDS, VOID } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import { dualCase, JOIN, tileHash } from './dual';
import {
	checkContinuation,
	checkEmitter,
	referenceBoxes,
	saddleProblems,
	type EmitterMesh
} from './invariants';
import {
	CHUNK,
	dirtyChunks,
	EDGE_BUILT,
	EDGE_GROUND,
	edgeSlot,
	hEdge,
	slotBetween,
	vEdge,
	worldShape,
	type ShapeInput,
	type WorldShape
} from './shape';

const WATER = FLOOR_IDS.indexOf('water');
const DIR = path.dirname(new URL(import.meta.url).pathname);

const grid = (width: number, height: number): SquareGrid => ({
	kind: 'square',
	cellSize: 1,
	width,
	height
});
const shapeOf = (over: Partial<ShapeInput> & { grid: SquareGrid }): WorldShape =>
	worldShape({ levels: null, floor: null, objects: [], known: null, ...over });
const bytes = (...v: number[]) => Uint8Array.from(v);

/** A seeded generator (mulberry32), the same tables on every run. */
function random(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A random table: raised blocks and stairs, painted floors, walls, and a fogged viewer's explored blobs. */
function randomTable(seed: number, width = 14, height = 12): ShapeInput {
	const rnd = random(seed);
	const int = (n: number) => Math.floor(rnd() * n);
	const g = grid(width, height);
	const levels = new Uint8Array(width * height);
	const floor = new Uint8Array(width * height);
	for (let r = 0; r < 6; r++) {
		const [x0, y0, w, h, l] = [int(width), int(height), 1 + int(5), 1 + int(5), int(6)];
		for (let y = y0; y < Math.min(y0 + h, height); y++)
			for (let x = x0; x < Math.min(x0 + w, width); x++) levels[y * width + x] = l;
	}
	for (let k = int(4); k > 0; k--) {
		const [x0, y] = [int(width - 4), int(height)];
		for (let s = 0; s < 4; s++) levels[y * width + x0 + s] = s + 1;
	}
	for (let r = 0; r < 4; r++) {
		const [x0, y0, w, h] = [int(width), int(height), 1 + int(4), 1 + int(4)];
		const f = [VOID, WATER, 1, 3][int(4)];
		for (let y = y0; y < Math.min(y0 + h, height); y++)
			for (let x = x0; x < Math.min(x0 + w, width); x++) floor[y * width + x] = f;
	}
	const known = new Uint8Array(width * height);
	for (let b = 0; b < 3; b++) {
		const [cx, cy, r] = [int(width), int(height), 1 + int(5)];
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++)
				if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) known[y * width + x] = 1;
	}
	// What a fogged viewer is sent: only explored cells' ground.
	for (let i = 0; i < known.length; i++) if (!known[i]) levels[i] = floor[i] = 0;
	const objects: SceneObject[] = [];
	for (let k = 0; k < 3; k++) {
		const [x, y, len] = [int(width), 1 + int(height - 1), 1 + int(4)];
		objects.push({
			id: `w${k}`,
			kind: 'wall',
			a: { x, y },
			b: { x: Math.min(x + len, width), y },
			window: k === 2
		});
	}
	return { grid: g, levels, floor, objects, known };
}

describe('world modules', () => {
	it('import no three.js, only the game rules, ground.ts and each other', () => {
		const files = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
		expect(files).toContain('shape.ts');
		for (const f of files) {
			const source = readFileSync(path.join(DIR, f), 'utf8');
			const from = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
			for (const m of from)
				expect(m, f).toMatch(/^(\.\.\/\.\.\/game\/[a-z-]+|\.\.\/ground|\.\/[a-z-]+)$/);
		}
	});
});

describe('edge classes', () => {
	it('class ground by the levels and void either side, and the border', () => {
		const s = shapeOf({ grid: grid(4, 1), levels: bytes(0, 1, 3, 3), floor: bytes(0, 0, 0, VOID) });
		const v = [0, 1, 2, 3, 4].map((x) => s.edges.ground.v[vEdge(s.grid, x, 0)]);
		expect(v).toEqual([
			EDGE_GROUND.border,
			EDGE_GROUND.step,
			EDGE_GROUND.cliff,
			EDGE_GROUND.void,
			EDGE_GROUND.border
		]);
		expect(s.edges.ground.h[hEdge(s.grid, 1, 0)]).toBe(EDGE_GROUND.border);
	});

	it('are flat toward an unexplored cell, whatever it was sent as', () => {
		const s = shapeOf({ grid: grid(3, 1), levels: bytes(4, 0, 0), known: bytes(1, 0, 1) });
		expect(s.edges.ground.v[vEdge(s.grid, 1, 0)]).toBe(EDGE_GROUND.flat);
		expect(s.edges.ground.v[vEdge(s.grid, 2, 0)]).toBe(EDGE_GROUND.flat);
	});

	it('class walls, windows and doors, a door over a wall it cut, and a sealed secret door as a wall', () => {
		const objects: SceneObject[] = [
			{ id: 'w', kind: 'wall', a: { x: 0, y: 1 }, b: { x: 3, y: 1 } },
			{ id: 'secret-sealed', kind: 'wall', a: { x: 1, y: 0 }, b: { x: 1, y: 1 } },
			{ id: 'win', kind: 'wall', a: { x: 2, y: 0 }, b: { x: 2, y: 1 }, window: true },
			{ id: 'd', kind: 'door', a: { x: 1, y: 1 }, b: { x: 2, y: 1 }, open: true }
		];
		const s = shapeOf({ grid: grid(3, 2), objects });
		const at = (a: [number, number], b: [number, number]) => {
			const { axis, index } = edgeSlot(s.grid, {
				a: { x: a[0], y: a[1] },
				b: { x: b[0], y: b[1] }
			});
			return s.edges.built[axis][index];
		};
		expect(at([0, 1], [1, 1])).toBe(EDGE_BUILT.wall);
		expect(at([1, 1], [2, 1])).toBe(EDGE_BUILT.door);
		expect(at([1, 0], [1, 1])).toBe(EDGE_BUILT.wall);
		expect(at([2, 0], [2, 1])).toBe(EDGE_BUILT.window);
		expect(at([0, 0], [1, 0])).toBe(EDGE_BUILT.none);
	});

	it('find the same slot from an edge and from the cells beside it', () => {
		const g = grid(5, 4);
		for (let y = 0; y < 4; y++)
			for (let x = 0; x < 5; x++) {
				const i = y * 5 + x;
				if (x < 4)
					expect(slotBetween(g, i, i + 1)).toEqual(
						edgeSlot(g, { a: { x: x + 1, y }, b: { x: x + 1, y: y + 1 } })
					);
				if (y < 3)
					expect(slotBetween(g, i + 5, i)).toEqual(
						edgeSlot(g, { a: { x, y: y + 1 }, b: { x: x + 1, y: y + 1 } })
					);
			}
		expect(slotBetween(grid(1, 3), 0, 1).axis).toBe('h');
	});
});

describe('the continuation rule', () => {
	it("gives an unexplored cell its first known neighbour's value, N, E, S, W, and changes no other", () => {
		// Row-major 3x3, the centre unexplored, east and south known at different levels.
		const s = shapeOf({
			grid: grid(3, 3),
			levels: bytes(0, 0, 0, 0, 0, 2, 0, 5, 0),
			known: bytes(0, 0, 0, 0, 0, 1, 0, 1, 0)
		});
		expect(s.levels[4]).toBe(2); // east before south
		expect(s.levels[0]).toBe(0); // no known neighbour: 0
		const far = shapeOf({
			grid: grid(5, 1),
			levels: bytes(3, 0, 0, 0, 0),
			known: bytes(1, 0, 0, 0, 0)
		});
		expect([...far.levels]).toEqual([3, 3, 0, 0, 0]);
	});

	it('holds for every known/unexplored pattern of a tile and every level and floor', () => {
		const values = [
			{ levels: [0, 1, 3], floors: [0] },
			{ levels: [0], floors: [0, WATER, VOID] }
		];
		let shapes = 0;
		for (const { levels, floors } of values)
			for (let pattern = 0; pattern < 16; pattern++)
				for (let combo = 0; combo < 81; combo++) {
					const pick = (list: number[], k: number) =>
						list[(Math.floor(combo / 3 ** k) % 3) % list.length];
					const known = Uint8Array.from([0, 1, 2, 3], (k) => (pattern >> k) & 1);
					const s = shapeOf({
						grid: grid(2, 2),
						levels: Uint8Array.from([0, 1, 2, 3], (k) => (known[k] ? pick(levels, k) : 0)),
						floor: Uint8Array.from([0, 1, 2, 3], (k) => (known[k] ? pick(floors, k) : 0)),
						known
					});
					expect(checkContinuation(s), `pattern ${pattern} combo ${combo}`).toEqual([]);
					shapes++;
				}
		expect(shapes).toBe(2 * 16 * 81);
	});

	it('splits an unexplored corner along its diagonal where its known neighbours differ', () => {
		// NW unexplored; NE at 2, SW at 0, SE at 2.
		const s = shapeOf({ grid: grid(2, 2), levels: bytes(0, 2, 0, 2), known: bytes(0, 1, 1, 1) });
		const tile = (1 * 3 + 1) * 8;
		expect(s.tiles.levels[tile + 7]).toBe(2); // NW toward NE
		expect(s.tiles.levels[tile + 6]).toBe(0); // NW toward SW
	});
});

describe('saddles', () => {
	it('match canStep for every 2x2 pattern of levels 0 to 3 and void', () => {
		const values = [0, 1, 2, 3, -1];
		let count = 0;
		for (let combo = 0; combo < 5 ** 4; combo++) {
			const v = [0, 1, 2, 3].map((k) => values[Math.floor(combo / 5 ** k) % 5]);
			const s = shapeOf({
				grid: grid(2, 2),
				levels: Uint8Array.from(v, (l) => Math.max(l, 0)),
				floor: Uint8Array.from(v, (l) => (l < 0 ? VOID : 0))
			});
			const { problems, count: n } = saddleProblems(s);
			expect(problems, v.join()).toEqual([]);
			count += n;
		}
		expect(count).toBeGreaterThan(100);
	});

	it('join the higher pair of a one-level checkerboard, the connected pair, or pinch', () => {
		// Cells row-major: NW, NE / SW, SE; the tile at (1, 1).
		const at = (l: number[], mask: number | 'walkable' = 1, floor?: number[]) =>
			dualCase(
				shapeOf({ grid: grid(2, 2), levels: bytes(...l), floor: floor && bytes(...floor) }),
				1,
				1,
				mask
			);
		expect(at([1, 0, 0, 1])).toMatchObject({ corners: 5, join: JOIN.in });
		expect(at([2, 0, 0, 2])).toMatchObject({ corners: 5, join: JOIN.pinch });
		expect(at([3, 0, 0, 1])).toMatchObject({ corners: 5, join: JOIN.out });
		expect(at([0, 0, 0, 0], 'walkable', [0, VOID, VOID, 0])).toMatchObject({
			corners: 5,
			join: JOIN.pinch
		});
		expect(at([1, 0, 0, 1], 2)).toMatchObject({ corners: 0, join: JOIN.none });
	});

	it('join land and water by a hash of the tile, the same every time', () => {
		const s = shapeOf({ grid: grid(2, 2), floor: bytes(0, WATER, WATER, 0) });
		expect(dualCase(s, 1, 1, 'land').join).toBe(tileHash(1, 1) ? JOIN.in : JOIN.out);
		const bits = Array.from({ length: 64 }, (_, k) => tileHash(k % 8, k >> 3));
		expect(bits.filter(Boolean).length).toBeGreaterThan(16);
		expect(bits.filter(Boolean).length).toBeLessThan(48);
	});
});

describe('seeded random tables', () => {
	const tables = Array.from({ length: 150 }, (_, seed) => randomTable(seed + 1));

	it('keep the continuation rule, the saddles and the harness', () => {
		let saddles = 0;
		for (const [k, t] of tables.entries()) {
			const s = worldShape(t);
			expect(checkContinuation(s), `seed ${k + 1}`).toEqual([]);
			const { problems, count } = saddleProblems(s);
			expect(problems, `seed ${k + 1}`).toEqual([]);
			saddles += count;
			expect(checkEmitter(s, referenceBoxes(s)), `seed ${k + 1}`).toEqual([]);
		}
		expect(saddles).toBeGreaterThan(20);
	});

	it('read nothing of unexplored cells: anything sent there changes nothing', () => {
		for (const [k, t] of tables.entries()) {
			const rnd = random(k + 1000);
			const scramble = (m: Uint8Array) =>
				m.map((v, i) => (t.known![i] ? v : i % 2 ? VOID : Math.floor(rnd() * 8)));
			const a = worldShape(t);
			const b = worldShape({ ...t, levels: scramble(t.levels!), floor: scramble(t.floor!) });
			for (const key of ['levels', 'floor', 'tiles', 'edges', 'walls'] as const)
				expect(b[key], `seed ${k + 1} ${key}`).toEqual(a[key]);
		}
	});

	it('change only cells within one cell of the known region', () => {
		for (const t of tables) {
			const s = worldShape(t);
			const { width: w, height: h } = t.grid;
			for (let i = 0; i < w * h; i++) {
				const [x, y] = [i % w, Math.floor(i / w)];
				const near = [
					[0, -1],
					[1, 0],
					[0, 1],
					[-1, 0]
				].some(
					([dx, dy]) =>
						x + dx >= 0 &&
						y + dy >= 0 &&
						x + dx < w &&
						y + dy < h &&
						t.known![(y + dy) * w + x + dx]
				);
				if (!t.known![i] && !near) expect([s.levels[i], s.floor[i]]).toEqual([0, 0]);
			}
		}
	});
});

describe('the harness', () => {
	// A ledge at 3 (cells 0 and 1), a cliff down to 0 (cell 2), a pillar (3) beside unexplored ground.
	const table = { grid: grid(5, 1), levels: bytes(3, 3, 0, 3, 0), known: bytes(1, 1, 1, 1, 0) };
	const shape = shapeOf(table);
	const boxes = referenceBoxes(shape);
	const mesh = (quads: [number, number, number][][], owner = 0): EmitterMesh => ({
		positions: new Float32Array(quads.flat(2)),
		indices: Uint32Array.from(quads.flatMap((_, q) => [0, 1, 2, 0, 2, 3].map((k) => q * 4 + k))),
		owners: new Int32Array(quads.length * 4).fill(owner)
	});
	const join = (a: EmitterMesh, b: EmitterMesh): EmitterMesh => ({
		positions: Float32Array.from([...a.positions, ...b.positions]),
		indices: Uint32Array.from([...a.indices, ...b.indices.map((i) => i + a.positions.length / 3)]),
		owners: Int32Array.from([...a.owners, ...b.owners])
	});
	// Cell 0's centre is at x = -2, z = 0, its floor at 1.2; the cliff's edge at x = -0.5.
	const box = (x: number, z: number, r: number, y0: number, y1: number) =>
		mesh([
			[
				[x - r, y1, z - r],
				[x - r, y1, z + r],
				[x + r, y1, z + r],
				[x + r, y1, z - r]
			],
			[
				[x - r, y0, z - r],
				[x + r, y0, z - r],
				[x + r, y1, z - r],
				[x - r, y1, z - r]
			]
		]);

	it('passes the reference boxes', () => {
		expect(checkEmitter(shape, boxes)).toEqual([]);
	});

	it("catches today's boxes drawing a drop toward an unexplored cell", () => {
		const raw = referenceBoxes(shapeOf({ ...table, known: null }));
		expect(checkEmitter(shape, raw).map((v) => v.rule)).toContain('unexplored-face');
	});

	it('catches ground that sinks inside a token disk, and a lip above a cliff top', () => {
		const sunk = { ...boxes, positions: boxes.positions.map((v, k) => (k === 1 ? v - 0.3 : v)) };
		expect(checkEmitter(shape, sunk).map((v) => v.rule)).toContain('disk');
		const lip = join(boxes, box(-0.55, 0, 0.05, 1.2, 1.5));
		expect(checkEmitter(shape, lip).map((v) => v.rule)).toContain('cliff-top');
	});

	it('lets a decoration reach INTRUSION into a disk, not further', () => {
		expect(checkEmitter(shape, boxes, box(-2 + 0.4, 0, 0.01, 1.2, 1.6))).toEqual([]);
		expect(checkEmitter(shape, boxes, box(-2 + 0.3, 0, 0.01, 1.2, 1.6)).map((v) => v.rule)).toEqual(
			['intrusion']
		);
	});

	it('catches a vertex owned by no cell', () => {
		expect(
			checkEmitter(shape, { ...boxes, owners: boxes.owners.map((o, k) => (k ? o : 99)) })[0].rule
		).toBe('owner');
	});
});

describe('dirty chunks', () => {
	const g = grid(40, 40);
	const base = shapeOf({ grid: g, levels: new Uint8Array(1600) });

	it('are the chunks round a changed cell, with a one-cell margin', () => {
		expect(dirtyChunks(base, base)).toEqual([]);
		const levels = new Uint8Array(1600);
		levels[5 * 40 + 16] = 2;
		// Cell (16, 5): its margin reaches x = 15 in chunk 0 and x = 17 in chunk 1.
		expect(dirtyChunks(base, shapeOf({ grid: g, levels }))).toEqual([0, 1]);
		levels.fill(0);
		levels[20 * 40 + 20] = 1;
		expect(dirtyChunks(base, shapeOf({ grid: g, levels }))).toEqual([4]);
		expect(CHUNK).toBe(16);
	});

	it('follow what the viewer knows, and are every chunk for a new grid', () => {
		const known = new Uint8Array(1600).fill(1);
		known[39 * 40 + 39] = 0;
		expect(dirtyChunks(base, shapeOf({ grid: g, levels: new Uint8Array(1600), known }))).toEqual([
			8
		]);
		expect(dirtyChunks(null, base)).toHaveLength(9);
		expect(dirtyChunks(shapeOf({ grid: grid(10, 10) }), base)).toHaveLength(9);
	});
});

describe('cost', () => {
	it('classifies a 64x64 table in a few milliseconds in Node', () => {
		const t = randomTable(7, 64, 64);
		for (let k = 0; k < 10; k++) worldShape(t);
		const times = Array.from({ length: 30 }, () => {
			const start = performance.now();
			worldShape(t);
			return performance.now() - start;
		}).sort((a, b) => a - b);
		// Under 1 ms on the reference machine (docs/PERFORMANCE.md); loose here for CI.
		expect(times[15]).toBeLessThan(10);
	});
});
