// Kit floor tiles (#254): which cells take tiles, and the tiles of a 16x16
// chunk, at the kit's own scale. Pure and renderer-free, in the `world` chunk.
//
// The grid is a gameplay overlay, never the art (docs/LOOK.md, gap 12): a
// floor's tiles lie on a lattice of their own pitch (the piece's footprint
// and a joint), anchored in the world and offset from the grid, so their
// seams don't follow cell edges. Cells only decide where tiles may lie: a
// tile whose footprint lies on tiled cells of its floor at one level is drawn
// whole (a quarter turn by its hash); one that reaches past them is cut at the
// cell edges it crosses, a piece per tiled cell, so nothing overhangs a drop,
// an untiled floor or unexplored ground. Pieces on a cell with a cliff or void
// edge are broken variants. Tops sit at their floor, sunk by a hash-picked
// jitter of up to TILE_JITTER (never above it). Everything here reads the
// world's shape, so only what the viewer was sent: unexplored cells take none.

import { FLOOR_IDS, VOID } from '../../game/floor';
import { STEP_HEIGHT } from '../ground';
import { variantOf } from './autotile';
import { regionsOf } from './regions';
import { CHUNK, chunksAcross, EDGE_GROUND, hEdge, vEdge, type WorldShape } from './shape';

const WATER = FLOOR_IDS.indexOf('water');

/** A floor's tiles as the builder needs them: the lattice's pitch and the variants' weights. */
export interface TileFloor {
	/** World units between tiles along x and z: a piece's footprint and its joint. */
	pitch: { x: number; z: number };
	tiles: readonly number[];
	broken: readonly number[];
}

/** Each tiled floor by its `FLOOR_IDS` byte (`plain`, 0, is the environment's default ground). */
export type TileKit = ReadonlyMap<number, TileFloor>;

/** The deepest a tile's top is sunk below its floor, in cells. */
export const TILE_JITTER = 0.02;
/** The deepest a tile's top may lie below its floor, in cells (the invariant). */
export const TILE_TOP_DEPTH = 0.035;
/** The lattice's offset from the world's origin, in pitches, so it never starts on a grid line. */
export const LATTICE_OFFSET = 0.37;
/** Cut pieces narrower than this share of a pitch are left out (the bed shows). */
const SLIVER = 0.08;

export interface TilePiece {
	/** The floor's byte. */
	floor: number;
	broken: boolean;
	/** Index into the floor's `tiles`, or its `broken` when broken. */
	variant: number;
	/** World centre of the piece, and its top. */
	x: number;
	y: number;
	z: number;
	/** Quarter turns about y. */
	turn: number;
	/** Its size along its own x and z, as a share of the pitch (1 for a whole tile). */
	sx: number;
	sz: number;
}

/**
 * The cells that take tiles: known, on the table, a floor the kit tiles, and not the void, water,
 * a stair run (#255) or a one-wide raised run (bridge decks, #256).
 */
export function tiledCells(shape: WorldShape, kit: TileKit): Uint8Array {
	const n = shape.grid.width * shape.grid.height;
	const out = new Uint8Array(n);
	if (kit.size === 0) return out;
	for (let i = 0; i < n; i++) {
		const f = shape.floor[i];
		const known = !shape.known || shape.known[i] === 1;
		out[i] = known && f !== VOID && f !== WATER && kit.has(f) ? 1 : 0;
	}
	const regions = regionsOf(shape);
	for (const run of [...regions.stairs, ...regions.oneWide]) for (const i of run.cells) out[i] = 0;
	return out;
}

/** The cells with a cliff or void edge on any side: their tiles are broken variants. */
export function brinkCells(shape: WorldShape): Uint8Array {
	const { grid, edges } = shape;
	const { width: w, height: h } = grid;
	const out = new Uint8Array(w * h);
	const drop = (v: number) => v === EDGE_GROUND.cliff || v === EDGE_GROUND.void;
	const g = edges.ground;
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++)
			out[y * w + x] =
				drop(g.h[hEdge(grid, x, y)]) ||
				drop(g.h[hEdge(grid, x, y + 1)]) ||
				drop(g.v[vEdge(grid, x, y)]) ||
				drop(g.v[vEdge(grid, x + 1, y)])
					? 1
					: 0;
	return out;
}

