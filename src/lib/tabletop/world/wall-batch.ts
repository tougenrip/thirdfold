// Wall pieces as instances (#252): autotile's pieces (autotile.ts) turned into
// the geometry each one draws and its matrix, for the walls' BatchedMeshes
// (walls.ts). Pure, in the lazy `world` chunk. A role the kit fills draws one
// of its variants (`variantOf` the piece's seed); a role it lacks draws the
// built-in procedural piece below, so a table always draws, with any kit.
//
// Matrices follow #250's pivots (src/lib/assets/kit.ts): an edge piece stands
// at the unit edge's midpoint, a post at its corner, turned by the piece's
// quarter turns and scaled by the cell size. Pieces whose height varies are
// scaled vertically: a retaining piece hangs from the higher floor down to the
// lower (authored for a drop of WALL_HEIGHT), a post runs from the lowest floor
// round its corner to the highest top (authored WALL_HEIGHT tall).

import {
	CAP_OVERHANG,
	POST_SIZE,
	STEP_HEIGHT,
	WALL_HALF_THIN,
	WALL_HEIGHT
} from '../../assets/kit';
import type { KitRole } from '../../assets/kit';
import { cornerToWorld, type SquareGrid } from '../../game/grid';
import { SITE, TILE_ROLES, variantOf, type WallPieces } from './autotile';

/** The roles instances draw: autotile's, and the cap a kit's walls may wear on top. */
export const BATCH_ROLES = [...TILE_ROLES, 'cap'] as const satisfies readonly KitRole[];
export type BatchRole = (typeof BATCH_ROLES)[number];
const CAP = BATCH_ROLES.indexOf('cap');
/** Pieces with a top: a kit's cap goes on them (a procedural one has its own). */
const TOPPED = new Set<string>(['wall.straight', 'wall.outer', 'wall.boundary']);
const RETAINING = TILE_ROLES.indexOf('wall.retaining');
const POSTS = new Set(
	['post.end', 'post.L', 'post.T', 'post.X'].map((r) => BATCH_ROLES.indexOf(r as BatchRole))
);

/** Variants per role: a piece's key is `role * VARIANTS + variant + 1`, 0 the procedural one. */
export const VARIANTS = 16;
export const pieceKey = (role: number, variant: number) => role * VARIANTS + variant + 1;
export const roleOfKey = (key: number) => BATCH_ROLES[Math.floor(key / VARIANTS)];

/** The weights of each variant of the roles a kit fills (`KitPiece.weight`, 1 when absent). */
export type KitWeights = Partial<Record<BatchRole, readonly number[]>>;

/** One chunk's instances, in autotile's order (a kit's cap after its wall). */
export interface WallInstances {
	count: number;
	/** `pieceKey` of what it draws. */
	key: Uint16Array;
	/**
	 * The unit edge it stands on, for highlights: a horizontal edge's `hEdge`, a vertical one's
	 * `vEdge` after them all (`edgeIndex`); -1 for a post.
	 */
	edge: Int32Array;
	/** Column-major 4x4 per instance. */
	matrices: Float32Array;
	/** The piece's seed (autotile's), for a stable tint. */
	seed: Uint32Array;
}

/** An edge's index in `WallInstances.edge`: horizontal edges first, then vertical. */
export function edgeIndex(grid: SquareGrid, axis: 'h' | 'v', x: number, y: number): number {
	return axis === 'h'
		? y * grid.width + x
		: grid.width * (grid.height + 1) + y * (grid.width + 1) + x;
}

export function wallInstances(p: WallPieces, grid: SquareGrid, kit: KitWeights): WallInstances {
	const cs = grid.cellSize;
	const capWeights = kit.cap;
	/** A kit's wall wears the kit's cap; a procedural wall has its own. */
	const capped = (role: number) =>
		!!capWeights && TOPPED.has(TILE_ROLES[role]) && !!kit[TILE_ROLES[role]];
	let n = p.count;
	for (let i = 0; i < p.count; i++) if (capped(p.role[i])) n++;
	const out: WallInstances = {
		count: n,
		key: new Uint16Array(n),
		edge: new Int32Array(n),
		matrices: new Float32Array(n * 16),
		seed: new Uint32Array(n)
	};
	let k = 0;
	for (let i = 0; i < p.count; i++) {
		const role = p.role[i];
		const name = TILE_ROLES[role];
		const weights = kit[name];
		const variant = weights ? variantOf(p.seed[i], weights) : -1;
		const site = p.site[i];
		const [x, y] = [p.x[i], p.y[i]];
		const c = cornerToWorld(grid, { x, y });
		const cx = c.x + (site === SITE.h ? cs / 2 : 0);
		const cz = c.z + (site === SITE.v ? cs / 2 : 0);
		const [y0, y1] = [p.y0[i], p.y1[i]];
		const stretched = role === RETAINING || POSTS.has(role);
		const sy = stretched ? (y1 - y0) / WALL_HEIGHT : cs;
		const edge = site === SITE.corner ? -1 : edgeIndex(grid, site === SITE.h ? 'h' : 'v', x, y);
		const place = (key: number) => {
			out.key[k] = key;
			out.edge[k] = edge;
			out.seed[k] = p.seed[i];
			compose(out.matrices, k * 16, cx, role === RETAINING ? y1 : y0, cz, p.rotation[i], cs, sy);
			k++;
		};
		place(pieceKey(role, variant));
		if (capped(role)) place(pieceKey(CAP, variantOf(p.seed[i], capWeights!)));
	}
	return out;
}

