// The world's shape on every fixture table (tests/fixtures/scenes) and every
// committed viewer view (tests/fixtures/views): wall spans as walls.ts drew
// them, the regions the later tasks build on, saddles that agree with canStep,
// the continuation rule, and the reference emitter through the harness.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeFloor } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import { edgeKey, unitEdges, type SceneObject } from '$lib/game/objects';
import { parseSceneFile } from '$lib/game/scene-file';
import { decodeLevels } from '$lib/game/terrain';
import { EYE_LEVELS, type FogView } from '$lib/game/visibility';
import { groundFor, STEP_HEIGHT, WALL_HEIGHT } from '../ground';
import { checkContinuation, checkEmitter, referenceBoxes, saddleProblems } from './invariants';
import { regionsOf } from './regions';
import { chunkWorld, tableWorld } from './cliffs';
import { chunkGround, tableGround } from './ground-mesh';
import {
	CHUNK,
	chunksAcross,
	knownOf,
	worldShape,
	type ShapeInput,
	type WorldShape
} from './shape';
import { LINTEL, SILL } from './wall-spans';

const SCENES = 'tests/fixtures/scenes';
const VIEWS = 'tests/fixtures/views';

interface Sent {
	grid: SquareGrid;
	terrain: string | null;
	floor: string | null;
	objects: SceneObject[];
	fog?: FogView;
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
		return { name: f.replace('.json', ''), input: input(parsed.scene as unknown as Sent, null) };
	});
const scene = (name: string) => worldShape(scenes.find((s) => s.name === name)!.input);

const viewFiles = readdirSync(VIEWS).filter((f) => f.endsWith('.json'));
const views = viewFiles.flatMap((f) => {
	const all = JSON.parse(readFileSync(path.join(VIEWS, f), 'utf8')) as Record<string, Sent>;
	return (['gm', 'player', 'spectator'] as const).map((viewer) => {
		const v = all[viewer];
		const known = v.fog ? knownOf(v.grid, v.fog, viewer === 'gm') : null;
		return { name: `${f} ${viewer}`, input: input(v, known) };
	});
});
const every = [...scenes, ...views];
const shapes = new Map<string, WorldShape>(every.map((t) => [t.name, worldShape(t.input)]));

/** What walls.ts's rebuildWalls drew before #239, from the levels as sent. */
function legacySpans(grid: SquareGrid, objects: readonly SceneObject[], levels: Uint8Array | null) {
	const ground = groundFor(grid, levels);
	const height = WALL_HEIGHT * grid.cellSize;
	const seen = new Set<string>();
	const out: { owner: string; bottom: number; top: number }[] = [];
	for (const o of objects) {
		if (o.kind !== 'wall') continue;
		for (const e of unitEdges(o.a, o.b)) {
			if (seen.has(edgeKey(e))) continue;
			seen.add(edgeKey(e));
			const { low, high } = ground.edgeFloors(e);
			const lintel = high === low ? [[high + height * LINTEL, high + height]] : [];
			const spans = o.window ? [[low, high + height * SILL], ...lintel] : [[low, high + height]];
			for (const [bottom, top] of spans) out.push({ owner: o.id, bottom, top });
		}
	}
	return out;
}

/** The chunk a cell (by index) lies in. */
const chunkOf = (g: SquareGrid, i: number) =>
	Math.floor(Math.floor(i / g.width) / CHUNK) * chunksAcross(g).x +
	Math.floor((i % g.width) / CHUNK);

const cellsAt = (s: WorldShape, ...xy: [number, number][]) =>
	xy.map(([x, y]) => y * s.grid.width + x);

