import { describe, expect, it } from 'vitest';
import { FLICKERS, LIGHT_KIND_DEFAULTS, lightLook } from '../game/lights';
import {
	FLICKER_PERIOD,
	FLICKER_WAVES,
	flickerAt,
	flickerPhase,
	flickerProfile
} from './light-model';

const profiles = FLICKERS.map((f) => flickerProfile(f));

describe('flicker (#231)', () => {
	it('stays within 8% of the light and every wave under 3 Hz (WCAG 2.3.1)', () => {
		for (const f of FLICKERS) {
			const [a1, f1, a2, f2] = FLICKER_WAVES[f];
			expect(a1 + a2, f).toBeLessThanOrEqual(0.08);
			expect(Math.max(f1, f2), f).toBeLessThan(3);
			const p = flickerProfile(f);
			for (let t = 0; t < 20; t += 0.013) {
				expect(Math.abs(flickerAt(p, 0.37, t) - 1)).toBeLessThanOrEqual(0.08 + 1e-12);
			}
		}
	});

	it('wraps at FLICKER_PERIOD without a jump: every wave is whole cycles in it', () => {
		for (const f of FLICKERS) {
			for (const hz of [FLICKER_WAVES[f][1], FLICKER_WAVES[f][3]]) {
				expect(Math.abs(hz * FLICKER_PERIOD - Math.round(hz * FLICKER_PERIOD))).toBeLessThan(1e-9);
			}
			const p = flickerProfile(f);
			expect(flickerAt(p, 0.2, 3.4 + FLICKER_PERIOD)).toBeCloseTo(flickerAt(p, 0.2, 3.4), 9);
		}
	});

	it('holds still without a profile, and moves with one', () => {
		for (let t = 0; t < 5; t += 0.1) expect(flickerAt(flickerProfile('none'), 0.5, t)).toBe(1);
		for (const p of profiles.slice(1)) {
			const seen = new Set([0, 0.25, 0.5, 0.75].map((t) => flickerAt(p, 0.1, t).toFixed(6)));
			expect(seen.size).toBeGreaterThan(1);
		}
	});

	it('is the same for the same light and time, on any client', () => {
		const phase = flickerPhase('light-12');
		expect(phase).toBe(flickerPhase('light-12'));
		expect(phase).toBeGreaterThanOrEqual(0);
		expect(phase).toBeLessThan(1);
		expect(flickerAt(2, phase, 7.25)).toBe(flickerAt(2, flickerPhase('light-12'), 7.25));
		// Another light keeps its own beat, whatever else comes and goes.
		expect(flickerPhase('light-13')).not.toBe(phase);
	});

	it('gives each kind its profile: flames flicker, lanterns gently, glows and panels never', () => {
		const amp = (kind: keyof typeof LIGHT_KIND_DEFAULTS) => {
			const [a1, , a2] = FLICKER_WAVES[lightLook({ kind }).flicker];
			return a1 + a2;
		};
		for (const kind of ['torch', 'candle', 'brazier', 'fire'] as const) {
			expect(amp(kind)).toBeGreaterThan(amp('lantern'));
		}
		expect(amp('lantern')).toBeGreaterThan(0);
		for (const kind of ['glow', 'neon', 'panel'] as const) expect(amp(kind)).toBe(0);
	});
});
