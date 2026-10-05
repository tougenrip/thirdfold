// Stairs (milestone 70, #255): every stair run the world's shape finds
// (regions.ts, #239) built as steps, from what the viewer was sent. Pure (no
// three.js), the same on every client, tier and backend; specs in the server
// project. docs/RENDERING.md, "Stairs", is the contract.
//
// - The ground draws the steps (cliffs.ts): each riser of a run becomes a
//   stair step, two half steps a level whose narrow tread lies over the lower
//   cell's edge band, and each side of a step down to a lower neighbour a
//   stringer. Each cell's top stays at its floor across its token disk: the
//   rules' levels and `canStep` are untouched, and picking stays the DDA's.
// - Rails stand where a man-made step's side drops two levels or more (or to
//   the void); hewn and earthen steps get a kerb there, walled sides nothing,
//   and a bridge's sides are #256's. They are drawn here (`stairTrim`), in the
//   faces' meshes.
// - A kit (#250) with `stair.riser`, `stair.side` or `railing` pieces takes
//   those places (a piece's `model`), and the ground leaves the edge to it.
// - Only known cells make a run, a side or a rail, and an unexplored neighbour
//   continues the stair (no side, rail or drop toward it).

import type { KitDef, KitPiece } from '../../assets/kit';
import { VOID } from '../../game/floor';
import { STEP_HEIGHT, WALL_HEIGHT } from '../ground';
import { keySeed, variantOf } from './autotile';
import type { CliffMesh } from './cliffs';
import { MAN_MADE } from './floors';
import { DIRS, regionsOf } from './regions';
import {
	CHUNK,
	chunksAcross,
	EDGE_BUILT,
	slotBetween,
	STAIR_EDGE,
	type EdgeMap,
	type StairMarks,
	type WorldShape
} from './shape';

/** What stands at a stair's edge: a kit role, or a kerb (procedural only). */
export type StairRole = 'stair.riser' | 'stair.side' | 'railing' | 'kerb';

export interface StairPiece {
	role: StairRole;
	/** The cell it belongs to: a riser's upper cell, else the step. */
	cell: number;
	/** The cell across its edge: a riser's lower cell, else the side's neighbour. */
	across: number;
	/** Where its +z face looks (a `DIRS` index): down the stair, or out over the side. */
	dir: number;
	/** Levels down to the floor across the edge; null for the void. */
	drop: number | null;
	/** The kit's model for it, or null: drawn procedurally. */
	model: string | null;
}

export interface Stairs extends StairMarks {
	pieces: StairPiece[];
}

export interface StairOptions {
	/** The environment's kit; null (or none of the stair roles) draws every piece procedurally. */
	kit?: KitDef | null;
	/** Whether the environment's default ground is built (`builtGround`): its stairs get rails. */
	built?: boolean;
}

/**
 * The environments whose default ground is built, not earth: their plain-floored stairs are
 * masonry and get rails. ponytail: an id list until environments say it themselves (#248's floor
 * styles); add one here when its plain ground is paved or planked.
 */
const BUILT_GROUND: ReadonlySet<string> = new Set(['stone-halls', 'railcar']);
export const builtGround = (environment: string | null | undefined): boolean =>
	BUILT_GROUND.has(environment ?? '');

/** Faces' meshes by `CLIFF_STYLES` index (cliffs.ts): earth, masonry. */
const EARTH = 0;
const MASONRY = 1;

const PLAIN_FLOOR = 0;
/** The most levels a `stair.side` piece reaches down (its envelope's −H). */
const SIDE_LEVELS = Math.round(WALL_HEIGHT / STEP_HEIGHT);

