// The ground's mesh (#240): the dual grid of the world's shape turned into
// triangles, one 16x16-cell chunk at a time. Pure: positions, normals, indices
// and the owning cell of every vertex, which world-layer.ts makes into meshes
// and the invariant harness (invariants.ts) checks on every fixture view.
//
// Render tiles sit on the grid's corners (shape.ts `tiles`), so each cell is
// four quarters, each from the tile at one of its corners. A quarter is flat
// at its sector's height: the floor, or in the void the chasm's floor (#243,
// chasm.ts), which goes in a mesh of its own (`bottom`). Where a fully known tile without the
// void has a corner, it is rounded: within `r` of the grid corner a quarter's
// sliver beyond a quarter circle (`MAX_ROUND`, four segments; a 0.05 chamfer
// on man-made floors) takes the height its level bands give it, cut down on a
// convex corner and filled up in a concave one; saddles follow `dualCase`'s
// join, and a pinched one stays square. Sides are sheer: every place two
// heights meet gets one vertical face, emitted by the higher piece's cell, so
// each chunk holds what its cells own. The table's border gets a face down to 0
// under known cells only, but a known void cell's floor runs on past an open
// border instead (`Chasm.open`). A `WallSink` takes every vertical face instead (cliffs.ts makes
// them cliffs and risers, #241); the skirts between unexplored cells stay plain.

import { VOID } from '../../game/floor';
import { MAN_MADE } from './floors';
import { STEP_HEIGHT } from '../ground';
import { chasmY, DEFAULT_CHASM, OPEN_REACH, type Chasm } from './chasm';
import { dualCase, JOIN, type Join } from './dual';
import type { EmitterMesh } from './invariants';
import {
	CHUNK,
	chunksAcross,
	CORNERS,
	MAX_ROUND,
	SECTOR_H,
	SECTOR_V,
	type WorldShape
} from './shape';

/** The chamfer, in cells, a corner of a man-made floor gets instead of a rounding. */
export const BEVEL = 0.05;
/** Segments of a rounded corner's quarter circle. */
export const ARC_SEGMENTS = 4;
/**
 * How far (in cells) a skirt between unexplored cells reaches in under its top: past `MAX_NOISE`,
 * so no face lies along an edge toward unexplored ground.
 */
export const SKIRT = 0.1;

/** An emitter mesh with a normal per vertex. */
export interface GroundMesh extends EmitterMesh {
	normals: Float32Array;
}

/**
 * Where vertical faces go instead of the sides (cliffs.ts): a face from (x0, z0) to (x1, z1)
 * between heights lo and hi, `n` its outward normal at each end (x, z, x, z), made by `owner`.
 */
export interface WallSink {
	wall(
		x0: number,
		z0: number,
		x1: number,
		z1: number,
		lo: number,
		hi: number,
		n: number[],
		owner: number
	): void;
}

/** A chunk's ground: its tops (flat, facing up), its sheer sides and the void's floor. */
export interface ChunkGround {
	top: GroundMesh;
	sides: GroundMesh;
	bottom: GroundMesh;
}

/** A tile's heights: each corner's halves toward its horizontal and vertical neighbours, its sliver. */
interface Tile {
	h: number[];
	v: number[];
	/** The sliver within `r` of the centre: its own height unless the tile is rounded. */
	c: number[];
	r: number;
	segments: number;
	rounded: boolean;
}

