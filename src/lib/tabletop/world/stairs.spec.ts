// Stairs (#255): the monastery's and the Hollow's runs built as steps, with
// stringers, rails and kerbs where the issue says; every fixture scene and view
// (and seeded random tables, fogged and not) through the harness with the token
// disks flat, the trim clear of them, nothing toward unexplored ground and no
// ray through; a synthetic kit taking the pieces; only the chunks a change
// touches rebuilt.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FIGURE_CLEAR, type KitDef } from '$lib/assets/kit';
import { decodeFloor, FLOOR_IDS, VOID } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import { parseSceneFile } from '$lib/game/scene-file';
import { decodeLevels } from '$lib/game/terrain';
import type { FogView } from '$lib/game/visibility';
import { chunkWorld, HALF_TREAD, NOSING, RECESS, tableWorld } from './cliffs';
import { checkContinuation, checkEmitter } from './invariants';
import { joinMeshes } from './join';
import { cracks, hit, randomTable, topAt } from './random-table';
import {
	chunksAcross,
	knownOf,
	STAIR_EDGE,
	slotBetween,
	worldShape,
	type ShapeInput,
	type WorldShape
} from './shape';
import {
	builtGround,
	stairDirty,
	stairsOf,
	stairTrim,
	withStairs,
	type StairOptions,
	type StairPiece,
	type Stairs
} from './stairs';

vi.setConfig({ testTimeout: 60_000 });

const LEVEL = 0.4;
const SCENES = 'tests/fixtures/scenes';
const VIEWS = 'tests/fixtures/views';

interface Sent {
	grid: SquareGrid;
	terrain: string | null;
	floor: string | null;
	objects: SceneObject[];
	fog?: FogView;
	environment?: string | null;
}

function input(sent: Sent, known: ShapeInput['known']): ShapeInput {
	const size = sent.grid.width * sent.grid.height;
	return {
		grid: sent.grid,
		levels: sent.terrain ? decodeLevels(sent.terrain, size) : null,
		floor: sent.floor ? decodeFloor(sent.floor, size) : null,
		objects: sent.objects,
		known
	};
}

const scenes = readdirSync(SCENES)
	.filter((f) => f.endsWith('.json') && !f.endsWith('.poses.json'))
	.map((f) => {
		const parsed = parseSceneFile(JSON.parse(readFileSync(path.join(SCENES, f), 'utf8')));
		if (!parsed.ok) throw new Error(`${f}: ${parsed.error}`);
		const sent = parsed.scene as unknown as Sent;
		return { name: f.replace('.json', ''), input: input(sent, null), env: sent.environment };
	});
const views = readdirSync(VIEWS)
	.filter((f) => f.endsWith('.json'))
	.flatMap((f) => {
		const all = JSON.parse(readFileSync(path.join(VIEWS, f), 'utf8')) as Record<string, Sent>;
		return (['gm', 'player', 'spectator'] as const).map((viewer) => {
			const v = all[viewer];
			const known = v.fog ? knownOf(v.grid, v.fog, viewer === 'gm') : null;
			return { name: `${f} ${viewer}`, input: input(v, known), env: v.environment };
		});
	});
const every = [...scenes, ...views];
const shaped = (t: (typeof every)[number]) =>
	withStairs(worldShape(t.input), { built: builtGround(t.env) });
const scene = (name: string) => shaped(scenes.find((s) => s.name === name)!);

const at = (s: WorldShape, x: number, y: number) => y * s.grid.width + x;
const grid = (width: number, height: number): SquareGrid => ({
	kind: 'square',
	cellSize: 1,
	width,
	height
});
const shapeOf = (over: Partial<ShapeInput> & { grid: SquareGrid }, options: StairOptions = {}) =>
	withStairs(worldShape({ levels: null, floor: null, objects: [], known: null, ...over }), options);

