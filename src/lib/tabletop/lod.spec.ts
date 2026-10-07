import { describe, expect, it } from 'vitest';
import { FIGURE_LODS, lodFor, projectedSize } from './lod';

const FOV = (45 * Math.PI) / 180;
const VIEW = 800;
/** The distance at which a unit sphere projects to `px`. */
const at = (px: number) => VIEW / (2 * Math.tan(FOV / 2)) / px;
const level = (px: number, current = 0, bias = 0) =>
	lodFor(1, at(px), FOV, VIEW, FIGURE_LODS, current, bias);

describe('lodFor', () => {
	it('projects a sphere to its radius in px', () => {
		expect(projectedSize(1, at(50), FOV, VIEW)).toBeCloseTo(50);
		expect(projectedSize(2, at(50), FOV, VIEW)).toBeCloseTo(100);
	});

	it('drops a level below each threshold', () => {
		const [t1, t2] = FIGURE_LODS;
		expect(level(t1 * 2)).toBe(0);
		expect(level(t1 * 0.8)).toBe(1);
		expect(level(t2 * 0.8)).toBe(2);
		expect(level(t2 * 0.01)).toBe(2);
	});

	it('holds a level within 0.9 to 1.1 of a threshold, back and forth', () => {
		const [t1, t2] = FIGURE_LODS;
		for (const [t, i] of [
			[t1, 0],
			[t2, 1]
		]) {
			let current = i;
			const seen = new Set<number>();
			for (const f of [0.95, 1.05, 0.92, 1.08, 1, 0.91, 1.09]) {
				current = level(t * f, current);
				seen.add(current);
			}
			expect([...seen]).toEqual([i]); // never flickers inside the band
			expect(level(t * 0.89, i)).toBe(i + 1); // past it, it switches
			expect(level(t * 1.0, i + 1)).toBe(i + 1); // and stays coarse until 1.1
			expect(level(t * 1.11, i + 1)).toBe(i);
		}
	});

	it('biases one level coarser, never past the last', () => {
		const [t1, t2] = FIGURE_LODS;
		expect(level(t1 * 2, 0, 1)).toBe(1);
		expect(level(t1 * 0.8, 1, 1)).toBe(2);
		expect(level(t2 * 0.5, 2, 1)).toBe(2);
		// The hysteresis reads the level before the bias.
		expect(level(t1 * 1.05, 2, 1)).toBe(2);
		expect(level(t1 * 1.2, 2, 1)).toBe(1);
	});

	it('keeps the finest level on degenerate views', () => {
		for (const d of [0, -1, NaN, Infinity * 0])
			expect(lodFor(1, d, FOV, VIEW, FIGURE_LODS, 2, 0)).toBe(0);
		expect(lodFor(0, 10, FOV, VIEW, FIGURE_LODS, 2, 0)).toBe(0);
		expect(lodFor(1, 0, FOV, VIEW, FIGURE_LODS, 0, 1)).toBe(1);
		expect(lodFor(1, 10, FOV, VIEW, [], 0, 1)).toBe(0); // no levels: always the model
		// Infinitely far: the coarsest.
		expect(lodFor(1, Infinity, FOV, VIEW, FIGURE_LODS, 0, 0)).toBe(2);
	});
});