function tileAt(shape: WorldShape, tx: number, ty: number, voidY: number): Tile {
	const { grid, tiles, known } = shape;
	const { width: w, height: h } = grid;
	const step = STEP_HEIGHT * grid.cellSize;
	const base = (ty * (w + 1) + tx) * 8;
	// A sector's height: its floor, or the chasm's floor in the void (below every floor).
	const at = (s: number) =>
		tiles.floor[base + s] === VOID ? voidY : tiles.levels[base + s] * step;
	const tile: Tile = {
		h: SECTOR_H.map(at),
		v: SECTOR_V.map(at),
		c: SECTOR_H.map(at),
		r: MAX_ROUND,
		segments: ARC_SEGMENTS,
		rounded: false
	};
	const cells: number[] = [];
	for (let k = 0; k < 4; k++) {
		const x = tx + CORNERS[k].dx;
		const y = ty + CORNERS[k].dy;
		if (x < 0 || y < 0 || x >= w || y >= h) return tile;
		const i = y * w + x;
		if ((known && !known[i]) || shape.floor[i] === VOID || tile.h[k] !== tile.v[k]) return tile;
		if (shape.stairs?.steps[i]) return tile; // a stair's corners stay square (#255)
		if (MAN_MADE.has(shape.floor[i])) [tile.r, tile.segments] = [BEVEL, 1];
		cells.push(i);
	}
	const levels = cells.map((i) => shape.levels[i]);
	const sliver = levels.map(() => Math.min(...levels));
	let join: Join | null = null;
	for (const band of [...new Set(levels)].sort((a, b) => a - b).slice(1)) {
		const inside = levels.map((l) => l >= band);
		join = null;
		for (let k = 0; k < 4; k++) {
			const [a, d, b] = [inside[(k + 1) & 3], inside[(k + 2) & 3], inside[(k + 3) & 3]];
			let keep = inside[k];
			const saddle = () => (join ??= dualCase(shape, tx, ty, band).join);
			// A convex corner is cut, unless its diagonal pair joins across the saddle.
			if (inside[k] && !a && !b) keep = d && saddle() !== JOIN.out;
			// A concave corner is filled, and across a saddle only if the other pair joins.
			else if (!inside[k] && a && b) keep = d || saddle() === JOIN.in;
			if (keep) sliver[k] = band;
		}
	}
	tile.c = sliver.map((l) => l * step);
	tile.rounded = tile.c.some((c, k) => c !== tile.h[k]);
	return tile;
}

/** Collects vertices and triangles, each triangle wound to face its normal. */
class Builder {
	private pos: number[] = [];
	private nor: number[] = [];
	private idx: number[] = [];
	private own: number[] = [];
	owner = 0;
	/** Where flat pieces below 0 go (the void's floor, #243), if not here. */
	under: Builder | null = null;

	constructor(private readonly sink: WallSink | null = null) {}

	vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
		this.pos.push(x, y, z);
		this.nor.push(nx, ny, nz);
		this.own.push(this.owner);
		return this.own.length - 1;
	}

	/** A triangle facing (nx, ny, nz). */
	triangle(a: number, b: number, c: number, nx: number, ny: number, nz: number): void {
		const p = this.pos;
		const ax = p[a * 3];
		const ay = p[a * 3 + 1];
		const az = p[a * 3 + 2];
		const ux = p[b * 3] - ax;
		const uy = p[b * 3 + 1] - ay;
		const uz = p[b * 3 + 2] - az;
		const vx = p[c * 3] - ax;
		const vy = p[c * 3 + 1] - ay;
		const vz = p[c * 3 + 2] - az;
		const dot = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
		if (dot < 0) this.idx.push(a, c, b);
		else this.idx.push(a, b, c);
	}

	/** A flat fan at height y round (x, z) points, facing up. */
	fan(points: number[], y: number): void {
		if (y < 0 && this.under) return this.under.fan(points, y);
		const first = this.vertex(points[0], y, points[1], 0, 1, 0);
		let last = this.vertex(points[2], y, points[3], 0, 1, 0);
		for (let i = 4; i < points.length; i += 2) {
			const next = this.vertex(points[i], y, points[i + 1], 0, 1, 0);
			this.triangle(first, last, next, 0, 1, 0);
			last = next;
		}
	}

	/** A flat rectangle from (x0, z0) to (x1, z1) at height y, facing up. */
	rect(x0: number, z0: number, x1: number, z1: number, y: number): void {
		if (y < 0 && this.under) return this.under.rect(x0, z0, x1, z1, y);
		const a = this.vertex(x0, y, z0, 0, 1, 0);
		const b = this.vertex(x1, y, z0, 0, 1, 0);
		const c = this.vertex(x1, y, z1, 0, 1, 0);
		const d = this.vertex(x0, y, z1, 0, 1, 0);
		this.triangle(a, b, c, 0, 1, 0);
		this.triangle(a, c, d, 0, 1, 0);
	}

	/** A quad of four (x, y, z) corners in order round it, facing (nx, nz), normals per end. */
	quad(c: number[], n: number[]): void {
		const [a0, a1, b0, b1] = n;
		const v = [
			this.vertex(c[0], c[1], c[2], a0, 0, a1),
			this.vertex(c[3], c[4], c[5], b0, 0, b1),
			this.vertex(c[6], c[7], c[8], b0, 0, b1),
			this.vertex(c[9], c[10], c[11], a0, 0, a1)
		];
		const [nx, nz] = [a0 + b0, a1 + b1];
		this.triangle(v[0], v[1], v[2], nx, 0, nz);
		this.triangle(v[0], v[2], v[3], nx, 0, nz);
	}

	/** One triangle of three (x, y, z) corners, facing (nx, 0, nz). */
	facet(c: number[], [nx, nz]: number[]): void {
		const v = [0, 3, 6].map((o) => this.vertex(c[o], c[o + 1], c[o + 2], nx, 0, nz));
		this.triangle(v[0], v[1], v[2], nx, 0, nz);
	}

	/** A vertical face in the quarter's (a, b) cells (P), from `other` up to `mine` if higher. */
	face(a0: number, b0: number, a1: number, b1: number, mine: number, other: number, n: number[]) {
		if (mine > other) this.wall(PX(a0), PZ(b0), PX(a1), PZ(b1), other, mine, n);
	}

	/** A vertical face from (x0, z0) to (x1, z1) between heights lo and hi, normals at each end. */
	wall(x0: number, z0: number, x1: number, z1: number, lo: number, hi: number, n: number[]) {
		if (this.sink) return this.sink.wall(x0, z0, x1, z1, lo, hi, n, this.owner);
		this.quad([x0, lo, z0, x1, lo, z1, x1, hi, z1, x0, hi, z0], n);
	}

	get empty(): boolean {
		return this.idx.length === 0;
	}

	done(): GroundMesh {
		return {
			positions: new Float32Array(this.pos),
			normals: new Float32Array(this.nor),
			indices: new Uint32Array(this.idx),
			owners: new Int32Array(this.own)
		};
	}
}

/** A builder that keeps nothing but the faces it hands its sink: the margin's (`chunkGround`). */
class Dry extends Builder {
	override rect(): void {}
	override fan(): void {}
	override quad(): void {}
	override facet(): void {}
}

/** Each corner's half-edge normals (toward its horizontal, then vertical, neighbour), x and z per end. */
const EDGE_NORMALS = CORNERS.map(({ dx, dy }) => {
	const [sx, sz] = [dx * 2 + 1, dy * 2 + 1];
	return [
		[-sx, 0, -sx, 0],
		[0, -sz, 0, -sz]
	];
});

/** A rounded corner's quarter circle, from (r, 0) to (0, r) round (r, r), as (a, b) pairs. */
const ARCS = new Map<number, number[]>();
function arcOf(r: number, segments: number): number[] {
	let arc = ARCS.get(r * 100 + segments);
	if (arc) return arc;
	arc = [];
	for (let i = 0; i <= segments; i++) {
		const t = (i / segments) * (Math.PI / 2);
		arc.push(r - r * Math.sin(t), r - r * Math.cos(t));
	}
	ARCS.set(r * 100 + segments, arc);
	return arc;
}

const negate = (n: number[]) => n.map((v) => -v);

