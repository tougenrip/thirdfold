import { describe, expect, it } from 'vitest';
import type { SquareGrid } from './grid';
import { canStep, findPath, isReachable, windowEdges, type SceneObject } from './objects';
import { obstaclesFor } from './props';
import {
	decodeLevels,
	encodeLevels,
	flatLevels,
	knownLevels,
	levelAt,
	MAX_LEVEL,
	withLevel
} from './terrain';
import { addVision, emptyMask, hasLineOfSight, cellIndex } from './visibility';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 12, height: 8 };

/** A room with a balcony along its east end (x 8-11 at level 5) and a stair up to it along y 7. */
function balcony(): Uint8Array {
	let levels = withLevel(null, grid, { x: 8, y: 0 }, { x: 11, y: 7 }, 5)!;
	for (const [x, level] of [
		[4, 1],
		[5, 2],
		[6, 3],
		[7, 4]
	]) {
		levels = withLevel(levels, grid, { x, y: 7 }, { x, y: 7 }, level)!;
	}
	return levels;
}

describe('levels', () => {
	it('sets areas, reads cells, and goes back to flat (null) when everything is level 0', () => {
		const raised = withLevel(null, grid, { x: 1, y: 1 }, { x: 2, y: 2 }, 3);
		expect(levelAt(raised, grid, { x: 2, y: 2 })).toBe(3);
		expect(levelAt(raised, grid, { x: 3, y: 2 })).toBe(0);
		expect(levelAt(raised, grid, { x: 99, y: 2 })).toBe(0);
		expect(withLevel(raised, grid, { x: 0, y: 0 }, { x: 11, y: 7 }, 0)).toBeNull();
	});

	it('round-trips through base64 and refuses the wrong size or levels too high', () => {
		const levels = balcony();
		expect(decodeLevels(encodeLevels(levels), levels.length)).toEqual(levels);
		expect(decodeLevels(encodeLevels(levels), levels.length + 1)).toBeNull();
		const tooHigh = flatLevels(grid);
		tooHigh[3] = MAX_LEVEL + 1;
		expect(decodeLevels(encodeLevels(tooHigh), tooHigh.length)).toBeNull();
		expect(decodeLevels('not base64!', 4)).toBeNull();
	});

	it('shows a viewer only the ground it has explored', () => {
		const known = emptyMask(grid);
		known[cellIndex(grid, { x: 9, y: 3 })] = 1;
		const seen = knownLevels(balcony(), known);
		expect(seen[cellIndex(grid, { x: 9, y: 3 })]).toBe(5);
		expect(seen[cellIndex(grid, { x: 9, y: 4 })]).toBe(0);
		expect(knownLevels(balcony(), null)).toEqual(balcony());
	});
});

describe('moving with elevation', () => {
	const blocked = () => obstaclesFor(grid, [], [], balcony());

	it('climbs or drops one level a step, never more', () => {
		expect(canStep(blocked(), { x: 7, y: 7 }, { x: 8, y: 7 })).toBe(true);
		expect(canStep(blocked(), { x: 7, y: 6 }, { x: 8, y: 6 })).toBe(false);
		expect(canStep(blocked(), { x: 8, y: 6 }, { x: 7, y: 6 })).toBe(false);
		// A diagonal needs a leg that climbs one level at most, too.
		expect(canStep(blocked(), { x: 7, y: 6 }, { x: 8, y: 7 })).toBe(false);
	});

	it('reaches the balcony only by the stair', () => {
		const path = findPath(grid, blocked(), { x: 1, y: 1 }, (c) => c.x === 10 && c.y === 2);
		expect(path).not.toBeNull();
		// Up the stair (it may cut a corner onto it, one level at a time).
		expect(path!.some((p) => p.y === 7 && p.x >= 5 && p.x <= 8)).toBe(true);
		const noStair = withLevel(balcony(), grid, { x: 4, y: 7 }, { x: 7, y: 7 }, 0);
		expect(
			isReachable(grid, obstaclesFor(grid, [], [], noStair), { x: 1, y: 1 }, { x: 10, y: 2 })
		).toBe(false);
	});

	it('changes nothing on a flat table', () => {
		const flat = obstaclesFor(grid, [], []);
		expect(flat.levels).toBeNull();
		expect(canStep(flat, { x: 7, y: 6 }, { x: 8, y: 6 })).toBe(true);
	});
});

describe('seeing between levels', () => {
	const blocked = (objects: SceneObject[] = [], levels: Uint8Array | null = balcony()) =>
		obstaclesFor(grid, objects, [], levels);

	it('lets the floor and the balcony edge see each other', () => {
		expect(hasLineOfSight(blocked(), { x: 2, y: 3 }, { x: 8, y: 3 })).toBe(true);
		expect(hasLineOfSight(blocked(), { x: 8, y: 3 }, { x: 2, y: 3 })).toBe(true);
	});

	it('hides what stands back from the edge from someone right under it', () => {
		// Just below the balcony's edge, the edge itself hides the far side of the balcony.
		expect(hasLineOfSight(blocked(), { x: 7, y: 3 }, { x: 11, y: 3 })).toBe(false);
		// From the balcony, looking out over the edge, the floor far below is in view.
		expect(hasLineOfSight(blocked(), { x: 11, y: 3 }, { x: 0, y: 3 })).toBe(true);
	});

	it('sees over a wall from high enough, but not from beside it', () => {
		// A wall between x 4 and 5 across the whole room, and a tower (level 10) at x 8-11.
		const wall: SceneObject = { id: 'w', kind: 'wall', a: { x: 5, y: 0 }, b: { x: 5, y: 8 } };
		const tower = withLevel(null, grid, { x: 8, y: 0 }, { x: 11, y: 7 }, 10);
		expect(hasLineOfSight(blocked([wall], null), { x: 1, y: 3 }, { x: 6, y: 3 })).toBe(false);
		// From the top of the tower, a floor-level wall below doesn't block the view down.
		expect(hasLineOfSight(blocked([wall], tower), { x: 8, y: 3 }, { x: 1, y: 3 })).toBe(true);
		// From a balcony only as high as the wall, it still does (the line dips below its top).
		expect(hasLineOfSight(blocked([wall]), { x: 8, y: 3 }, { x: 1, y: 3 })).toBe(false);
		// Standing on the floor behind it, it does too.
		expect(hasLineOfSight(blocked([wall], tower), { x: 7, y: 3 }, { x: 1, y: 3 })).toBe(false);
	});

	it('lets sight through windows but not feet', () => {
		const window: SceneObject = {
			id: 'win',
			kind: 'wall',
			a: { x: 5, y: 0 },
			b: { x: 5, y: 8 },
			window: true
		};
		const o = blocked([window], null);
		expect(windowEdges([window]).size).toBe(8);
		expect(hasLineOfSight(o, { x: 1, y: 3 }, { x: 6, y: 3 })).toBe(true);
		expect(isReachable(grid, o, { x: 1, y: 3 }, { x: 6, y: 3 })).toBe(false);
	});

	it('gives vision reaching up and down the same way', () => {
		const mask = emptyMask(grid);
		addVision(grid, blocked(), { x: 10, y: 3 }, 12, mask);
		expect(mask[cellIndex(grid, { x: 1, y: 3 })]).toBe(1);
		const below = emptyMask(grid);
		addVision(grid, blocked(), { x: 7, y: 3 }, 12, below);
		expect(below[cellIndex(grid, { x: 11, y: 3 })]).toBe(0);
		expect(below[cellIndex(grid, { x: 8, y: 3 })]).toBe(1);
	});
});