/** The stairs of a shape: their marks for the ground and their pieces. */
export function stairsOf(
	shape: WorldShape,
	{ kit = null, built = false }: StairOptions = {}
): Stairs {
	const { grid, known, levels, floor } = shape;
	const { width: w, height: h } = grid;
	const n = w * h;
	const edges: EdgeMap = {
		h: new Uint8Array(w * (h + 1)),
		v: new Uint8Array((w + 1) * h)
	};
	const steps = new Uint8Array(n);
	const pieces: StairPiece[] = [];
	const { stairs: runs, oneWide } = regionsOf(shape);
	const isKnown = (i: number) => !known || known[i] === 1;
	const neighbour = (i: number, d: number) => {
		const x = (i % w) + DIRS[d].dx;
		const y = Math.floor(i / w) + DIRS[d].dy;
		return x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x;
	};
	const walled = (i: number, j: number) => {
		const { axis, index } = slotBetween(grid, i, j);
		return shape.edges.built[axis][index] !== EDGE_BUILT.none;
	};
	// A bridge: one wide with a drop on both sides and neither walled (a stair along a wall, like
	// the gallery's, is not one). Its sides are #256's balustrades.
	const bridge = new Uint8Array(n);
	for (const r of oneWide)
		for (const i of r.cells) {
			const sides = r.along === 'x' ? [0, 2] : [1, 3];
			if (sides.every((d) => neighbour(i, d) < 0 || !walled(i, neighbour(i, d)))) bridge[i] = 1;
		}
	const pick = (role: StairRole, i: number, j: number): string | null => {
		const list: KitPiece[] | undefined =
			role === 'kerb' ? undefined : kit?.pieces[role as Exclude<StairRole, 'kerb'>];
		if (!list?.length) return null;
		const { axis, index } = slotBetween(grid, i, j);
		const across = axis === 'h' ? w : w + 1;
		const seed = keySeed(axis, index % across, Math.floor(index / across));
		return list[
			variantOf(
				seed,
				list.map((p) => p.weight ?? 1)
			)
		].model;
	};
	const place = (
		role: StairRole,
		cell: number,
		across: number,
		dir: number,
		drop: number | null
	) => {
		const model = pick(role, cell, across);
		pieces.push({ role, cell, across, dir, drop, model });
		if (role !== 'stair.riser' && role !== 'stair.side') return;
		const { axis, index } = slotBetween(grid, cell, across);
		edges[axis][index] = model
			? STAIR_EDGE.kit
			: role === 'stair.riser'
				? STAIR_EDGE.riser
				: STAIR_EDGE.side;
	};

	// Risers first, so a side never takes an edge a run climbs.
	const riser = new Set<number>();
	const slotKey = (i: number, j: number) => {
		const { axis, index } = slotBetween(grid, i, j);
		return axis === 'h' ? index : -1 - index;
	};
	for (const run of runs) {
		for (let k = 1; k < run.cells.length; k++) {
			const [lower, upper] = [run.cells[k - 1], run.cells[k]];
			if (riser.has(slotKey(lower, upper))) continue;
			riser.add(slotKey(lower, upper));
			place('stair.riser', upper, lower, (run.dir + 2) & 3, 1);
		}
		for (let k = 1; k + 1 < run.cells.length; k++) steps[run.cells[k]] = 1;
	}
	// Each step's sides: a stringer down to a lower known neighbour, and a rail or kerb on a drop.
	const sided = new Set<number>();
	for (const run of runs)
		for (let k = 1; k + 1 < run.cells.length; k++) {
			const s = run.cells[k];
			if (bridge[s]) continue; // a bridge's sides are #256's
			for (const d of [(run.dir + 1) & 3, (run.dir + 3) & 3]) {
				const j = neighbour(s, d);
				if (j < 0 || !isKnown(j)) continue;
				const key = slotKey(s, j);
				if (riser.has(key) || sided.has(key)) continue;
				if (walled(s, j)) continue;
				const toVoid = floor[j] === VOID;
				const drop = toVoid ? null : levels[s] - levels[j];
				if (drop !== null && drop < 1) continue;
				sided.add(key);
				if (drop !== null) {
					// A drop deeper than its envelope stays the ground's cliff.
					if (drop <= SIDE_LEVELS || !kit?.pieces['stair.side']?.length)
						place('stair.side', s, j, d, drop);
				}
				if (drop === null || drop >= 2) {
					const manMade = MAN_MADE.has(floor[s]) || (floor[s] === PLAIN_FLOOR && built);
					place(manMade ? 'railing' : 'kerb', s, j, d, drop);
				}
			}
		}
	return { edges, steps, pieces };
}

/** The shape with its stairs, which the ground (ground-mesh.ts, cliffs.ts) then draws. */
export function withStairs(
	shape: WorldShape,
	options: StairOptions = {}
): WorldShape & { stairs: Stairs } {
	return { ...shape, stairs: stairsOf(shape, options) };
}