/** The quarter being built: its tile's centre and the steps toward its cell, in world units. */
const P = { ox: 0, oz: 0, sx: 0, sz: 0 };
const PX = (a: number) => P.ox + P.sx * a;
const PZ = (b: number) => P.oz + P.sz * b;
/** A point `along` a half edge from the centre, `inward` into the cell, at height y. */
const point = (axis: 'a' | 'b', along: number, inward: number, y: number) =>
	axis === 'a' ? [PX(inward), y, PZ(along)] : [PX(along), y, PZ(inward)];

/** The tiles a build reads, each worked out once. */
class Tiles {
	private cache = new Map<number, Tile>();
	private readonly voidY: number;
	constructor(
		private readonly shape: WorldShape,
		readonly chasm: Chasm
	) {
		this.voidY = chasmY(chasm, shape.grid.cellSize);
	}
	at(tx: number, ty: number): Tile {
		const key = ty * (this.shape.grid.width + 1) + tx;
		let t = this.cache.get(key);
		if (!t) this.cache.set(key, (t = tileAt(this.shape, tx, ty, this.voidY)));
		return t;
	}
}

/**
 * The quarter of cell (x, y) toward the tile at (tx, ty), whose corner k it is: its tops into
 * `top` and the sides it owns into `sides`.
 */
