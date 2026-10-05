// The world's shape (milestone 69, #239): what every ground, cliff, void, kit,
// water and scatter builder reads, worked out once from the grid data a viewer
// was sent. Pure and renderer-free (no three.js), so its specs run in the
// server project. docs/RENDERING.md, "World shape", is the contract.
//
// Three rules hold for everything here:
// - It reads only what the viewer was sent (levels and floors as masked by
//   `viewFor`, the objects, and `known`, the explored mask). Nothing about
//   unexplored ground can leak, because nothing about it is an input.
// - No edge is drawn toward an unexplored cell: such an edge is always `flat`,
//   and the continued maps make the dual grid flat across it.
// - The picture never contradicts the rules: steps are |Δ| = 1 (what
//   `canStep` climbs), cliffs |Δ| ≥ 2, and saddles follow `canStep`
//   (dual.ts).

import { VOID, type FloorMap } from '../../game/floor';
import type { GridEdge, SquareGrid } from '../../game/grid';
import { orderCorners, type SceneObject, unitEdges } from '../../game/objects';
import { obstaclesFor } from '../../game/props';
import type { LevelMap } from '../../game/terrain';
import { decodeMask, type CellMask, type FogView } from '../../game/visibility';
import { groundFor, type Ground } from '../ground';
import { wallSpans, type WallSpan } from './wall-spans';

export { wallSpans, type WallSpan } from './wall-spans';

/** A token's footing (#250: kit.ts holds it, one constant for walls and ground). */
export { TOKEN_DISK } from '../../assets/kit';
/** How far (in cells) a decoration may reach into a token's disk. */
export const INTRUSION = 0.08;
/** The largest corner rounding (in cells) an emitter may give ground. */
export const MAX_ROUND = 0.25;
/** The largest noise displacement (in cells) an emitter may give an edge. */
export const MAX_NOISE = 0.07;

/** What the ground does across a unit edge. */
export const EDGE_GROUND = {
	/** The same level, both void, or an unexplored cell on either side. */
	flat: 0,
	/** One level apart: walkable (MAX_STEP). */
	step: 1,
	/** Two levels or more apart: a drop nobody walks. */
	cliff: 2,
	/** Walkable ground on one side, the void (off the map) on the other. */
	void: 3,
	/** The table's edge. */
	border: 4
} as const;

/** What stands on a unit edge. A sealed secret door (`<id>-sealed`) is a wall, as sent. */
export const EDGE_BUILT = { none: 0, wall: 1, window: 2, door: 3 } as const;

/**
 * One byte per unit edge. `h[y * width + x]` (y in 0..height) is the edge
 * along the top of cell (x, y), between (x, y - 1) and (x, y);
 * `v[y * (width + 1) + x]` (x in 0..width) the edge along its left side,
 * between (x - 1, y) and (x, y).
 */
export interface EdgeMap {
	h: Uint8Array;
	v: Uint8Array;
}

/** What `worldShape` reads: the viewer's grid data, as sent. */
export interface ShapeInput {
	grid: SquareGrid;
	levels: LevelMap | null;
	floor: FloorMap | null;
	objects: readonly SceneObject[];
	/** The cells the viewer has explored (`knownOf`); null for the GM and with fog off. */
	known: CellMask | null;
}

export interface WorldShape {
	grid: SquareGrid;
	known: CellMask | null;
	/**
	 * Continued levels per cell (dice, picks, `floorY`): a known cell's own; an
	 * unexplored one takes its first known orthogonal neighbour's (N, E, S, W), else 0.
	 */
	levels: Uint8Array;
	/** Continued floors per cell, by the same rule. */
	floor: Uint8Array;
	/** `groundFor` over the continued levels. */
	ground: Ground;
	/**
	 * Continued values per dual tile, for meshing: `(width + 1) * (height + 1)`
	 * tiles, one per grid corner (`tileIndex`), eight sectors each (`SECTORS`).
	 */
	tiles: { levels: Uint8Array; floor: Uint8Array };
	edges: { ground: EdgeMap; built: EdgeMap };
	/** The walls' pieces, as `walls.ts` draws them. */
	walls: WallSpan[];
	/** Stair runs' marks (#255, stairs.ts `withStairs`), when the shape is drawn with stairs. */
	stairs?: StairMarks;
}