/** A stable 32-bit hash of a floor and a lattice slot (negative slots too). */
function slotSeed(f: number, i: number, j: number, salt = 0): number {
	let h =
		Math.imul(f + 1, 0x9e3779b1) ^ Math.imul(i | 0, 0x85ebca6b) ^ Math.imul(j | 0, 0xc2b2ae35);
	h ^= salt;
	h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
	h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
	return (h ^ (h >>> 16)) >>> 0;
}

/** The cells, as [x0, x1) and [y0, y1), of chunk `c`. */
function chunkCells(shape: WorldShape, c: number) {
	const { x: across } = chunksAcross(shape.grid);
	const x0 = (c % across) * CHUNK;
	const y0 = Math.floor(c / across) * CHUNK;
	return {
		x0,
		y0,
		x1: Math.min(x0 + CHUNK, shape.grid.width),
		y1: Math.min(y0 + CHUNK, shape.grid.height)
	};
}

/**
 * The tiles chunk `c` owns: every lattice slot of a tiled floor whose centre lies on one of its
 * cells (a slot off the table belongs to the nearest), whole or cut at the cells it crosses.
 */
export function chunkTiles(
	shape: WorldShape,
	kit: TileKit,
	tiled: Uint8Array,
	brink: Uint8Array,
	c: number
): TilePiece[] {
	const { grid, levels, floor } = shape;
	const { width: w, height: h, cellSize: cs } = grid;
	const { x0, y0, x1, y1 } = chunkCells(shape, c);
	const out: TilePiece[] = [];
	// The floors tiled on or within two cells of the chunk: its slots may reach that far.
	const floors = new Set<number>();
	for (let y = Math.max(y0 - 2, 0); y < Math.min(y1 + 2, h); y++)
		for (let x = Math.max(x0 - 2, 0); x < Math.min(x1 + 2, w); x++)
			if (tiled[y * w + x]) floors.add(floor[y * w + x]);
	const floorY = (i: number) => levels[i] * STEP_HEIGHT * cs;
	const ok = (x: number, y: number, f: number) =>
		x >= 0 && y >= 0 && x < w && y < h && tiled[y * w + x] === 1 && floor[y * w + x] === f;
	const clampCell = (v: number, n: number) => Math.min(Math.max(Math.floor(v), 0), n - 1);
	for (const f of floors) {
		const spec = kit.get(f)!;
		// The pitch in grid units, and where slot 0 starts (grid units from the table's corner).
		const px = spec.pitch.x / cs;
		const pz = spec.pitch.z / cs;
		const ox = (LATTICE_OFFSET * spec.pitch.x) / cs + w / 2;
		const oz = (LATTICE_OFFSET * spec.pitch.z) / cs + h / 2;
		const square = Math.abs(px - pz) < 1e-6;
		// Every slot whose centre may fall on the chunk's cells, and one more each way off the table.
		const iFrom = Math.floor((x0 - ox) / px) - 1;
		const iTo = Math.ceil((x1 - ox) / px);
		const jFrom = Math.floor((y0 - oz) / pz) - 1;
		const jTo = Math.ceil((y1 - oz) / pz);
		for (let j = jFrom; j <= jTo; j++) {
			const b0 = oz + j * pz;
			const b1 = b0 + pz;
			const cy = clampCell((b0 + b1) / 2, h);
			if (cy < y0 || cy >= y1) continue;
			for (let i = iFrom; i <= iTo; i++) {
				const a0 = ox + i * px;
				const a1 = a0 + px;
				const cx = clampCell((a0 + a1) / 2, w);
				if (cx < x0 || cx >= x1) continue;
				const [gx0, gx1] = [Math.floor(a0), Math.ceil(a1) - 1];
				const [gy0, gy1] = [Math.floor(b0), Math.ceil(b1) - 1];
				let any = false;
				let whole = true;
				let level = -1;
				let broken = false;
				for (let gy = gy0; gy <= gy1; gy++)
					for (let gx = gx0; gx <= gx1; gx++) {
						if (!ok(gx, gy, f)) {
							whole = false;
							continue;
						}
						any = true;
						const k = gy * w + gx;
						if (level < 0) level = levels[k];
						else if (levels[k] !== level) whole = false;
						if (brink[k]) broken = true;
					}
				if (!any) continue;
				const seed = slotSeed(f, i, j);
				const sink = ((seed >>> 24) / 255) * TILE_JITTER * cs;
				const piece = (
					k: number,
					cx: number,
					cz: number,
					sx: number,
					sz: number,
					turn: number,
					brk: boolean
				) => {
					const useBroken = brk && spec.broken.length > 0;
					out.push({
						floor: f,
						broken: useBroken,
						variant: variantOf(slotSeed(f, i, j, k + 1), useBroken ? spec.broken : spec.tiles),
						x: (cx - w / 2) * cs,
						y: floorY(k) - sink,
						z: (cz - h / 2) * cs,
						turn,
						sx,
						sz
					});
				};
				if (whole) {
					const turn = square ? seed & 3 : (seed & 1) * 2;
					piece(gy0 * w + gx0, (a0 + a1) / 2, (b0 + b1) / 2, 1, 1, turn, broken);
					continue;
				}
				for (let gy = gy0; gy <= gy1; gy++)
					for (let gx = gx0; gx <= gx1; gx++) {
						if (!ok(gx, gy, f)) continue;
						const [l, r] = [Math.max(a0, gx), Math.min(a1, gx + 1)];
						const [t, u] = [Math.max(b0, gy), Math.min(b1, gy + 1)];
						if ((r - l) / px < SLIVER || (u - t) / pz < SLIVER) continue;
						const k = gy * w + gx;
						piece(k, (l + r) / 2, (t + u) / 2, (r - l) / px, (u - t) / pz, 0, brink[k] === 1);
					}
			}
		}
	}
	return out;
}

