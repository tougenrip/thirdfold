import { describe, expect, it } from 'vitest';
import {
	decodeFloor,
	encodeFloor,
	FLOOR_IDS,
	FLOORS,
	isFloorId,
	knownFloor,
	VOID,
	withFloor,
	type FloorId
} from './floor';
import type { SquareGrid } from './grid';
import { findPath, isReachable } from './objects';
import { isSolidCell, obstaclesFor } from './props';
import { emptyMask, hasLineOfSight } from './visibility';

const NEW: FloorId[] = ['cobble', 'flagstone', 'rock', 'mud', 'snow', 'gravel'];
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
		// Water, stone and the floors after the void (#248) are only looks.
		const wet = withFloor(null, grid, { x: 3, y: 0 }, { x: 3, y: 3 }, 'water')!;
		const open = obstaclesFor(grid, [], [], null, wet);
		expect(isReachable(grid, open, { x: 0, y: 1 }, { x: 5, y: 1 })).toBe(true);
		for (const id of NEW) {
			const painted = withFloor(null, grid, { x: 0, y: 0 }, { x: 5, y: 3 }, id)!;
			const looks = obstaclesFor(grid, [], [], null, painted);
			expect(looks).toEqual(obstaclesFor(grid, [], [], null, null));
			expect(isReachable(grid, looks, { x: 0, y: 1 }, { x: 5, y: 1 })).toBe(true);
			expect(hasLineOfSight(looks, { x: 0, y: 1 }, { x: 5, y: 1 })).toBe(true);
		}
	});

	it('appends six floors after the void, so every older byte keeps its meaning (#248)', () => {
		expect(FLOOR_IDS.slice(0, VOID + 1)).toEqual([
			'plain',
			'stone',
			'wood',
			'grass',
			'dirt',
			'sand',
			'water',
			'void'
		]);
		expect(FLOOR_IDS.slice(VOID + 1)).toEqual(NEW);
		expect(NEW.map((id) => FLOOR_IDS.indexOf(id))).toEqual([8, 9, 10, 11, 12, 13]);
		expect(FLOORS[0].name).toBe('Default ground');
		const cells = grid.width * grid.height;
		const every = Uint8Array.from({ length: cells }, (_, i) => i % 14);
		expect(decodeFloor(encodeFloor(every), cells)).toEqual(every);
		expect(decodeFloor(encodeFloor(every.map((v) => (v === 13 ? 14 : v))), cells)).toBeNull();
		for (const id of NEW) {
			expect(isFloorId(id)).toBe(true);
			const floor = withFloor(null, grid, { x: 1, y: 1 }, { x: 2, y: 2 }, id)!;
			expect(floor[1 * 6 + 2]).toBe(FLOOR_IDS.indexOf(id));
			const known = emptyMask(grid);
			known[1 * 6 + 1] = 1;
			const seen = knownFloor(floor, known);
			expect(seen[1 * 6 + 1]).toBe(FLOOR_IDS.indexOf(id));
			expect(seen[2 * 6 + 2]).toBe(0);
		}
	});
});
