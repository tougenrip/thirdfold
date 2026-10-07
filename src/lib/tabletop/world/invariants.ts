// The invariant harness (#239): what every world emitter's output must keep, so
// the picture never contradicts movement or sight and never draws toward
// unexplored ground. Test support, pure: an emitter hands over triangles in
// world units (positions, indices, the owning cell of each vertex) and
// `checkEmitter` names every place it breaks a rule. `referenceBoxes` is
// today's boxes from the world's shape, the emitter every later one is held
// beside (#240, #241 and #243 register theirs in the world specs).

import { decodeFloor, VOID } from '../../game/floor';
import { cornerToWorld, gridToWorld, type GridEdge, type SquareGrid } from '../../game/grid';
import { canStep, type SceneObject } from '../../game/objects';
import { decodeLevels } from '../../game/terrain';
import type { FogView } from '../../game/visibility';
import type { WorldLook } from '../../game/world';
import { chasmOf, chasmY } from './chasm';
import { dualCase, JOIN, tileHash, type DualMask } from './dual';
import { TOKEN_DISK } from '../../assets/kit';
import {
	CORNERS,
	EDGE_GROUND,
	groundObstacles,
	INTRUSION,
	knownOf,
	MAX_NOISE,
	MAX_ROUND,
	worldShape,
	type WorldShape
} from './shape';

export { checkWallPieces, type WallViolation } from './wall-invariants';

/** Triangles in world units: xyz per vertex, three indices per triangle, a cell (or -1) per vertex. */
export interface EmitterMesh {
	positions: Float32Array;
	indices: Uint32Array;
	owners: Int32Array;
}

export type Rule = 'disk' | 'intrusion' | 'cliff-top' | 'unexplored-face' | 'owner';

export interface Violation {
	rule: Rule;
	cell: number;
	detail: string;
}

/** Heights agree within this, in world units per unit of cell size. */
const EPS = 1e-4;
const RING = 8;

/** Every triangle bucketed by the cells its footprint covers, for vertical rays. */
class Index {
	private buckets: number[][];
	constructor(
		private readonly shape: WorldShape,
		readonly mesh: EmitterMesh
	) {
		const { width: w, height: h } = shape.grid;
		this.buckets = Array.from({ length: w * h }, () => []);
		const p = mesh.positions;
		for (let t = 0; t < mesh.indices.length; t += 3) {
			let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
			for (let k = 0; k < 3; k++) {
				const v = mesh.indices[t + k] * 3;
				x0 = Math.min(x0, p[v]);
				x1 = Math.max(x1, p[v]);
				z0 = Math.min(z0, p[v + 2]);
				z1 = Math.max(z1, p[v + 2]);
			}
			const [cx0, cy0] = this.cellOf(x0, z0);
			const [cx1, cy1] = this.cellOf(x1, z1);
			for (let y = cy0; y <= cy1; y++)
				for (let x = cx0; x <= cx1; x++) this.buckets[y * w + x].push(t);
		}
	}

	private cellOf(x: number, z: number): [number, number] {
		const { width: w, height: h, cellSize: cs } = this.shape.grid;
		const clamp = (v: number, n: number) => Math.min(Math.max(Math.floor(v), 0), n - 1);
		return [clamp(x / cs + w / 2, w), clamp(z / cs + h / 2, h)];
	}

	/** Triangles over a cell. */
	near(cell: number): readonly number[] {
		return this.buckets[cell];
	}

	/** The highest surface straight below (x, z) from above, or -Infinity where there is none. */
	top(x: number, z: number): number {
		const [cx, cy] = this.cellOf(x, z);
		const p = this.mesh.positions;
		const ix = this.mesh.indices;
		let best = -Infinity;
		for (const t of this.buckets[cy * this.shape.grid.width + cx]) {
			const a = ix[t] * 3;
			const b = ix[t + 1] * 3;
			const c = ix[t + 2] * 3;
			const d = (p[b] - p[a]) * (p[c + 2] - p[a + 2]) - (p[c] - p[a]) * (p[b + 2] - p[a + 2]);
			if (Math.abs(d) < 1e-12) continue; // vertical: a ray down misses it
			const u = ((x - p[a]) * (p[c + 2] - p[a + 2]) - (p[c] - p[a]) * (z - p[a + 2])) / d;
			const v = ((p[b] - p[a]) * (z - p[a + 2]) - (x - p[a]) * (p[b + 2] - p[a + 2])) / d;
			if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
			best = Math.max(best, p[a + 1] + u * (p[b + 1] - p[a + 1]) + v * (p[c + 1] - p[a + 1]));
		}
		return best;
	}
}

