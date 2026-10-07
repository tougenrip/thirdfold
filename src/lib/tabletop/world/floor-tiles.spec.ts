// Kit floor tiles (#254): which cells take tiles, the lattice at the kit's own
// scale (no seam on a grid line by design), pieces cut where the tiling ends,
// broken variants at drops, the bed, dirty chunks, the invariant harness on
// every fixture view and on seeded random tables, and a differential test that
// a player's tiles never change with what lies on ground they never explored.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeFloor, FLOOR_IDS, type FloorId } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import { decodeLevels } from '$lib/game/terrain';
import type { FogView } from '$lib/game/visibility';
import { STEP_HEIGHT } from '../ground';
import {
	brinkCells,
	chunkTiles,
	dirtyTileChunks,
	LATTICE_OFFSET,
	TILE_JITTER,
	tileBeds,
	tiledCells,
	type TileKit,
	type TilePiece
} from './floor-tiles';
import { randomTable } from './random-table';
import { chunksAcross, knownOf, worldShape, type ShapeInput, type WorldShape } from './shape';
import { checkTiles } from './tile-invariants';

const F = (id: FloorId) => FLOOR_IDS.indexOf(id);
const spec = (pitch: number, broken = 1) => ({
	pitch: { x: pitch, z: pitch },
	tiles: [1, 1, 1],
	broken: Array.from({ length: broken }, () => 1)
});
/** A kit tiling the default ground and every man-made floor, at pitches that are no cell's divisor. */
const KIT: TileKit = new Map([
	[F('plain'), spec(0.62)],
	[F('stone'), spec(0.62)],
	[F('flagstone'), spec(0.74)],
	[F('cobble'), spec(0.31)],
	[F('wood'), { pitch: { x: 0.95, z: 0.24 }, tiles: [1, 2], broken: [] }],
	[F('tile'), spec(0.48)],
	[F('grating'), spec(0.5, 0)]
]);

function shapeOf(
	width: number,
	height: number,
	paint: (x: number, y: number) => { floor?: FloorId; level?: number; known?: boolean } = () => ({})
): WorldShape {
	const n = width * height;
	const [floor, levels, known] = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
	for (let i = 0; i < n; i++) {
		const c = paint(i % width, Math.floor(i / width));
		floor[i] = F(c.floor ?? 'stone');
		levels[i] = c.level ?? 0;
		known[i] = c.known === false ? 0 : 1;
	}
	const grid: SquareGrid = { kind: 'square', width, height, cellSize: 1 };
	return worldShape({ grid, floor, levels, objects: [], known });
}

function allTiles(shape: WorldShape, kit = KIT) {
	const tiled = tiledCells(shape, kit);
	const brink = brinkCells(shape);
	const { x, y } = chunksAcross(shape.grid);
	const pieces: TilePiece[] = [];
	for (let c = 0; c < x * y; c++) pieces.push(...chunkTiles(shape, kit, tiled, brink, c));
	return { tiled, brink, pieces };
}

/** The grid cells a piece covers. */
function cellsUnder(shape: WorldShape, p: TilePiece, kit = KIT): number[] {
	const { width: w, height: h } = shape.grid;
	const s = kit.get(p.floor)!;
	const [ax, az] = [(p.sx * s.pitch.x) / 2, (p.sz * s.pitch.z) / 2];
	const [hx, hz] = p.turn % 2 ? [az, ax] : [ax, az];
	const out: number[] = [];
	for (let y = Math.floor(p.z + h / 2 - hz + 1e-6); y <= Math.floor(p.z + h / 2 + hz - 1e-6); y++)
		for (let x = Math.floor(p.x + w / 2 - hx + 1e-6); x <= Math.floor(p.x + w / 2 + hx - 1e-6); x++)
			out.push(y * w + x);
	return out;
}