function quarter(
	shape: WorldShape,
	tiles: Tiles,
	top: Builder,
	sides: Builder,
	x: number,
	y: number,
	tx: number,
	ty: number,
	k: number
): void {
	const { grid, known } = shape;
	const { width: w, height: h, cellSize: cs } = grid;
	const tile = tiles.at(tx, ty);
	// From the tile's centre (a grid corner) toward the cell's centre, in cells.
	const sx = CORNERS[k].dx * 2 + 1;
	const sz = CORNERS[k].dy * 2 + 1;
	const ox = (tx - w / 2) * cs;
	const oz = (ty - h / 2) * cs;
	const hk = k ^ 1;
	const vk = 3 - k;
	const split = tile.h[k] !== tile.v[k];
	const isKnown = !known || known[y * w + x] === 1;
	if (isKnown && !tile.rounded) {
		// The common case, without the general path's closures: a flat known quarter, and a face
		// on each half edge where it stands above its neighbour (or the border).
		const y0 = tile.h[k];
		const [ex, ez] = [ox + sx * 0.5 * cs, oz + sz * 0.5 * cs];
		top.rect(ox, oz, ex, ez, y0);
		const outA = x - sx < 0 || x - sx >= w;
		const outB = y - sz < 0 || y - sz >= h;
		const lowA = outA ? 0 : tile.h[hk];
		const lowB = outB ? 0 : tile.v[vk];
		const [nA, nB] = [EDGE_NORMALS[k][0], EDGE_NORMALS[k][1]];
		// The void at an open border: its floor runs on outward (and round the corner), no wall.
		const open = tiles.chasm.open && y0 < 0;
		const [ax, bz] = [ox - sx * OPEN_REACH * cs, oz - sz * OPEN_REACH * cs];
		if (y0 > lowA) sides.wall(ox, oz, ox, ez, lowA, y0, nA);
		else if (outA && open) top.rect(ox, oz, ax, ez, y0);
		else if (outA && y0 < 0) sides.wall(ox, oz, ox, ez, y0, 0, negate(nA));
		if (y0 > lowB) sides.wall(ox, oz, ex, oz, lowB, y0, nB);
		else if (outB && open) top.rect(ox, oz, ex, bz, y0);
		else if (outB && y0 < 0) sides.wall(ox, oz, ex, oz, y0, 0, negate(nB));
		if (outA && outB && open) top.rect(ox, oz, ax, bz, y0);
		return;
	}
	[P.ox, P.oz, P.sx, P.sz] = [ox, oz, sx * cs, sz * cs];
	const { r, segments } = tile;
	const arc = arcOf(r, segments);

	// Tops.
	if (split) {
		top.fan([PX(0), PZ(0), PX(0), PZ(0.5), PX(0.5), PZ(0.5)], tile.h[k]);
		top.fan([PX(0), PZ(0), PX(0.5), PZ(0), PX(0.5), PZ(0.5)], tile.v[k]);
	} else if (!tile.rounded) {
		top.fan([PX(0.5), PZ(0.5), PX(0.5), PZ(0), PX(0), PZ(0), PX(0), PZ(0.5)], tile.h[k]);
	} else {
		const ring = [PX(0.5), PZ(0.5), PX(0.5), PZ(0)];
		for (let i = 0; i < arc.length; i += 2) ring.push(PX(arc[i]), PZ(arc[i + 1]));
		ring.push(PX(0), PZ(0.5));
		top.fan(ring, tile.h[k]);
		const sliver = [PX(0), PZ(0)];
		for (let i = 0; i < arc.length; i += 2) sliver.push(PX(arc[i]), PZ(arc[i + 1]));
		top.fan(sliver, tile.c[k]);
	}

	// Sides: each where this piece stands above what meets it.
	const face = sides.face.bind(sides);
	// The half edge toward the horizontal neighbour (a = 0), then the vertical one (b = 0).
	for (const [axis, nk, mine] of [
		['a', hk, tile.h],
		['b', vk, tile.v]
	] as const) {
		const n = axis === 'a' ? [-sx, 0, -sx, 0] : [0, -sz, 0, -sz];
		const at = (along: number, inward: number, y: number) => point(axis, along, inward, y);
		const [nx, ny] = axis === 'a' ? [x - sx, y] : [x, y - sz];
		const outside = nx < 0 || ny < 0 || nx >= w || ny >= h;
		const theirs = outside ? 0 : mine[nk];
		if (!isKnown && (outside || (known && !known[ny * w + nx]))) {
			// Unexplored on both sides (or the border): nothing stands on the edge. A skirt slants
			// from the other side's height on the edge to this top, `SKIRT` in under it, so no
			// gap shows the sky and no face lies along the edge.
			if (mine[k] === theirs || (!outside && mine[k] < theirs)) continue;
			const skirt = [...at(0, 0, theirs), ...at(0.5, 0, theirs)];
			skirt.push(...at(0.5, SKIRT, mine[k]), ...at(0, SKIRT, mine[k]));
			sides.quad(
				skirt,
				n.map((v) => (mine[k] > theirs ? v : -v))
			);
			// Its ends closed: across the cell's middle line, and at the grid corner on a slant
			// (a cap on the corner's other edge would stand on it).
			const ahead = axis === 'a' ? [0, sz] : [sx, 0];
			const end = [...at(0.5, 0, theirs), ...at(0.5, 0, mine[k]), ...at(0.5, SKIRT, mine[k])];
			sides.facet(end, ahead);
			const corner = [...at(0, 0, theirs), ...at(0, 0, mine[k]), ...at(SKIRT, SKIRT, mine[k])];
			sides.facet(
				corner,
				ahead.map((v) => -v)
			);
			continue;
		}
		if (outside) {
			// The table's border under a known cell: down (or up, round the void's hole) to 0.
			if (mine[k] === 0) continue;
			const [lo, hi] = [Math.min(mine[k], 0), Math.max(mine[k], 0)];
			const facing = n.map((v) => (mine[k] > 0 ? v : -v));
			const [a, b] = [at(0, 0, lo), at(0.5, 0, lo)];
			sides.wall(a[0], a[2], b[0], b[2], lo, hi, facing);
			continue;
		}
		const along = (lo: number, hi: number, m: number, o: number) =>
			axis === 'a' ? face(0, lo, 0, hi, m, o, n) : face(lo, 0, hi, 0, m, o, n);
		if (tile.rounded) {
			along(0, r, tile.c[k], tile.c[nk]);
			along(r, 0.5, mine[k], theirs);
		} else along(0, 0.5, mine[k], theirs);
	}
	// The rounded corner's arc between the sliver and the rest.
	if (tile.rounded && tile.c[k] !== tile.h[k]) {
		const out = tile.h[k] > tile.c[k] ? 1 : -1; // toward the sliver if the rest is higher
		for (let i = 0; i + 2 < arc.length; i += 2) {
			const [a0, b0, a1, b1] = [arc[i], arc[i + 1], arc[i + 2], arc[i + 3]];
			const n = [(a0 - r) * sx, (b0 - r) * sz, (a1 - r) * sx, (b1 - r) * sz].map(
				(v) => (v / r) * out
			);
			const [lo, hi] = [Math.min(tile.h[k], tile.c[k]), Math.max(tile.h[k], tile.c[k])];
			sides.wall(PX(a0), PZ(b0), PX(a1), PZ(b1), lo, hi, n);
		}
	}
	if (isKnown) return; // a known cell's quarters are all its own height
	// An unexplored cell split along its diagonal, and its quarters in the neighbouring tiles.
	if (split) {
		const d = Math.SQRT1_2 * (tile.h[k] > tile.v[k] ? 1 : -1);
		const [lo, hi] = [Math.min(tile.h[k], tile.v[k]), Math.max(tile.h[k], tile.v[k])];
		sides.wall(PX(0), PZ(0), PX(0.5), PZ(0.5), lo, hi, [sx * d, -sz * d, sx * d, -sz * d]);
	}
	const across = tiles.at(tx + sx, ty);
	face(0.5, 0, 0.5, 0.5, tile.v[k], across.v[hk], [sx, 0, sx, 0]);
	const below = tiles.at(tx, ty + sz);
	face(0, 0.5, 0.5, 0.5, tile.h[k], below.h[vk], [0, sz, 0, sz]);
}

