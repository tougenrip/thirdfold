// Roofs over roofed rooms (#257): footprints for the GM and for players (the interior mask as
// sent, and presumed rooms closed by known walls), the rectangles and gables, every fixture scene
// and view, Bellweather's houses, and the differential secrecy test: a player's roofs are the
// same whatever the server holds for cells they haven't explored.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIGURE_CLEAR, type KitRoof } from '$lib/assets/kit';
import { decodeFloor, VOID } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import { cellsBeside, unitEdges, type SceneObject } from '$lib/game/objects';
import { parseSceneFile } from '$lib/game/scene-file';
import { decodeLevels } from '$lib/game/terrain';
import { decodeMask, type FogView } from '$lib/game/visibility';
import { WALL_HEIGHT } from '../ground';
import { random } from './random-table';
import { rectsOf, roofFootprint, roofMesh, roofRegions, seenInto } from './roofs';
import { knownOf, worldShape, type ShapeInput } from './shape';

const ROOF: KitRoof = { style: 'gable', pitch: 45, eave: 0.25, material: 'thatch' };
const grid = (width: number, height: number): SquareGrid => ({
	kind: 'square',
	cellSize: 1,
	width,
	height
});
let n = 0;
const wall = (a: [number, number], b: [number, number]): SceneObject => ({
	id: `w${n++}`,
	kind: 'wall',
	a: { x: a[0], y: a[1] },
	b: { x: b[0], y: b[1] }
});
/** A closed room from corner (x0, y0) to (x1, y1), a door in its south wall's first cell. */
const room = (x0: number, y0: number, x1: number, y1: number): SceneObject[] => [
	wall([x0, y0], [x1, y0]),
	wall([x0, y0], [x0, y1]),
	wall([x1, y0], [x1, y1]),
	{ id: `d${n++}`, kind: 'door', a: { x: x0, y: y1 }, b: { x: x0 + 1, y: y1 }, open: false },
	wall([x0 + 1, y1], [x1, y1])
];
const mask = (g: SquareGrid, inside: (x: number, y: number) => boolean) =>
	Uint8Array.from({ length: g.width * g.height }, (_, i) =>
		inside(i % g.width, Math.floor(i / g.width)) ? 1 : 0
	);
const shapeOf = (g: SquareGrid, objects: SceneObject[], known: Uint8Array | null = null) =>
	worldShape({ grid: g, levels: null, floor: null, objects, known });
const cellsOf = (m: Uint8Array) => [...m.keys()].filter((i) => m[i]);

describe('footprints', () => {
	// A 3x2 room inside an 8x6 table: cells (2-4, 2-3).
	const g = grid(8, 6);
	const objects = room(2, 2, 5, 4);
	const inside = (x: number, y: number) => x >= 2 && x < 5 && y >= 2 && y < 4;
	const interior = mask(g, inside);

	it('are the interior mask for the GM and fog off, and never presumed', () => {
		expect(roofFootprint(shapeOf(g, objects), objects, interior, true)).toEqual(interior);
		expect(cellsOf(roofFootprint(shapeOf(g, objects), objects, null, true))).toEqual([]);
	});

	it('presume a room a player has walked round, closed by walls it knows', () => {
		const outside = mask(g, (x, y) => !inside(x, y));
		const shape = shapeOf(g, objects, outside);
		// The view sends no interior for unexplored cells: presumed, with the kit's say-so only.
		expect(roofFootprint(shape, objects, new Uint8Array(48), true)).toEqual(interior);
		expect(cellsOf(roofFootprint(shape, objects, null, false))).toEqual([]);
	});

	it('presume nothing open to the table, to the edge, past MAX_ROOM_CELLS or seen to be open', () => {
		const outside = mask(g, (x, y) => !inside(x, y));
		const presumed = (objs: SceneObject[], known = outside, sent: Uint8Array | null = null) =>
			cellsOf(roofFootprint(shapeOf(g, objs, known), objs, sent, true));
		// A missing wall: the room runs on into unexplored ground that meets the table's edge.
		expect(
			presumed(
				objects.slice(1),
				mask(g, (x, y) => !inside(x, y) && y > 1)
			)
		).toEqual([]);
		// Against the table's edge: the edge is no wall.
		const corner = [wall([0, 2], [3, 2]), wall([3, 0], [3, 2])];
		expect(
			presumed(
				corner,
				mask(g, (x, y) => x >= 3 || y >= 2)
			)
		).toEqual([]);
		// An explored cell of the enclosure the mask doesn't roof: a yard, not a house.
		const yard = mask(g, (x, y) => !inside(x, y) || (x === 2 && y === 2));
		expect(presumed(objects, yard)).toEqual([]);
		// The same cell roofed: the rest is presumed with it.
		expect(
			presumed(
				objects,
				yard,
				mask(g, (x, y) => x === 2 && y === 2)
			)
		).toEqual(cellsOf(interior));
		// Larger than a room: open ground.
		const big = grid(20, 20);
		const hall = room(1, 1, 19, 19);
		const ring = mask(big, (x, y) => x === 0 || y === 0 || x === 19 || y === 19);
		const out = roofFootprint(shapeOf(big, hall, ring), hall, null, true);
		expect(cellsOf(out)).toEqual([]);
	});

	it('read only walls with a known side', () => {
		const outside = mask(g, (x, y) => !inside(x, y));
		// A wall between two unexplored cells (never sent) changes nothing.
		const extra = [...objects, wall([3, 2], [3, 4])];
		const shape = shapeOf(g, extra, outside);
		expect(roofFootprint(shape, extra, null, true)).toEqual(interior);
	});
});