/** The pieces of a role at a cell, by the direction they face. */
const piecesAt = (s: { stairs: Stairs }, role: StairPiece['role'], cell: number) =>
	s.stairs.pieces.filter((p) => p.role === role && p.cell === cell).map((p) => p.dir);

/** Every chunk's trim (rails and kerbs) as one mesh. */
const tableTrim = (s: WorldShape) => {
	const across = chunksAcross(s.grid);
	return joinMeshes(Array.from({ length: across.x * across.y }, (_, c) => stairTrim(s, c)).flat());
};

/**
 * A two-wide stair climbing east on rows 1 and 2, levels 0 to 3, with level 0 north and a terrace
 * one level below it south (a drop on one side only: a stair, not a bridge, #256).
 */
const G = grid(5, 4);
const STAIR = Uint8Array.from([0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 0, 1, 2, 3, 3, 0, 0, 1, 2, 2]);
/** The step at level 2 on row 1, and the cell north of it. */
const STEP = 7;
const NORTH = 2;

const N = 0;
const S = 2;
const E = 1;
const W = 3;

describe('stairs on the monastery', () => {
	const s = scene('monastery');

	it('builds the gallery stair with rails only where the nave drops two levels or more', () => {
		// x 15 to 18 on row 9, levels 1 to 4, climbing east to the gallery; the nave (0) north.
		for (let x = 15; x <= 19; x++)
			expect(piecesAt(s, 'stair.riser', at(s, x, 9)), `${x}`).toEqual([W]);
		for (let x = 15; x <= 18; x++) expect(s.stairs.steps[at(s, x, 9)], `${x}`).toBe(1);
		// The north side: a stringer down to the nave on every step, a rail from x = 16.
		for (let x = 15; x <= 18; x++) expect(piecesAt(s, 'stair.side', at(s, x, 9))).toEqual([N]);
		expect(piecesAt(s, 'railing', at(s, 15, 9))).toEqual([]);
		for (let x = 16; x <= 18; x++) expect(piecesAt(s, 'railing', at(s, x, 9)), `${x}`).toEqual([N]);
		// The south side is the nave's wall: nothing.
		for (let x = 15; x <= 18; x++)
			expect(s.stairs.pieces.some((p) => p.cell === at(s, x, 9) && p.dir === S)).toBe(false);
		expect(s.stairs.pieces.some((p) => p.role === 'kerb')).toBe(false);
	});

	it('builds the two-wide outside stair with two pieces a step and rails on both drops', () => {
		// x 22 and 23, rows 13 to 10 at levels 1 to 4, climbing north to the ledge.
		for (let y = 9; y <= 13; y++) {
			const step = [22, 23].flatMap((x) => piecesAt(s, 'stair.riser', at(s, x, y)));
			expect(step, `row ${y}`).toEqual([S, S]);
		}
		for (let y = 10; y <= 13; y++) {
			const level = 14 - y;
			const rail = level >= 2 ? [W] : [];
			expect(piecesAt(s, 'railing', at(s, 22, y)), `row ${y}`).toEqual(rail);
			expect(piecesAt(s, 'railing', at(s, 23, y)), `row ${y}`).toEqual(level >= 2 ? [E] : []);
			// Where both sides drop two or more it flies: a two-wide bridge (#256) whose rails are its
			// parapets and whose sides its body; below that, stringers. Nothing between the columns.
			const flying = level >= 2;
			expect(s.stairs.bridges[at(s, 22, y)] !== 0, `row ${y}`).toBe(flying);
			expect(piecesAt(s, 'stair.side', at(s, 22, y))).toEqual(flying ? [] : [W]);
			expect(piecesAt(s, 'stair.side', at(s, 23, y))).toEqual(flying ? [] : [E]);
		}
	});

	it('builds the walled tower stair with no rail and no stringer', () => {
		for (let x = 24; x <= 28; x++) expect(piecesAt(s, 'stair.riser', at(s, x, 2))).toEqual([W]);
		for (let x = 24; x <= 27; x++) {
			expect(s.stairs.steps[at(s, x, 2)]).toBe(1);
			expect(
				s.stairs.pieces.filter((p) => p.cell === at(s, x, 2) && p.role !== 'stair.riser')
			).toEqual([]);
		}
	});

	it('draws each step as two half steps, the lower half over the edge band, the top at its floor', () => {
		const m = tableWorld(s);
		// From the nave side of the gallery stair's first riser (between x 14 and 15, row 9), a ray
		// east: the lower half's riser HALF_TREAD out over x 14, the upper half recessed under the nosing.
		const edge = 15 - s.grid.width / 2;
		const z = 9.5 - s.grid.height / 2;
		const reach = (y: number) => 2 - hit(m, [edge - 2, y, z], [1, 0, 0]);
		expect(reach(LEVEL * 0.25)).toBeCloseTo(HALF_TREAD, 4);
		expect(reach(LEVEL * 0.5 + (LEVEL * 0.5 - NOSING) / 2)).toBeCloseTo(-RECESS, 4);
		expect(reach(LEVEL - NOSING / 2)).toBeCloseTo(0, 4);
		// Straight down: the half step's tread, and the cells' floors across their disks.
		expect(topAt(m, edge - HALF_TREAD / 2, z)).toBeCloseTo(LEVEL / 2, 4);
		expect(topAt(m, edge - 0.3, z)).toBeCloseTo(0, 4);
		expect(topAt(m, edge + 0.3, z)).toBeCloseTo(LEVEL, 4);
	});
});

