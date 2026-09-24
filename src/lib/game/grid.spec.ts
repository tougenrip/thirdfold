import { describe, expect, it } from 'vitest';
import { gridDistance, gridToWorld, inBounds, worldToGrid, type SquareGrid } from './grid';

const grid: SquareGrid = { kind: 'square', cellSize: 2, width: 10, height: 6 };

describe('grid coordinates', () => {
	it('places cell centres symmetrically around the origin', () => {
		expect(gridToWorld(grid, { x: 0, y: 0 })).toEqual({ x: -9, y: 0, z: -5 });
		expect(gridToWorld(grid, { x: 9, y: 5 })).toEqual({ x: 9, y: 0, z: 5 });
	});

	it('round-trips every cell through world space', () => {
		for (let x = 0; x < grid.width; x++) {
			for (let y = 0; y < grid.height; y++) {
				expect(worldToGrid(grid, gridToWorld(grid, { x, y }))).toEqual({ x, y });
			}
		}
	});

	it('snaps points anywhere inside a cell to that cell', () => {
		expect(worldToGrid(grid, { x: -9.99, z: -5.99 })).toEqual({ x: 0, y: 0 });
		expect(worldToGrid(grid, { x: 0.01, z: 0.01 })).toEqual({ x: 5, y: 3 });
	});

	it('returns null off the grid', () => {
		expect(worldToGrid(grid, { x: -10.01, z: 0 })).toBeNull();
		expect(worldToGrid(grid, { x: 0, z: 6 })).toBeNull();
	});

	it('bounds-checks integer cells only', () => {
		expect(inBounds(grid, { x: 9, y: 5 })).toBe(true);
		expect(inBounds(grid, { x: 10, y: 0 })).toBe(false);
		expect(inBounds(grid, { x: -1, y: 0 })).toBe(false);
		expect(inBounds(grid, { x: 1.5, y: 0 })).toBe(false);
	});
});

describe('gridDistance', () => {
	it('counts diagonal steps as one cell', () => {
		expect(gridDistance({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(3);
		expect(gridDistance({ x: 0, y: 0 }, { x: 4, y: 1 })).toBe(4);
		expect(gridDistance({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
	});
});
