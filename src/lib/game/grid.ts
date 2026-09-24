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

// Corners and edges. Walls and doors run along grid lines, between cells. A
// corner is a grid-line intersection: x in [0, width], y in [0, height], with
// corner (x, y) being the min-x/min-y corner of cell (x, y).

/** A unit segment of a grid line between two adjacent corners, with `a` before `b`. */
export interface GridEdge {
	a: GridPos;
	b: GridPos;
}

export function cornerInBounds(grid: SquareGrid, c: GridPos): boolean {
	return (
		Number.isInteger(c.x) &&
		Number.isInteger(c.y) &&
		c.x >= 0 &&
		c.y >= 0 &&
		c.x <= grid.width &&
		c.y <= grid.height
	);
}

export function cornerToWorld(grid: SquareGrid, c: GridPos): WorldPos {
	return {
		x: (c.x - grid.width / 2) * grid.cellSize,
		y: 0,
		z: (c.y - grid.height / 2) * grid.cellSize
	};
}

/** Nearest corner to a world point, or null when it falls outside the grid. */
export function worldToCorner(grid: SquareGrid, world: Pick<WorldPos, 'x' | 'z'>): GridPos | null {
	const c = {
		x: Math.round(world.x / grid.cellSize + grid.width / 2),
		y: Math.round(world.z / grid.cellSize + grid.height / 2)
	};
	return cornerInBounds(grid, c) ? c : null;
}

/** Nearest unit edge to a world point, or null off the grid. */
export function worldToEdge(grid: SquareGrid, world: Pick<WorldPos, 'x' | 'z'>): GridEdge | null {
	const u = world.x / grid.cellSize + grid.width / 2;
	const v = world.z / grid.cellSize + grid.height / 2;
	if (u < 0 || v < 0 || u > grid.width || v > grid.height) return null;
	const nearX = Math.round(u);
	const nearY = Math.round(v);
	if (Math.abs(u - nearX) <= Math.abs(v - nearY)) {
		// Closest to a vertical line x = nearX.
		const y = Math.min(Math.floor(v), grid.height - 1);
		return { a: { x: nearX, y }, b: { x: nearX, y: y + 1 } };
	}
	const x = Math.min(Math.floor(u), grid.width - 1);
	return { a: { x, y: nearY }, b: { x: x + 1, y: nearY } };
}