describe('stairs on the Hollow', () => {
	const s = scene('hollow');

	it('builds the stairs at y 23 and y 13 with kerbs on their drops, hewn not railed', () => {
		for (const x of [40, 41]) {
			expect(s.stairs.steps[at(s, x, 23)]).toBe(1);
			expect(piecesAt(s, 'stair.riser', at(s, x, 23))).toEqual([S]);
			expect(piecesAt(s, 'stair.riser', at(s, x, 22))).toEqual([S]);
		}
		for (const x of [42, 43]) {
			expect(s.stairs.steps[at(s, x, 13)]).toBe(1);
			expect(piecesAt(s, 'stair.riser', at(s, x, 13))).toEqual([S]);
		}
		expect(piecesAt(s, 'kerb', at(s, 40, 23))).toEqual([W]);
		expect(piecesAt(s, 'kerb', at(s, 41, 23))).toEqual([E]);
		// No rail on a hewn stair; the only rails are the bridges' parapets (#256).
		const rails = s.stairs.pieces.filter((p) => p.role === 'railing');
		expect(rails.every((p) => s.stairs.bridges[p.cell] !== 0)).toBe(true);
	});

	it('gives the watch stair onto the high bridge treads, and the bridge its sides', () => {
		for (const x of [38, 39, 40])
			expect(piecesAt(s, 'stair.riser', at(s, x, 9)), `${x}`).toEqual([W]);
		for (const x of [38, 39]) {
			const sides = s.stairs.pieces.filter(
				(p) => p.cell === at(s, x, 9) && p.role !== 'stair.riser'
			);
			// The bridge's parapets (#256), no stringer or kerb.
			expect(sides.map((p) => [p.role, p.dir])).toEqual([
				['railing', N],
				['railing', S]
			]);
		}
	});
});