/**
 * The chunks whose tiles change from one shape to the next: those within two cells of a cell whose
 * level, floor, known state or tiling changed (a tile reaches a cell past its chunk, and its brink
 * looks one further). Every chunk without a previous shape, or on a new grid.
 */
export function dirtyTileChunks(
	prev: { shape: WorldShape; tiled: Uint8Array } | null,
	shape: WorldShape,
	tiled: Uint8Array,
	margin = 2
): number[] {
	const g = shape.grid;
	const across = chunksAcross(g);
	const all = Array.from({ length: across.x * across.y }, (_, i) => i);
	const p = prev?.shape;
	if (
		!p ||
		p.grid.width !== g.width ||
		p.grid.height !== g.height ||
		p.grid.cellSize !== g.cellSize
	)
		return all;
	const dirty = new Uint8Array(all.length);
	const knownAt = (s: WorldShape, i: number) => (s.known ? s.known[i] : 1);
	for (let y = 0; y < g.height; y++)
		for (let x = 0; x < g.width; x++) {
			const i = y * g.width + x;
			if (
				prev.tiled[i] === tiled[i] &&
				p.levels[i] === shape.levels[i] &&
				p.floor[i] === shape.floor[i] &&
				!knownAt(p, i) === !knownAt(shape, i)
			)
				continue;
			const cx0 = Math.floor(Math.max(x - margin, 0) / CHUNK);
			const cx1 = Math.floor(Math.min(x + margin, g.width - 1) / CHUNK);
			const cy0 = Math.floor(Math.max(y - margin, 0) / CHUNK);
			const cy1 = Math.floor(Math.min(y + margin, g.height - 1) / CHUNK);
			for (let cy = cy0; cy <= cy1; cy++)
				for (let cx = cx0; cx <= cx1; cx++) dirty[cy * across.x + cx] = 1;
		}
	return all.filter((c) => dirty[c]);
}

/**
 * The bed under tiles (#254), per vertex of a chunk's top: 1 where every cell the vertex touches is
 * tiled on its owner's level (the ground there sinks under the tiles, `ringUniforms.bed`), else 0,
 * so the bed rises back to the floor at the edge of the tiling and no crack opens beside it.
 */
export function tileBeds(
	shape: WorldShape,
	tiled: Uint8Array,
	positions: Float32Array,
	owners: ArrayLike<number>
): Float32Array {
	const { width: w, height: h, cellSize: cs } = shape.grid;
	const out = new Float32Array(owners.length);
	const eps = 1e-4;
	for (let v = 0; v < owners.length; v++) {
		const o = owners[v];
		if (!tiled[o]) continue;
		const gx = positions[v * 3] / cs + w / 2;
		const gy = positions[v * 3 + 2] / cs + h / 2;
		let bed = 1;
		for (let y = Math.floor(gy - eps); y <= Math.floor(gy + eps); y++)
			for (let x = Math.floor(gx - eps); x <= Math.floor(gx + eps); x++) {
				const k = y * w + x;
				if (x < 0 || y < 0 || x >= w || y >= h || !tiled[k] || shape.levels[k] !== shape.levels[o])
					bed = 0;
			}
		out[v] = bed;
	}
	return out;
}