describe('regions and gables', () => {
	it('split an L greedily into maximal rectangles, each cell once', () => {
		// ###
		// #..
		// #..
		const cells = [0, 1, 2, 5, 10];
		expect(rectsOf(cells, 5)).toEqual([
			{ x: 0, y: 0, w: 3, h: 1 },
			{ x: 0, y: 1, w: 1, h: 2 }
		]);
	});

	it('put a gable along the long axis, over the walls, eaves outside and over FIGURE_CLEAR', () => {
		const g = grid(8, 6);
		const objects = room(1, 1, 6, 4); // 5 x 3
		const interior = mask(g, (x, y) => x >= 1 && x < 6 && y >= 1 && y < 4);
		const shape = shapeOf(g, objects);
		const regions = roofRegions(shape, interior);
		expect(regions).toHaveLength(1);
		const [r] = regions;
		expect(r.rects).toEqual([{ x: 1, y: 1, w: 5, h: 3 }]);
		expect(r.eaveY).toBeCloseTo(WALL_HEIGHT);
		expect(interior[r.fogCell]).toBe(0);
		const m = roofMesh(shape, regions, ROOF, interior);
		const ys = [...m.positions].filter((_, i) => i % 3 === 1);
		// The ridge 1.5 above the eave (half of 3 cells at 45°); the eave's edge 0.25 below it.
		expect(Math.max(...ys)).toBeCloseTo(WALL_HEIGHT + 1.5);
		expect(Math.min(...ys)).toBeCloseTo(WALL_HEIGHT - 0.25);
		expect(Math.min(...ys)).toBeGreaterThanOrEqual(FIGURE_CLEAR);
		// The ridge runs along x: its highest vertices share one z.
		const top = [];
		for (let i = 0; i < m.positions.length; i += 3)
			if (m.positions[i + 1] > WALL_HEIGHT + 1.49) top.push(m.positions[i + 2]);
		expect(new Set(top.map((z) => z.toFixed(4))).size).toBe(1);
		// Normals are unit, and every vertex carries its region's cell.
		for (let i = 0; i < m.normals.length; i += 3)
			expect(Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2])).toBeCloseTo(1);
		expect(m.fogCells.length / 2).toBe(m.positions.length / 3);
		expect(Math.max(...m.indices)).toBeLessThan(m.positions.length / 3);
	});

	it('keep a steep, wide eave over FIGURE_CLEAR and cap a wide hall', () => {
		const g = grid(40, 40);
		const interior = mask(g, (x, y) => x >= 1 && x < 39 && y >= 1 && y < 39);
		const shape = shapeOf(g, []);
		const steep: KitRoof = { ...ROOF, pitch: 60, eave: 0.5 };
		const m = roofMesh(shape, roofRegions(shape, interior), steep, interior);
		const ys = [...m.positions].filter((_, i) => i % 3 === 1);
		expect(Math.min(...ys)).toBeGreaterThanOrEqual(FIGURE_CLEAR - 1e-6);
		expect(Math.max(...ys)).toBeLessThanOrEqual(3 * WALL_HEIGHT + 1e-6);
	});

	it('raise the eave to the highest floor, with an infill band over the lower walls', () => {
		const g = grid(6, 4);
		const interior = mask(g, (x, y) => x >= 1 && x < 5 && y >= 1 && y < 3);
		const levels = Uint8Array.from({ length: 24 }, (_, i) => (i % 6 >= 3 ? 2 : 0));
		const shape = worldShape({ grid: g, levels, floor: null, objects: [], known: null });
		const regions = roofRegions(shape, interior);
		expect(regions[0].eaveY).toBeCloseTo(0.8 + WALL_HEIGHT);
		const flat = roofMesh(shapeOf(g, []), roofRegions(shapeOf(g, []), interior), ROOF, interior);
		const raised = roofMesh(shape, regions, ROOF, interior);
		expect(raised.indices.length).toBeGreaterThan(flat.indices.length);
	});

	it('are left out while the viewer sees into them', () => {
		const g = grid(8, 6);
		const interior = mask(g, (x, y) => x >= 1 && x < 6 && y >= 1 && y < 4);
		const [r] = roofRegions(shapeOf(g, []), interior);
		expect(seenInto(r, null)).toBe(false);
		expect(
			seenInto(
				r,
				mask(g, (x) => x === 0)
			)
		).toBe(false);
		expect(
			seenInto(
				r,
				mask(g, (x, y) => x === 1 && y === 1)
			)
		).toBe(true);
	});
});