describe('stairs through the harness', () => {
	it('keep every disk flat, the trim clear of it and nothing toward unexplored ground, everywhere', () => {
		let runs = 0;
		for (const t of every) {
			const s = shaped(t);
			runs += s.stairs.pieces.filter((p) => p.role === 'stair.riser').length;
			expect(
				checkEmitter(s, tableWorld(s), tableTrim(s), { allowance: 0, clear: FIGURE_CLEAR }),
				t.name
			).toEqual([]);
			expect(checkContinuation(s), t.name).toEqual([]);
			// Every piece stands between two known cells.
			const known = (i: number) => !s.known || s.known[i] === 1;
			const blind = s.stairs.pieces.filter((p) => !known(p.cell) || !known(p.across));
			expect(blind, t.name).toEqual([]);
			expect(cracks(tableWorld(s), s.grid, 3, 60), t.name).toEqual([]);
		}
		expect(runs).toBeGreaterThan(40);
	}, 240_000);

	it('pass on seeded random tables, fogged and not, and let no ray through', () => {
		let pieces = 0;
		for (let seed = 1; seed <= 60; seed++) {
			const t = randomTable(seed);
			for (const known of [t.known, null]) {
				const s = withStairs(worldShape({ ...t, known }), { built: seed % 2 === 0 });
				pieces += s.stairs.pieces.length;
				const m = tableWorld(s);
				const name = `seed ${seed}${known ? '' : ', all known'}`;
				expect(
					checkEmitter(s, m, tableTrim(s), { allowance: 0, clear: FIGURE_CLEAR }),
					name
				).toEqual([]);
				expect(cracks(m, s.grid, seed, 120), name).toEqual([]);
			}
		}
		expect(pieces).toBeGreaterThan(0);
	}, 120_000);

	it('draws nothing toward an unexplored neighbour: the stair continues into it', () => {
		const s = shapeOf({ grid: G, levels: STAIR });
		expect(piecesAt(s, 'stair.side', STEP)).toEqual([N]);
		expect(piecesAt(s, 'kerb', STEP)).toEqual([N]);
		const known = new Uint8Array(20).fill(1);
		known[NORTH] = 0;
		const fogged = shapeOf({ grid: G, levels: STAIR, known });
		expect(fogged.stairs.pieces.filter((p) => p.cell === STEP && p.role !== 'stair.riser')).toEqual(
			[]
		);
		expect(checkEmitter(fogged, tableWorld(fogged), tableTrim(fogged))).toEqual([]);
	});

	it("gives an open bridge's sides to the bridge (#256), but not a stair along a wall", () => {
		const levels = Uint8Array.from([0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 0, 0, 0, 0, 0]);
		const open = shapeOf({ grid: G, levels });
		// The step at level 2 drops two both ways: a bridge, with parapets. The first step (drops of
		// 1) is not one.
		const sides = open.stairs.pieces.filter((p) => p.cell === STEP && p.role !== 'stair.riser');
		expect(sides.map((p) => [p.role, p.dir])).toEqual([
			['railing', N],
			['railing', S]
		]);
		expect(piecesAt(open, 'stair.side', STEP - 1)).toEqual([S, N]);
		const wall: SceneObject = { id: 'w', kind: 'wall', a: { x: 0, y: 2 }, b: { x: 5, y: 2 } };
		const walled = shapeOf({ grid: grid(5, 3), levels, objects: [wall] });
		expect(piecesAt(walled, 'stair.side', STEP)).toEqual([N]);
		expect(piecesAt(walled, 'kerb', STEP)).toEqual([N]);
	});
});

