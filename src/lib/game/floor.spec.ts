import { describe, expect, it } from 'vitest';
import {
	decodeFloor,
	encodeFloor,
	FLOOR_IDS,
	isFloorId,
	knownFloor,
	VOID,
	withFloor
} from './floor';
import type { SquareGrid } from './grid';
import { findPath, isReachable } from './objects';
import { isSolidCell, obstaclesFor } from './props';
import { emptyMask, hasLineOfSight } from './visibility';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 6, height: 4 };

describe('floors', () => {
	it('paints areas, and a table painted all plain again has no map', () => {
		const floor = withFloor(null, grid, { x: 1, y: 1 }, { x: 2, y: 2 }, 'stone')!;
		expect(floor[1 * 6 + 1]).toBe(FLOOR_IDS.indexOf('stone'));
		expect(floor[0]).toBe(0);
		expect(withFloor(floor, grid, { x: 0, y: 0 }, { x: 5, y: 3 }, 'plain')).toBeNull();
		expect(isFloorId('wood')).toBe(true);
		expect(isFloorId('lava')).toBe(false);
	});

	it('round-trips through base64 and refuses what names no floor or is the wrong size', () => {
		const floor = withFloor(null, grid, { x: 0, y: 0 }, { x: 5, y: 0 }, 'void')!;
		expect(decodeFloor(encodeFloor(floor), floor.length)).toEqual(floor);
		expect(decodeFloor(encodeFloor(floor), floor.length + 1)).toBeNull();
		expect(decodeFloor('not base64!', floor.length)).toBeNull();
		const bad = floor.slice();
		bad[3] = 200;
		expect(decodeFloor(encodeFloor(bad), bad.length)).toBeNull();
	});

	it('tells a viewer only the floors of cells they know', () => {
		const floor = withFloor(null, grid, { x: 0, y: 0 }, { x: 5, y: 3 }, 'grass')!;
		const known = emptyMask(grid);
		known[2] = 1;
		const seen = knownFloor(floor, known);
		expect(seen[2]).toBe(FLOOR_IDS.indexOf('grass'));
		expect(seen[3]).toBe(0);
		expect(knownFloor(floor, null)).toBe(floor);
	});

	it('keeps everyone off the map, but lets sight cross it', () => {
		// A column off the map splits the table in two.
		const floor = withFloor(null, grid, { x: 3, y: 0 }, { x: 3, y: 3 }, 'void')!;
		expect(floor[3]).toBe(VOID);
		const blocked = obstaclesFor(grid, [], [], null, floor);
		expect(isSolidCell(blocked, { x: 3, y: 1 })).toBe(true);
		expect(isReachable(grid, blocked, { x: 0, y: 1 }, { x: 5, y: 1 })).toBe(false);
		expect(findPath(grid, blocked, { x: 0, y: 1 }, (c) => c.x === 5)).toBeNull();
		expect(hasLineOfSight(blocked, { x: 0, y: 1 }, { x: 5, y: 1 })).toBe(true);
		// Water and stone are only looks.
		const wet = withFloor(null, grid, { x: 3, y: 0 }, { x: 3, y: 3 }, 'water')!;
		const open = obstaclesFor(grid, [], [], null, wet);
		expect(isReachable(grid, open, { x: 0, y: 1 }, { x: 5, y: 1 })).toBe(true);
	});
});