const known = (s: WorldShape, i: number) => !s.known || s.known[i] === 1;

/** Sample points of a disk of `radius` (world units) round (x, z): its centre and two rings. */
function disk(x: number, z: number, radius: number): [number, number][] {
	const points: [number, number][] = [[x, z]];
	for (const r of [radius / 2, radius])
		for (let k = 0; k < RING; k++) {
			const a = ((k + 0.5) / RING) * Math.PI * 2;
			points.push([x + r * Math.cos(a), z + r * Math.sin(a)]);
		}
	return points;
}

/** Each unit edge of the grid with the one or two cells beside it. */
function* edges(s: WorldShape): Generator<{ e: GridEdge; cls: number; cells: number[] }> {
	const { width: w, height: h } = s.grid;
	for (let y = 0; y <= h; y++)
		for (let x = 0; x < w; x++)
			yield {
				e: { a: { x, y }, b: { x: x + 1, y } },
				cls: s.edges.ground.h[y * w + x],
				cells: [y - 1, y].filter((r) => r >= 0 && r < h).map((r) => r * w + x)
			};
	for (let y = 0; y < h; y++)
		for (let x = 0; x <= w; x++)
			yield {
				e: { a: { x, y }, b: { x, y: y + 1 } },
				cls: s.edges.ground.v[y * (w + 1) + x],
				cells: [x - 1, x].filter((c) => c >= 0 && c < w).map((c) => y * w + c)
			};
}

/**
 * Where `ground` (and optional `decorations`) break the world's rules:
 * - disk: a known walkable cell's surface is not flat at its floor over TOKEN_DISK;
 * - intrusion: something between the floor and `clear` over it is within TOKEN_DISK - `allowance`;
 * - cliff-top: a step or cliff's top is not at the higher floor, or has a lip above it;
 * - unexplored-face: a face that is not flat lies along an edge with an unexplored side;
 * - owner: a vertex owned by no cell on the table.
 */
export function checkEmitter(
	shape: WorldShape,
	ground: EmitterMesh,
	decorations: EmitterMesh | null = null,
	{ allowance = INTRUSION, clear = Infinity } = {}
): Violation[] {
	const out: Violation[] = [];
	const { grid } = shape;
	const cs = grid.cellSize;
	const eps = EPS * cs;
	const index = new Index(shape, ground);
	const deco = decorations && new Index(shape, decorations);
	const n = grid.width * grid.height;

	for (const mesh of decorations ? [ground, decorations] : [ground])
		for (let v = 0; v < mesh.owners.length; v++)
			if (mesh.owners[v] < -1 || mesh.owners[v] >= n)
				out.push({ rule: 'owner', cell: mesh.owners[v], detail: `vertex ${v}` });

	for (let i = 0; i < n; i++) {
		if (!known(shape, i) || shape.floor[i] === VOID) continue;
		const cell = { x: i % grid.width, y: Math.floor(i / grid.width) };
		const c = gridToWorld(grid, cell);
		const floor = shape.ground.floorY(cell);
		for (const [x, z] of disk(c.x, c.z, TOKEN_DISK * cs)) {
			const top = index.top(x, z);
			if (Math.abs(top - floor) > eps) {
				out.push({ rule: 'disk', cell: i, detail: `top ${top} at ${x},${z}, floor ${floor}` });
				break;
			}
		}
		if (!deco) continue;
		const reach = (TOKEN_DISK - allowance) * cs - eps;
		for (const t of deco.near(i)) {
			const high = above(decorations!, t, floor + clear * cs - eps, true);
			if (
				!high &&
				above(decorations!, t, floor + eps) &&
				distanceTo(decorations!, t, c.x, c.z) < reach
			) {
				out.push({ rule: 'intrusion', cell: i, detail: `triangle ${t / 3}, floor ${floor}` });
				break;
			}
		}
	}

	const inset = (MAX_NOISE + 0.01) * cs;
	const band = MAX_NOISE * cs + eps;
	for (const { e, cls, cells } of edges(shape)) {
		const p = cornerToWorld(grid, e.a);
		const q = cornerToWorld(grid, e.b);
		const [ux, uz] = [(q.x - p.x) / cs, (q.z - p.z) / cs];
		if (cells.some((i) => !known(shape, i))) {
			const owner = cells.find((i) => !known(shape, i))!;
			for (const t of new Set(cells.flatMap((i) => [...index.near(i)]))) {
				if (onEdge(ground, t, p, q, band, eps)) {
					out.push({ rule: 'unexplored-face', cell: owner, detail: `triangle ${t / 3}` });
					break;
				}
			}
			continue;
		}
		if (cls !== EDGE_GROUND.step && cls !== EDGE_GROUND.cliff) continue;
		const [lo, hi] = cells.map((i) => shape.levels[i]);
		const high = cells[hi > lo ? 1 : 0];
		const highY = Math.max(
			...cells.map((i) => shape.ground.floorY({ x: i % grid.width, y: Math.floor(i / grid.width) }))
		);
		// The normal across the edge, pointing into the higher cell.
		const into = high === cells[1] ? 1 : -1;
		const [nx, nz] = [uz * into, ux * into];
		for (const t of [MAX_ROUND + 0.01, 0.5, 1 - MAX_ROUND - 0.01]) {
			const ex = p.x + (q.x - p.x) * t;
			const ez = p.z + (q.z - p.z) * t;
			const at = (o: number) => index.top(ex + nx * o, ez + nz * o);
			const lip = [-inset, -inset / 2, inset / 2, inset].some((o) => at(o) > highY + eps);
			if (lip || Math.abs(at(inset) - highY) > eps) {
				out.push({
					rule: 'cliff-top',
					cell: high,
					detail: `at t ${t}, top ${at(inset)} vs ${highY}`
				});
				break;
			}
		}
	}
	return out;
}