/** What a stair (#255) puts on a unit edge: the ground draws it as a step, a stringer or not at all. */
export const STAIR_EDGE = { none: 0, riser: 1, side: 2, kit: 3 } as const;

/** Where the ground draws stairs instead of risers and cliffs (stairs.ts). */
export interface StairMarks {
	/** Per unit edge, a `STAIR_EDGE` (`kit`: a kit piece stands there, the ground draws nothing). */
	edges: EdgeMap;
	/** A run's steps (its cells but the foot and the head): the ground keeps their corners square. */
	steps: Uint8Array;
}

/**
 * The sectors of a dual tile, clockwise round its centre (a grid corner) from
 * north. A tile's corners are the four cells round that grid corner, NW, NE,
 * SE, SW (clockwise, `CORNERS`); each corner's quarter is split along the
 * diagonal from the centre into the half toward its horizontal neighbour and
 * the half toward its vertical one. A known corner's halves are equal.
 */
export const SECTORS = [
	'NE toward NW',
	'NE toward SE',
	'SE toward NE',
	'SE toward SW',
	'SW toward SE',
	'SW toward NW',
	'NW toward SW',
	'NW toward NE'
] as const;
/** The tile's corners clockwise from north-west, as cell offsets from the tile's grid corner. */
export const CORNERS = [
	{ dx: -1, dy: -1 },
	{ dx: 0, dy: -1 },
	{ dx: 0, dy: 0 },
	{ dx: -1, dy: 0 }
] as const;
/** The sector of corner k toward its horizontal neighbour (k ^ 1), and toward its vertical one (3 - k). */
export const SECTOR_H = [7, 0, 3, 4] as const;
export const SECTOR_V = [6, 1, 2, 5] as const;

export const tileIndex = (grid: SquareGrid, tx: number, ty: number) => ty * (grid.width + 1) + tx;
export const hEdge = (grid: SquareGrid, x: number, y: number) => y * grid.width + x;
export const vEdge = (grid: SquareGrid, x: number, y: number) => y * (grid.width + 1) + x;

/** A unit edge's place in an `EdgeMap`. */
export function edgeSlot(grid: SquareGrid, e: GridEdge): { axis: 'h' | 'v'; index: number } {
	const { a, b } = orderCorners(e.a, e.b);
	return a.x === b.x
		? { axis: 'v', index: vEdge(grid, a.x, a.y) }
		: { axis: 'h', index: hEdge(grid, a.x, a.y) };
}

/** The edge map's slot between two orthogonally adjacent cells (by index). */
export function slotBetween(
	grid: SquareGrid,
	i: number,
	j: number
): { axis: 'h' | 'v'; index: number } {
	const w = grid.width;
	const [lo, hi] = i < j ? [i, j] : [j, i];
	return Math.floor(lo / w) === Math.floor(hi / w)
		? { axis: 'v', index: vEdge(grid, hi % w, Math.floor(hi / w)) }
		: { axis: 'h', index: hEdge(grid, hi % w, Math.floor(hi / w)) };
}

/** The cells a viewer knows, from what it was sent: null for the GM and with fog off. */
export function knownOf(grid: SquareGrid, fog: FogView, gm: boolean): CellMask | null {
	return !fog.enabled || gm ? null : decodeMask(fog.explored, grid.width * grid.height);
}

/** Ground-only obstacles (levels and void, no walls or props): what saddles follow. */
export function groundObstacles(shape: WorldShape) {
	return obstaclesFor(shape.grid, [], [], shape.levels, shape.floor);
}

