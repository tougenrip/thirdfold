// Roofs over roofed rooms (milestone 70, #257): which cells a viewer sees roofed, split into
// regions and their wings (roof-mesh.ts builds the geometry, #258). Pure (no three.js), in the
// lazy `world` chunk, the same on every client, tier and backend; specs in the server project.
// docs/RENDERING.md, "Roofs (#257)", is the contract.
//
// - Footprints come only from what the viewer was sent: the interior mask (views send it for
//   explored cells only, #203, and it is masked to `known` again here), and with the kit's
//   `presumeRoofs` the unexplored cells inside a closed loop of known walls whose explored cells
//   are all roofed. A wall counts only on an edge with a known side, so nothing the server holds
//   for unexplored cells changes a player's roofs (the differential test in roofs.spec.ts).
// - Regions are the footprint's 4-connected components (interior partitions don't split a roof),
//   each roofed as its maximal rectangles, its wings (#258), whose prisms (roof-mesh.ts) cross:
//   the narrower wing's ridge sits lower, the valley. A region with more than MAX_WINGS falls
//   back to a greedy split into rectangles that don't overlap (#257's).
// - A region takes the fog state of one known cell outside it (`fogCell`): a roof is exterior
//   scenery, never shaded by the unexplored cells under it.

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
	/** Its wings: the maximal rectangles of its cells (`wingsOf`), each a prism. */
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
			rects: wingsOf(cells, w),
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

/** The most wings a region is roofed by; past it, the greedy rectangles of #257. */
export const MAX_WINGS = 12;

/**
 * Every maximal rectangle of the cells (one no other rectangle of them contains), in row order of
 * its first cell, then by width. They cover every cell and may overlap: an L is two bars, a T two,
 * a plus two. Past MAX_WINGS (a ragged region), `rectsOf`'s greedy split instead. `cells` are in
 * row order, as a region's are.
 */
export function wingsOf(cells: readonly number[], w: number): RoofRect[] {
	const set = new Set(cells);
	// Runs of cells down from and right of each cell, so each test below is one look-up.
	const down = new Map<number, number>();
	const right = new Map<number, number>();
	for (let k = cells.length - 1; k >= 0; k--) {
		const i = cells[k];
		down.set(i, 1 + (down.get(i + w) ?? 0));
		right.set(i, (i + 1) % w && set.has(i + 1) ? 1 + right.get(i + 1)! : 1);
	}
	const runDown = (x: number, y: number) => (x >= 0 && x < w ? (down.get(y * w + x) ?? 0) : 0);
	const out: RoofRect[] = [];
	for (const s of cells) {
		const x = s % w;
		const y = (s - x) / w;
		let rh = Infinity;
		for (let rw = 1; rw <= right.get(s)!; rw++) {
			rh = Math.min(rh, runDown(x + rw - 1, y));
			const grows =
				runDown(x + rw, y) >= rh || runDown(x - 1, y) >= rh || (right.get(s - w) ?? 0) >= rw;
			if (grows) continue;
			out.push({ x, y, w: rw, h: rh });
			if (out.length > MAX_WINGS) return rectsOf(cells, w);
		}
	}
	return out;
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