/** Whether any (or, with `all`, every) vertex of triangle t stands above `y`. */
function above(mesh: EmitterMesh, t: number, y: number, all = false): boolean {
	return [0, 1, 2][all ? 'every' : 'some']((k) => mesh.positions[mesh.indices[t + k] * 3 + 1] > y);
}

/** The distance in plan from (x, z) to triangle t (0 inside it). */
function distanceTo(mesh: EmitterMesh, t: number, x: number, z: number): number {
	const p = [0, 1, 2].map((k) => {
		const v = mesh.indices[t + k] * 3;
		return [mesh.positions[v], mesh.positions[v + 2]];
	});
	const side = (a: number[], b: number[]) =>
		(b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
	const s = [side(p[0], p[1]), side(p[1], p[2]), side(p[2], p[0])];
	const area =
		(p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
	// A face standing upright is a segment in plan: only its edges count.
	if (area !== 0 && (s.every((v) => v >= 0) || s.every((v) => v <= 0))) return 0;
	let best = Infinity;
	for (let k = 0; k < 3; k++) {
		const [a, b] = [p[k], p[(k + 1) % 3]];
		const [lx, lz] = [b[0] - a[0], b[1] - a[1]];
		const len = lx * lx + lz * lz;
		const u = len ? Math.max(0, Math.min(1, ((x - a[0]) * lx + (z - a[1]) * lz) / len)) : 0;
		best = Math.min(best, Math.hypot(x - a[0] - lx * u, z - a[1] - lz * u));
	}
	return best;
}

/** Whether triangle t is a face that isn't flat, lying within `band` of segment pq. */
function onEdge(
	mesh: EmitterMesh,
	t: number,
	p: { x: number; z: number },
	q: { x: number; z: number },
	band: number,
	eps: number
): boolean {
	const pos = mesh.positions;
	let y0 = Infinity;
	let y1 = -Infinity;
	for (let k = 0; k < 3; k++) {
		const v = mesh.indices[t + k] * 3;
		const [x, y, z] = [pos[v], pos[v + 1], pos[v + 2]];
		y0 = Math.min(y0, y);
		y1 = Math.max(y1, y);
		const lx = q.x - p.x;
		const lz = q.z - p.z;
		const s = Math.max(0, Math.min(1, ((x - p.x) * lx + (z - p.z) * lz) / (lx * lx + lz * lz)));
		if (Math.hypot(x - (p.x + lx * s), z - (p.z + lz * s)) > band) return false;
	}
	return y1 - y0 > eps;
}

/**
 * Today's boxes, from the world's shape: every cell's top at its floor, and a
 * side face where a known cell stands above a known neighbour (or the table's
 * edge), down to the lower floor (or 0). Nothing is drawn toward unexplored ground.
 */
export function referenceBoxes(shape: WorldShape): EmitterMesh {
	const { grid } = shape;
	const { width: w, height: h } = grid;
	const pos: number[] = [];
	const idx: number[] = [];
	const own: number[] = [];
	const quad = (cell: number, corners: [number, number, number][]) => {
		const base = own.length;
		for (const c of corners) {
			pos.push(...c);
			own.push(cell);
		}
		idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
	};
	const floorOf = (i: number) => shape.ground.floorY({ x: i % w, y: Math.floor(i / w) });
	// The four sides: the neighbour's offset, then the side's corners as offsets from the cell's.
	const sides = [
		{ dx: 0, dy: -1, a: [0, 0], b: [1, 0] },
		{ dx: 1, dy: 0, a: [1, 0], b: [1, 1] },
		{ dx: 0, dy: 1, a: [1, 1], b: [0, 1] },
		{ dx: -1, dy: 0, a: [0, 1], b: [0, 0] }
	];
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			const top = floorOf(i);
			const corner = (ox: number, oy: number) => cornerToWorld(grid, { x: x + ox, y: y + oy });
			const [c00, c10, c11, c01] = [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)];
			quad(i, [
				[c00.x, top, c00.z],
				[c01.x, top, c01.z],
				[c11.x, top, c11.z],
				[c10.x, top, c10.z]
			]);
			if (!known(shape, i)) continue;
			for (const s of sides) {
				const nx = x + s.dx;
				const ny = y + s.dy;
				const border = nx < 0 || ny < 0 || nx >= w || ny >= h;
				const j = ny * w + nx;
				const cls = border
					? EDGE_GROUND.border
					: s.dx
						? shape.edges.ground.v[y * (w + 1) + Math.max(x, nx)]
						: shape.edges.ground.h[Math.max(y, ny) * w + x];
				const low = border ? 0 : floorOf(j);
				if (cls === EDGE_GROUND.flat || low >= top) continue;
				const a = corner(s.a[0], s.a[1]);
				const b = corner(s.b[0], s.b[1]);
				quad(i, [
					[a.x, top, a.z],
					[b.x, top, b.z],
					[b.x, low, b.z],
					[a.x, low, a.z]
				]);
			}
		}
	}
	return {
		positions: new Float32Array(pos),
		indices: new Uint32Array(idx),
		owners: new Int32Array(own)
	};
}

