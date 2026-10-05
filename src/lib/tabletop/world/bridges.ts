// Bridges and balustrades (milestone 70, #256): what the world's shape makes
// of a raised run at most two wide with drops on both long sides (regions.ts
// `bridgeRuns`), and of a built floor's open drop. Pure (no three.js), the same
// on every client, tier and backend; specs in the server project.
// docs/RENDERING.md, "Bridges and balustrades", is the contract.
//
// - A bridge's cells are marked by what stands under their deck: a pier every
//   two or three slices (by a hash of the cell), an arch where every long side
//   of the slice is known void, else a solid spandrel down to the lower floor.
//   Nothing opens over walkable ground: the height field has one floor a cell,
//   so nothing stands under a bridge and nothing may seem to.
// - Each open long side gets a parapet (a `railing`) and is taken from the
//   ground: bridge-mesh.ts draws its deck, spandrel, pier or arch instead.
// - A man-made floor (or the plain floor where the environment's ground is
//   built) at an open drop of two levels or more, or the void, gets a
//   balustrade on its edge, and so does a window between such floors (the
//   gallery's railing: its sill is the window's, #253).
// - Only known cells make a bridge, a side or a rail: an unexplored side is no
//   drop (regions.ts), so no arch or void is hinted toward it.

import { VOID } from '../../game/floor';
import { keySeed } from './autotile';
import { MAN_MADE } from './floors';
import { DIRS, regionsOf } from './regions';
import { EDGE_BUILT, slotBetween, type WorldShape } from './shape';

/** What stands under a bridge cell's deck (the low two bits of `Bridges.cells`). */
export const UNDER = { none: 0, span: 1, pier: 2, arch: 3 } as const;
/** `Bridges.cells`' third bit: the run goes along y (its long sides face east and west). */
export const ALONG_Y = 4;

/** A rail's site: the cell it stands on, the cell across its edge, the way it faces, the drop. */
export interface RailSite {
	cell: number;
	across: number;
	/** Where its +z face looks (a `DIRS` index): out over the drop. */
	dir: number;
	/** Levels down to the floor across the edge; null for the void. */
	drop: number | null;
	/** On a window between floors: the window's sill stands over it, so never a kit piece. */
	window: boolean;
}

export interface Bridges {
	/** Per cell: `UNDER` | `ALONG_Y`, 0 off every bridge. */
	cells: Uint8Array;
	/** The long sides' parapets: their edges are the bridge's, not the ground's. */
	sides: RailSite[];
}

const PLAIN_FLOOR = 0;

/** Whether a cell's floor is built: man-made, or the plain floor of a built environment. */
export const builtFloor = (floor: number, built: boolean) =>
	MAN_MADE.has(floor) || (floor === PLAIN_FLOOR && built);

/** The bridges of a shape: each cell's mark and the long sides' parapets. */
export function bridgesOf(shape: WorldShape): Bridges {
	const { grid, floor, levels } = shape;
	const w = grid.width;
	const cells = new Uint8Array(w * grid.height);
	const sides: RailSite[] = [];
	const isKnown = (i: number) => !shape.known || shape.known[i] === 1;
	for (const run of regionsOf(shape).bridges) {
		const [sideA, sideB] = run.along === 'y' ? [3, 1] : [0, 2];
		const along = run.along === 'y' ? ALONG_Y : 0;
		const piers = pierSlices(shape, run.slices);
		run.slices.forEach((slice, k) => {
			const outer = [
				[slice[0], sideA],
				[slice[slice.length - 1], sideB]
			] as const;
			const open = outer.filter(([c, d]) => !walled(shape, c, neighbour(shape, c, d)));
			const overVoid =
				open.length === 2 &&
				outer.every(([c, d]) => {
					const j = neighbour(shape, c, d);
					return isKnown(j) && floor[j] === VOID;
				}) &&
				slice.every((c) => levels[c] === levels[slice[0]]);
			const under = piers.has(k) ? UNDER.pier : overVoid ? UNDER.arch : UNDER.span;
			for (const c of slice) {
				// A cell on bridges both ways (a corner): no arch through it, a pier if either has one.
				const was = cells[c];
				const pier = under === UNDER.pier || was % 4 === UNDER.pier;
				const u = was === 0 ? under : pier ? UNDER.pier : UNDER.span;
				cells[c] = u | (was === 0 ? along : was & ALONG_Y);
			}
			for (const [c, d] of open) {
				const j = neighbour(shape, c, d);
				const drop = floor[j] === VOID ? null : levels[c] - levels[j];
				sides.push({ cell: c, across: j, dir: d, drop, window: false });
			}
		});
	}
	return { cells, sides };
}

/**
 * The slices that stand on piers: every two or three (by a hash of the slice's first cell), never
 * the first or the last (an abutment is beside them).
 */
function pierSlices(shape: WorldShape, slices: number[][]): Set<number> {
	const out = new Set<number>();
	const w = shape.grid.width;
	const gap = (k: number) => {
		const c = slices[k][0];
		return 2 + (keySeed('h', c % w, Math.floor(c / w)) & 1);
	};
	for (let k = gap(0); k < slices.length - 1; k += gap(k)) out.add(k);
	return out;
}

/**
 * The balustrades at open drops: every known edge from a built floor (`builtFloor`) down two
 * levels or more, or to the void, with no wall or door on it (a window down to a lower floor takes
 * one too, under its sill), on the higher cell, and not on a stair's step or a bridge (`skip`),
 * which have rails of their own.
 */
export function dropRails(
	shape: WorldShape,
	built: boolean,
	skip: (cell: number) => boolean
): RailSite[] {
	const { grid, floor, levels } = shape;
	const n = grid.width * grid.height;
	const isKnown = (i: number) => !shape.known || shape.known[i] === 1;
	const out: RailSite[] = [];
	for (let s = 0; s < n; s++) {
		if (!isKnown(s) || floor[s] === VOID || skip(s) || !builtFloor(floor[s], built)) continue;
		for (let d = 0; d < 4; d++) {
			const j = neighbour(shape, s, d);
			if (j < 0 || !isKnown(j)) continue;
			const drop = floor[j] === VOID ? null : levels[s] - levels[j];
			if (drop !== null && drop < 2) continue;
			const { axis, index } = slotBetween(grid, s, j);
			const on = shape.edges.built[axis][index];
			if (on === EDGE_BUILT.wall || on === EDGE_BUILT.door) continue;
			// A window takes one only over a floor below (a gallery's), never out to the void.
			if (on === EDGE_BUILT.window && drop === null) continue;
			out.push({ cell: s, across: j, dir: d, drop, window: on === EDGE_BUILT.window });
		}
	}
	return out;
}

/** The cell `d` from cell i, or -1 off the table. */
export function neighbour(shape: WorldShape, i: number, d: number): number {
	const { width: w, height: h } = shape.grid;
	const x = (i % w) + DIRS[d].dx;
	const y = Math.floor(i / w) + DIRS[d].dy;
	return x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x;
}

/** A wall, window or door between two cells (-1: off the table, open). */
function walled(shape: WorldShape, i: number, j: number): boolean {
	if (j < 0) return false;
	const { axis, index } = slotBetween(shape.grid, i, j);
	return shape.edges.built[axis][index] !== EDGE_BUILT.none;
}
