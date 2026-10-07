// The tile ring (#254): tiers, the fade, and that nothing pops at its edge: past the ring a tile's
// top lies under the ground, which has risen back to its floor; inside, the ground lies the bed
// below the tops, and in between both move smoothly with the fade.

import { describe, expect, it } from 'vitest';
import {
	BED_DEPTH,
	rectInRing,
	RING_BAND,
	ringCells,
	ringFade,
	TILE_RING,
	TILE_SINK
} from './tile-ring';

describe('the tile ring', () => {
	it('draws none on low, a ring on medium and high, the whole table on ultra', () => {
		expect(TILE_RING.low).toBe(0);
		expect(TILE_RING.medium).toBeLessThan(TILE_RING.high);
		const grid = { width: 48, height: 36 };
		expect(ringCells('ultra', grid)).toBe(60);
		expect(ringCells('medium', grid)).toBe(12);
		expect(ringFade(0, 0)).toBe(0);
	});

	it('fades over the band inside the radius, smoothly', () => {
		expect(ringFade(0, 12)).toBe(1);
		expect(ringFade(12 - RING_BAND, 12)).toBe(1);
		expect(ringFade(12, 12)).toBe(0);
		expect(ringFade(30, 12)).toBe(0);
		let last = 1;
		for (let d = 8; d <= 12; d += 0.05) {
			const f = ringFade(d, 12);
			expect(f).toBeLessThanOrEqual(last);
			expect(last - f).toBeLessThan(0.03);
			last = f;
		}
	});

	it('leaves no tile above the ground past the ring, and the bed under them inside it', () => {
		for (let d = 0; d <= 14; d += 0.25) {
			const f = ringFade(d, 12);
			const ground = -BED_DEPTH * f;
			const top = -TILE_SINK * (1 - f);
			if (f === 0) expect(top).toBeLessThan(ground);
			if (f === 1) expect(ground).toBeLessThan(top);
		}
	});

	it('finds the chunks the ring reaches', () => {
		const box = { x0: 0, z0: 0, x1: 16, z1: 16 };
		expect(rectInRing(box, 8, 8, 1)).toBe(true);
		expect(rectInRing(box, 30, 8, 12)).toBe(false);
		expect(rectInRing(box, 27, 8, 12)).toBe(true);
		expect(rectInRing(box, 8, 8, 0)).toBe(false);
	});
});