describe('the world shape on every fixture', () => {
	it('has every scene and every viewer of every view to check', () => {
		expect(scenes.length).toBeGreaterThanOrEqual(15);
		expect(views.length).toBe(3 * viewFiles.length);
		expect(views.filter((v) => v.input.known).length).toBe(2 * viewFiles.length);
	});

	it('draws the walls exactly as walls.ts did; with fog, the same wherever both sides are known', () => {
		let differ = 0;
		for (const { name, input: i } of every) {
			const legacy = legacySpans(i.grid, i.objects, i.levels);
			const plain = worldShape({ ...i, known: null }).walls;
			expect(
				plain.map(({ owner, bottom, top }) => ({ owner, bottom, top })),
				name
			).toEqual(legacy);
			const fogged = shapes.get(name)!.walls;
			expect(fogged.length, name).toBe(legacy.length);
			fogged.forEach((s, k) => {
				if (s.bottom !== legacy[k].bottom || s.top !== legacy[k].top) differ++;
			});
		}
		// No fixture view has a wall with a drop toward ground its viewer hasn't explored.
		expect(differ).toBe(0);
	});

	it("keeps the eye's height above the higher floor in every window's gap", () => {
		let windows = 0;
		for (const { name, input: i } of scenes) {
			const ground = groundFor(i.grid, i.levels);
			const eye = EYE_LEVELS * STEP_HEIGHT * i.grid.cellSize;
			const spans = shapes.get(name)!.walls;
			for (const o of i.objects) {
				if (o.kind !== 'wall' || !o.window) continue;
				for (const e of unitEdges(o.a, o.b)) {
					const [sill, lintel] = spans.filter((s) => edgeKey(s.edge) === edgeKey(e));
					if (sill.owner !== o.id) continue;
					windows++;
					const at = ground.edgeFloors(e).high + eye;
					expect(sill.top, name).toBeLessThan(at);
					if (lintel) expect(lintel.bottom, name).toBeGreaterThan(at);
				}
			}
		}
		expect(windows).toBeGreaterThan(0);
	});

	it('keeps the continuation rule on every view', () => {
		for (const { name } of every) expect(checkContinuation(shapes.get(name)!), name).toEqual([]);
	});

	it('resolves every saddle the way canStep does', () => {
		for (const { name } of every)
			expect(saddleProblems(shapes.get(name)!).problems, name).toEqual([]);
	});

	it('passes the reference emitter through the harness for the GM, a fogged player and a spectator', () => {
		for (const { name } of every) {
			const s = shapes.get(name)!;
			expect(checkEmitter(s, referenceBoxes(s)), name).toEqual([]);
		}
	});

	it('passes the dual-grid ground (#240) through the harness on every scene and view', () => {
		for (const { name } of every) {
			const s = shapes.get(name)!;
			expect(checkEmitter(s, tableGround(s)), name).toEqual([]);
			// Each chunk holds only its own cells.
			const across = chunksAcross(s.grid);
			const strays: string[] = [];
			for (let c = 0; c < across.x * across.y; c++) {
				const { top, sides } = chunkGround(s, c);
				for (const o of [...top.owners, ...sides.owners])
					if (chunkOf(s.grid, o) !== c) strays.push(`chunk ${c}: cell ${o}`);
			}
			expect(strays, name).toEqual([]);
		}
	}, 60_000);
});

describe('cliffs and risers (#241) on every fixture', () => {
	it('pass the harness for the GM, a fogged player and a spectator, each chunk its own cells', () => {
		for (const { name } of every) {
			const s = shapes.get(name)!;
			expect(checkEmitter(s, tableWorld(s)), name).toEqual([]);
			const across = chunksAcross(s.grid);
			const strays: string[] = [];
			for (let c = 0; c < across.x * across.y; c++) {
				const { top, sides } = chunkWorld(s, c);
				for (const m of [top, ...sides])
					for (const o of m.owners) if (chunkOf(s.grid, o) !== c) strays.push(`chunk ${c}: ${o}`);
			}
			expect(strays, name).toEqual([]);
		}
	}, 120_000);

	it("keeps the Hollow's faces under 30k triangles", () => {
		const s = scene('hollow');
		const across = chunksAcross(s.grid);
		let triangles = 0;
		for (let c = 0; c < across.x * across.y; c++)
			for (const m of chunkWorld(s, c).sides) triangles += m.indices.length / 3;
		expect(triangles).toBeLessThan(30_000);
	});
});

