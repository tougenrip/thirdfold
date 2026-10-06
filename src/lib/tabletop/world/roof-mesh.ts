// Roof geometry (#257, #258): each region's wings (its maximal rectangles, roofs.ts) as gable or
// hip prisms, the infill under them, and the kit's pieces on what shows of them: ridge and hip
// caps, chimneys (with their smoke sockets, #319) and dormers. Pure, in the lazy `world` chunk,
// the same on every client; docs/RENDERING.md "Roofs (#257)" and "Hips, caps, chimneys and
// dormers (#258)".
//
// - The roof is the upper envelope of its wings' prisms, drawn as they are (the depth test keeps
//   the highest): for a rectilinear outline at one pitch, the hip prisms of its maximal rectangles
//   meet exactly where a straight skeleton puts the hips and valleys (the height at a point is
//   its distance to the outline in the max norm), and gable prisms cross into cross-gables.
// - A piece goes only where its wing is the envelope (`onTop`), once per spot, so nothing buried
//   under another wing is drawn twice or pokes through.
// - Every choice is a hash of cell coordinates (`keySeed`), never of the region (which grows as a
//   player explores): a chimney is on a wing's ridge cell of lowest hash, when that hash is under
//   CHIMNEY_ODDS, so it stays put while the wing does.

import { FIGURE_CLEAR, type KitRoof } from '../../assets/kit';
import { STEP_HEIGHT, WALL_HEIGHT } from '../ground';
import { keySeed, variantOf } from './autotile';
import { MAX_RISE, type RoofRegion } from './roofs';
import type { WorldShape } from './shape';
import type { PieceMesh } from './wall-batch';

/** The kit's roof pieces this draws (`roof.eave` and `roof.corner` are whole slopes, not trims). */
export const ROOF_PIECE_ROLES = ['roof.ridge', 'roof.hip', 'roof.chimney', 'roof.dormer'] as const;
export type RoofPieceRole = (typeof ROOF_PIECE_ROLES)[number];
export interface RoofPiece {
	mesh: PieceMesh;
	weight: number;
	/** A chimney's smoke socket in its own frame (`KitPiece.sockets`). */
	smoke?: readonly [number, number, number];
}
export type RoofPieces = Partial<Record<RoofPieceRole, RoofPiece[]>>;

/** Ridge and hip caps: the pieces shrunk across the ridge by this, and lifted off the slopes. */
export const CAP_SCALE = 0.5;
const CAP_LIFT = 0.015;
/**
 * A ridge cell's odds of a chimney: a wing has one on its ridge cell of lowest hash when that is
 * under these odds, so about four in five six-cell houses do, fewer short ones.
 */
export const CHIMNEY_ODDS = 0.25;
/** How far down the slope from the ridge a chimney stands, in cells. */
const CHIMNEY_DOWN = 0.35;
/** The share of eave cells on a long slope with a dormer, and the run a slope needs for one. */
export const DORMER_ODDS = 0.3;
export const DORMER_RUN = 4;

/** One chunk's roofs as a mesh. `fogCells` is per vertex (x, y): its region's `fogCell`. */
export interface RoofMesh {
	positions: Float32Array;
	normals: Float32Array;
	/** Per vertex: 1 on the roof (the material's colour), a piece's baked colour over the tint. */
	colors: Float32Array;
	indices: Uint32Array;
	fogCells: Float32Array;
	/** Per vertex: its region's index in the list given (#259 fades by it). */
	region: Uint16Array;
	/** Each chimney's smoke socket, x y z in world units (#319). */
	smoke: Float32Array;
}

/** A wing as built: its axes (u along the ridge), walls, eave, pitch and heights, in world units. */
interface Wing {
	alongX: boolean;
	hip: boolean;
	u0: number;
	u1: number;
	v0: number;
	v1: number;
	U0: number;
	U1: number;
	V0: number;
	V1: number;
	mid: number;
	half: number;
	slope: number;
	eave: number;
	y0: number;
	top: number;
	/** The ridge's ends: the wall ends on a gable, half the depth in on a hip. */
	r0: number;
	r1: number;
}

