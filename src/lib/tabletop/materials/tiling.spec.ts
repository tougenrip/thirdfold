import { describe, expect, it } from 'vitest';
import { WALL_LEVELS } from '../../game/visibility';
import { STEP_HEIGHT, WALL_HEIGHT } from '../ground';
import { dominantAxis, repeatFor, repeatHeight } from './tiling';

/** Whether `a` is a whole multiple of `b`, to float error. */
const divides = (b: number, a: number) => Math.abs(a / b - Math.round(a / b)) < 1e-9;

describe('box projection (#177)', () => {
	it('samples along the normal’s largest axis', () => {
		expect(dominantAxis({ x: 1, y: 0, z: 0 })).toBe('x');
		expect(dominantAxis({ x: -0.9, y: 0.3, z: 0.1 })).toBe('x');
		expect(dominantAxis({ x: 0.1, y: -1, z: 0.2 })).toBe('y');
		expect(dominantAxis({ x: 0, y: 0.2, z: -0.7 })).toBe('z');
	});

	it('breaks ties the same way everywhere: x, then y, then z', () => {
		expect(dominantAxis({ x: 0.7, y: 0.7, z: 0 })).toBe('x');
		expect(dominantAxis({ x: -0.7, y: 0, z: 0.7 })).toBe('x');
		expect(dominantAxis({ x: 0, y: 0.7, z: -0.7 })).toBe('y');
	});
});

describe('vertical repeats (#177)', () => {
	it('fall on the level steps, so walls and the ground beside them stay in phase', () => {
		for (const cells of [0.25, 0.5, 1, 2, 3, 4, 8]) {
			const h = repeatHeight(cells, STEP_HEIGHT);
			// A whole number of steps, or a course: a step divided evenly, so it also divides a wall
			// into a multiple of WALL_LEVELS courses.
			if (h >= STEP_HEIGHT) expect(divides(STEP_HEIGHT, h)).toBe(true);
			else {
				expect(divides(h, STEP_HEIGHT)).toBe(true);
				expect(divides(WALL_LEVELS, WALL_HEIGHT / h)).toBe(true);
			}
		}
	});

	it('are as tall as the texture is wide, to the nearest step or course', () => {
		expect(repeatHeight(2, 0.4)).toBeCloseTo(2);
		expect(repeatHeight(3, 0.4)).toBeCloseTo(3.2);
		expect(repeatHeight(0.4, 0.4)).toBeCloseTo(0.4);
		expect(repeatHeight(0.1, 0.4)).toBeCloseTo(0.1);
		expect(repeatHeight(0.15, 0.4)).toBeCloseTo(0.4 / 3);
		// A wall's full height when a repeat is as wide as one.
		expect(repeatHeight(WALL_HEIGHT, STEP_HEIGHT)).toBeCloseTo(WALL_HEIGHT);
	});

	it('scale with the cell size, and give a material its repeat per world unit', () => {
		expect(repeatFor(2, 1, STEP_HEIGHT)).toEqual({ x: 0.5, y: 1 / repeatHeight(2, STEP_HEIGHT) });
		const big = repeatFor(2, 1.5, STEP_HEIGHT);
		expect(big.x).toBeCloseTo(1 / 3);
		expect(1 / big.y).toBeCloseTo(repeatHeight(2, STEP_HEIGHT) * 1.5);
		expect(repeatHeight(0, STEP_HEIGHT)).toBe(STEP_HEIGHT);
	});
});
