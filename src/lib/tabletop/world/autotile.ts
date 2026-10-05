// Edge autotiling (milestone 70, #251): which kit piece stands on every known
// wall edge and at every grid corner, from what the viewer was sent. Pure
// (no three.js), the same on every client, tier and backend; specs in the
// server project. docs/RENDERING.md, "Wall autotiling", is the contract.
//
// - Edge kinds follow the rules' precedence: a window wherever any window
//   covers the edge (`windowEdges` wins for sight), else a wall, else a door.
//   Object ids and object boundaries are never read, so a wall split in three,
//   a wall cut by `cutWall` and a sealed secret door all tile as one wall.
// - Nothing toward unexplored cells: an edge with no known side is absent, an
//   unexplored side counts as walkable (never `wall.outer`, never building),
//   and heights come from known sides only.
// - Straight corners get no post, which hides every split.

import type { KitRole } from '../../assets/kit';
import { VOID } from '../../game/floor';
import type { SquareGrid } from '../../game/grid';
import { type SceneObject, unitEdges } from '../../game/objects';
import type { CellMask } from '../../game/visibility';
import { STEP_HEIGHT, WALL_HEIGHT } from '../ground';
import {
	CHUNK,
	chunksAcross,
	dirtyChunks,
	EDGE_BUILT,
	edgeSlot,
	hEdge,
	vEdge,
	type EdgeMap,
	type WorldShape
} from './shape';

/**
 * The kit roles autotile places, a subset of #250's `KIT_ROLES` (src/lib/assets/kit.ts), indexed
 * here for the packed pieces. Caps (`cap`, their own kit role, on every wall's top) are #252's to
 * stack, and door leaves come from the door objects themselves (#253), so neither is placed here.
 */
export const TILE_ROLES = [
	'wall.straight',
	'wall.outer',
	'wall.retaining',
	'wall.boundary',
	'plinth',
	'window.frame',
	'window.sill',
	'door.frame',
	'post.end',
	'post.L',
	'post.T',
	'post.X'
] as const satisfies readonly KitRole[];
export type TileRole = (typeof TILE_ROLES)[number];
const ROLE = Object.fromEntries(TILE_ROLES.map((r, i) => [r, i])) as Record<TileRole, number>;

/** What joins at a grid corner. */
export const JOINT = { none: 0, end: 1, straight: 2, L: 3, T: 4, X: 5 } as const;
export type Joint = (typeof JOINT)[keyof typeof JOINT];

/** Arms of a corner: the edges running north, east, south and west from it. */
export const ARM = { N: 1, E: 2, S: 4, W: 8 } as const;

/** Where a piece stands: the horizontal edge from (x, y), the vertical one, or the corner (x, y). */
export const SITE = { h: 0, v: 1, corner: 2 } as const;

/** `flags` bit: a post beside a door (a jamb). */
export const JAMB = 1;

/**
 * Turns `mask`'s arms one quarter turn as a piece rotated by π/2 about +Y is
 * turned: S (+z) to E (+x), E to N (-z), N to W, W to S.
 */
const turn = (mask: number) => (mask >> 1) | ((mask & 1) << 3);

/** Each joint's arms at rotation 0: an end's arm runs S (+z), an L's S and E, a T's E, S and W. */
const CANONICAL: Record<Joint, number> = { 0: 0, 1: ARM.S, 2: ARM.N | ARM.S, 3: 6, 4: 14, 5: 15 };

/** The joint for a corner's arms and the quarter turns (0-3) that put its canonical arms there. */
export function jointOf(mask: number): { joint: Joint; rotation: number } {
	const n = (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);
	const joint: Joint =
		n === 0
			? JOINT.none
			: n === 1
				? JOINT.end
				: n === 3
					? JOINT.T
					: n === 4
						? JOINT.X
						: mask === 5 || mask === 10
							? JOINT.straight
							: JOINT.L;
	let m = CANONICAL[joint];
	for (let r = 0; r < 4; r++, m = turn(m)) if (m === mask) return { joint, rotation: r };
	return { joint, rotation: 0 }; // unreachable: every mask is some joint turned
}

const POST: Partial<Record<Joint, number>> = {
	[JOINT.end]: ROLE['post.end'],
	[JOINT.L]: ROLE['post.L'],
	[JOINT.T]: ROLE['post.T'],
	[JOINT.X]: ROLE['post.X']
};

/** Rank of each `EDGE_BUILT` value on a shared edge: window over wall over door. */
const PRECEDENCE = [0, 2, 3, 1];

