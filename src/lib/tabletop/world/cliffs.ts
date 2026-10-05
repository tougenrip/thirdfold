// Stepped cliffs and step risers (#241): the vertical faces of the ground's
// chunks (ground-mesh.ts, through its `WallSink`) extruded along a profile, so a
// player tells a walkable step from a drop at a glance, by shape as well as
// colour. Pure, like the rest of world/: positions, normals, a shade per vertex
// (vertex colours) and the owning cell of every vertex, by style.
//
// - A **riser** (one level, what `canStep` climbs) is a straight step: a nosing
//   NOSING tall at the edge, lighter (worn), over a riser set back RECESS under
//   it, darker in its shadow, kicking out to the edge at its foot. No noise.
// - A **cliff** (two levels or more, or a drop into the void) has a rim LIP
//   tall at the edge, then its face set back under the rim, about
//   ROWS_PER_LEVEL rows a level (MAX_ROWS at most), each pushed back by deterministic noise of the
//   world position (never more than MAX_NOISE in all, never at the rim or the
//   foot), its strata from the rock kind's world-space mapping.
//
// Every face hangs back under the higher cell's top (its top row and its foot
// stay on the edge, the rest is set back into the higher cell's edge band, past
// no token's disk), so nothing stands over the lower cell, the tops stay exactly
// at floorY, and the rock kind's lookup a hundredth of a cell behind the face
// (positionWorld − normalWorld × 0.01 × cellSize) always lands in the cell that
// owns it. Where faces meet with the same heights and normal they join; where
// they don't (a sharp corner, a change of height, the chunk's edge without its
// partner) the set-back tapers to the edge over TAPER, so no gap ever opens.
// Faces made by unexplored cells, and the void's own walls, stay plain. Below
// level 0, down a chasm (#243), every face darkens with depth (`depthShade`).
//
// The style follows the cell that owns the face: masonry on man-made floors
// (stone, wood, cobble, flagstone), earth on the rest (rock too); the layer
// gives each style its look by the environment (the cave environments wear
// cave rock on every face).
//
// Stairs (#255, stairs.ts) take over their edges: a run's riser becomes a
// **stair** step (each level two half steps, the lower half's narrow tread
// HALF_TREAD out over the lower cell's edge band, under the same worn nosing),
// a step's side down to a lower neighbour a **side** (a stringer with its top
// SIDE_OUT proud of the edge), and an edge a kit piece stands on draws nothing.
// Their ends taper over STAIR_TAPER, so a step's end is a closed wedge.

import { VOID } from '../../game/floor';
import { MAN_MADE as MASONRY } from './floors';
import { STEP_HEIGHT } from '../ground';
import { bridgeTrim } from './bridge-mesh';
import { DEFAULT_CHASM, depthShade, type Chasm } from './chasm';
import { chunkGround, type GroundMesh, type WallSink } from './ground-mesh';
import { joinMeshes } from './join';
import { CHUNK, chunksAcross, MAX_NOISE, slotBetween, STAIR_EDGE, type WorldShape } from './shape';

/** The styles a face may take, each a mesh of its own (world-layer.ts gives each its look). */
export const CLIFF_STYLES = ['earth', 'masonry'] as const;
export type CliffStyle = (typeof CLIFF_STYLES)[number];
/** A floor's style index in `CLIFF_STYLES`. */
export const styleOf = (floor: number): number => (MASONRY.has(floor) ? 1 : 0);

/** What a face is drawn as. */
export const FACE = { plain: 0, riser: 1, cliff: 2, stair: 3, side: 4, kit: 5 } as const;
export type FaceKind = (typeof FACE)[keyof typeof FACE];