export function worldShape(input: ShapeInput): WorldShape {
	const { grid, known } = input;
	const levels = continueCells(grid, input.levels, known);
	const floor = continueCells(grid, input.floor, known);
	return {
		grid,
		known,
		levels,
		floor,
		ground: groundFor(grid, levels),
		tiles: {
			levels: continueTiles(grid, levels, known),
			floor: continueTiles(grid, floor, known)
		},
		edges: {
			ground: groundEdges(grid, levels, floor, known),
			built: builtEdges(grid, input.objects)
		},
		// Continued levels: the sent ones wherever a side is known, so nothing unexplored is read.
		walls: wallSpans(grid, input.objects, levels, known)
	};
}

const N = 4;
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

/** Each unexplored cell takes its first known orthogonal neighbour's value (N, E, S, W), else 0. */
function continueCells(grid: SquareGrid, sent: Uint8Array | null, known: CellMask | null) {
	const { width: w, height: h } = grid;
	const out = sent ? sent.slice() : new Uint8Array(w * h);
	if (!known) return out;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			if (known[i]) continue;
			out[i] = 0;
			for (let d = 0; d < N; d++) {
				const nx = x + DX[d];
				const ny = y + DY[d];
				if (nx < 0 || ny < 0 || nx >= w || ny >= h || !known[ny * w + nx]) continue;
				out[i] = sent ? sent[ny * w + nx] : 0;
				break;
			}
		}
	}
	return out;
}

/**
 * The dual tiles' sectors. Off the table a corner is its nearest cell (clamped).
 * An unexplored corner's half toward a neighbour takes that neighbour's value if
 * known, else the other neighbour's, else the diagonal's, else its own continued
 * value: so where its two neighbours differ it is split along the diagonal, and
 * every boundary lies on a known-known edge or inside unexplored cells.
 */
function continueTiles(
	grid: SquareGrid,
	continued: Uint8Array,
	known: CellMask | null
): Uint8Array {
	const { width: w, height: h } = grid;
	const out = new Uint8Array((w + 1) * (h + 1) * 8);
	const cell = new Int32Array(4);
	const val = new Uint8Array(4);
	const kn = new Uint8Array(4);
	for (let ty = 0; ty <= h; ty++) {
		// The tile's rows and columns of cells, clamped onto the table.
		const north = Math.max(ty - 1, 0) * w;
		const south = Math.min(ty, h - 1) * w;
		for (let tx = 0; tx <= w; tx++) {
			const west = Math.max(tx - 1, 0);
			const east = Math.min(tx, w - 1);
			cell[0] = north + west;
			cell[1] = north + east;
			cell[2] = south + east;
			cell[3] = south + west;
			const base = (ty * (w + 1) + tx) * 8;
			let unknown = false;
			for (let k = 0; k < 4; k++) {
				val[k] = continued[cell[k]];
				kn[k] = !known || known[cell[k]] ? 1 : 0;
				if (!kn[k]) unknown = true;
			}
			for (let k = 0; k < 4; k++) {
				if (!unknown || kn[k]) {
					out[base + SECTOR_H[k]] = out[base + SECTOR_V[k]] = val[k];
					continue;
				}
				const hk = k ^ 1;
				const vk = 3 - k;
				const dk = (k + 2) & 3;
				const fallback = kn[dk] ? val[dk] : val[k];
				out[base + SECTOR_H[k]] = kn[hk] ? val[hk] : kn[vk] ? val[vk] : fallback;
				out[base + SECTOR_V[k]] = kn[vk] ? val[vk] : kn[hk] ? val[hk] : fallback;
			}
		}
	}
	return out;
}