/** Every unit edge's kind by the rules' precedence, whatever the objects' order, ids or splits. */
export function edgeKinds(grid: SquareGrid, objects: readonly SceneObject[]): EdgeMap {
	const map: EdgeMap = {
		h: new Uint8Array(grid.width * (grid.height + 1)),
		v: new Uint8Array((grid.width + 1) * grid.height)
	};
	for (const o of objects) {
		const kind =
			o.kind === 'door' ? EDGE_BUILT.door : o.window ? EDGE_BUILT.window : EDGE_BUILT.wall;
		for (const e of unitEdges(o.a, o.b)) {
			const { axis, index } = edgeSlot(grid, e);
			if (index >= map[axis].length) continue;
			if (PRECEDENCE[kind] > PRECEDENCE[map[axis][index]]) map[axis][index] = kind;
		}
	}
	return map;
}

/** What autotile reads: the world's shape, the edge kinds and the building context. */
export interface TileInput {
	shape: WorldShape;
	kinds: EdgeMap;
	/**
	 * Cells inside buildings: the viewer's roof footprint (#257, `roofFootprint`: the interior mask
	 * as sent, #203, and presumed roofs), read on known cells only. Null means no building context:
	 * no wall is then `wall.boundary`. `RoofLayer.update` gives one from the first frame where the
	 * kit presumes roofs, else once the viewer knows a roofed cell (docs/RENDERING.md, "Roofs").
	 */
	building: CellMask | null;
	/** Each edge's view (null: no piece), worked out once: an edge is read by its piece and both posts. */
	views: { h: (EdgeView | null)[]; v: (EdgeView | null)[] };
}

export function tileInput(
	shape: WorldShape,
	objects: readonly SceneObject[],
	building: CellMask | null
): TileInput {
	const { width: w, height: h } = shape.grid;
	const t: TileInput = {
		shape,
		kinds: edgeKinds(shape.grid, objects),
		building,
		views: { h: new Array(w * (h + 1)).fill(null), v: new Array((w + 1) * h).fill(null) }
	};
	for (let y = 0; y <= h; y++)
		for (let x = 0; x <= w; x++) {
			if (x < w && t.kinds.h[y * w + x]) t.views.h[y * w + x] = edgeView(t, 'h', x, y);
			if (y < h && t.kinds.v[y * (w + 1) + x]) t.views.v[y * (w + 1) + x] = edgeView(t, 'v', x, y);
		}
	return t;
}

/**
 * One chunk's pieces, as parallel arrays. A piece at an edge stands on the unit edge from
 * corner (x, y) east (`SITE.h`) or south (`SITE.v`), centred on its midpoint; a post on the
 * corner (x, y). `rotation` is quarter turns about +Y (θ = rotation · π/2): a piece's +z face
 * looks S (grid +y, world +z) at 0, E at 1, N at 2, W at 3. Heights are world units.
 */
export interface WallPieces {
	count: number;
	/** Index into `TILE_ROLES`. */
	role: Uint8Array;
	site: Uint8Array;
	x: Uint16Array;
	y: Uint16Array;
	rotation: Uint8Array;
	/** FNV-1a of the edge's `edgeKey`, or of `c:x:y` for a corner: picks the kit's variant. */
	seed: Uint32Array;
	y0: Float32Array;
	y1: Float32Array;
	flags: Uint8Array;
}

/** Pieces as they are found: nine numbers each, in `WallPieces` field order. */
type Sink = number[];
const FIELDS = 9;

const FNV_BASIS = 0x811c9dc5;
const fnvByte = (h: number, byte: number) => Math.imul(h ^ byte, 0x01000193);
function fnvNumber(h: number, n: number): number {
	if (n >= 10) h = fnvNumber(h, Math.floor(n / 10));
	return fnvByte(h, 48 + (n % 10));
}
/**
 * FNV-1a (`fnv1a` in game/visibility.ts) of the ASCII key `<tag>:<x>:<y>`, without building it:
 * an edge's `edgeKey` (`h:x:y`, `v:x:y`) or a corner's `c:x:y`.
 */
export function keySeed(tag: 'h' | 'v' | 'c', x: number, y: number): number {
	let h = fnvByte(FNV_BASIS, tag.charCodeAt(0));
	h = fnvNumber(fnvByte(h, 58), x);
	return fnvNumber(fnvByte(h, 58), y) >>> 0;
}

/** A variant index from a seed and the kit's weights (each > 0), the same on every client. */
export function variantOf(seed: number, weights: readonly number[]): number {
	const total = weights.reduce((a, b) => a + b, 0);
	let t = (seed / 0x100000000) * total;
	for (let i = 0; i < weights.length; i++) if ((t -= weights[i]) < 0) return i;
	return weights.length - 1;
}

/** One edge as autotile sees it, or null when it has no piece (nothing built, or no known side). */
export interface EdgeView {
	kind: number;
	low: number;
	high: number;
	/** The main piece's quarter turns, and a retaining piece's (toward the lower side). */
	rotation: number;
	down: number;
	outer: boolean;
	boundary: boolean;
}

