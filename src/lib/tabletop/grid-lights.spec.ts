import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeFloor } from '$lib/game/floor';
import type { GridPos, SquareGrid } from '$lib/game/grid';
import { lightSources, litMask, type LightSource } from '$lib/game/lights';
import { blockingEdges, windowEdges, type Obstacles, type SceneObject } from '$lib/game/objects';
import { obstaclesFor } from '$lib/game/props';
import { parseSceneFile } from '$lib/game/scene-file';
import { decodeLevels } from '$lib/game/terrain';
import { addVision, emptyMask, hasLineOfSight, SightCache } from '$lib/game/visibility';
import {
	buildLists,
	buildRows,
	DATA_TEXELS,
	GRID_LIGHT_CAPACITY,
	packLightData,
	ROW_ANGLES,
	standInFalloff
} from './grid-lights';

const GRID: SquareGrid = { kind: 'square', cellSize: 1, width: 24, height: 24 };
const grid = GRID;
const wall = (id: string, a: GridPos, b: GridPos, window = false): SceneObject => ({
	id,
	kind: 'wall',
	a,
	b,
	window
});
const obstacles = (objects: SceneObject[], levels: Uint8Array | null = null): Obstacles => ({
	edges: blockingEdges(objects),
	windows: windowEdges(objects),
	width: grid.width,
	solid: null,
	opaque: null,
	levels
});
const source = (x: number, y: number, radius: number, intensity = 1): LightSource => ({
	pos: { x, y },
	radius,
	color: '#ffa04d',
	intensity
});

// Two rooms side by side (a wall on x = 12 with a door gap at y 11) and a window run at y = 6.
const ROOMS = obstacles([
	wall('w1', { x: 12, y: 0 }, { x: 12, y: 11 }),
	wall('w2', { x: 12, y: 12 }, { x: 12, y: 24 }),
	wall('win', { x: 3, y: 6 }, { x: 9, y: 6 }, true),
	wall('w3', { x: 15, y: 6 }, { x: 21, y: 6 })
]);
const SOURCES = [
	source(5, 5, 6),
	source(11, 11, 8, 2),
	source(14, 4, 4),
	source(18, 18, 20, 0.5),
	source(0, 0, 3),
	source(13, 11, 5)
];

/** The cells each light is listed on. */
function listed(lists: Uint8Array, k: number, index: number): Uint8Array {
	const mask = emptyMask(grid);
	for (let c = 0; c < mask.length; c++) {
		for (let j = 0; j < k; j++) if (lists[c * k + j] === index + 1) mask[c] = 1;
	}
	return mask;
}

describe('buildLists', () => {
	it("lists each light on exactly the cells the rules' litMask lights", () => {
		const cache = new SightCache().use(grid, ROOMS);
		const lists = buildLists(grid, cache, SOURCES, 8);
		SOURCES.forEach((s, i) => {
			expect(listed(lists, 8, i)).toEqual(litMask(grid, ROOMS, [s]));
		});
	});

	it('keeps the strongest K by contribution, strongest first, when more reach a cell', () => {
		const open = obstacles([]);
		const cache = new SightCache().use(grid, open);
		const sources = [source(10, 10, 6, 0.5), source(12, 10, 6, 1), source(9, 10, 6, 3)];
		const lists = buildLists(grid, cache, sources, 2);
		const c = 10 * grid.width + 11;
		const score = (i: number) =>
			sources[i].intensity! * standInFalloff(Math.abs(11 - sources[i].pos.x), sources[i].radius);
		const order = [0, 1, 2].sort((a, b) => score(b) - score(a));
		expect([...lists.subarray(c * 2, c * 2 + 2)]).toEqual([order[0] + 1, order[1] + 1]);
		// Every listed light lights its cell by the rules, even when a cell's list is full.
		sources.forEach((s, i) => {
			const lit = litMask(grid, open, [s]);
			listed(lists, 2, i).forEach((v, cell) => v && expect(lit[cell]).toBe(1));
		});
	});

	it('leaves out lights past the capacity', () => {
		const cache = new SightCache().use(grid, obstacles([]));
		const many = Array.from({ length: GRID_LIGHT_CAPACITY + 3 }, () => source(3, 3, 1));
		const lists = buildLists(grid, cache, many, 4);
		expect(Math.max(...lists)).toBeLessThanOrEqual(GRID_LIGHT_CAPACITY);
	});
});

/** Checks a light's rows against the rules' sight along every angle. */
function checkRows(
	blocked: Obstacles,
	origin: GridPos,
	radius: number,
	grid: SquareGrid = GRID
): Float32Array {
	const sight = emptyMask(grid);
	addVision(grid, blocked, origin, radius, sight);
	const levels = blocked.levels ?? null;
	const rows = buildRows(grid, sight, origin, levels);
	const below = (c: GridPos) =>
		!!levels && levels[c.y * grid.width + c.x] < levels[origin.y * grid.width + origin.x];
	const at = (a: number, d: number) => {
		const angle = (2 * Math.PI * a) / ROW_ANGLES;
		return {
			x: Math.floor(origin.x + 0.5 + d * Math.cos(angle)),
			y: Math.floor(origin.y + 0.5 + d * Math.sin(angle))
		};
	};
	const onMap = (c: GridPos) => c.x >= 0 && c.y >= 0 && c.x < grid.width && c.y < grid.height;
	const checked = new Set<number>();
	for (let a = 0; a < ROW_ANGLES; a++) {
		// Before the row's distance every cell the ray is on is in sight (or a drop below the
		// light, which the lists keep dark): no light leaks.
		for (let d = 0; d < rows[a] - 1e-6; d += 0.05) {
			const c = at(a, d);
			const i = c.y * grid.width + c.x;
			if (below(c) || checked.has(i)) continue;
			checked.add(i);
			expect(sight[i], `angle ${a} at ${d}`).toBe(1);
			expect(hasLineOfSight(blocked, origin, c)).toBe(true);
		}
		// Just past it, the ray is on a cell out of sight (or off the map): the row is tight.
		const past = at(a, rows[a] + 1e-4);
		if (onMap(past) && !below(past))
			expect(sight[past.y * grid.width + past.x], `angle ${a}`).toBe(0);
	}
	return rows;
}