/** A riser's nosing: its height at the edge, and how far the riser below sits back (cells). */
export const NOSING = 0.05;
export const RECESS = 0.04;
/** A cliff's rim: its height at the edge, and how far the face sits back under it (cells). */
export const LIP = 0.04;
export const SET_BACK = 0.035;
/** The deepest a cliff's face is set back, noise and all: within `MAX_NOISE`. */
export const DEEPEST = MAX_NOISE - 0.005;
/** Rows of a cliff's face per level. */
export const ROWS_PER_LEVEL = 3;
/** The most rows a face takes, however tall: a tower's bands grow instead (chunk cost, #241). */
export const MAX_ROWS = 12;
/** Columns along a face, at most this far apart (cells), and the taper's length at a free end. */
export const COLUMN = 0.5;
export const TAPER = 0.25;
/** A stair step's lower half: how far its tread reaches over the lower cell (WALL_HALF_THIN). */
export const HALF_TREAD = 0.07;
/** How far a stair's side stands proud of its edge, its top a narrow coping. */
export const SIDE_OUT = 0.03;
/** A stair's side: its coping band's height. */
export const COPING = 0.06;
/** The taper of a stair's free ends (a step's end meets its side). */
export const STAIR_TAPER = 0.1;
/** Shades (vertex colours): the worn nosing and rim, the shadow under them, the foot. */
const SHADE = { nose: 1.3, rim: 1.15, under: 0.55, recess: 0.8, foot: 0.85, tread: 1.2 };
/** Two rows this close stand for one, with a change of shade between their bands. */
const SEAM = 1e-4;

/** A mesh with a colour (rgb, the face's shade) per vertex. */
export interface CliffMesh extends GroundMesh {
	colors: Float32Array;
}

/** A chunk's ground: its tops, its faces by style (`CLIFF_STYLES`) and the void's floor (#243). */
export interface ChunkWorld {
	top: GroundMesh;
	sides: CliffMesh[];
	bottom: GroundMesh;
}

/** One row of a profile: its height, how far it sits back (cells), its shade, noise or not. */
interface Row {
	y: number;
	back: number;
	shade: number;
	noisy: boolean;
}

/** A face's profile from its top (hi) to its foot (lo), in world units (`cs` the cell size). */
export function profile(kind: FaceKind, lo: number, hi: number, cs: number): Row[] {
	const row = (y: number, back: number, shade: number, noisy = false): Row => ({
		y,
		back,
		shade,
		noisy
	});
	if (kind === FACE.plain) return [row(hi, 0, 1), row(lo, 0, 1)];
	if (kind === FACE.stair) {
		// The upper half under the nosing, the lower half's tread out over the lower cell, its riser.
		const mid = (hi + lo) / 2;
		const out = -HALF_TREAD;
		return [
			row(hi, 0, SHADE.nose),
			row(hi - NOSING * cs, 0, SHADE.nose),
			row(hi - (NOSING + RECESS) * cs, RECESS, SHADE.under),
			row(mid + SEAM * cs, RECESS, SHADE.recess),
			row(mid, RECESS, SHADE.tread),
			row(mid, out, SHADE.tread),
			row(mid - SEAM * cs, out, SHADE.nose),
			row(mid - NOSING * cs, out, SHADE.nose),
			row(mid - (NOSING + SEAM) * cs, out, SHADE.recess),
			row(lo, out, SHADE.foot)
		];
	}
	if (kind === FACE.side)
		return [
			row(hi, 0, SHADE.tread),
			row(hi, -SIDE_OUT, SHADE.tread),
			row(hi - SEAM * cs, -SIDE_OUT, SHADE.rim),
			row(hi - COPING * cs, -SIDE_OUT, SHADE.rim),
			row(hi - (COPING + SEAM) * cs, -SIDE_OUT, SHADE.recess),
			row(lo, -SIDE_OUT, SHADE.foot)
		];
	if (kind === FACE.riser)
		return [
			row(hi, 0, SHADE.nose),
			row(hi - NOSING * cs, 0, SHADE.nose),
			row(hi - (NOSING + RECESS) * cs, RECESS, SHADE.under),
			row(lo + RECESS * cs, RECESS, SHADE.recess),
			row(lo, 0, SHADE.foot)
		];
	const top = hi - (LIP + SET_BACK) * cs;
	const levels = (hi - lo) / (STEP_HEIGHT * cs);
	const n = Math.min(MAX_ROWS, Math.max(2, Math.round(levels * ROWS_PER_LEVEL)));
	const rows = [row(hi, 0, SHADE.rim), row(hi - LIP * cs, 0, SHADE.rim), row(top, SET_BACK, 0.6)];
	for (let k = 1; k < n; k++) rows.push(row(top - ((top - lo) * k) / n, SET_BACK, 0, true));
	rows.push(row(lo, 0, SHADE.foot));
	return rows;
}

