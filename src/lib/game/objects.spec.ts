import { describe, expect, it } from 'vitest';
import { worldToCorner, worldToEdge, cornerToWorld, type SquareGrid } from './grid';
import {
	blockingEdges,
	canStep,
	cellsBeside,
	cutWall,
	edgeBetween,
	edgeKey,
	findPath,
	isReachable,
	objectOnEdge,
	alignToAxis,
	segmentProblem,
	unitEdges,
	walkDistance,
	type SceneObject,
	type Wall
} from './objects';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 10, height: 10 };
const wall = (ax: number, ay: number, bx: number, by: number, id = 'w'): Wall => ({
	id,
	kind: 'wall',
	a: { x: ax, y: ay },
	b: { x: bx, y: by }
});

describe('corner and edge picking', () => {
	it('round-trips corners through world space', () => {
		for (const c of [
			{ x: 0, y: 0 },
			{ x: 10, y: 10 },
			{ x: 3, y: 7 }
		]) {
			expect(worldToCorner(grid, cornerToWorld(grid, c))).toEqual(c);
		}
	});

	it('snaps to the nearest grid line segment', () => {
		// Just right of the vertical line x=3, a third of the way into row 2.
		expect(worldToEdge(grid, { x: 3.1 - 5, z: 2.4 - 5 })).toEqual({
			a: { x: 3, y: 2 },
			b: { x: 3, y: 3 }
		});
		// Just below the horizontal line y=6, in column 4.
		expect(worldToEdge(grid, { x: 4.5 - 5, z: 5.9 - 5 })).toEqual({
			a: { x: 4, y: 6 },
			b: { x: 5, y: 6 }
		});
		expect(worldToEdge(grid, { x: 20, z: 0 })).toBeNull();
	});
});

describe('segments', () => {
	it('accepts axis-aligned runs and explains bad ones', () => {
		expect(segmentProblem(grid, { x: 0, y: 2 }, { x: 10, y: 2 })).toBeNull();
		expect(segmentProblem(grid, { x: 1, y: 1 }, { x: 3, y: 3 })).toMatch(/diagonal/);
		expect(segmentProblem(grid, { x: 1, y: 1 }, { x: 1, y: 1 })).toMatch(/two different/);
		expect(segmentProblem(grid, { x: 0, y: 0 }, { x: 11, y: 0 })).toMatch(/off the table/);
	});

	it('lists unit edges regardless of direction', () => {
		expect(unitEdges({ x: 2, y: 5 }, { x: 2, y: 3 }).map(edgeKey)).toEqual(['v:2:3', 'v:2:4']);
		expect(unitEdges({ x: 1, y: 0 }, { x: 3, y: 0 }).map(edgeKey)).toEqual(['h:1:0', 'h:2:0']);
	});

	it('finds the edge between and the cells beside', () => {
		expect(edgeKey(edgeBetween({ x: 2, y: 2 }, { x: 3, y: 2 }))).toBe('v:3:2');
		expect(edgeKey(edgeBetween({ x: 2, y: 3 }, { x: 2, y: 2 }))).toBe('h:2:3');
		expect(cellsBeside(grid, { a: { x: 3, y: 2 }, b: { x: 3, y: 3 } })).toEqual([
			{ x: 2, y: 2 },
			{ x: 3, y: 2 }
		]);
		// Table border: only one cell is on the grid.
		expect(cellsBeside(grid, { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } })).toEqual([{ x: 0, y: 0 }]);
	});
});

describe('movement blocking', () => {
	// A vertical wall on x=5 from y=0 to y=10 splits the board, with a door at y 4..5.
	const objects = (open: boolean): SceneObject[] => [
		wall(5, 0, 5, 4, 'w1'),
		{ id: 'd', kind: 'door', a: { x: 5, y: 4 }, b: { x: 5, y: 5 }, open },
		wall(5, 5, 5, 10, 'w2')
	];

	it('blocks walls and closed doors, not open doors', () => {
		expect(blockingEdges(objects(false)).has('v:5:4')).toBe(true);
		expect(blockingEdges(objects(true)).has('v:5:4')).toBe(false);
		expect(blockingEdges(objects(true)).size).toBe(9);
	});

	it('stops orthogonal steps through a wall', () => {
		const blocked = blockingEdges(objects(false));
		expect(canStep(blocked, { x: 4, y: 1 }, { x: 5, y: 1 })).toBe(false);
		expect(canStep(blocked, { x: 4, y: 1 }, { x: 4, y: 2 })).toBe(true);
	});

	it('stops diagonal squeezes through a wall line but allows going round a wall end', () => {
		const blocked = blockingEdges(objects(false));
		expect(canStep(blocked, { x: 4, y: 1 }, { x: 5, y: 2 })).toBe(false);
		const stub = blockingEdges([wall(5, 0, 5, 3)]);
		expect(canStep(stub, { x: 4, y: 3 }, { x: 5, y: 2 })).toBe(true);
	});

	it('blocks a diagonal across the inside of an L-shaped corner', () => {
		// Walls meet at corner (5,5): x=5 for y 3..5 and y=5 for x 5..7. Cell (5,4) sits inside the L.
		const corner = blockingEdges([wall(5, 3, 5, 5), wall(5, 5, 7, 5)]);
		expect(canStep(corner, { x: 5, y: 4 }, { x: 4, y: 5 })).toBe(false);
		expect(canStep(corner, { x: 4, y: 5 }, { x: 5, y: 4 })).toBe(false);
		// Going round the outside of the corner is fine.
		expect(canStep(corner, { x: 4, y: 4 }, { x: 5, y: 5 })).toBe(true);
	});

	it('finds paths only through open doors', () => {
		expect(isReachable(grid, blockingEdges(objects(false)), { x: 1, y: 1 }, { x: 8, y: 8 })).toBe(
			false
		);
		expect(isReachable(grid, blockingEdges(objects(true)), { x: 1, y: 1 }, { x: 8, y: 8 })).toBe(
			true
		);
		expect(isReachable(grid, blockingEdges(objects(false)), { x: 1, y: 1 }, { x: 4, y: 9 })).toBe(
			true
		);
	});
});

