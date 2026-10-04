// The shader grid's maths (#245), mirrored in grid-modes.ts: Golus's line coverage, the modes'
// strengths, explore mode's falloff, and the highlight's patterns, which tell move, blocked and
// place apart by shape alone (G6: in greyscale and under any colour-vision deficiency, where
// colour-vision.spec.ts finds three pairs of their colours too close).

import { describe, expect, it } from 'vitest';
import {
	distanceFade,
	exploreTerm,
	EXPLORE_INNER,
	EXPLORE_RADIUS,
	GRID_MODES,
	GRID_STRENGTH,
	HIGHLIGHT_PATTERN,
	LINE_WIDTH,
	lineCoverage,
	PATTERN_INSET,
	patternCovers
} from './grid-modes';

const SAMPLES = 64;
/** Pattern `p`'s coverage over a cell, sampled at the centres of a 64×64 lattice. */
const mask = (p: number) =>
	Array.from({ length: SAMPLES * SAMPLES }, (_, i) =>
		patternCovers(p, ((i % SAMPLES) + 0.5) / SAMPLES, (Math.floor(i / SAMPLES) + 0.5) / SAMPLES)
	);

describe('the grid lines', () => {
	it('cover the line and nothing between lines, close up', () => {
		const pixel = 0.005; // a cell 200 px across
		expect(lineCoverage(0, pixel)).toBeCloseTo(1, 5);
		expect(lineCoverage(3, pixel)).toBeCloseTo(1, 5);
		expect(lineCoverage(0.5, pixel)).toBe(0);
		expect(lineCoverage(LINE_WIDTH * 2, pixel)).toBe(0);
	});

	it('are never drawn thinner than a pixel: a thin line is fainter instead', () => {
		const pixel = 0.1; // a line narrower than a pixel
		const peak = lineCoverage(0, pixel);
		expect(peak).toBeGreaterThan(0);
		expect(peak).toBeLessThanOrEqual(LINE_WIDTH / pixel + 1e-9);
		expect(lineCoverage(pixel / 2, pixel)).toBeGreaterThan(0);
	});

	it('fade to their average where cells shrink below a pixel, so they cannot shimmer', () => {
		const far = Array.from({ length: 50 }, (_, i) => lineCoverage(i / 50, 2));
		for (const c of far) expect(c).toBeCloseTo(LINE_WIDTH, 6);
	});

	it('fade with the camera distance', () => {
		expect(distanceFade(10)).toBe(1);
		expect(distanceFade(65)).toBeGreaterThan(0);
		expect(distanceFade(65)).toBeLessThan(1);
		expect(distanceFade(200)).toBe(0);
	});
});

describe('the grid modes', () => {
	it('weigh the lines: full in build and explore, faint in overview, none off', () => {
		expect(GRID_MODES).toEqual(['build', 'explore', 'overview', 'off']);
		expect(GRID_STRENGTH.build).toBe(1);
		expect(GRID_STRENGTH.explore).toBe(1);
		expect(GRID_STRENGTH.overview).toBeGreaterThan(0);
		expect(GRID_STRENGTH.overview).toBeLessThan(0.5);
		expect(GRID_STRENGTH.off).toBe(0);
	});

	it('show explore mode round the focus, fading out by its radius', () => {
		expect(exploreTerm(0)).toBe(1);
		expect(exploreTerm(EXPLORE_INNER)).toBe(1);
		expect(exploreTerm((EXPLORE_INNER + EXPLORE_RADIUS) / 2)).toBeCloseTo(0.5, 5);
		expect(exploreTerm(EXPLORE_RADIUS)).toBe(0);
		for (let d = 0; d < 5; d += 0.25)
			expect(exploreTerm(d + 0.25)).toBeLessThanOrEqual(exploreTerm(d));
	});
});

describe('the highlight patterns', () => {
	const kinds = Object.entries(HIGHLIGHT_PATTERN);

	it('are none with no highlight, and never cover the grid line at the edge', () => {
		expect(mask(0).some(Boolean)).toBe(false);
		for (const [, p] of kinds)
			for (const t of [0, PATTERN_INSET / 2, 1 - PATTERN_INSET / 2])
				for (const s of [0.1, 0.5, 0.9]) {
					expect(patternCovers(p, t, s)).toBe(false);
					expect(patternCovers(p, s, t)).toBe(false);
				}
	});

	it('fill (move), hatch (blocked) and bracket the corners (place)', () => {
		const share = (p: number) => mask(p).filter(Boolean).length / SAMPLES ** 2;
		expect(share(HIGHLIGHT_PATTERN.move)).toBeGreaterThan(0.8);
		expect(share(HIGHLIGHT_PATTERN.blocked)).toBeGreaterThan(0.35);
		expect(share(HIGHLIGHT_PATTERN.blocked)).toBeLessThan(0.55);
		expect(share(HIGHLIGHT_PATTERN.place)).toBeGreaterThan(0.08);
		expect(share(HIGHLIGHT_PATTERN.place)).toBeLessThan(0.3);
		// Blocked's stripes run diagonally; place leaves the cell's middle and edges' middles bare.
		expect(patternCovers(HIGHLIGHT_PATTERN.place, 0.5, 0.5)).toBe(false);
		expect(patternCovers(HIGHLIGHT_PATTERN.place, 0.5, 0.08)).toBe(false);
		expect(patternCovers(HIGHLIGHT_PATTERN.place, 0.08, 0.08)).toBe(true);
	});

	it('are told apart by shape alone: every pair differs over a quarter of the cell', () => {
		for (const [i, [a, p]] of kinds.entries())
			for (const [b, q] of kinds.slice(i + 1)) {
				const [m, n] = [mask(p), mask(q)];
				const differ = m.filter((v, k) => v !== n[k]).length / SAMPLES ** 2;
				expect(differ, `${a}/${b}`).toBeGreaterThan(0.25);
			}
	});
});