/** A box's parts, in units of the cell, about a piece's pivot: x along the edge, +z out over it. */
type Box = [x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, shade: number];

/** A kerb: a low course along the edge. */
const KERB: Box[] = [[-0.5, 0.5, 0, 0.1, -0.05, 0.05, 1.1]];
/** A balustrade: a plinth, four balusters and a handrail, all within ±0.05 of the edge. */
const RAIL: Box[] = [
	[-0.5, 0.5, 0, 0.08, -0.05, 0.05, 0.9],
	...[-0.375, -0.125, 0.125, 0.375].map((x): Box => [
		x - 0.03,
		x + 0.03,
		0.08,
		0.8,
		-0.03,
		0.03,
		1
	]),
	[-0.5, 0.5, 0.8, 0.9, -0.05, 0.05, 1.2]
];

/** A box's six sides, each by its corners (bits: x 1, y 2, z 4) and its outward normal. */
const SIDES: [number[], [number, number, number]][] = [
	[
		[0, 2, 6, 4],
		[-1, 0, 0]
	],
	[
		[1, 5, 7, 3],
		[1, 0, 0]
	],
	[
		[0, 4, 5, 1],
		[0, -1, 0]
	],
	[
		[2, 3, 7, 6],
		[0, 1, 0]
	],
	[
		[0, 1, 3, 2],
		[0, 0, -1]
	],
	[
		[4, 6, 7, 5],
		[0, 0, 1]
	]
];

/**
 * The rails and kerbs of a chunk's steps drawn procedurally (no kit piece), as meshes by
 * `CLIFF_STYLES` index: rails masonry, kerbs earth. The world layer adds them to the faces'
 * meshes; the harness checks them as decorations, clear of every token's disk.
 */
export function stairTrim(shape: WorldShape, chunk: number): CliffMesh[] {
	const { grid } = shape;
	const { width: w, height: h, cellSize: cs } = grid;
	const across = chunksAcross(grid);
	const [cx, cy] = [(chunk % across.x) * CHUNK, Math.floor(chunk / across.x) * CHUNK];
	const out = [new Trim(), new Trim()];
	for (const p of (shape.stairs as Stairs | undefined)?.pieces ?? []) {
		if (p.model || (p.role !== 'railing' && p.role !== 'kerb')) continue;
		const [x, y] = [p.cell % w, Math.floor(p.cell / w)];
		if (x < cx || y < cy || x >= cx + CHUNK || y >= cy + CHUNK) continue;
		const { dx, dy } = DIRS[p.dir];
		// The pivot: the edge's midpoint on the step's floor; +z out over the edge, +x along it.
		const ox = (x + 0.5 + dx / 2 - w / 2) * cs;
		const oz = (y + 0.5 + dy / 2 - h / 2) * cs;
		const oy = shape.ground.floorY({ x, y });
		const frame = { ox, oy, oz, ax: -dy, az: dx, zx: dx, zz: dy, cs };
		const style = p.role === 'railing' ? MASONRY : EARTH;
		for (const box of p.role === 'railing' ? RAIL : KERB) out[style].box(box, frame, p.cell);
	}
	return out.map((t) => t.done());
}

interface Frame {
	ox: number;
	oy: number;
	oz: number;
	/** World x and z of the piece's +x (along the edge) and +z (out over it). */
	ax: number;
	az: number;
	zx: number;
	zz: number;
	cs: number;
}

class Trim {
	private pos: number[] = [];
	private nor: number[] = [];
	private col: number[] = [];
	private idx: number[] = [];
	private own: number[] = [];