describe('kit floor tiles (#254)', () => {
	it('lays a lattice of its own pitch, offset from the grid, whole tiles turned by their hash', () => {
		const shape = shapeOf(10, 8);
		const { pieces, tiled } = allTiles(shape);
		expect(tiled.every((t) => t === 1)).toBe(true);
		expect(checkTiles(shape, KIT, tiled, pieces)).toEqual([]);
		const whole = pieces.filter((p) => p.sx === 1 && p.sz === 1);
		expect(whole.length).toBeGreaterThan(100);
		expect(new Set(whole.map((p) => p.turn)).size).toBe(4);
		expect(new Set(whole.map((p) => p.variant)).size).toBe(3);
		// The seams: no lattice line on a grid line (the world's origin is a grid line here).
		const off = (v: number) => Math.abs(v - Math.round(v));
		for (const p of whole)
			for (const left of [p.x - 0.31, p.z - 0.31]) {
				expect(off(left / 0.62 - LATTICE_OFFSET)).toBeLessThan(1e-6); // on its own lattice
				expect(off(left)).toBeGreaterThan(0.005); // and off the grid's
			}
		// Tops at the floor, sunk by at most the jitter, a few of them sunk.
		expect(whole.every((p) => p.y <= 0 && p.y >= -TILE_JITTER)).toBe(true);
		expect(whole.some((p) => p.y < -0.005)).toBe(true);
		// Same inputs, same tiles (every client sees the same floor).
		expect(allTiles(shapeOf(10, 8)).pieces).toEqual(pieces);
	});

	it('covers the tiled cells exactly: cut at a floor change and at the table edge, never past it', () => {
		const shape = shapeOf(9, 7, (x) => ({ floor: x < 4 ? 'stone' : 'grass' }));
		const { pieces, tiled } = allTiles(shape);
		expect(checkTiles(shape, KIT, tiled, pieces)).toEqual([]);
		// The area the pieces cover, in pitches, is the tiled area (no gaps beyond the slivers).
		const area = pieces.reduce((a, p) => a + p.sx * p.sz * 0.62 * 0.62, 0);
		expect(area).toBeGreaterThan(4 * 7 * 0.95);
		expect(area).toBeLessThanOrEqual(4 * 7 + 1e-6);
		expect(pieces.some((p) => p.sx < 1 || p.sz < 1)).toBe(true);
		for (const p of pieces) for (const k of cellsUnder(shape, p)) expect(k % 9).toBeLessThan(4);
	});

	it('gives the default ground tiles only where the kit lists plain', () => {
		const shape = shapeOf(6, 6, () => ({ floor: 'plain' }));
		expect(allTiles(shape).pieces.length).toBeGreaterThan(0);
		const without = new Map([...KIT].filter(([f]) => f !== F('plain')));
		expect(allTiles(shape, without).pieces).toEqual([]);
		expect(allTiles(shape, new Map()).tiled.every((t) => t === 0)).toBe(true);
	});

	it('leaves stairs, bridge decks, water, the void and unexplored cells untiled', () => {
		const shape = shapeOf(12, 9, (x, y) => {
			if (y === 1 && x >= 1 && x <= 4) return { level: x }; // a stair run up to the east
			if (y === 4 && x >= 1 && x <= 6) return { level: 3 }; // a one-wide raised run
			if (y === 7 && x === 1) return { floor: 'water' };
			if (y === 7 && x === 2) return { floor: 'void' };
			if (x >= 9) return { known: false };
			return {};
		});
		const { tiled, pieces } = allTiles(shape);
		const at = (x: number, y: number) => tiled[y * 12 + x];
		for (let x = 1; x <= 4; x++) expect(at(x, 1), `stair ${x}`).toBe(0);
		for (let x = 1; x <= 6; x++) expect(at(x, 4), `bridge ${x}`).toBe(0);
		expect(at(1, 7)).toBe(0);
		expect(at(2, 7)).toBe(0);
		for (let y = 0; y < 9; y++) for (let x = 9; x < 12; x++) expect(at(x, y)).toBe(0);
		expect(at(0, 0)).toBe(1);
		expect(checkTiles(shape, KIT, tiled, pieces)).toEqual([]);
		const covered = new Set(pieces.flatMap((p) => cellsUnder(shape, p)));
		for (let i = 0; i < tiled.length; i++) if (!tiled[i]) expect(covered.has(i)).toBe(false);
	});

	it('breaks the tiles on a cell beside a cliff or the void, and cuts them at the drop', () => {
		const shape = shapeOf(8, 6, (x) => (x < 4 ? { level: 3 } : x === 7 ? { floor: 'void' } : {}));
		const { tiled, brink, pieces } = allTiles(shape);
		expect(brink[0 * 8 + 3]).toBe(1); // the high side of the cliff
		expect(brink[0 * 8 + 4]).toBe(1); // its foot
		expect(brink[0 * 8 + 6]).toBe(1); // beside the void
		expect(brink[0 * 8 + 1]).toBe(0);
		expect(checkTiles(shape, KIT, tiled, pieces)).toEqual([]);
		const on = (p: TilePiece) => cellsUnder(shape, p).map((k) => k % 8);
		expect(pieces.filter((p) => on(p).includes(3)).every((p) => p.broken)).toBe(true);
		expect(pieces.some((p) => p.broken)).toBe(true);
		expect(pieces.filter((p) => on(p).every((x) => x <= 1)).some((p) => p.broken)).toBe(false);
		// Heights: on the high side at level 3, below at 0.
		for (const p of pieces) {
			const level = on(p)[0] < 4 ? 3 : 0;
			expect(p.y).toBeLessThanOrEqual(level * STEP_HEIGHT + 1e-9);
			expect(p.y).toBeGreaterThanOrEqual(level * STEP_HEIGHT - TILE_JITTER - 1e-9);
		}
		// A floor without broken variants keeps its whole ones.
		const grating = shapeOf(4, 4, (x) => (x === 3 ? { floor: 'void' } : { floor: 'grating' }));
		expect(allTiles(grating).pieces.some((p) => p.broken)).toBe(false);
	});

	it('beds the ground under tiles, rising to the floor where the tiling ends', () => {
		const shape = shapeOf(4, 1, (x) => ({ floor: x < 2 ? 'stone' : 'grass' }));
		const tiled = tiledCells(shape, KIT);
		// Vertices (x, 0, z) with their owners: the middle of cell 0, the edge between 0 and 1, the
		// edge between 1 (tiled) and 2 (grass), the middle of cell 2.
		const positions = Float32Array.from([-1.5, 0, 0, -1, 0, 0, 0, 0, 0, 0.5, 0, 0]);
		expect([...tileBeds(shape, tiled, positions, [0, 0, 1, 2])]).toEqual([1, 1, 0, 0]);
	});

	it('rebuilds only the chunks round a change', () => {
		const shape = shapeOf(48, 32);
		const tiled = tiledCells(shape, KIT);
		expect(dirtyTileChunks(null, shape, tiled)).toHaveLength(6);
		const next = shapeOf(48, 32, (x, y) => (x === 20 && y === 8 ? { floor: 'grass' } : {}));
		const after = tiledCells(next, KIT);
		expect(dirtyTileChunks({ shape, tiled }, next, after)).toEqual([1]);
		const edge = shapeOf(48, 32, (x, y) => (x === 17 && y === 8 ? { floor: 'grass' } : {}));
		expect(dirtyTileChunks({ shape, tiled }, edge, tiledCells(edge, KIT))).toEqual([0, 1]);
	});

	it('keeps the invariant on seeded random tables, fogged and not', () => {
		for (let seed = 1; seed <= 60; seed++) {
			const input = randomTable(seed);
			for (const known of [null, input.known]) {
				const shape = worldShape({ ...input, known });
				const { tiled, pieces } = allTiles(shape);
				expect(checkTiles(shape, KIT, tiled, pieces), `seed ${seed}`).toEqual([]);
			}
		}
	});
});