describe('buildRows', () => {
	it('agrees with the rules along every angle, in rooms and through a door gap', () => {
		for (const s of SOURCES) checkRows(ROOMS, s.pos, s.radius);
	});

	it('stops at the exact wall edge', () => {
		const rows = checkRows(ROOMS, { x: 9, y: 2 }, 8);
		// Straight at the wall on x = 12 from the centre of x = 9 (9.5): 2.5 cells.
		expect(rows[0]).toBeCloseTo(2.5, 6);
		// 45° down-right: the x = 12 line at 2.5·√2.
		expect(rows[ROW_ANGLES / 8]).toBeCloseTo(2.5 * Math.SQRT2, 6);
	});

	it('passes through windows, which block movement and not sight', () => {
		// From (5, 3) straight down (+y): through the window at y = 6 to the radius.
		const rows = checkRows(ROOMS, { x: 5, y: 3 }, 6);
		expect(rows[ROW_ANGLES / 4]).toBeGreaterThan(6);
		const solid = obstacles([wall('w', { x: 3, y: 6 }, { x: 9, y: 6 })]);
		expect(checkRows(solid, { x: 5, y: 3 }, 6)[ROW_ANGLES / 4]).toBeCloseTo(2.5, 6);
	});

	it('shines from a balcony over a low ridge that hides the ground beyond from the floor', () => {
		// A balcony at level 5 for x < 4, the floor at 0 beyond, a ridge at level 2 on x = 7.
		const levels = new Uint8Array(grid.width * grid.height);
		for (let y = 0; y < grid.height; y++) {
			for (let x = 0; x < 4; x++) levels[y * grid.width + x] = 5;
			levels[y * grid.width + 7] = 2;
		}
		const blocked = obstacles([], levels);
		const balcony = checkRows(blocked, { x: 2, y: 12 }, 12);
		const floor = checkRows(blocked, { x: 5, y: 12 }, 12);
		// From the balcony the ray runs over the drop under its edge and on past the ridge; from
		// the floor beside the ridge it stops there.
		expect(balcony[0]).toBeGreaterThan(8 - 2);
		expect(floor[0]).toBeLessThan(8 - 5);
		// Without the levels the drop under the balcony's edge would stop it at the edge.
		const sight = emptyMask(grid);
		addVision(grid, blocked, { x: 2, y: 12 }, 12, sight);
		expect(buildRows(grid, sight, { x: 2, y: 12 })[0]).toBeCloseTo(1.5, 6);
	});
});

/** A fixture table's grid, obstacles (walls, doors, props, levels, floors) and light sources. */
function fixture(name: string) {
	const raw = JSON.parse(readFileSync(`tests/fixtures/scenes/${name}.json`, 'utf8'));
	const parsed = parseSceneFile(raw);
	if (!parsed.ok) throw new Error(parsed.error);
	const scene = parsed.scene;
	const size = scene.grid.width * scene.grid.height;
	const levels = scene.terrain ? decodeLevels(scene.terrain, size) : null;
	const floor = scene.floor ? decodeFloor(scene.floor, size) : null;
	const blocked = obstaclesFor(scene.grid, scene.objects, scene.props, levels, floor);
	return { grid: scene.grid, blocked, sources: lightSources(scene.lights, scene.tokens) };
}

describe('on the fixture tables', () => {
	// The dungeon's 40 torches in walled rooms, the monastery's windows, gallery and belfry, and
	// the Hollow's levels, bridges and drops.
	for (const name of ['dungeon-40', 'monastery', 'hollow']) {
		it(`${name}: lists equal litMask per light, rows never leave the rules' sight`, () => {
			const { grid, blocked, sources } = fixture(name);
			expect(sources.length).toBeGreaterThan(0);
			const cache = new SightCache().use(grid, blocked);
			const lists = buildLists(grid, cache, sources, 32);
			const cells = grid.width * grid.height;
			sources.forEach((s, i) => {
				const mine = new Uint8Array(cells);
				for (let c = 0; c < cells; c++) {
					for (let j = 0; j < 32; j++) if (lists[c * 32 + j] === i + 1) mine[c] = 1;
				}
				expect(mine).toEqual(litMask(grid, blocked, [s]));
				checkRows(blocked, s.pos, s.radius, grid);
			});
		});
	}
});

describe('packLightData', () => {
	it('lays each light out in its column of three texel rows', () => {
		const data = packLightData([
			{
				visual: { x: 1, y: 2, z: 3 },
				reach: 4,
				rgb: [0.5, 0.25, 0.125],
				ruleOrigin: { x: 6, y: 7 },
				profile: 2,
				phase: 0.75,
				flags: 1
			}
		]);
		const line = GRID_LIGHT_CAPACITY * 4;
		expect(data.length).toBe(line * DATA_TEXELS);
		expect([...data.subarray(0, 4)]).toEqual([1, 2, 3, 4]);
		expect([...data.subarray(line, line + 4)]).toEqual([0.5, 0.25, 0.125, 1]);
		expect([...data.subarray(2 * line, 2 * line + 4)]).toEqual([6.5, 7.5, 2, 0.75]);
		expect(data[4]).toBe(0);
	});
});