describe('cutWall', () => {
	let n = 0;
	const id = () => `new${++n}`;

	it('splits a wall around a doorway, keeping the id on the first piece', () => {
		const pieces = cutWall(wall(0, 3, 6, 3, 'long'), { a: { x: 2, y: 3 }, b: { x: 3, y: 3 } }, id);
		expect(pieces).toEqual([
			{ id: 'long', kind: 'wall', a: { x: 0, y: 3 }, b: { x: 2, y: 3 } },
			{ id: 'new1', kind: 'wall', a: { x: 3, y: 3 }, b: { x: 6, y: 3 } }
		]);
	});

	it('trims an end or removes a one-edge wall entirely', () => {
		expect(cutWall(wall(0, 3, 2, 3), { a: { x: 0, y: 3 }, b: { x: 1, y: 3 } }, id)).toEqual([
			{ id: 'w', kind: 'wall', a: { x: 1, y: 3 }, b: { x: 2, y: 3 } }
		]);
		expect(cutWall(wall(0, 3, 1, 3), { a: { x: 1, y: 3 }, b: { x: 0, y: 3 } }, id)).toEqual([]);
	});

	it('leaves walls that do not contain the edge alone', () => {
		const w = wall(0, 3, 2, 3);
		expect(cutWall(w, { a: { x: 5, y: 3 }, b: { x: 6, y: 3 } }, id)).toEqual([w]);
	});
});

describe('objectOnEdge / alignToAxis', () => {
	it('finds the object on an edge, preferring a door', () => {
		const objs: SceneObject[] = [
			wall(0, 2, 6, 2, 'w'),
			{ id: 'd', kind: 'door', a: { x: 3, y: 2 }, b: { x: 4, y: 2 }, open: false }
		];
		expect(objectOnEdge(objs, { a: { x: 1, y: 2 }, b: { x: 2, y: 2 } })?.id).toBe('w');
		expect(objectOnEdge(objs, { a: { x: 4, y: 2 }, b: { x: 3, y: 2 } })?.id).toBe('d');
		expect(objectOnEdge(objs, { a: { x: 1, y: 3 }, b: { x: 2, y: 3 } })).toBeUndefined();
	});

	it('snaps to the dominant axis', () => {
		expect(alignToAxis({ x: 2, y: 2 }, { x: 7, y: 3 })).toEqual({ x: 7, y: 2 });
		expect(alignToAxis({ x: 2, y: 2 }, { x: 3, y: 8 })).toEqual({ x: 2, y: 8 });
	});
});

describe('findPath / walkDistance', () => {
	it('counts diagonal steps as one cell, like gridDistance', () => {
		expect(walkDistance(grid, new Set(), { x: 0, y: 0 }, { x: 3, y: 3 })).toBe(3);
		expect(walkDistance(grid, new Set(), { x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
		expect(walkDistance(grid, new Set(), { x: 0, y: 0 }, { x: 10, y: 0 })).toBeNull();
	});

	it('walks around walls, and finds nothing through a closed room', () => {
		// A wall from (3,0) down to (3,9) leaves only the bottom row open.
		const blocked = blockingEdges([wall(3, 0, 3, 9)]);
		// Down column 2 (8), round the end of the wall (1), back up column 3 (9).
		expect(walkDistance(grid, blocked, { x: 2, y: 0 }, { x: 3, y: 0 })).toBe(18);
		const box = blockingEdges([wall(0, 3, 10, 3)]);
		expect(walkDistance(grid, box, { x: 0, y: 0 }, { x: 0, y: 5 })).toBeNull();
	});

	it('returns the cells stepped onto, stopping at the first goal and avoiding impassable cells', () => {
		const path = findPath(grid, new Set(), { x: 0, y: 0 }, (c) => c.x === 2 && c.y === 0);
		expect(path).toEqual([
			{ x: 1, y: 0 },
			{ x: 2, y: 0 }
		]);
		const detour = findPath(
			grid,
			new Set(),
			{ x: 0, y: 0 },
			(c) => c.x === 2 && c.y === 0,
			(c) => !(c.x === 1 && c.y <= 1)
		);
		expect(detour?.length).toBe(4);
		expect(detour?.some((c) => c.x === 1 && c.y <= 1)).toBe(false);
	});
});