interface Sent {
	grid: SquareGrid;
	terrain: string | null;
	floor: string | null;
	objects: SceneObject[];
	fog?: FogView;
}

const VIEWS = 'tests/fixtures/views';
function inputOf(v: Sent, viewer: string): ShapeInput {
	const size = v.grid.width * v.grid.height;
	return {
		grid: v.grid,
		levels: v.terrain ? decodeLevels(v.terrain, size) : null,
		floor: v.floor ? decodeFloor(v.floor, size) : null,
		objects: v.objects,
		known: v.fog ? knownOf(v.grid, v.fog, viewer === 'gm') : null
	};
}

describe('kit floor tiles on every fixture view', () => {
	const files = readdirSync(VIEWS).filter((f) => f.endsWith('.json'));
	for (const f of files)
		it(`${f}: tiles only on known tiled cells, at their floor`, () => {
			const all = JSON.parse(readFileSync(path.join(VIEWS, f), 'utf8')) as Record<string, Sent>;
			for (const viewer of ['gm', 'player', 'spectator']) {
				const shape = worldShape(inputOf(all[viewer], viewer));
				const { tiled, pieces } = allTiles(shape);
				expect(checkTiles(shape, KIT, tiled, pieces), `${viewer}`).toEqual([]);
				if (shape.known)
					for (let i = 0; i < tiled.length; i++) if (!shape.known[i]) expect(tiled[i]).toBe(0);
			}
		});

	it("never changes a player's tiles with what lies on ground they never explored", () => {
		let compared = 0;
		for (const f of files) {
			const all = JSON.parse(readFileSync(path.join(VIEWS, f), 'utf8')) as Record<string, Sent>;
			const input = inputOf(all.player, 'player');
			if (!input.known || input.known.every((k) => k === 1)) continue;
			const n = input.grid.width * input.grid.height;
			const other = (a: Uint8Array | null, value: number) => {
				const out = a ? a.slice() : new Uint8Array(n);
				for (let i = 0; i < n; i++) if (!input.known![i]) out[i] = value;
				return out;
			};
			const base = allTiles(worldShape(input)).pieces;
			for (const [floor, level] of [
				[F('void'), 0],
				[F('grass'), 7],
				[F('tile'), 2]
			]) {
				const changed = {
					...input,
					floor: other(input.floor, floor),
					levels: other(input.levels, level)
				};
				expect(allTiles(worldShape(changed)).pieces, f).toEqual(base);
			}
			compared++;
		}
		expect(compared).toBeGreaterThan(3);
	});
});
