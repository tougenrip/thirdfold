// Logical tabletop grid. Grid positions are what game rules reason about;
// world positions are only for the renderer. Keep the two separate.

export interface SquareGrid {
	kind: 'square';
	/** World units per cell edge. */
	cellSize: number;
	/** Number of cells along x. */
	width: number;
	/** Number of cells along z. */
	height: number;
}

/** A cell on the grid. `x` runs along world x, `y` along world z. */
export interface GridPos {
	x: number;
	y: number;
}

export interface WorldPos {
	x: number;
	y: number;
	z: number;
}

export const DEFAULT_GRID: SquareGrid = { kind: 'square', cellSize: 1, width: 20, height: 20 };

/** The grid is centred on the world origin, so cell (0,0) is the min-x/min-z corner. */
export function gridToWorld(grid: SquareGrid, pos: GridPos): WorldPos {
	return {
		x: (pos.x + 0.5 - grid.width / 2) * grid.cellSize,
		y: 0,
		z: (pos.y + 0.5 - grid.height / 2) * grid.cellSize
	};
}

/** The cell containing a world point, or null when the point is off the grid. */
export function worldToGrid(grid: SquareGrid, world: Pick<WorldPos, 'x' | 'z'>): GridPos | null {
	const pos = {
		x: Math.floor(world.x / grid.cellSize + grid.width / 2),
		y: Math.floor(world.z / grid.cellSize + grid.height / 2)
	};
	return inBounds(grid, pos) ? pos : null;
}

export function inBounds(grid: SquareGrid, pos: GridPos): boolean {
	return (
		Number.isInteger(pos.x) &&
		Number.isInteger(pos.y) &&
		pos.x >= 0 &&
		pos.y >= 0 &&
		pos.x < grid.width &&
		pos.y < grid.height
	);
}

/** Distance in cells where a diagonal step costs one cell (Chebyshev). */
export function gridDistance(a: GridPos, b: GridPos): number {
	return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
