// The ground's shape in the three.js view: each cell's level (elevation) as
// a world height. One level is a fifth of a wall, matching the rules in
// $lib/game/visibility.ts (WALL_LEVELS), so what the table shows and what
// characters can see over agree. Presentation only.

import { inBounds, type GridEdge, type GridPos, type SquareGrid } from '$lib/game/grid';
import { cellsBeside } from '$lib/game/objects';
import { WALL_LEVELS } from '$lib/game/visibility';

/** World height of one level, at a cell size of 1. */
export const STEP_HEIGHT = 0.22;
/** A wall's height above the floor it stands on: WALL_LEVELS levels. */
export const WALL_HEIGHT = STEP_HEIGHT * WALL_LEVELS;

export interface Ground {
	readonly levels: Uint8Array | null;
	/** Level of a cell (0 off the table or on a flat one). */
	level(c: GridPos): number;
	/** World height of a cell's floor. */
	floorY(c: GridPos): number;
	/** World heights of the lower and higher floors beside an edge. */
	edgeFloors(e: GridEdge): { low: number; high: number };
}

export function groundFor(grid: SquareGrid, levels: Uint8Array | null): Ground {
	const level = (c: GridPos) => (levels && inBounds(grid, c) ? levels[c.y * grid.width + c.x] : 0);
	const floorY = (c: GridPos) => level(c) * STEP_HEIGHT * grid.cellSize;
	return {
		levels,
		level,
		floorY,
		edgeFloors(e) {
			const ys = cellsBeside(grid, e).map(floorY);
			return ys.length ? { low: Math.min(...ys), high: Math.max(...ys) } : { low: 0, high: 0 };
		}
	};
}