/** The height of a wing's roof over (x, z), or -Infinity off it. */
function heightOn(g: Wing, x: number, z: number): number {
	const [u, v] = g.alongX ? [x, z] : [z, x];
	const e = g.eave + 1e-6;
	if (u < g.U0 - e || u > g.U1 + e || v < g.V0 - e || v > g.V1 + e) return -Infinity;
	let d = g.half - Math.abs(v - g.mid);
	if (g.hip) d = Math.min(d, (g.U1 - g.U0) / 2 - Math.abs(u - (g.U0 + g.U1) / 2));
	return g.y0 + d * g.slope;
}

/** Whether wing `g` is the top of its region's roof at (x, z). */
const onTop = (wings: readonly Wing[], g: Wing, x: number, z: number) =>
	wings.every((o) => o === g || heightOn(o, x, z) <= heightOn(g, x, z) + 1e-4);

/** A hash in [0, 1) of a cell and a purpose, the same on every client. */
const hashOf = (x: number, y: number, salt: number) =>
	(Math.imul(keySeed('c', x, y) ^ salt, 0x9e3779b1) >>> 0) / 0x100000000;

/**
 * The regions' roofs as one mesh, in world units. Each wing is a prism along its long axis: two
 * slopes out past the walls by the kit's eave (held so the eave stays over FIGURE_CLEAR), both
 * sides of each (the soffit seen from inside), closed at each end by a gable (`gable` kits) or a
 * hipped slope (`hip`); an infill band from a lower wall's top up to the eave; and the kit's
 * `pieces` where they show, their baked colours divided by `tint` (the roof material's linear
 * colour, which the material multiplies back).
 */