/** T(x, y, z) · Ry(r · π/2) · S(s, sy, s), column-major, at `o`: +z turns to (sin θ, 0, cos θ). */
function compose(
	m: Float32Array,
	o: number,
	x: number,
	y: number,
	z: number,
	r: number,
	s: number,
	sy: number
) {
	const c = [1, 0, -1, 0][r & 3];
	const n = [0, 1, 0, -1][r & 3];
	m.set([c * s, 0, -n * s, 0, 0, sy, 0, 0, n * s, 0, c * s, 0, x, y, z, 1], o);
}

/** A piece's geometry: positions and normals (3 a vertex) and triangles. */
export interface PieceMesh {
	positions: Float32Array;
	normals: Float32Array;
	indices: Uint32Array;
}

type Box = readonly [x0: number, y0: number, z0: number, x1: number, y1: number, z1: number];

/** Axis-aligned boxes as one mesh, each face its own four vertices (flat normals). */
export function boxes(list: readonly Box[]): PieceMesh {
	const positions: number[] = [];
	const normals: number[] = [];
	const indices: number[] = [];
	for (const [x0, y0, z0, x1, y1, z1] of list) {
		const ends = [
			[x0, y0, z0],
			[x1, y1, z1]
		];
		// A face per axis and side, wound round its normal: u × w is the axis (u, w cyclic after it).
		for (let a = 0; a < 3; a++)
			for (const side of [1, 0]) {
				const [u, w] = [(a + 1) % 3, (a + 2) % 3];
				const quad = side ? [0, 1, 3, 2] : [0, 2, 3, 1];
				const v = positions.length / 3;
				for (const q of quad) {
					const p = [0, 0, 0];
					p[a] = ends[side][a];
					p[u] = ends[q & 1][u];
					p[w] = ends[q >> 1][w];
					positions.push(...p);
					normals.push(...[0, 1, 2].map((k) => (k === a ? side * 2 - 1 : 0)));
				}
				indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
			}
	}
	return {
		positions: new Float32Array(positions),
		normals: new Float32Array(normals),
		indices: new Uint32Array(indices)
	};
}

const H = WALL_HEIGHT;
const T = WALL_HALF_THIN;
/** The procedural cap: a course `CAP_DEPTH` deep on the wall's top, overhanging both faces. */
const CAP_DEPTH = 0.12;
const O = T + CAP_OVERHANG;
const cap: Box = [-0.5, H - CAP_DEPTH, -O, 0.5, H, O];
const body = (y0: number, y1: number): Box => [-0.5, y0, -T, 0.5, y1, T];
/** A window's sill and lintel (wall-spans.ts' `SILL` and `LINTEL`), a door's lintel. */
const SILL = 0.35 * H;
const LINTEL = 0.8 * H;
const DOOR_TOP = 0.92 * H;
const P = POST_SIZE / 2;
/** A post stands a little over the caps, so their tops never meet in one plane. */
const POST_RISE = 0.04;

/**
 * The built-in piece for each role, in kit units (#250's pivots, at a cell size of 1): what draws
 * where a kit has no variant. Walls with their cap; a retaining piece a little behind the plinth's
 * face so the course shows (the cliff behind it is set back, cliffs.ts); posts over the caps.
 */
export function proceduralPiece(role: BatchRole): PieceMesh {
	switch (role) {
		case 'wall.straight':
		case 'wall.outer':
		case 'wall.boundary':
			return boxes([body(0, H - CAP_DEPTH), cap]);
		case 'wall.retaining':
			return boxes([[-0.5, -H, -T, 0.5, 0, T - 0.02]]);
		case 'plinth':
			return boxes([body(0, STEP_HEIGHT)]);
		case 'window.frame':
			return boxes([body(0, SILL), body(LINTEL, H - CAP_DEPTH), cap]);
		case 'window.sill':
			return boxes([body(0, SILL)]);
		case 'door.frame':
			return boxes([body(DOOR_TOP, H - CAP_DEPTH), cap]);
		case 'cap':
			return boxes([cap]);
		default: // the posts
			return boxes([[-P, 0, -P, P, H + POST_RISE, P]]);
	}
}

/** What `pieceOf` reads of a geometry: three's BufferGeometry has it (no import here). */
interface Attribute {
	count: number;
	getX(i: number): number;
	getY(i: number): number;
	getZ(i: number): number;
}
interface Geometry {
	getAttribute(name: 'position' | 'normal'): Attribute;
	getIndex(): Pick<Attribute, 'count' | 'getX'> | null;
}

/** A kit piece's parts (#252) as one mesh: positions, normals and triangles (made where none). */
export function pieceOf(parts: readonly Geometry[]): PieceMesh {
	const [positions, normals, indices]: number[][] = [[], [], []];
	for (const g of parts) {
		const [position, normal, index] = [
			g.getAttribute('position'),
			g.getAttribute('normal'),
			g.getIndex()
		];
		const base = positions.length / 3;
		for (let v = 0; v < position.count; v++) {
			positions.push(position.getX(v), position.getY(v), position.getZ(v));
			normals.push(normal.getX(v), normal.getY(v), normal.getZ(v));
		}
		const count = index ? index.count : position.count;
		for (let i = 0; i < count; i++) indices.push(base + (index ? index.getX(i) : i));
	}
	return {
		positions: new Float32Array(positions),
		normals: new Float32Array(normals),
		indices: new Uint32Array(indices)
	};
}
