import { describe, expect, it } from 'vitest';
import type { SquareGrid } from './grid';
import type { SceneObject } from './objects';
import { MAX_ROOM_CELLS, roomAround, roomBoundary } from './rooms';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 20, height: 20 };
const wall = (id: string, a: [number, number], b: [number, number]): SceneObject => ({
	id,
	kind: 'wall',
	a: { x: a[0], y: a[1] },
	b: { x: b[0], y: b[1] }
});

/** A 3×2 room at x 2-4, y 2-3 with a door in its east wall and a window in its north wall. */
const objects: SceneObject[] = [
	wall('n1', [2, 2], [3, 2]),
	{ id: 'win', kind: 'wall', a: { x: 3, y: 2 }, b: { x: 5, y: 2 }, window: true },
	wall('s', [2, 4], [5, 4]),
	wall('w', [2, 2], [2, 4]),
	wall('e', [5, 2], [5, 3]),
	{ id: 'd', kind: 'door', a: { x: 5, y: 3 }, b: { x: 5, y: 4 }, open: true }
];

describe('rooms', () => {
	it('finds the walled-in space around a cell, bounded by walls, windows and doors (even open)', () => {
		const cells = roomAround(grid, roomBoundary(objects), { x: 3, y: 3 });
		expect(cells?.sort((a, b) => a - b)).toEqual([42, 43, 44, 62, 63, 64]);
	});

	it('calls a space too big to be a room open ground', () => {
		expect(roomAround(grid, roomBoundary(objects), { x: 10, y: 10 })).toBeNull();
		expect(roomAround(grid, new Set(), { x: 0, y: 0 }, MAX_ROOM_CELLS)).toBeNull();
		expect(roomAround(grid, roomBoundary(objects), { x: 30, y: 3 })).toBeNull();
	});
});