/** Deterministic value noise in [0, 1] of a point (in cells): the same on every client and build. */
export function noise(x: number, y: number, z: number): number {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	const iz = Math.floor(z);
	const fx = smooth(x - ix);
	const fy = smooth(y - iy);
	const fz = smooth(z - iz);
	const near = lerp(
		lerp(hash(ix, iy, iz), hash(ix + 1, iy, iz), fx),
		lerp(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), fx),
		fy
	);
	const far = lerp(
		lerp(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), fx),
		lerp(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), fx),
		fy
	);
	return lerp(near, far, fz);
}

function smooth(f: number): number {
	return f * f * (3 - 2 * f);
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

/** A lattice point's value in [0, 1). */
function hash(x: number, y: number, z: number): number {
	let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x2545f491) ^ 0x241;
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** How far back a cliff row sits at (x, y, z) world units: SET_BACK to DEEPEST, in strata. */
const depthAt = (x: number, y: number, z: number, cs: number) =>
	SET_BACK + (DEEPEST - SET_BACK) * noise((x / cs) * 1.7, (y / cs) * 5, (z / cs) * 1.7);

/** A vertical face as ground-mesh.ts hands it over. */
interface Face {
	x0: number;
	z0: number;
	x1: number;
	z1: number;
	lo: number;
	hi: number;
	n: number[];
	owner: number;
	kind: FaceKind;
}

/** What a stair (#255) made of the edge between a cell and the one beyond it, if beside it. */
function stairEdge(shape: WorldShape, owner: number, x: number, y: number): number {
	const { grid, stairs } = shape;
	const w = grid.width;
	if (!stairs || Math.abs(x - (owner % w)) + Math.abs(y - Math.floor(owner / w)) !== 1) return 0;
	const { axis, index } = slotBetween(grid, owner, y * w + x);
	return stairs.edges[axis][index];
}

/** What a face is: plain where its owner is unexplored or the void, a cliff over the void. */
function kindOf(shape: WorldShape, f: Omit<Face, 'kind'>): FaceKind {
	const { grid, known, floor } = shape;
	const cs = grid.cellSize;
	if ((known && !known[f.owner]) || floor[f.owner] === VOID) return FACE.plain;
	// The cell beyond the face's middle: the void there makes any drop a cliff, down to the
	// chasm's floor (a whole number of levels or not: the sea's and the moving ground's aren't).
	const [nx, nz] = [f.n[0] + f.n[2], f.n[1] + f.n[3]];
	const len = Math.hypot(nx, nz) || 1;
	const x = Math.floor(((f.x0 + f.x1) / 2 + (nx / len) * 0.25 * cs) / cs + grid.width / 2);
	const y = Math.floor(((f.z0 + f.z1) / 2 + (nz / len) * 0.25 * cs) / cs + grid.height / 2);
	const beyond = x >= 0 && y >= 0 && x < grid.width && y < grid.height;
	const stair = beyond ? stairEdge(shape, f.owner, x, y) : STAIR_EDGE.none;
	// A kit piece, or a bridge's side (#256, over the void too), stands there.
	if (stair === STAIR_EDGE.kit) return FACE.kit;
	if (beyond && floor[y * grid.width + x] === VOID) return FACE.cliff;
	const levels = (f.hi - f.lo) / (STEP_HEIGHT * cs);
	if (Math.abs(levels - Math.round(levels)) > 1e-3 || Math.round(levels) < 1) return FACE.plain;
	if (stair === STAIR_EDGE.riser && Math.round(levels) === 1) return FACE.stair;
	if (stair === STAIR_EDGE.side) return FACE.side;
	return Math.round(levels) === 1 ? FACE.riser : FACE.cliff;
}

/** A face end's key: where it is, its heights, its normal and kind. Two ends with one key join. */
function endKey(f: Face, end: 0 | 1, cs: number): string {
	const r = (v: number) => Math.round((v / cs) * 1e4);
	const [x, z] = end ? [f.x1, f.z1] : [f.x0, f.z0];
	const [nx, nz] = [f.n[end * 2], f.n[end * 2 + 1]];
	const q = (v: number) => Math.round((v / (Math.hypot(nx, nz) || 1)) * 1e3);
	return `${r(x)},${r(z)},${r(f.lo)},${r(f.hi)},${q(nx)},${q(nz)},${f.kind}`;
}

type Typed = Float32Array | Uint32Array | Int32Array;

/** A typed array that grows as it is filled (a chunk's faces push tens of thousands of numbers). */
class Grow<T extends Typed> {
	private a: T;
	n = 0;
	constructor(private readonly make: new (size: number) => T) {
		this.a = new make(1024);
	}
	add(x: number): this {
		if (this.n === this.a.length) {
			const next = new this.make(this.a.length * 2);
			next.set(this.a);
			this.a = next;
		}
		this.a[this.n++] = x;
		return this;
	}
	add3(x: number, y: number, z: number): this {
		return this.add(x).add(y).add(z);
	}
	/** What was added, in an array of its own size. */
	done(): T {
		return this.a.slice(0, this.n) as T;
	}
}

/** Collects one style's faces as triangles. */
class Faces {
	private pos = new Grow(Float32Array);
	private nor = new Grow(Float32Array);
	private col = new Grow(Float32Array);
	private idx = new Grow(Uint32Array);
	private own = new Grow(Int32Array);

	/** A face extruded along its profile; `free` says which ends taper to the edge. */
	add(f: Face, free: [boolean, boolean], cs: number): void {
		const rows = profile(f.kind, f.lo, f.hi, cs);
		const dx = f.x1 - f.x0;
		const dz = f.z1 - f.z0;
		const len = Math.hypot(dx, dz);
		if (len < 1e-9) return;
		const [tx, tz] = [dx / len, dz / len];
		const m = Math.max(1, Math.ceil(len / (COLUMN * cs) - 1e-6));
		const w = m + 1;
		const taperLength = (f.kind === FACE.stair || f.kind === FACE.side ? STAIR_TAPER : TAPER) * cs;
		// Each column's point on the edge, its outward normal (x, z) and its taper.
		const col = new Float64Array(w * 5);
		for (let j = 0; j < w; j++) {
			const t = j / m;
			const nx = f.n[0] + (f.n[2] - f.n[0]) * t;
			const nz = f.n[1] + (f.n[3] - f.n[1]) * t;
			const nl = Math.hypot(nx, nz) || 1;
			let taper = 1;
			if (free[0]) taper = Math.min(taper, (t * len) / taperLength);
			if (free[1]) taper = Math.min(taper, ((1 - t) * len) / taperLength);
			col[j * 5] = f.x0 + dx * t;
			col[j * 5 + 1] = f.z0 + dz * t;
			col[j * 5 + 2] = nx / nl;
			col[j * 5 + 3] = nz / nl;
			col[j * 5 + 4] = taper;
		}
		// Every vertex, rows down and columns along: x, y, z and its shade.
		const v = new Float64Array(rows.length * w * 4);
		for (let r = 0; r < rows.length; r++) {
			const row = rows[r];
			for (let j = 0; j < w; j++) {
				const x = col[j * 5];
				const z = col[j * 5 + 1];
				const back = row.noisy ? depthAt(x, row.y, z, cs) : row.back;
				const d = back * col[j * 5 + 4] * cs;
				const o = (r * w + j) * 4;
				v[o] = x - col[j * 5 + 2] * d;
				v[o + 1] = row.y;
				v[o + 2] = z - col[j * 5 + 3] * d;
				const shade = row.noisy
					? 0.95 - 0.3 * ((back - SET_BACK) / (DEEPEST - SET_BACK))
					: row.shade;
				v[o + 3] = shade * depthShade(row.y, cs);
			}
		}
		// The winding that faces out: the same for the whole face (its rows only lean back).
		const out = tz * (f.n[0] + f.n[2]) - tx * (f.n[1] + f.n[3]) > 0;
		for (let r = 0; r + 1 < rows.length; r++) {
			const flat = rows[r].y - rows[r + 1].y < 1e-9;
			if (flat && Math.abs(rows[r].back - rows[r + 1].back) < 1e-9) continue;
			const base = this.own.n;
			for (let k = r; k <= r + 1; k++)
				for (let j = 0; j < w; j++) {
					const o = (k * w + j) * 4;
					// The band's normal at this column: down its rows, crossed with along the edge.
					const top = (r * w + j) * 4;
					const foot = top + w * 4;
					const ux = v[foot] - v[top];
					const uy = v[foot + 1] - v[top + 1];
					const uz = v[foot + 2] - v[top + 2];
					const nx = uy * tz;
					const ny = uz * tx - ux * tz;
					const nz = -uy * tx;
					const outward = nx * col[j * 5 + 2] + nz * col[j * 5 + 3] < 0 ? -1 : 1;
					const nl = outward / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
					this.pos.add3(v[o], v[o + 1], v[o + 2]);
					// A stair's tread or coping (a level band) faces up, even where its end tapers shut.
					if (flat) this.nor.add3(0, 1, 0);
					else this.nor.add3(nx * nl, ny * nl, nz * nl);
					this.col.add3(v[o + 3], v[o + 3], v[o + 3]);
					this.own.add(f.owner);
				}
			for (let j = 0; j < m; j++) {
				const a = base + j;
				const c = a + w + 1;
				if (out) this.idx.add3(a, a + 1, c).add3(a, c, c - 1);
				else this.idx.add3(a, c, a + 1).add3(a, c - 1, c);
			}
		}
	}

	/** Plain geometry (the skirts between unexplored cells), shaded only by depth. */
	plain(mesh: GroundMesh, cs: number): void {
		const base = this.own.n;
		for (const v of mesh.positions) this.pos.add(v);
		for (const v of mesh.normals) this.nor.add(v);
		for (let v = 0; v < mesh.owners.length; v++) {
			const shade = depthShade(mesh.positions[v * 3 + 1], cs);
			this.col.add3(shade, shade, shade);
		}
		for (const o of mesh.owners) this.own.add(o);
		for (const i of mesh.indices) this.idx.add(base + i);
	}

	done(): CliffMesh {
		return {
			positions: this.pos.done(),
			normals: this.nor.done(),
			colors: this.col.done(),
			indices: this.idx.done(),
			owners: this.own.done()
		};
	}
}

/** The ground of one chunk with its cliffs and risers: tops, faces by style, the void's floor. */
export function chunkWorld(
	shape: WorldShape,
	chunk: number,
	chasm: Chasm = DEFAULT_CHASM
): ChunkWorld {
	const { grid } = shape;
	const cs = grid.cellSize;
	const faces: Face[] = [];
	const sink: WallSink = {
		wall(x0, z0, x1, z1, lo, hi, n, owner) {
			const f = { x0, z0, x1, z1, lo, hi, n, owner };
			faces.push({ ...f, kind: kindOf(shape, f) });
		}
	};
	// The cells a cell round the chunk make faces too, so ends across its edge join.
	const { top, sides: skirts, bottom } = chunkGround(shape, chunk, sink, 1, chasm);
	const ends = new Map<string, number>();
	const keys = faces.map((f) => [endKey(f, 0, cs), endKey(f, 1, cs)] as const);
	for (const pair of keys) for (const k of pair) ends.set(k, (ends.get(k) ?? 0) + 1);
	const across = chunksAcross(grid);
	const [cx, cy] = [(chunk % across.x) * CHUNK, Math.floor(chunk / across.x) * CHUNK];
	const out = CLIFF_STYLES.map(() => new Faces());
	out[0].plain(skirts, cs);
	faces.forEach((f, i) => {
		const [x, y] = [f.owner % grid.width, Math.floor(f.owner / grid.width)];
		if (x < cx || y < cy || x >= cx + CHUNK || y >= cy + CHUNK) return;
		if (f.kind === FACE.kit) return; // a kit piece or a bridge's side stands there (stairs.ts)
		const free: [boolean, boolean] = [ends.get(keys[i][0]) !== 2, ends.get(keys[i][1]) !== 2];
		out[styleOf(shape.floor[f.owner])].add(f, free, cs);
	});
	return { top, sides: out.map((b) => b.done()), bottom };
}

/**
 * Every chunk's ground with its cliffs, risers, bridges' bodies (#256, bridge-mesh.ts: the ground
 * leaves their sides to them) and the void's floor, as one mesh (for the harness).
 */
export function tableWorld(shape: WorldShape, chasm: Chasm = DEFAULT_CHASM): GroundMesh {
	const across = chunksAcross(shape.grid);
	const parts: GroundMesh[] = [];
	for (let c = 0; c < across.x * across.y; c++) {
		const { top, sides, bottom } = chunkWorld(shape, c, chasm);
		parts.push(top, ...sides, bottom, ...bridgeTrim(shape, c, chasm));
	}
	return joinMeshes(parts);
}
