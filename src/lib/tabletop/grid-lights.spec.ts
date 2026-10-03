import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeFloor, FLOOR_IDS } from '$lib/game/floor';
import type { GridPos, SquareGrid } from '$lib/game/grid';
import { lightSources, litMask, type LightSource } from '$lib/game/lights';
import {
	blockingEdges,
	canStep,
	windowEdges,
	type Obstacles,
	type SceneObject
} from '$lib/game/objects';
import { obstaclesFor } from '$lib/game/props';
import { parseSceneFile } from '$lib/game/scene-file';
import { decodeLevels } from '$lib/game/terrain';
import { addVision, emptyMask, hasLineOfSight, SightCache } from '$lib/game/visibility';
import {
	bounceField,
	BOUNCE_RANGE,
	buildLists,
	buildRows,
	CAVITY_PER_SIDE,
	cavityField,
	contribution,
	floorAlbedo,
	groundTint,
	OPEN_BITS,
	openSides,
	packIndirect,
	DATA_TEXELS,
	GRID_LIGHT_CAPACITY,
	LIGHT_TEXELS,
	packLight,
	ROW_ANGLES
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
		const score = (i: number) => contribution(sources[i], Math.abs(11 - sources[i].pos.x));
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

describe('packLight', () => {
	it('lays a light out in a row of its own: three data texels, then its occlusion row', () => {
		const row = Float32Array.from({ length: ROW_ANGLES }, (_, a) => a / 8);
		const out = new Float32Array(LIGHT_TEXELS * 4 * 2);
		const entry = {
			id: 'torch',
			visual: { x: 1, y: 2, z: 3 },
			reach: 4.5,
			colour: [0.5, 0.25, 0.125] as const,
			intensity: 2,
			ruleOrigin: { x: 6, y: 7 },
			profile: 2,
			phase: 0.75,
			flags: 1
		};
		packLight(entry, row, out, LIGHT_TEXELS * 4);
		const at = (texel: number) => [...out.subarray(LIGHT_TEXELS * 4 + texel * 4).slice(0, 4)];
		expect(LIGHT_TEXELS).toBe(DATA_TEXELS + ROW_ANGLES / 4);
		expect(out.subarray(0, LIGHT_TEXELS * 4).every((v) => v === 0)).toBe(true);
		expect(at(0)).toEqual([1, 2, 3, 4.5]);
		expect(at(1)).toEqual([1, 0.5, 0.25, 1]);
		expect(at(2)).toEqual([6.5, 7.5, 2, 0.75]);
		expect(at(DATA_TEXELS)).toEqual([0, 1 / 8, 2 / 8, 3 / 8]);
		expect(at(LIGHT_TEXELS - 1)).toEqual([252 / 8, 253 / 8, 254 / 8, 255 / 8]);
	});
});

describe('bounce and cavity (#234)', () => {
	const cells = grid.width * grid.height;
	const bounceOf = (sources: LightSource[], blocked: Obstacles, floor: Uint8Array | null = null) =>
		bounceField(
			grid,
			new SightCache().use(grid, blocked),
			sources,
			floorAlbedo(cells, floor),
			openSides(grid, blocked)
		);
	const lit = (b: Float32Array, c: number) => b[c * 3] + b[c * 3 + 1] + b[c * 3 + 2] > 0;

	it("stays on each light's own lit cells: nothing crosses a wall, nothing where it doesn't light", () => {
		for (const s of SOURCES) {
			const bounce = bounceOf([s], ROOMS);
			const rules = litMask(grid, ROOMS, [s]);
			const stray = [...rules.keys()].filter((c) => lit(bounce, c) && !rules[c]);
			expect(stray, `${s.pos.x},${s.pos.y}`).toEqual([]);
			expect(lit(bounce, s.pos.y * grid.width + s.pos.x)).toBe(true);
		}
		// Beside the wall on x = 12, away from the door gap: none on the far side.
		const bounce = bounceOf([source(10, 5, 6)], ROOMS);
		for (let y = 0; y < 10; y++) expect(lit(bounce, y * grid.width + 12), `12,${y}`).toBe(false);
		expect(lit(bounce, 5 * grid.width + 11)).toBe(true);
	});

	it("follows the light's colour and the floor's albedo; a room without light has none", () => {
		const open = obstacles([]);
		const at = 5 * grid.width + 6;
		const red = bounceOf([{ ...source(5, 5, 4), color: '#ff2000' }], open);
		expect(red[at * 3]).toBeGreaterThan(10 * red[at * 3 + 1]);
		const grass = new Uint8Array(cells).fill(FLOOR_IDS.indexOf('grass'));
		const green = bounceOf([{ ...source(5, 5, 4), color: '#ffffff' }], open, grass);
		expect(green[at * 3 + 1]).toBeGreaterThan(green[at * 3]);
		expect(green[at * 3 + 1]).toBeGreaterThan(green[at * 3 + 2]);
		const none = new Uint8Array(cells).fill(FLOOR_IDS.indexOf('void'));
		expect(bounceOf([source(5, 5, 4)], open, none).every((v) => v === 0)).toBe(true);
		expect(bounceOf([], ROOMS).every((v) => v === 0)).toBe(true);
		// The same inputs, the same field.
		expect(bounceOf(SOURCES, ROOMS)).toEqual(bounceOf(SOURCES, ROOMS));
	});

	it('puts cavity only at the feet of walls and ledges', () => {
		const room = obstacles([
			wall('n', { x: 2, y: 2 }, { x: 8, y: 2 }),
			wall('w', { x: 2, y: 2 }, { x: 2, y: 8 })
		]);
		const cavity = cavityField(grid, room);
		const at = (x: number, y: number) => cavity[y * grid.width + x];
		expect(at(2, 2)).toBeCloseTo(2 * CAVITY_PER_SIDE); // the corner
		expect(at(4, 2)).toBeCloseTo(CAVITY_PER_SIDE);
		expect(at(4, 1)).toBeCloseTo(CAVITY_PER_SIDE); // the wall's far side
		expect(at(5, 5)).toBe(0);
		expect(at(0, 0)).toBe(0); // the grid's own edge doesn't count
		const levels = new Uint8Array(cells);
		levels[10 * grid.width + 10] = 2;
		const ledge = cavityField(grid, obstacles([], levels));
		expect(ledge[10 * grid.width + 9]).toBeCloseTo(CAVITY_PER_SIDE);
		expect(ledge[10 * grid.width + 10]).toBe(0); // the top stays clean
		expect([...ledge].filter((v) => v > 0)).toHaveLength(4);
	});

	it('spreads only across sides that sight crosses, never a window or a step too high', () => {
		const levels = new Uint8Array(cells);
		levels[3 * grid.width + 20] = 2;
		const glass = [wall('win', { x: 3, y: 6 }, { x: 4, y: 6 }, true)];
		const sides = openSides(grid, obstacles(glass, levels));
		expect(sides[5 * grid.width + 3] & 2).toBe(0); // the window between (3,5) and (3,6)
		expect(sides[5 * grid.width + 4] & 2).toBe(2);
		expect(sides[3 * grid.width + 19] & 1).toBe(0); // up two levels
		expect(sides[2 * grid.width + 20] & 2).toBe(0);
		// Elsewhere, exactly what canStep in sight mode allows both ways (no windows there).
		for (let y = 7; y < grid.height - 1; y++)
			for (let x = 0; x < grid.width - 1; x++) {
				const [c, e, s] = [
					{ x, y },
					{ x: x + 1, y },
					{ x, y: y + 1 }
				];
				const both = (b: GridPos) => canStep(ROOMS, c, b, 'sight') && canStep(ROOMS, b, c, 'sight');
				const open = openSides(grid, ROOMS)[y * grid.width + x];
				expect(!!(open & 1), `${x},${y} east`).toBe(both(e));
				expect(!!(open & 2), `${x},${y} south`).toBe(both(s));
			}
	});

	it('packs bounce over BOUNCE_RANGE into RGB, and shut sides and open bits into A', () => {
		const bounce = new Float32Array([BOUNCE_RANGE, BOUNCE_RANGE / 2, 9, 0, 0, 0]);
		const cavity = new Float32Array([2 * CAVITY_PER_SIDE, 0]);
		// Two cells side by side, open between them: the first's east, the second's west.
		const out = packIndirect(2, bounce, cavity, new Uint8Array([1, 0]));
		expect([...out]).toEqual([255, 128, 255, 2 * 16 + OPEN_BITS.east, 0, 0, 0, OPEN_BITS.west]);
	});

	it("tints the hemisphere's ground by the painted floors' hue, white with none", () => {
		expect(groundTint(null)).toEqual([1, 1, 1]);
		expect(groundTint(new Uint8Array(4))).toEqual([1, 1, 1]);
		const [r, g, b] = groundTint(new Uint8Array(4).fill(FLOOR_IDS.indexOf('grass')));
		expect(g).toBeGreaterThan(r);
		expect(g).toBeGreaterThan(b);
		expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeCloseTo(1);
	});
});