interface Sent {
	grid: SquareGrid;
	terrain: string | null;
	floor: string | null;
	interior?: string | null;
	objects: SceneObject[];
	fog?: FogView;
}
interface Fixture {
	name: string;
	input: ShapeInput;
	interior: Uint8Array | null;
}
function fixture(name: string, sent: Sent, known: ShapeInput['known']): Fixture {
	const size = sent.grid.width * sent.grid.height;
	return {
		name,
		input: {
			grid: sent.grid,
			levels: sent.terrain ? decodeLevels(sent.terrain, size) : null,
			floor: sent.floor ? decodeFloor(sent.floor, size) : null,
			objects: sent.objects,
			known
		},
		interior: sent.interior ? decodeMask(sent.interior, size) : null
	};
}
const SCENES = 'tests/fixtures/scenes';
const VIEWS = 'tests/fixtures/views';
const scenes = readdirSync(SCENES)
	.filter((f) => f.endsWith('.json') && !f.endsWith('.poses.json'))
	.map((f) => {
		const parsed = parseSceneFile(JSON.parse(readFileSync(path.join(SCENES, f), 'utf8')));
		if (!parsed.ok) throw new Error(`${f}: ${parsed.error}`);
		return fixture(f.replace('.json', ''), parsed.scene as unknown as Sent, null);
	});
const views = readdirSync(VIEWS)
	.filter((f) => f.endsWith('.json'))
	.flatMap((f) => {
		const all = JSON.parse(readFileSync(path.join(VIEWS, f), 'utf8')) as Record<string, Sent>;
		return (['gm', 'player', 'spectator'] as const).map((viewer) => {
			const v = all[viewer];
			return fixture(`${f} ${viewer}`, v, v.fog ? knownOf(v.grid, v.fog, viewer === 'gm') : null);
		});
	});
const roofsOf = (f: Fixture, input = f.input, interior = f.interior) => {
	const shape = worldShape(input);
	const footprint = roofFootprint(shape, input.objects, interior, true);
	const regions = roofRegions(shape, footprint);
	return { footprint, regions, mesh: roofMesh(shape, regions, ROOF, footprint) };
};