function edgeView(t: TileInput, axis: 'h' | 'v', x: number, y: number): EdgeView | null {
	const { shape, building } = t;
	const { width: w, height: h, cellSize: cs } = shape.grid;
	const horizontal = axis === 'h';
	const kind = horizontal ? t.kinds.h[y * w + x] : t.kinds.v[y * (w + 1) + x];
	if (!kind) return null;
	// The cells beside it: p north (or west), q south (or east); -1 off the table.
	const px = horizontal ? x : x - 1;
	const py = horizontal ? y - 1 : y;
	const p = px >= 0 && py >= 0 && px < w && py < h ? py * w + px : -1;
	const q = x < w && y < h ? y * w + x : -1;
	const known = shape.known;
	const pk = p >= 0 && (!known || known[p] === 1);
	const qk = q >= 0 && (!known || known[q] === 1);
	if (!pk && !qk) return null;
	// Heights from the known sides only (a drop shows only between two known cells).
	const step = STEP_HEIGHT * cs;
	const fp = shape.levels[pk ? p : q] * step;
	const fq = shape.levels[qk ? q : p] * step;
	// Off the table or known void: what a thick wall may face. Unexplored is walkable.
	const po = p < 0 || (pk && shape.floor[p] === VOID);
	const qo = q < 0 || (qk && shape.floor[q] === VOID);
	const pb = !!building && pk && building[p] === 1;
	const qb = !!building && qk && building[q] === 1;
	// The +z face looks at the void, else out of the building, else down a drop, else S or E.
	const faceP = po !== qo ? po : pb !== qb ? qb : fp < fq;
	const toP = horizontal ? 2 : 3;
	const toQ = horizontal ? 0 : 1;
	return {
		kind,
		low: Math.min(fp, fq),
		high: Math.max(fp, fq),
		rotation: faceP ? toP : toQ,
		down: fp < fq ? toP : toQ,
		outer: po || qo,
		// Only between two known cells: a wall with an unexplored side may be a house's (#257).
		boundary: !!building && pk && qk && !pb && !qb
	};
}

const viewOf = (t: TileInput, axis: 'h' | 'v', x: number, y: number) =>
	t.views[axis][axis === 'h' ? y * t.shape.grid.width + x : y * (t.shape.grid.width + 1) + x];

function edgePieces(t: TileInput, axis: 'h' | 'v', x: number, y: number, out: Sink): void {
	const e = viewOf(t, axis, x, y);
	if (!e) return;
	const cs = t.shape.grid.cellSize;
	const site = axis === 'h' ? SITE.h : SITE.v;
	const seed = keySeed(axis, x, y);
	const role =
		e.kind === EDGE_BUILT.door
			? ROLE['door.frame']
			: e.kind === EDGE_BUILT.window
				? e.high > e.low
					? ROLE['window.sill']
					: ROLE['window.frame']
				: e.outer
					? ROLE['wall.outer']
					: e.boundary
						? ROLE['wall.boundary']
						: ROLE['wall.straight'];
	out.push(role, site, x, y, e.rotation, seed, e.high, e.high + WALL_HEIGHT * cs, 0);
	if (e.high === e.low) return;
	// A drop: a retaining piece from the lower floor up to the higher, under a plinth course.
	out.push(ROLE['wall.retaining'], site, x, y, e.down, seed, e.low, e.high, 0);
	const plinth = Math.max(e.low, e.high - STEP_HEIGHT * cs);
	out.push(ROLE.plinth, site, x, y, e.down, seed, plinth, e.high, 0);
}

function cornerPiece(t: TileInput, tx: number, ty: number, out: Sink): void {
	const { shape } = t;
	const { width: w, height: h, cellSize: cs } = shape.grid;
	let mask = 0;
	let top = -Infinity;
	let flags = 0;
	for (let arm = 0; arm < 4; arm++) {
		// N, E, S, W: the edges from this corner.
		const e =
			arm === 0
				? ty > 0 && viewOf(t, 'v', tx, ty - 1)
				: arm === 1
					? tx < w && viewOf(t, 'h', tx, ty)
					: arm === 2
						? ty < h && viewOf(t, 'v', tx, ty)
						: tx > 0 && viewOf(t, 'h', tx - 1, ty);
		if (!e) continue;
		mask |= 1 << arm;
		top = Math.max(top, e.high + WALL_HEIGHT * cs);
		if (e.kind === EDGE_BUILT.door) flags |= JAMB;
	}
	const { joint, rotation } = jointOf(mask);
	const role = POST[joint];
	if (role === undefined) return;
	// From the lowest known floor round the corner (an arm guarantees one).
	let bottom = Infinity;
	for (let cy = ty - 1; cy <= ty; cy++) {
		for (let cx = tx - 1; cx <= tx; cx++) {
			if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
			const i = cy * w + cx;
			if (shape.known && !shape.known[i]) continue;
			bottom = Math.min(bottom, shape.levels[i] * STEP_HEIGHT * cs);
		}
	}
	const seed = keySeed('c', tx, ty);
	out.push(role, SITE.corner, tx, ty, rotation, seed, bottom, top, flags);
}