export function roofMesh(
	shape: WorldShape,
	regions: readonly RoofRegion[],
	roof: KitRoof,
	footprint: Uint8Array,
	pieces: RoofPieces = {},
	tint: readonly [number, number, number] = [1, 1, 1]
): RoofMesh {
	const { width: w, height: h, cellSize: cs } = shape.grid;
	const [pos, nor, col, fog, reg, idx, smoke]: number[][] = [[], [], [], [], [], [], []];
	const tan = Math.tan((roof.pitch * Math.PI) / 180);
	let region = 0;
	let cell = [0, 0];
	const vertex = (p: readonly number[], n: readonly number[], c: readonly number[]) => {
		pos.push(p[0], p[1], p[2]);
		nor.push(n[0], n[1], n[2]);
		col.push(c[0], c[1], c[2]);
		fog.push(cell[0], cell[1]);
		reg.push(region);
	};
	const quad = (a: number[], b: number[], c: number[], d: number[]) => {
		// Both sides of a b c d (a roof is seen from above and, from inside, below), each side's
		// normal from its own winding.
		const [ux, uy, uz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
		const [vx, vy, vz] = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
		let [nx, ny, nz] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
		const len = Math.hypot(nx, ny, nz) || 1;
		[nx, ny, nz] = [nx / len, ny / len, nz / len];
		for (const sign of [1, -1]) {
			const base = pos.length / 3;
			for (const p of [a, b, c, d]) vertex(p, [nx * sign, ny * sign, nz * sign], [1, 1, 1]);
			if (sign > 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
			else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
		}
	};
	/**
	 * A piece: its point `pivot` (kit units) put at `at`, turned `turns` quarters about y, scaled by
	 * the cell size times `size` (per axis, in its own frame).
	 */
	const put = (
		piece: RoofPiece,
		pivot: readonly number[],
		at: readonly number[],
		turns: number,
		size: readonly number[] = [1, 1, 1]
	) => {
		const [c, s] = [[1, 0, -1, 0][turns & 3], [0, 1, 0, -1][turns & 3]];
		const scale = size.map((k) => k * cs);
		const place = (x: number, y: number, z: number) => [
			at[0] + x * c + z * s,
			at[1] + y,
			at[2] - x * s + z * c
		];
		const { positions: P, normals: N, colors: C, indices } = piece.mesh;
		const base = pos.length / 3;
		for (let i = 0; i < P.length; i += 3) {
			const [x, y, z] = [0, 1, 2].map((k) => (P[i + k] - pivot[k]) * scale[k]);
			const [nx, ny, nz] = [0, 1, 2].map((k) => N[i + k] / scale[k]);
			const len = Math.hypot(nx, ny, nz) || 1;
			const colour = C ? [0, 1, 2].map((k) => C[i + k] / Math.max(tint[k], 1e-3)) : [1, 1, 1];
			vertex(
				place(x, y, z),
				place(nx / len, ny / len, nz / len).map((v, k) => v - at[k]),
				colour
			);
		}
		for (const i of indices) idx.push(base + i);
		if (piece.smoke) {
			const [x, y, z] = [0, 1, 2].map((k) => (piece.smoke![k] - pivot[k]) * scale[k]);
			smoke.push(...place(x, y, z));
		}
	};
	const pick = (role: RoofPieceRole, seed: number) => {
		const list = pieces[role];
		if (!list?.length) return null;
		const weights = list.map((p) => p.weight);
		return list[variantOf(seed, weights)];
	};
	// A ridge or hip piece's ridge is where a one-cell roof's is: half a cell up the kit's pitch.
	const apex = WALL_HEIGHT + 0.5 * tan;
	const X = (x: number) => (x - w / 2) * cs;
	const Z = (y: number) => (y - h / 2) * cs;
	for (const r of regions) {
		cell = [r.fogCell % w, Math.floor(r.fogCell / w)];
		const wings = r.rects.map((rect): Wing => {
			// Along x when at least as wide as deep; the ridge's axis is u, across it v.
			const alongX = rect.w >= rect.h;
			const [u0, u1] = alongX ? [rect.x, rect.x + rect.w] : [rect.y, rect.y + rect.h];
			const [v0, v1] = alongX ? [rect.y, rect.y + rect.h] : [rect.x, rect.x + rect.w];
			const [U0, U1] = alongX ? [X(u0), X(u1)] : [Z(u0), Z(u1)];
			const [V0, V1] = alongX ? [Z(v0), Z(v1)] : [X(v0), X(v1)];
			const half = (V1 - V0) / 2;
			const rise = Math.min(half * tan, MAX_RISE * WALL_HEIGHT * cs);
			const slope = rise / half;
			const eave = Math.min(roof.eave, (WALL_HEIGHT - FIGURE_CLEAR) / slope) * cs;
			const hip = roof.style === 'hip';
			const [r0, r1] = hip ? [U0 + half, U1 - half] : [U0, U1];
			const [mid, y0] = [(V0 + V1) / 2, r.eaveY];
			return {
				alongX,
				hip,
				u0,
				u1,
				v0,
				v1,
				U0,
				U1,
				V0,
				V1,
				mid,
				half,
				slope,
				eave,
				y0,
				top: y0 + rise,
				r0,
				r1
			};
		});
		for (const g of wings) prism(g, quad);
		infill(shape, r, footprint, quad, X, Z);
		dress(wings, footprint, w, cs, put, pick, apex);
		region++;
	}
	return {
		positions: Float32Array.from(pos),
		normals: Float32Array.from(nor),
		colors: Float32Array.from(col),
		indices: Uint32Array.from(idx),
		fogCells: Float32Array.from(fog),
		region: Uint16Array.from(reg),
		smoke: Float32Array.from(smoke)
	};
}

type Quad = (a: number[], b: number[], c: number[], d: number[]) => void;

/** A wing's slopes and ends: gables from the eave to the ridge, or hipped slopes to its ends. */
function prism(g: Wing, quad: Quad): void {
	const P = (u: number, y: number, v: number) => (g.alongX ? [u, y, v] : [v, y, u]);
	const { U0, U1, V0, V1, mid, eave, y0, top, r0, r1 } = g;
	const [ua, ub] = [U0 - eave, U1 + eave];
	const low = y0 - eave * g.slope;
	quad(P(ua, low, V0 - eave), P(r0, top, mid), P(r1, top, mid), P(ub, low, V0 - eave));
	quad(P(ub, low, V1 + eave), P(r1, top, mid), P(r0, top, mid), P(ua, low, V1 + eave));
	if (g.hip) {
		quad(P(ua, low, V1 + eave), P(r0, top, mid), P(r0, top, mid), P(ua, low, V0 - eave));
		quad(P(ub, low, V0 - eave), P(r1, top, mid), P(r1, top, mid), P(ub, low, V1 + eave));
	} else {
		// The gables, from the eave to the ridge (a quad with two corners at the ridge).
		quad(P(U0, y0, V1), P(U0, top, mid), P(U0, top, mid), P(U0, y0, V0));
		quad(P(U1, y0, V0), P(U1, top, mid), P(U1, top, mid), P(U1, y0, V1));
	}
}

type Put = (
	p: RoofPiece,
	pivot: readonly number[],
	at: readonly number[],
	turns: number,
	size?: readonly number[]
) => void;
type Pick = (role: RoofPieceRole, seed: number) => RoofPiece | null;

/**
 * A region's ridge and hip caps, chimneys and dormers, each only where its wing shows. Pivots
 * are in kit units: a cap's and a chimney's the one-cell ridge (`apex` up), a dormer's the eave
 * line of its wall (WALL_HEIGHT up, half a cell out).
 */
function dress(
	wings: readonly Wing[],
	footprint: Uint8Array,
	w: number,
	cs: number,
	put: Put,
	pick: Pick,
	apex: number
): void {
	const h = footprint.length / w;
	const done = new Set<string>();
	const xz = (g: Wing, u: number, v: number) => (g.alongX ? [u, v] : [v, u]);
	/** Puts a piece where its wing is the top of the roof, once per spot and role. */
	const place = (
		g: Wing,
		role: RoofPieceRole,
		[u, y, v]: readonly number[],
		pivot: readonly number[],
		turns: number,
		seed: number,
		cap?: readonly number[]
	) => {
		const [x, z] = xz(g, u, v);
		const key = `${role}:${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
		const piece = pick(role, seed);
		if (!piece || done.has(key) || !onTop(wings, g, x, z)) return false;
		done.add(key);
		put(piece, pivot, [x, y + (cap ? CAP_LIFT * cs : 0), z], turns, cap);
		return true;
	};
	const ridged = [0, apex, 0];
	for (const g of wings) {
		const turns = g.alongX ? 0 : 1;
		/** A seed from cell (u, v) of the wing (u, v in cells along and across its ridge). */
		const seed = (u: number, v: number, salt: number) => {
			const [x, y] = xz(g, u, v);
			return Math.floor(hashOf(x, y, salt) * 0x100000000);
		};
		const ridgeV = g.v0 + Math.floor((g.v1 - g.v0 - 1) / 2);
		/** A cell's centre along the ridge, and the cell under a point along it. */
		const U = (u: number) => g.U0 + (u - g.u0 + 0.5) * cs;
		const cellAt = (at: number) => g.u0 + Math.floor((at - g.U0) / cs);
		// Ridge caps, a cell each along the ridge; a hip's caps at its ends cover a ridge of none.
		for (let k = 0; k < Math.round((g.r1 - g.r0) / cs); k++) {
			const at = g.r0 + (k + 0.5) * cs;
			const where = [at, g.top, g.mid];
			place(g, 'roof.ridge', where, ridged, turns, seed(cellAt(at), ridgeV, 1), [
				1,
				CAP_SCALE,
				CAP_SCALE
			]);
		}
		if (g.hip) {
			// Hip caps down each hip, about half a cell apart, from the ridge's ends.
			const run = g.half + g.eave;
			const n = Math.max(1, Math.round((2 * run) / cs));
			for (const [end, du] of [
				[g.r0, -1],
				[g.r1, 1]
			] as const)
				for (const dv of [-1, 1])
					for (let k = 0; k < n; k++) {
						const t = (k * run) / n;
						const where = [end + du * t, g.top - t * g.slope, g.mid + dv * t];
						place(g, 'roof.hip', where, ridged, 0, seed(cellAt(end), ridgeV, 7 + k), [
							CAP_SCALE,
							CAP_SCALE,
							CAP_SCALE
						]);
					}
		}
		if (g.v1 - g.v0 < 2) continue; // a one-cell wing is too narrow for a chimney or dormer
		// A chimney on the ridge cell of lowest hash, when that hash is low enough.
		let chimney = -1;
		let best = CHIMNEY_ODDS;
		for (let u = g.u0; u < g.u1; u++) {
			const [x, y] = xz(g, u, ridgeV);
			const hash = hashOf(x, y, 2);
			if (U(u) >= g.r0 && U(u) <= g.r1 && hash < best) [chimney, best] = [u, hash];
		}
		if (chimney >= 0) {
			const down = (seed(chimney, ridgeV, 3) & 1 ? 1 : -1) * CHIMNEY_DOWN * cs;
			const where = [U(chimney), g.top - Math.abs(down) * g.slope, g.mid + down];
			if (!place(g, 'roof.chimney', where, ridged, turns, seed(chimney, ridgeV, 4))) chimney = -1;
		}
		// Dormers on a long slope, at its eave over an outer wall, clear of the chimney and the ends.
		if (g.u1 - g.u0 <= DORMER_RUN) continue;
		for (const side of [-1, 1]) {
			const vOut = side > 0 ? g.v1 : g.v0 - 1;
			const V = side > 0 ? g.V1 : g.V0;
			const turns = g.alongX ? (side > 0 ? 0 : 2) : side > 0 ? 1 : 3;
			let last = -Infinity;
			for (let u = g.u0 + 1; u < g.u1 - 1; u++) {
				const [ox, oy] = xz(g, u, vOut);
				const out = ox < 0 || oy < 0 || ox >= w || oy >= h || !footprint[oy * w + ox];
				if (!out || Math.abs(u - chimney) <= 1 || u - last <= 1) continue;
				const [x, y] = xz(g, u, side > 0 ? g.v1 - 1 : g.v0);
				if (hashOf(x, y, 5 + side) >= DORMER_ODDS) continue;
				const [px, pz] = xz(g, U(u), V - side * 0.25 * cs);
				if (!onTop(wings, g, px, pz)) continue;
				const where = [U(u), g.y0, V];
				if (place(g, 'roof.dormer', where, [0, WALL_HEIGHT, 0.5], turns, seed(u, vOut, 6)))
					last = u;
			}
		}
	}
}

/** Bands from each lower outer wall's top up to the region's eave, so no gap shows under the roof. */
function infill(
	shape: WorldShape,
	r: RoofRegion,
	footprint: Uint8Array,
	quad: Quad,
	X: (x: number) => number,
	Z: (y: number) => number
): void {
	const { width: w, height: h, cellSize: cs } = shape.grid;
	for (const i of r.cells) {
		const x = i % w;
		const y = (i - x) / w;
		const wall = (shape.levels[i] * STEP_HEIGHT + WALL_HEIGHT) * cs;
		if (wall >= r.eaveY - 1e-6) continue;
		const out = (nx: number, ny: number) =>
			nx < 0 || ny < 0 || nx >= w || ny >= h || !footprint[ny * w + nx];
		const [a, b] = [X(x), X(x + 1)];
		const [c, d] = [Z(y), Z(y + 1)];
		const top = r.eaveY;
		if (out(x, y - 1)) quad([b, wall, c], [b, top, c], [a, top, c], [a, wall, c]);
		if (out(x, y + 1)) quad([a, wall, d], [a, top, d], [b, top, d], [b, wall, d]);
		if (out(x - 1, y)) quad([a, wall, c], [a, top, c], [a, top, d], [a, wall, d]);
		if (out(x + 1, y)) quad([b, wall, d], [b, top, d], [b, top, c], [b, wall, c]);
	}
}
