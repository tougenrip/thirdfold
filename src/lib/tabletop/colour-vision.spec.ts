// G6 (#157): the highlight colours that mean move, blocked and place must stay
// told apart under the three dichromacies. Each colour goes to linear light,
// through Machado, Oliveira and Fernandes (2009)'s simulation at severity 1.0,
// then to CIE Lab (D65), and every pair must lie at least MIN_DELTA_E apart
// (CIE76). The overlay draws these colours exactly (overlay.svelte.spec.ts), so
// the material colours are the ones on screen.

import { describe, expect, it } from 'vitest';
import { HIGHLIGHT } from './previews';

/**
 * CIE76 ΔE 2.3 is a just-noticeable difference between patches side by side. A highlight is a
 * small patch seen on its own, drawn at 35% over a textured floor, which leaves about a third of
 * its difference on screen: 20 at full colour keeps some 7 there, a clear difference, not a
 * squint. It is also where categorical palettes are usually held apart.
 */
const MIN_DELTA_E = 20;

/** Machado 2009, severity 1.0, rows of a 3×3 matrix on linear RGB. */
const SIMULATIONS = {
	protanopia: [
		[0.152286, 1.052583, -0.204868],
		[0.114503, 0.786281, 0.099216],
		[-0.003882, -0.048116, 1.051998]
	],
	deuteranopia: [
		[0.367322, 0.860646, -0.227968],
		[0.280085, 0.672501, 0.047413],
		[-0.01182, 0.04294, 0.968881]
	],
	tritanopia: [
		[1.255528, -0.076749, -0.178779],
		[-0.078411, 0.930809, 0.147602],
		[0.004733, 0.691367, 0.3039]
	]
};

/** Pairs that fall short today, reported on #157 rather than recoloured here. */
const KNOWN_SHORT = new Set([
	'protanopia move/place',
	'deuteranopia move/blocked',
	'deuteranopia blocked/place'
]);

const linear = (hex: number) =>
	[16, 8, 0].map((s) => {
		const c = ((hex >> s) & 255) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});

/** Linear sRGB to CIE Lab (D65), clamped to the gamut first as a screen would. */
function lab(rgb: number[]): number[] {
	const [r, g, b] = rgb.map((v) => Math.min(Math.max(v, 0), 1));
	const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
	const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
	const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
	return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const simulate = (m: number[][], c: number[]) =>
	m.map((row) => row.reduce((sum, k, i) => sum + k * c[i], 0));

function deltaE(a: number, b: number, m: number[][]): number {
	const [p, q] = [a, b].map((hex) => lab(simulate(m, linear(hex))));
	return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

describe('the highlight colours under colour-vision deficiency', () => {
	it('come out at the published Lab values without a simulation', () => {
		// sRGB white is L 100; pure red is Lab (53.24, 80.09, 67.20).
		const identity = [
			[1, 0, 0],
			[0, 1, 0],
			[0, 0, 1]
		];
		expect(lab(simulate(identity, linear(0xffffff)))[0]).toBeCloseTo(100, 1);
		lab(linear(0xff0000)).forEach((v, i) => expect(v).toBeCloseTo([53.24, 80.09, 67.2][i], 1));
	});

	const kinds = Object.keys(HIGHLIGHT) as (keyof typeof HIGHLIGHT)[];
	const pairs = kinds.flatMap((a, i) => kinds.slice(i + 1).map((b) => [a, b] as const));
	for (const [name, m] of Object.entries(SIMULATIONS))
		for (const [a, b] of pairs) {
			const label = `${name} ${a}/${b}`;
			// A known shortfall is expected to fail: when the colours change and it passes, this
			// fails instead, so the list is kept honest.
			const test = KNOWN_SHORT.has(label) ? it.fails : it;
			test(`keeps ${a} and ${b} apart under ${name}`, () => {
				expect(deltaE(HIGHLIGHT[a], HIGHLIGHT[b], m)).toBeGreaterThanOrEqual(MIN_DELTA_E);
			});
		}
});