describe('regions on the fixtures', () => {
	it('finds the belfry stair and the gallery stair in the monastery', () => {
		const s = scene('monastery');
		const { stairs } = regionsOf(s);
		const has = (cells: number[]) => stairs.some((r) => r.cells.join() === cells.join());
		// The belfry stair: level 5 at x = 23 to 10 at x = 28, climbing east.
		expect(has(cellsAt(s, [23, 2], [24, 2], [25, 2], [26, 2], [27, 2], [28, 2]))).toBe(true);
		// The tower's stair, two wide, climbing north from the nave to the gallery.
		for (const x of [22, 23])
			expect(has(cellsAt(s, [x, 14], [x, 13], [x, 12], [x, 11], [x, 10], [x, 9]))).toBe(true);
		expect(has(cellsAt(s, [14, 9], [15, 9], [16, 9], [17, 9], [18, 9], [19, 9]))).toBe(true);
	});

	it("finds the Hollow's stairs to the steps and the watch, and its bridges", () => {
		const s = scene('hollow');
		const { stairs, oneWide } = regionsOf(s);
		const stairAt = (x: number, y: number) => stairs.some((r) => r.cells.includes(y * 48 + x));
		// Up from the terrace to the steps, from the steps to the watch, and the high bridge's end.
		for (const [x, y] of [
			[40, 23],
			[41, 23],
			[42, 13],
			[43, 13],
			[38, 9],
			[39, 9]
		])
			expect(stairAt(x, y), `${x},${y}`).toBe(true);
		const run = (cell: number) => oneWide.find((r) => r.cells.includes(cell));
		// The ruins' bridge at x = 12 runs along y, the high bridge at y = 9 along x.
		const ruins = run(cellsAt(s, [12, 18])[0]);
		expect(ruins?.along).toBe('y');
		expect(ruins?.cells).toEqual(
			cellsAt(s, [12, 16], [12, 17], [12, 18], [12, 19], [12, 20], [12, 21])
		);
		const high = run(cellsAt(s, [34, 9])[0]);
		expect(high?.along).toBe('x');
		expect(high?.cells).toEqual(
			cellsAt(s, [32, 9], [33, 9], [34, 9], [35, 9], [36, 9], [37, 9], [38, 9], [39, 9])
		);
		// The causeway is two wide: not a one-wide run.
		for (const [x, y] of [
			[23, 25],
			[24, 25]
		])
			expect(run(cellsAt(s, [x, y])[0])).toBeUndefined();
	});

	it("finds the night train's border void as one region on the table's edge", () => {
		const s = scene('railcar');
		const { voids } = regionsOf(s);
		const border = voids.filter((v) => v.touchesBorder);
		expect(border).toHaveLength(1);
		expect(border[0].cells).toContain(0);
		expect(border[0].cells.length).toBe(158);
	});

	it('finds water bodies and void regions only on known ground', () => {
		const s = scene('ghost-town');
		const { water, voids } = regionsOf(s);
		expect(water.reduce((n, b) => n + b.cells.length, 0)).toBe(42);
		expect(voids.reduce((n, v) => n + v.cells.length, 0)).toBe(80);
		for (const { name } of views) {
			const v = shapes.get(name)!;
			if (!v.known) continue;
			const r = regionsOf(v);
			const cells = [
				...r.stairs.flatMap((x) => x.cells),
				...r.oneWide.flatMap((x) => x.cells),
				...r.water.flatMap((x) => x.cells),
				...r.voids.flatMap((x) => x.cells)
			];
			expect(
				cells.every((i) => v.known![i]),
				name
			).toBe(true);
		}
	});
});