/**
 * Where the continued maps break the continuation rule: an edge with an
 * unexplored side that isn't flat (or the table's border); within a tile, a
 * change between sectors that isn't on a known-known half edge, between two
 * unexplored corners, or on an unexplored corner's diagonal; between tiles, a
 * change on their shared side that isn't inside an unexplored cell.
 */
export function checkContinuation(shape: WorldShape): string[] {
	const out: string[] = [];
	const { width: w, height: h } = shape.grid;
	const k = (x: number, y: number) =>
		known(shape, Math.min(Math.max(y, 0), h - 1) * w + Math.min(Math.max(x, 0), w - 1));
	for (const { e, cls, cells } of edges(shape)) {
		if (cls === EDGE_GROUND.border || cells.every((i) => known(shape, i))) continue;
		if (cls !== EDGE_GROUND.flat) out.push(`edge ${e.a.x},${e.a.y}-${e.b.x},${e.b.y} is ${cls}`);
	}
	// Between sector s and s + 1: a corner's diagonal (its index), or the half
	// edge between two corners: 0|1 NE's diagonal, 1|2 east (NE, SE), 2|3 SE's
	// diagonal, 3|4 south (SE, SW), 4|5 SW's, 5|6 west (SW, NW), 6|7 NW's, 7|0 north (NW, NE).
	const BETWEEN: (number[] | number)[] = [1, [1, 2], 2, [2, 3], 3, [3, 0], 0, [0, 1]];
	for (const tiles of [shape.tiles.levels, shape.tiles.floor]) {
		for (let ty = 0; ty <= h; ty++) {
			for (let tx = 0; tx <= w; tx++) {
				const base = (ty * (w + 1) + tx) * 8;
				const corner = [k(tx - 1, ty - 1), k(tx, ty - 1), k(tx, ty), k(tx - 1, ty)];
				for (let s = 0; s < 8; s++) {
					if (tiles[base + s] === tiles[base + ((s + 1) & 7)]) continue;
					const across = BETWEEN[s];
					const ok = Array.isArray(across)
						? corner[across[0]] === corner[across[1]]
						: !corner[across];
					if (!ok) out.push(`tile ${tx},${ty} sectors ${s}|${(s + 1) & 7}`);
				}
				// The shared sides with the tiles to the north and east.
				const pairs: [number, number, number, boolean][] = [];
				if (ty > 0) {
					const up = ((ty - 1) * (w + 1) + tx) * 8;
					pairs.push([base + 7, up + 4, 0, corner[0]], [base + 0, up + 3, 1, corner[1]]);
				}
				if (tx < w) {
					const right = (ty * (w + 1) + tx + 1) * 8;
					pairs.push([base + 1, right + 6, 1, corner[1]], [base + 2, right + 5, 2, corner[2]]);
				}
				for (const [a, b, , isKnown] of pairs)
					if (tiles[a] !== tiles[b] && isKnown) out.push(`tiles ${tx},${ty} side ${a - base}`);
			}
		}
	}
	return out;
}