function groundEdges(
	grid: SquareGrid,
	levels: Uint8Array,
	floor: Uint8Array,
	known: CellMask | null
): EdgeMap {
	const { width: w, height: h } = grid;
	const classify = (i: number, j: number) => {
		if (known && (!known[i] || !known[j])) return EDGE_GROUND.flat;
		const vi = floor[i] === VOID;
		const vj = floor[j] === VOID;
		if (vi !== vj) return EDGE_GROUND.void;
		if (vi) return EDGE_GROUND.flat;
		const d = Math.abs(levels[i] - levels[j]);
		return d === 0 ? EDGE_GROUND.flat : d === 1 ? EDGE_GROUND.step : EDGE_GROUND.cliff;
	};
	const hMap = new Uint8Array(w * (h + 1));
	const vMap = new Uint8Array((w + 1) * h);
	for (let y = 0; y <= h; y++)
		for (let x = 0; x < w; x++)
			hMap[y * w + x] =
				y === 0 || y === h ? EDGE_GROUND.border : classify((y - 1) * w + x, y * w + x);
	for (let y = 0; y < h; y++)
		for (let x = 0; x <= w; x++)
			vMap[y * (w + 1) + x] =
				x === 0 || x === w ? EDGE_GROUND.border : classify(y * w + x - 1, y * w + x);
	return { h: hMap, v: vMap };
}

/** Walls and windows (the first on an edge, as `walls.ts` draws them), then doors over them. */
function builtEdges(grid: SquareGrid, objects: readonly SceneObject[]): EdgeMap {
	const map: EdgeMap = {
		h: new Uint8Array(grid.width * (grid.height + 1)),
		v: new Uint8Array((grid.width + 1) * grid.height)
	};
	for (const pass of ['wall', 'door'] as const) {
		for (const o of objects) {
			if (o.kind !== pass) continue;
			const value =
				o.kind === 'door' ? EDGE_BUILT.door : o.window ? EDGE_BUILT.window : EDGE_BUILT.wall;
			for (const e of unitEdges(o.a, o.b)) {
				const { axis, index } = edgeSlot(grid, e);
				if (index >= map[axis].length) continue;
				if (pass === 'door' || map[axis][index] === EDGE_BUILT.none) map[axis][index] = value;
			}
		}
	}
	return map;
}

/** Chunks are CHUNK x CHUNK cells, row-major (`cy * chunksAcross + cx`). */
export const CHUNK = 16;

export function chunksAcross(grid: SquareGrid): { x: number; y: number } {
	return { x: Math.ceil(grid.width / CHUNK), y: Math.ceil(grid.height / CHUNK) };
}

/**
 * The chunks to rebuild going from `prev` to `next`: those touched by a cell
 * whose continued level, floor or known state changed, plus a one-cell margin
 * (a dual tile reads the cells on both sides of a chunk's edge). Every chunk
 * when there was no shape or the grid changed. Sorted.
 */
export function dirtyChunks(prev: WorldShape | null, next: WorldShape): number[] {
	const g = next.grid;
	const across = chunksAcross(g);
	const all = () => Array.from({ length: across.x * across.y }, (_, i) => i);
	if (!prev || prev.grid.width !== g.width || prev.grid.height !== g.height) return all();
	const dirty = new Uint8Array(across.x * across.y);
	const knownAt = (s: WorldShape, i: number) => (s.known ? s.known[i] : 1);
	for (let y = 0; y < g.height; y++) {
		for (let x = 0; x < g.width; x++) {
			const i = y * g.width + x;
			if (
				prev.levels[i] === next.levels[i] &&
				prev.floor[i] === next.floor[i] &&
				!knownAt(prev, i) === !knownAt(next, i)
			)
				continue;
			const x0 = Math.floor(Math.max(x - 1, 0) / CHUNK);
			const x1 = Math.floor(Math.min(x + 1, g.width - 1) / CHUNK);
			const y0 = Math.floor(Math.max(y - 1, 0) / CHUNK);
			const y1 = Math.floor(Math.min(y + 1, g.height - 1) / CHUNK);
			for (let cy = y0; cy <= y1; cy++)
				for (let cx = x0; cx <= x1; cx++) dirty[cy * across.x + cx] = 1;
		}
	}
	return all().filter((c) => dirty[c]);
}