	box([x0, x1, y0, y1, z0, z1, shade]: Box, f: Frame, owner: number): void {
		const corner = (bits: number) => {
			const [x, y, z] = [bits & 1 ? x1 : x0, bits & 2 ? y1 : y0, bits & 4 ? z1 : z0];
			return [
				f.ox + (x * f.ax + z * f.zx) * f.cs,
				f.oy + y * f.cs,
				f.oz + (x * f.az + z * f.zz) * f.cs
			];
		};
		for (const [quad, [nx, ny, nz]] of SIDES) {
			// The normal in the world, and the shade a little darker on the sides than on top.
			const n = [nx * f.ax + nz * f.zx, ny, nx * f.az + nz * f.zz];
			const s = shade * (ny > 0 ? 1.1 : ny < 0 ? 0.6 : 0.9);
			const base = this.own.length;
			for (const bits of quad) {
				this.pos.push(...corner(bits));
				this.nor.push(...n);
				this.col.push(s, s, s);
				this.own.push(owner);
			}
			// Wound to face its normal.
			const p = this.pos;
			const v = (k: number) => [p[(base + k) * 3], p[(base + k) * 3 + 1], p[(base + k) * 3 + 2]];
			const [a, b, c] = [v(0), v(1), v(2)];
			const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
			const t = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
			const dot =
				(u[1] * t[2] - u[2] * t[1]) * n[0] +
				(u[2] * t[0] - u[0] * t[2]) * n[1] +
				(u[0] * t[1] - u[1] * t[0]) * n[2];
			if (dot >= 0) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
			else this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
		}
	}

	done(): CliffMesh {
		return {
			positions: new Float32Array(this.pos),
			normals: new Float32Array(this.nor),
			colors: new Float32Array(this.col),
			indices: new Uint32Array(this.idx),
			owners: new Int32Array(this.own)
		};
	}
}

/** A face mesh with trim added (the world layer draws them as one). */
export function withTrim(face: CliffMesh, trim: CliffMesh): CliffMesh {
	if (!trim.indices.length) return face;
	const v = face.owners.length;
	const join = <T extends Float32Array | Int32Array>(a: T, b: T, make: new (n: number) => T) => {
		const out = new make(a.length + b.length);
		out.set(a);
		out.set(b, a.length);
		return out;
	};
	const indices = new Uint32Array(face.indices.length + trim.indices.length);
	indices.set(face.indices);
	indices.set(
		trim.indices.map((i) => i + v),
		face.indices.length
	);
	return {
		positions: join(face.positions, trim.positions, Float32Array),
		normals: join(face.normals, trim.normals, Float32Array),
		colors: join(face.colors, trim.colors, Float32Array),
		owners: join(face.owners, trim.owners, Int32Array),
		indices
	};
}

/** Each cell's stairs in one number: its step mark, its four edges' marks and its trim's sides. */
function signatures(shape: WorldShape): Uint32Array {
	const { width: w, height: h } = shape.grid;
	const sig = new Uint32Array(w * h);
	const s = shape.stairs as Stairs | undefined;
	if (!s) return sig;
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			const e = s.edges;
			sig[i] =
				s.steps[i] |
				(e.h[y * w + x] << 1) |
				(e.h[(y + 1) * w + x] << 3) |
				(e.v[y * (w + 1) + x] << 5) |
				(e.v[y * (w + 1) + x + 1] << 7);
		}
	for (const p of s.pieces)
		if (p.role === 'railing' || p.role === 'kerb')
			sig[p.cell] |= 1 << (9 + p.dir + (p.role === 'kerb' ? 4 : 0) + (p.model ? 8 : 0));
	return sig;
}

/**
 * The chunks whose stairs differ between two shapes of one grid (beside `dirtyChunks`, which
 * follows levels, floors and the explored mask): those of every cell whose stairs changed, with
 * the same one-cell margin (a face's ends join across a chunk's edge). Sorted.
 */
export function stairDirty(prev: WorldShape | null, next: WorldShape): number[] {
	const g = next.grid;
	if (!prev || prev.grid.width !== g.width || prev.grid.height !== g.height) return [];
	const [a, b] = [signatures(prev), signatures(next)];
	const across = chunksAcross(g);
	const dirty = new Set<number>();
	for (let i = 0; i < a.length; i++) {
		if (a[i] === b[i]) continue;
		const [x, y] = [i % g.width, Math.floor(i / g.width)];
		for (let cy = Math.max(y - 1, 0); cy <= Math.min(y + 1, g.height - 1); cy++)
			for (let cx = Math.max(x - 1, 0); cx <= Math.min(x + 1, g.width - 1); cx++)
				dirty.add(Math.floor(cy / CHUNK) * across.x + Math.floor(cx / CHUNK));
	}
	return [...dirty].sort((p, q) => p - q);
}
