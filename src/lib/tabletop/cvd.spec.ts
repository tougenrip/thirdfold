// The colour-vision helpers (cvd.ts): OKLab against its published values, and what the
// simulations do to colours a dichromat confuses or keeps apart.

import { describe, expect, it } from 'vitest';
import { linear, oklab, oklabDistance, simulate, simulatePixels, type Deficiency } from './cvd';

describe('colour vision', () => {
	it('puts white and red at their published OKLab values', () => {
		oklab(linear(0xffffff)).forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0][i], 3));
		oklab(linear(0xff0000)).forEach((v, i) => expect(v).toBeCloseTo([0.628, 0.2249, 0.1258][i], 3));
	});

	it('leaves greys grey under every deficiency', () => {
		for (const kind of ['protanopia', 'deuteranopia', 'tritanopia'] as const) {
			const [r, g, b] = simulate(linear(0x808080), kind);
			expect(Math.abs(r - g) + Math.abs(g - b)).toBeLessThan(0.01);
		}
	});

	it('takes the hue out of red against green under protanopia and deuteranopia only', () => {
		const [red, green] = [0xd62728, 0x2ca02c];
		/** How far apart their hues lie: OKLab's a and b, lightness aside. */
		const hues = (kind: Deficiency | null) => {
			const [p, q] = [red, green].map((c) => oklab(kind ? simulate(linear(c), kind) : linear(c)));
			return Math.hypot(p[1] - q[1], p[2] - q[2]);
		};
		expect(hues('protanopia')).toBeLessThan(hues(null) / 3);
		expect(hues('deuteranopia')).toBeLessThan(hues(null) / 3);
		expect(hues('tritanopia')).toBeGreaterThan(hues(null) / 3);
		expect(oklabDistance(red, green)).toBeGreaterThan(0.2);
	});
});

describe('simulated pixels', () => {
	it('keep greys and alpha, and turn red toward olive under deuteranopia', () => {
		const out = simulatePixels([128, 128, 128, 255, 255, 0, 0, 7], 'deuteranopia');
		expect([...out.slice(0, 3)].every((v) => Math.abs(v - 128) <= 1)).toBe(true);
		expect(out[3]).toBe(255);
		expect(out[7]).toBe(7);
		// Red's green rises toward its red: a dichromat sees a dark yellow.
		expect(out[5]).toBeGreaterThan(out[4] / 2);
	});
});