/** A cell's four quarters: toward its NW, NE, SE and SW corners, whose tiles' corners it is. */
const QUARTERS = [
	{ dx: 0, dy: 0, k: 2 },
	{ dx: 1, dy: 0, k: 3 },
	{ dx: 1, dy: 1, k: 0 },
	{ dx: 0, dy: 1, k: 1 }
] as const;

/**
 * The ground of one chunk (`chunksAcross` row-major), from the world's shape. With a `sink`, every
 * vertical face goes to it (with its owner) instead of the sides, and so do the faces of the cells
 * `margin` cells round the chunk, whose tops and skirts are dropped: cliffs.ts joins faces across
 * the chunk's edge by them.
 */
export function chunkGround(
	shape: WorldShape,
	chunk: number,
	sink: WallSink | null = null,
	margin = 0,
	chasm: Chasm = DEFAULT_CHASM
): ChunkGround {
	const { grid } = shape;
	const across = chunksAcross(grid);
	const cx = (chunk % across.x) * CHUNK;
	const cy = Math.floor(chunk / across.x) * CHUNK;
	const tiles = new Tiles(shape, chasm);
	const [top, sides, bottom] = [new Builder(), new Builder(sink), new Builder()];
	top.under = bottom;
	const [scratchTop, scratchSides] = [new Dry(), new Dry(sink)];
	const [x1, y1] = [cx + CHUNK, cy + CHUNK];
	for (let y = Math.max(cy - margin, 0); y < Math.min(y1 + margin, grid.height); y++)
		for (let x = Math.max(cx - margin, 0); x < Math.min(x1 + margin, grid.width); x++) {
			const own = x >= cx && y >= cy && x < x1 && y < y1;
			const [t, s] = own ? [top, sides] : [scratchTop, scratchSides];
			t.owner = s.owner = bottom.owner = y * grid.width + x;
			for (const q of QUARTERS) quarter(shape, tiles, t, s, x, y, x + q.dx, y + q.dy, q.k);
		}
	return { top: top.done(), sides: sides.done(), bottom: bottom.done() };
}
