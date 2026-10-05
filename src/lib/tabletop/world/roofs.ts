// Roofs over roofed rooms (milestone 70, #257): which cells a viewer sees roofed, split into
// regions and rectangles, and each region's gable prisms as geometry. Pure (no three.js), in the
// lazy `world` chunk, the same on every client, tier and backend; specs in the server project.
// docs/RENDERING.md, "Roofs (#257)", is the contract.
//
// - Footprints come only from what the viewer was sent: the interior mask (views send it for
//   explored cells only, #203, and it is masked to `known` again here), and with the kit's
//   `presumeRoofs` the unexplored cells inside a closed loop of known walls whose explored cells
//   are all roofed. A wall counts only on an edge with a known side, so nothing the server holds
//   for unexplored cells changes a player's roofs (the differential test in roofs.spec.ts).
// - Regions are the footprint's 4-connected components (interior partitions don't split a roof),
//   each split greedily into maximal rectangles with a gable along its long axis. Where rectangles
//   meet the prisms interpenetrate: the narrower wing's ridge sits lower, the valley.
// - A region takes the fog state of one known cell outside it (`fogCell`): a roof is exterior
//   scenery, never shaded by the unexplored cells under it.

import { FIGURE_CLEAR, type KitRoof } from '../../assets/kit';
import { MAX_ROOM_CELLS } from '../../game/rooms';
import type { SceneObject } from '../../game/objects';
import type { CellMask } from '../../game/visibility';
import { STEP_HEIGHT, WALL_HEIGHT } from '../ground';
import { edgeKinds } from './autotile';
import { CHUNK, chunksAcross, hEdge, vEdge, type WorldShape } from './shape';

/** A roof's highest rise over its eave, in walls: wide halls flatten rather than tower. */
export const MAX_RISE = 2;

/**
 * The cells this viewer sees roofed: the interior mask on known cells, and with `presume` the
 * unexplored cells of every closed loop of known walls (at most `MAX_ROOM_CELLS`, not open to the
 * table's edge) whose known cells are all roofed. For the GM and fog off (`known` null) it is the
 * mask itself.
 */
export function roofFootprint(
	shape: WorldShape,
	objects: readonly SceneObject[],
	interior: CellMask | null,
	presume: boolean
): Uint8Array {
	const { grid, known } = shape;
	const { width: w, height: h } = grid;
	const n = w * h;
	const out = new Uint8Array(n);
	if (interior?.length === n)
		for (let i = 0; i < n; i++) out[i] = interior[i] && (!known || known[i]) ? 1 : 0;
	if (!presume || !known) return out;
	const kinds = edgeKinds(grid, objects);
	const knownAt = (x: number, y: number) =>
		x >= 0 && y >= 0 && x < w && y < h && known[y * w + x] === 1;
	// A built edge stops the flood only where the viewer knows a cell beside it.
	const wallH = (x: number, y: number) =>
		kinds.h[hEdge(grid, x, y)] > 0 && (knownAt(x, y - 1) || knownAt(x, y));
	const wallV = (x: number, y: number) =>
		kinds.v[vEdge(grid, x, y)] > 0 && (knownAt(x - 1, y) || knownAt(x, y));
	const seen = new Uint8Array(n);
	for (let s = 0; s < n; s++) {
		if (known[s] || seen[s]) continue;
		seen[s] = 1;
		const cells = [s];
		let open = false;
		for (let k = 0; k < cells.length; k++) {
			const x = cells[k] % w;
			const y = (cells[k] - x) / w;
			const steps: [boolean, number, number][] = [
				[wallH(x, y), x, y - 1],
				[wallH(x, y + 1), x, y + 1],
				[wallV(x, y), x - 1, y],
				[wallV(x + 1, y), x + 1, y]
			];
			for (const [walled, nx, ny] of steps) {
				if (walled) continue;
				if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
					open = true; // the table's edge is no wall
					continue;
				}
				const j = ny * w + nx;
				if (!seen[j]) {
					seen[j] = 1;
					cells.push(j);
				}
			}
		}
		if (open || cells.length > MAX_ROOM_CELLS) continue;
		if (cells.some((i) => known[i] && !out[i])) continue; // an explored cell says it is open
		for (const i of cells) out[i] = 1;
	}
	return out;
}

/** A rectangle of cells: from (x, y), `w` across and `h` down. */
export interface RoofRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** One roof: a 4-connected component of the footprint. */
export interface RoofRegion {
	/** Its cells, in row order (the first names its chunk). */
	cells: number[];
	rects: RoofRect[];
	/** World height of its eaves: the highest floor under it plus a wall. */
	eaveY: number;
	/** The known cell outside it (else inside it) whose fog state it takes. */
	fogCell: number;
	/** The chunk it is drawn in: its first cell's. */
	chunk: number;
}