/** The chunk a corner's (and the edges from it east and south) pieces belong to. */
export function chunkOfCorner(grid: SquareGrid, tx: number, ty: number): number {
	const x = Math.min(tx, grid.width - 1);
	const y = Math.min(ty, grid.height - 1);
	return Math.floor(y / CHUNK) * chunksAcross(grid).x + Math.floor(x / CHUNK);
}

/** One chunk's pieces: per corner in row order, its edge east, its edge south, then its post. */
export function chunkPieces(t: TileInput, chunk: number): WallPieces {
	const g = t.shape.grid;
	const across = chunksAcross(g);
	const [cx, cy] = [chunk % across.x, Math.floor(chunk / across.x)];
	const x1 = cx === across.x - 1 ? g.width + 1 : (cx + 1) * CHUNK;
	const y1 = cy === across.y - 1 ? g.height + 1 : (cy + 1) * CHUNK;
	const out: Sink = [];
	for (let ty = cy * CHUNK; ty < y1; ty++) {
		for (let tx = cx * CHUNK; tx < x1; tx++) {
			if (tx < g.width) edgePieces(t, 'h', tx, ty, out);
			if (ty < g.height) edgePieces(t, 'v', tx, ty, out);
			cornerPiece(t, tx, ty, out);
		}
	}
	const n = out.length / FIELDS;
	const p: WallPieces = {
		count: n,
		role: new Uint8Array(n),
		site: new Uint8Array(n),
		x: new Uint16Array(n),
		y: new Uint16Array(n),
		rotation: new Uint8Array(n),
		seed: new Uint32Array(n),
		y0: new Float32Array(n),
		y1: new Float32Array(n),
		flags: new Uint8Array(n)
	};
	for (let i = 0, o = 0; i < n; i++, o += FIELDS) {
		p.role[i] = out[o];
		p.site[i] = out[o + 1];
		p.x[i] = out[o + 2];
		p.y[i] = out[o + 3];
		p.rotation[i] = out[o + 4];
		p.seed[i] = out[o + 5];
		p.y0[i] = out[o + 6];
		p.y1[i] = out[o + 7];
		p.flags[i] = out[o + 8];
	}
	return p;
}

/** The pieces of the given chunks (every chunk by default), by chunk index. */
export function autotile(t: TileInput, chunks?: readonly number[]): Map<number, WallPieces> {
	const across = chunksAcross(t.shape.grid);
	const list = chunks ?? Array.from({ length: across.x * across.y }, (_, i) => i);
	return new Map(list.map((c) => [c, chunkPieces(t, c)]));
}

/**
 * The chunks whose pieces may differ from `prev` to `next`: the shape's dirty chunks, and the
 * chunks of every corner beside an edge whose kind changed or a cell whose building changed.
 * Every chunk with no previous input, a new grid size or a building context come or gone. Sorted.
 */
export function dirtyPieceChunks(prev: TileInput | null, next: TileInput): number[] {
	const g = next.shape.grid;
	const base = dirtyChunks(prev?.shape ?? null, next.shape);
	if (!prev || prev.shape.grid.width !== g.width || prev.shape.grid.height !== g.height)
		return base;
	// A building context come or gone (a kit with roofs, #257) may change every wall.
	if (!prev.building !== !next.building) return dirtyChunks(null, next.shape);
	const dirty = new Set(base);
	const mark = (x0: number, y0: number, x1: number, y1: number) => {
		for (let y = y0; y <= y1; y++)
			for (let x = x0; x <= x1; x++) dirty.add(chunkOfCorner(g, Math.max(x, 0), Math.max(y, 0)));
	};
	for (let y = 0; y <= g.height; y++)
		for (let x = 0; x < g.width; x++)
			if (prev.kinds.h[hEdge(g, x, y)] !== next.kinds.h[hEdge(g, x, y)]) mark(x, y, x + 1, y);
	for (let y = 0; y < g.height; y++)
		for (let x = 0; x <= g.width; x++)
			if (prev.kinds.v[vEdge(g, x, y)] !== next.kinds.v[vEdge(g, x, y)]) mark(x, y, x, y + 1);
	for (let i = 0; i < g.width * g.height; i++) {
		const was = prev.building ? prev.building[i] : 0;
		const now = next.building ? next.building[i] : 0;
		const x = i % g.width;
		const y = Math.floor(i / g.width);
		// A cell's four edges start at its corners; posts stand at their ends.
		if (was !== now) mark(x, y, x + 1, y + 1);
	}
	return [...dirty].sort((a, b) => a - b);
}