/**
 * Every saddle of a shape under every mask (walkable, land, each level band),
 * checked against `canStep` on ground-only obstacles: a pair joins only if it
 * connects, the inside (higher) pair whenever it does, and a pinch only where
 * neither does; land and water by the tile's hash.
 */
export function saddleProblems(shape: WorldShape): { problems: string[]; count: number } {
	const problems: string[] = [];
	let count = 0;
	const { width: w, height: h } = shape.grid;
	const obstacles = groundObstacles(shape);
	const top = shape.levels.reduce((m, l) => Math.max(m, l), 0);
	const masks: DualMask[] = ['walkable', 'land', ...Array.from({ length: top }, (_, l) => l + 1)];
	for (let ty = 1; ty < h; ty++) {
		for (let tx = 1; tx < w; tx++) {
			const cells = CORNERS.map(({ dx, dy }) => ({ x: tx + dx, y: ty + dy }));
			if (!cells.every((c) => known(shape, c.y * w + c.x))) continue;
			const joins = (p: number, q: number) =>
				canStep(obstacles, cells[p], cells[q]) && canStep(obstacles, cells[q], cells[p]);
			for (const mask of masks) {
				const { corners, join } = dualCase(shape, tx, ty, mask);
				if (corners !== 5 && corners !== 10) continue;
				count++;
				const [a, b] = corners === 5 ? [0, 2] : [1, 3];
				const inside = joins(a, b);
				const outside = joins(a + 1, (b + 1) & 3);
				const want =
					mask === 'land'
						? tileHash(tx, ty)
							? JOIN.in
							: JOIN.out
						: inside
							? JOIN.in
							: outside
								? JOIN.out
								: JOIN.pinch;
				if (join !== want) problems.push(`tile ${tx},${ty} mask ${mask}: ${join}, not ${want}`);
				if (mask === 'walkable' && join !== JOIN.pinch)
					problems.push(`tile ${tx},${ty}: walkable ground joins across the void`);
			}
		}
	}
	return { problems, count };
}

/** What a viewer was sent of a table, as the fixtures' views hold it. */
export interface SentTable {
	grid: SquareGrid;
	terrain: string | null;
	floor: string | null;
	objects: SceneObject[];
	fog: FogView;
	world: WorldLook;
}

/**
 * For the unexplored-is-black test (#243): whether the picture at a cell's centre on the plane
 * y = 0, seen from `eye`, may show something past it. Only a cell the viewer's ground continues as
 * void is a hole there: the ray falls on into it down to the chasm's floor, and if on the way it
 * passes over a cell `shown` says the viewer was shown (or off the table), the sample may see that.
 */
export function pastHole(sent: SentTable, shown: (i: number) => boolean) {
	const { grid } = sent;
	const { width: w, height: h, cellSize: cs } = grid;
	const n = w * h;
	const shape = worldShape({
		grid,
		levels: sent.terrain ? decodeLevels(sent.terrain, n) : null,
		floor: sent.floor ? decodeFloor(sent.floor, n) : null,
		objects: sent.objects,
		known: knownOf(grid, sent.fog, false)
	});
	const depth = chasmY(chasmOf(sent.world.backdrop), cs);
	return (i: number, eye: { x: number; y: number; z: number }): boolean => {
		if (shape.floor[i] !== VOID) return false;
		const at = gridToWorld(grid, { x: i % w, y: Math.floor(i / w) });
		const d = [at.x - eye.x, -eye.y, at.z - eye.z];
		const step = cs / 8 / Math.hypot(d[0], d[1], d[2]);
		for (let s = step; d[1] * s >= depth; s += step) {
			const [x, z] = [at.x + d[0] * s, at.z + d[2] * s];
			const [cx, cy] = [Math.floor(x / cs + w / 2), Math.floor(z / cs + h / 2)];
			if (cx < 0 || cy < 0 || cx >= w || cy >= h || shown(cy * w + cx)) return true;
		}
		return false;
	};
}