/** The footprint's regions, with the cells' continued levels; a region with no known cell near is left out. */
export function roofRegions(shape: WorldShape, footprint: Uint8Array): RoofRegion[] {
	const { grid, known, levels } = shape;
	const { width: w, height: h, cellSize: cs } = grid;
	const across = chunksAcross(grid).x;
	const label = new Int32Array(w * h).fill(-1);
	const out: RoofRegion[] = [];
	for (let s = 0; s < w * h; s++) {
		if (!footprint[s] || label[s] >= 0) continue;
		const cells = [s];
		label[s] = out.length;
		for (let k = 0; k < cells.length; k++) {
			const x = cells[k] % w;
			const y = (cells[k] - x) / w;
			for (const [nx, ny] of [
				[x, y - 1],
				[x - 1, y],
				[x + 1, y],
				[x, y + 1]
			]) {
				const j = ny * w + nx;
				if (nx < 0 || ny < 0 || nx >= w || ny >= h || !footprint[j] || label[j] >= 0) continue;
				label[j] = out.length;
				cells.push(j);
			}
		}
		cells.sort((a, b) => a - b);
		const fogCell = fogCellOf(cells, footprint, known, w, h);
		if (fogCell < 0) continue;
		let top = 0;
		for (const i of cells) top = Math.max(top, levels[i]);
		out.push({
			cells,
			rects: rectsOf(cells, w),
			eaveY: (top * STEP_HEIGHT + WALL_HEIGHT) * cs,
			fogCell,
			chunk: Math.floor(cells[0] / w / CHUNK) * across + Math.floor((cells[0] % w) / CHUNK)
		});
	}
	return out;
}

/** The known cell beside the region nearest its centre (ties by index), else its first known cell, else -1. */
function fogCellOf(
	cells: number[],
	footprint: Uint8Array,
	known: CellMask | null,
	w: number,
	h: number
): number {
	let [cx, cy] = [0, 0];
	for (const i of cells) [cx, cy] = [cx + (i % w), cy + Math.floor(i / w)];
	[cx, cy] = [cx / cells.length, cy / cells.length];
	let best = -1;
	let far = Infinity;
	for (const i of cells) {
		const x = i % w;
		const y = (i - x) / w;
		for (let dy = -1; dy <= 1; dy++)
			for (let dx = -1; dx <= 1; dx++) {
				const [nx, ny] = [x + dx, y + dy];
				const j = ny * w + nx;
				if (nx < 0 || ny < 0 || nx >= w || ny >= h || footprint[j] || (known && !known[j]))
					continue;
				const d = (nx - cx) ** 2 + (ny - cy) ** 2;
				if (d < far || (d === far && j < best)) [best, far] = [j, d];
			}
	}
	return best >= 0 ? best : (cells.find((i) => !known || known[i]) ?? -1);
}

/** Greedy maximal rectangles: from each free cell in row order, as far right, then as far down. */
export function rectsOf(cells: readonly number[], w: number): RoofRect[] {
	const free = new Set(cells);
	const out: RoofRect[] = [];
	for (const s of cells) {
		if (!free.has(s)) continue;
		const x = s % w;
		const y = (s - x) / w;
		let rw = 1;
		while (x + rw < w && free.has(s + rw)) rw++;
		let rh = 1;
		const rowFree = (r: number) => {
			for (let i = 0; i < rw; i++) if (!free.has((y + r) * w + x + i)) return false;
			return true;
		};
		while (rowFree(rh)) rh++;
		for (let r = 0; r < rh; r++) for (let i = 0; i < rw; i++) free.delete((y + r) * w + x + i);
		out.push({ x, y, w: rw, h: rh });
	}
	return out;
}

/** One chunk's roofs as a mesh. `fogCells` is per vertex (x, y): its region's `fogCell`. */
export interface RoofMesh {
	positions: Float32Array;
	normals: Float32Array;
	indices: Uint32Array;
	fogCells: Float32Array;
	/** Per vertex: its region's index in the list given (#259 fades by it). */
	region: Uint16Array;
}

/**
 * The regions' gables as one mesh, in world units. Each rectangle is a prism along its long axis:
 * two slopes out past the walls by the kit's eave (held so the eave stays over FIGURE_CLEAR), both
 * sides of each (the soffit seen from inside), a gable at each end from the eave up, and an infill
 * band from a lower wall's top up to the eave. `style` is read for #258's hips; today all gable.
 */