describe('roofs on every fixture', () => {
	it('roof exactly the interior mask for every scene', () => {
		let roofed = 0;
		for (const f of scenes) {
			const { footprint, regions, mesh } = roofsOf(f);
			expect(footprint, f.name).toEqual(f.interior ?? new Uint8Array(footprint.length));
			if (regions.length) roofed++;
			for (const v of mesh.positions) expect(Number.isFinite(v), f.name).toBe(true);
		}
		expect(roofed).toBeGreaterThanOrEqual(5);
	});

	it("give Bellweather's five houses one gable each, along its long side", () => {
		const village = scenes.find((s) => s.name === 'village')!;
		const { regions } = roofsOf(village);
		expect(regions.map((r) => r.rects)).toEqual([
			[{ x: 2, y: 7, w: 7, h: 6 }],
			[{ x: 15, y: 7, w: 7, h: 5 }],
			[{ x: 25, y: 7, w: 8, h: 6 }],
			[{ x: 2, y: 20, w: 6, h: 4 }],
			[{ x: 16, y: 20, w: 6, h: 4 }]
		]);
	});

	it("let a player who walked Bellweather's streets presume its closed houses, not the smithy", () => {
		const village = scenes.find((s) => s.name === 'village')!;
		const { grid: g, objects } = village.input;
		const roofed = village.interior!;
		const known = Uint8Array.from(roofed, (v) => 1 - v);
		// What a view sends: the walls touching an explored cell, the mask on explored cells.
		const sent = objects.filter((o) =>
			unitEdges(o.a, o.b).some((e) => cellsBeside(g, e).some((c) => known[c.y * g.width + c.x]))
		);
		const shape = worldShape({ ...village.input, objects: sent, known });
		const footprint = roofFootprint(shape, sent, new Uint8Array(roofed.length), true);
		const smithy = (i: number) => i % g.width >= 16 && i % g.width < 22 && i >= 20 * g.width;
		expect(cellsOf(footprint)).toEqual(cellsOf(roofed).filter((i) => !smithy(i)));
		expect(roofRegions(shape, footprint)).toHaveLength(4);
	});

	it('give players roofs only on cells they know roofed or presume from walls they know', () => {
		let checked = 0;
		for (const f of views) {
			const known = f.input.known;
			if (!known) continue;
			const { footprint, regions } = roofsOf(f);
			for (let i = 0; i < footprint.length; i++) {
				if (!footprint[i]) continue;
				if (known[i]) expect(f.interior?.[i], `${f.name} ${i}`).toBe(1);
			}
			for (const r of regions) expect(known[r.fogCell], f.name).toBe(1);
			checked++;
		}
		expect(checked).toBeGreaterThan(20);
	});
});

describe('secrecy', () => {
	it("leaves a player's and a spectator's roofs unchanged whatever the server holds in unexplored cells", () => {
		let checked = 0;
		for (const [k, f] of views.entries()) {
			const known = f.input.known;
			if (!known) continue;
			const { width: w, height: h } = f.input.grid;
			const size = w * h;
			const rnd = random(k + 7);
			const unknown = (x: number, y: number) =>
				x < 0 || y < 0 || x >= w || y >= h || !known[y * w + x];
			const scramble = (m: Uint8Array | null) =>
				Uint8Array.from({ length: size }, (_, i) =>
					known[i] ? (m ? m[i] : 0) : Math.floor(rnd() * 8)
				);
			const levels = scramble(f.input.levels);
			const floor = scramble(f.input.floor).map((v, i) => (!known[i] && v % 2 ? VOID : v));
			// The server's whole mask, roofed at random where the viewer never looked.
			const interior = Uint8Array.from({ length: size }, (_, i) =>
				known[i] ? (f.interior?.[i] ?? 0) : rnd() < 0.5 ? 1 : 0
			);
			const extra: SceneObject[] = [];
			for (let y = 0; y <= h; y++)
				for (let x = 0; x <= w; x++) {
					if (x < w && unknown(x, y - 1) && unknown(x, y) && rnd() < 0.3)
						extra.push(wall([x, y], [x + 1, y]));
					if (y < h && unknown(x - 1, y) && unknown(x, y) && rnd() < 0.3)
						extra.push(wall([x, y], [x, y + 1]));
				}
			const objects = [...f.input.objects, ...extra];
			const scrambled = roofsOf(f, { ...f.input, levels, floor, objects }, interior);
			expect(scrambled, f.name).toEqual(roofsOf(f));
			checked++;
		}
		expect(checked).toBeGreaterThan(20);
	}, 60_000);
});
