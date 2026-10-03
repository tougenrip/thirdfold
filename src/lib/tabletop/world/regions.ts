// Regions of the world's shape (#239), found once for the builders that draw
// them: stair runs (kits, #255), one-wide raised runs (bridges and ridges,
// balustrades, #256), water bodies (#292) and void regions (chasms, #243).
// Only known cells count, so nothing here reaches into unexplored ground.

import { FLOOR_IDS, VOID } from '../../game/floor';
import { EDGE_BUILT, slotBetween, type WorldShape } from './shape';

const WATER = FLOOR_IDS.indexOf('water');

/** Directions by index: north (y - 1), east, south, west. */
export const DIRS = [
	{ dx: 0, dy: -1 },
	{ dx: 1, dy: 0 },
	{ dx: 0, dy: 1 },
	{ dx: -1, dy: 0 }
] as const;

/** A chain of cells each one level above the last, in one direction, with at least two risers. */
export interface StairRun {
	/** Cell indices from the foot (the lowest) to the head. */
	cells: number[];
	/** The direction of the climb, an index into DIRS. */
	dir: number;
}

/**
 * Raised cells one wide: each has a drop of two levels or more (or the void)
 * on both sides across `along`, and the run goes on along it, each next cell
 * within one level. A cell with drops both ways (a pillar) is in a run of each.
 */
export interface OneWideRun {
	cells: number[];
	along: 'x' | 'y';
}

/** Water cells joined edge to edge at one level. */
export interface WaterBody {
	cells: number[];
	level: number;
}

/** Void cells joined edge to edge; `touchesBorder` if one is on the table's edge. */
export interface VoidRegion {
	cells: number[];
	touchesBorder: boolean;
}

export interface Regions {
	stairs: StairRun[];
	oneWide: OneWideRun[];
	water: WaterBody[];
	voids: VoidRegion[];
}

export function regionsOf(shape: WorldShape): Regions {
	return {
		stairs: stairRuns(shape),
		oneWide: oneWideRuns(shape),
		water: components(shape, (i) => shape.floor[i] === WATER, true).map((cells) => ({
			cells,
			level: shape.levels[cells[0]]
		})),
		voids: components(shape, (i) => shape.floor[i] === VOID, false).map((cells) => ({
			cells,
			touchesBorder: cells.some((i) => onBorder(shape, i))
		}))
	};
}

const isKnown = (s: WorldShape, i: number) => !s.known || s.known[i] === 1;
/** Ground a figure could stand on: known and not void. */
const isGround = (s: WorldShape, i: number) => isKnown(s, i) && s.floor[i] !== VOID;

function onBorder({ grid }: WorldShape, i: number): boolean {
	const x = i % grid.width;
	const y = Math.floor(i / grid.width);
	return x === 0 || y === 0 || x === grid.width - 1 || y === grid.height - 1;
}

/** The cell `d` from cell i, or -1 off the table. */
function step({ grid }: WorldShape, i: number, d: number): number {
	const x = (i % grid.width) + DIRS[d].dx;
	const y = Math.floor(i / grid.width) + DIRS[d].dy;
	return x < 0 || y < 0 || x >= grid.width || y >= grid.height ? -1 : y * grid.width + x;
}

/** A wall or window between two adjacent cells (a door is a way through). */
function walled(s: WorldShape, i: number, j: number): boolean {
	const { axis, index } = slotBetween(s.grid, i, j);
	const b = s.edges.built[axis][index];
	return b === EDGE_BUILT.wall || b === EDGE_BUILT.window;
}

function stairRuns(s: WorldShape): StairRun[] {
	const runs: StairRun[] = [];
	const climbs = (i: number, j: number) =>
		j >= 0 && isGround(s, j) && s.levels[j] === s.levels[i] + 1 && !walled(s, i, j);
	const n = s.grid.width * s.grid.height;
	for (let d = 0; d < 4; d++) {
		const back = (d + 2) & 3;
		for (let i = 0; i < n; i++) {
			if (!isGround(s, i)) continue;
			const prev = step(s, i, back);
			if (prev >= 0 && isGround(s, prev) && climbs(prev, i)) continue;
			const cells = [i];
			for (let j = step(s, i, d); climbs(cells[cells.length - 1], j); j = step(s, j, d))
				cells.push(j);
			if (cells.length >= 3) runs.push({ cells, dir: d });
		}
	}
	return runs;
}

function oneWideRuns(s: WorldShape): OneWideRun[] {
	const runs: OneWideRun[] = [];
	const { width: w, height: h } = s.grid;
	const drop = (i: number, j: number) =>
		j >= 0 && isKnown(s, j) && (s.floor[j] === VOID || s.levels[j] + 2 <= s.levels[i]);
	// A run along y has its drops east and west; along x, north and south.
	for (const along of ['x', 'y'] as const) {
		const [sideA, sideB, ahead] = along === 'y' ? [1, 3, 2] : [0, 2, 1];
		const narrow = (i: number) =>
			i >= 0 && isGround(s, i) && drop(i, step(s, i, sideA)) && drop(i, step(s, i, sideB));
		const joined = (i: number, j: number) =>
			narrow(j) && Math.abs(s.levels[i] - s.levels[j]) <= 1 && !walled(s, i, j);
		for (let i = 0; i < w * h; i++) {
			if (!narrow(i)) continue;
			const before = step(s, i, (ahead + 2) & 3);
			if (before >= 0 && narrow(before) && joined(before, i)) continue;
			const cells = [i];
			for (
				let j = step(s, i, ahead);
				j >= 0 && joined(cells[cells.length - 1], j);
				j = step(s, j, ahead)
			)
				cells.push(j);
			runs.push({ cells, along });
		}
	}
	return runs;
}

/** Edge-joined components of known cells that `member` accepts (at one level if `level`). */
function components(s: WorldShape, member: (i: number) => boolean, level: boolean): number[][] {
	const n = s.grid.width * s.grid.height;
	const seen = new Uint8Array(n);
	const out: number[][] = [];
	for (let start = 0; start < n; start++) {
		if (seen[start] || !isKnown(s, start) || !member(start)) continue;
		const cells = [start];
		seen[start] = 1;
		for (let k = 0; k < cells.length; k++) {
			for (let d = 0; d < 4; d++) {
				const j = step(s, cells[k], d);
				if (j < 0 || seen[j] || !isKnown(s, j) || !member(j)) continue;
				if (level && s.levels[j] !== s.levels[start]) continue;
				seen[j] = 1;
				cells.push(j);
			}
		}
		out.push(cells);
	}
	return out;
}