describe('stairs and kits', () => {
	const levels = STAIR;
	const kit: KitDef = {
		name: 'Test',
		roof: null,
		presumeRoofs: false,
		pieces: {
			'stair.riser': [{ model: 'step-a' }, { model: 'step-b', weight: 3 }],
			railing: [{ model: 'rail-a' }]
		},
		floors: {}
	};
	const stone = FLOOR_IDS.indexOf('stone');

	it('takes a kit piece wherever the kit has one, and the ground leaves that edge to it', () => {
		const floor = new Uint8Array(20).fill(stone);
		const plain = shapeOf({ grid: G, levels, floor });
		const kitted = shapeOf({ grid: G, levels, floor }, { kit });
		for (const p of kitted.stairs.pieces) {
			if (p.role === 'stair.riser') expect(['step-a', 'step-b']).toContain(p.model);
			else if (p.role === 'railing') expect(p.model).toBe('rail-a');
			else expect(p.model, p.role).toBeNull(); // no stair.side in the kit: procedural
		}
		// The same pieces, the same places: only the models differ.
		const where = (s: { stairs: Stairs }) =>
			s.stairs.pieces.map(({ role, cell, dir }) => [role, cell, dir]);
		expect(where(kitted)).toEqual(where(plain));
		// Variants by the edge's seed: the same every time.
		expect(stairsOf(kitted, { kit }).pieces).toEqual(kitted.stairs.pieces);
		// The risers' edges are the kit's: the ground draws nothing on them, and no rail is trim.
		for (const p of kitted.stairs.pieces.filter((q) => q.role === 'stair.riser')) {
			const { axis, index } = slotBetween(kitted.grid, p.cell, p.across);
			expect(kitted.stairs.edges[axis][index]).toBe(STAIR_EDGE.kit);
		}
		const faces = (s: WorldShape) =>
			chunkWorld(s, 0).sides.reduce((n, m) => n + m.indices.length, 0);
		expect(faces(kitted)).toBeLessThan(faces(plain));
		expect(stairTrim(kitted, 0).every((m) => m.indices.length === 0)).toBe(true);
		expect(stairTrim(plain, 0)[1].indices.length).toBeGreaterThan(0);
		// A ray at the half step's height meets nothing the ground drew (the kit's piece goes there).
		const lowY = LEVEL / 4;
		const fromWest = (s: WorldShape) => hit(tableWorld(s), [-3, LEVEL + lowY, -0.5], [1, 0, 0]);
		expect(fromWest(plain)).toBeLessThan(fromWest(kitted));
	});

	it('styles rails by the floor, and plain ground by the environment', () => {
		const plainFloor = shapeOf({ grid: G, levels });
		expect(plainFloor.stairs.pieces.filter((p) => p.role === 'railing')).toEqual([]);
		expect(plainFloor.stairs.pieces.filter((p) => p.role === 'kerb').length).toBeGreaterThan(0);
		const built = shapeOf({ grid: G, levels }, { built: true });
		expect(built.stairs.pieces.filter((p) => p.role === 'kerb')).toEqual([]);
		expect(built.stairs.pieces.filter((p) => p.role === 'railing').length).toBeGreaterThan(0);
		expect(builtGround('stone-halls')).toBe(true);
		expect(builtGround('cavern')).toBe(false);
		expect(builtGround(null)).toBe(false);
	});

	it('puts rails into the void, but no stringer down to it', () => {
		const floor = new Uint8Array(20);
		floor[NORTH] = VOID;
		const s = shapeOf({ grid: G, levels, floor }, { built: true });
		expect(piecesAt(s, 'stair.side', STEP)).toEqual([]);
		expect(piecesAt(s, 'railing', STEP)).toEqual([N]);
	});
});

describe('stair rebuilds', () => {
	it('rebuilds only the chunks whose stairs a wall changed', () => {
		const t = scenes.find((x) => x.name === 'monastery')!;
		const before = shaped(t);
		// A wall along the gallery stair's north side: no stringer or rail there any more.
		const wall: SceneObject = { id: 'w', kind: 'wall', a: { x: 15, y: 9 }, b: { x: 19, y: 9 } };
		const after = withStairs(worldShape({ ...t.input, objects: [...t.input.objects, wall] }), {
			built: true
		});
		expect(piecesAt(after, 'railing', at(after, 17, 9))).toEqual([]);
		const dirty = stairDirty(before, after);
		expect(dirty).toEqual([0, 1]); // x 14 to 19 with the margin: both chunks of the top row
		expect(stairDirty(before, before)).toEqual([]);
		// A stair the drawn shape didn't have (no stairs at all) is a change too.
		expect(stairDirty(worldShape(t.input), before).length).toBeGreaterThan(0);
	});
});
