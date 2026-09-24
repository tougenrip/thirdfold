import { describe, expect, it } from 'vitest';
import type { SquareGrid } from './grid';
import { blockingEdges, type SceneObject } from './objects';
import {
	addVision,
	cellIndex,
	decodeMask,
	emptyMask,
	encodeMask,
	hasLineOfSight,
	rectCells
} from './visibility';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 12, height: 12 };
const wall = (ax: number, ay: number, bx: number, by: number): SceneObject => ({
	id: `${ax}${ay}${bx}${by}`,
	kind: 'wall',
	a: { x: ax, y: ay },
	b: { x: bx, y: by }
});
const c = (x: number, y: number) => ({ x, y });

describe('hasLineOfSight', () => {
	const none = new Set<string>();

	it('sees along rows, columns and diagonals in open space', () => {
		expect(hasLineOfSight(none, c(0, 0), c(8, 0))).toBe(true);
		expect(hasLineOfSight(none, c(3, 9), c(3, 1))).toBe(true);
		expect(hasLineOfSight(none, c(0, 0), c(5, 5))).toBe(true);
		expect(hasLineOfSight(none, c(1, 1), c(7, 4))).toBe(true);
		expect(hasLineOfSight(none, c(2, 2), c(2, 2))).toBe(true);
	});

	it('is blocked by a wall across the line', () => {
		const blocked = blockingEdges([wall(5, 0, 5, 12)]);
		expect(hasLineOfSight(blocked, c(2, 3), c(8, 3))).toBe(false);
		expect(hasLineOfSight(blocked, c(2, 3), c(7, 9))).toBe(false);
		expect(hasLineOfSight(blocked, c(2, 3), c(4, 9))).toBe(true);
	});

	it('sees through an open door but not a closed one', () => {
		const door = (open: boolean): SceneObject[] => [
			wall(5, 0, 5, 3),
			{ id: 'd', kind: 'door', a: c(5, 3), b: c(5, 4), open },
			wall(5, 4, 5, 12)
		];
		expect(hasLineOfSight(blockingEdges(door(false)), c(2, 3), c(8, 3))).toBe(false);
		expect(hasLineOfSight(blockingEdges(door(true)), c(2, 3), c(8, 3))).toBe(true);
	});

	it('is symmetric for these cases', () => {
		const blocked = blockingEdges([wall(5, 0, 5, 6), wall(0, 6, 5, 6)]);
		for (const [a, b] of [
			[c(2, 2), c(8, 9)],
			[c(4, 5), c(6, 7)],
			[c(1, 1), c(4, 4)]
		]) {
			expect(hasLineOfSight(blocked, a, b)).toBe(hasLineOfSight(blocked, b, a));
		}
	});
});

describe('addVision', () => {
	it('covers a round radius and stops at walls', () => {
		const mask = emptyMask(grid);
		addVision(grid, blockingEdges([wall(6, 0, 6, 12)]), c(4, 4), 3, mask);
		const seen = (x: number, y: number) => mask[cellIndex(grid, c(x, y))] === 1;
		expect(seen(4, 4)).toBe(true);
		expect(seen(4, 1)).toBe(true); // straight up, radius 3
		expect(seen(1, 1)).toBe(false); // corner of the square is outside the circle
		expect(seen(5, 4)).toBe(true);
		expect(seen(6, 4)).toBe(false); // behind the wall
		expect(seen(4, 8)).toBe(false); // beyond radius
	});

	it('gives zero-radius tokens only their own cell', () => {
		const mask = emptyMask(grid);
		addVision(grid, new Set(), c(2, 2), 0, mask);
		expect(mask.reduce((n, v) => n + v, 0)).toBe(1);
	});
});

describe('masks', () => {
	it('round-trips through base64', () => {
		const mask = emptyMask(grid);
		for (const i of [0, 7, 8, 63, 100, 143]) mask[i] = 1;
		expect(decodeMask(encodeMask(mask), mask.length)).toEqual(mask);
	});

	it('decodes junk to an empty mask', () => {
		expect(decodeMask('%%%not base64', 16)).toEqual(new Uint8Array(16));
	});

	it('clamps rectangles to the grid in either corner order', () => {
		expect(rectCells(grid, c(2, 1), c(1, 2))).toEqual([13, 14, 25, 26]);
		expect(rectCells(grid, c(10, 10), c(20, 20))).toHaveLength(4);
	});
});
