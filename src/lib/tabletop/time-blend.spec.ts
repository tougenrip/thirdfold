import { describe, expect, it } from 'vitest';
import { canonicalTime } from '$lib/game/world';
import { oneHot, presetWeights } from './time-blend';

const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);

describe('presetWeights', () => {
	it('is one-hot at each band canonical hour, so older tables draw as before', () => {
		for (const band of ['day', 'dusk', 'dark'] as const)
			expect(presetWeights(canonicalTime(band))).toEqual(oneHot(band));
		expect(presetWeights(360)).toEqual(oneHot('dusk')); // 06:00
	});

	it('holds day from 08:00 to 17:30 and dark from 22:00 to 04:30', () => {
		for (const t of [480, 600, 1050]) expect(presetWeights(t)).toEqual(oneHot('day'));
		for (const t of [1320, 1439, 0, 120, 270]) expect(presetWeights(t)).toEqual(oneHot('dark'));
	});

	it('mixes at most two presets and sums to 1 every minute', () => {
		for (let t = 0; t < 1440; t++) {
			const w = presetWeights(t);
			expect(sum(w)).toBeCloseTo(1, 12);
			expect(Object.values(w).filter((v) => v > 0).length).toBeLessThanOrEqual(2);
			for (const v of Object.values(w)) expect(v).toBeGreaterThanOrEqual(0);
		}
	});

	it('is linear between keys: 20:30 is 60% dusk, 06:30 a quarter day', () => {
		const late = presetWeights(1230);
		expect(late.dusk).toBeCloseTo(0.6, 12);
		expect(late.dark).toBeCloseTo(0.4, 12);
		expect(presetWeights(390).day).toBeCloseTo(0.25, 12);
	});

	it('is continuous, across midnight too, and wraps', () => {
		for (let t = 0; t < 1440; t++) {
			const [a, b] = [presetWeights(t), presetWeights(t + 1)];
			for (const k of ['day', 'dusk', 'dark'] as const)
				expect(Math.abs(a[k] - b[k])).toBeLessThanOrEqual(1 / 90 + 1e-12);
		}
		expect(presetWeights(1440 + 390)).toEqual(presetWeights(390));
		expect(presetWeights(-60)).toEqual(presetWeights(1380));
	});
});