export function roofMesh(
	shape: WorldShape,
	regions: readonly RoofRegion[],
	roof: KitRoof,
	footprint: Uint8Array
): RoofMesh {
	const { width: w, height: h, cellSize: cs } = shape.grid;
	const pos: number[] = [];
	const nor: number[] = [];
	const fog: number[] = [];
	const reg: number[] = [];
	const idx: number[] = [];
	const tan = Math.tan((roof.pitch * Math.PI) / 180);
	let region = 0;
	let cell = [0, 0];
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
			for (const p of [a, b, c, d]) {
				pos.push(p[0], p[1], p[2]);
				nor.push(nx * sign, ny * sign, nz * sign);
				fog.push(cell[0], cell[1]);
				reg.push(region);
			}
			if (sign > 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
			else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
		}
	};
	const X = (x: number) => (x - w / 2) * cs;
	const Z = (y: number) => (y - h / 2) * cs;
	for (const r of regions) {
		cell = [r.fogCell % w, Math.floor(r.fogCell / w)];
		const y0 = r.eaveY;
		for (const rect of r.rects) {
			// Along x when at least as wide as deep; the ridge's axis is u, across it v.
			const alongX = rect.w >= rect.h;
			const [u0, u1] = alongX ? [rect.x, rect.x + rect.w] : [rect.y, rect.y + rect.h];
			const [v0, v1] = alongX ? [rect.y, rect.y + rect.h] : [rect.x, rect.x + rect.w];
			const half = ((v1 - v0) / 2) * cs;
			const rise = Math.min(half * tan, MAX_RISE * WALL_HEIGHT * cs);
			const slope = rise / half;
			const eave = Math.min(roof.eave, (WALL_HEIGHT - FIGURE_CLEAR) / slope) * cs;
			const P = (u: number, y: number, v: number) => (alongX ? [u, y, v] : [v, y, u]);
			const [U0, U1] = alongX ? [X(u0), X(u1)] : [Z(u0), Z(u1)];
			const [V0, V1] = alongX ? [Z(v0), Z(v1)] : [X(v0), X(v1)];
			const mid = (V0 + V1) / 2;
			const [ua, ub] = [U0 - eave, U1 + eave];
			const low = y0 - eave * slope;
			const top = y0 + rise;
			quad(P(ua, low, V0 - eave), P(ua, top, mid), P(ub, top, mid), P(ub, low, V0 - eave));
			quad(P(ub, low, V1 + eave), P(ub, top, mid), P(ua, top, mid), P(ua, low, V1 + eave));
			// The gables, from the eave to the ridge (a quad with two corners at the ridge).
			quad(P(U0, y0, V1), P(U0, top, mid), P(U0, top, mid), P(U0, y0, V0));
			quad(P(U1, y0, V0), P(U1, top, mid), P(U1, top, mid), P(U1, y0, V1));
		}
		infill(shape, r, footprint, quad, X, Z);
		region++;
	}
	return {
		positions: Float32Array.from(pos),
		normals: Float32Array.from(nor),
		indices: Uint32Array.from(idx),
		fogCells: Float32Array.from(fog),
		region: Uint16Array.from(reg)
	};
}

/** Bands from each lower outer wall's top up to the region's eave, so no gap shows under the roof. */
function infill(
	shape: WorldShape,
	r: RoofRegion,
	footprint: Uint8Array,
	quad: (a: number[], b: number[], c: number[], d: number[]) => void,
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

/** Roofs by chunk: each chunk's regions (the chunks with none are absent). */
export function roofsByChunk(regions: readonly RoofRegion[]): Map<number, RoofRegion[]> {
	const out = new Map<number, RoofRegion[]>();
	for (const r of regions) out.set(r.chunk, [...(out.get(r.chunk) ?? []), r]);
	return out;
}

/** What a chunk's roofs are made of (their floors too, for the infill), to tell when to rebuild it. */
export const roofKey = (shape: WorldShape, regions: readonly RoofRegion[]): string =>
	regions
		.map((r) => {
			const rects = r.rects.map((q) => `${q.x},${q.y},${q.w},${q.h}`).join(';');
			return `${r.eaveY}:${r.fogCell}:${rects}:${r.cells.map((i) => shape.levels[i]).join(',')}`;
		})
		.join('|');

/** Whether the viewer sees into a region now: any of its cells in `visible`. */
export const seenInto = (r: RoofRegion, visible: CellMask | null): boolean =>
	!!visible && r.cells.some((i) => visible[i] === 1);
