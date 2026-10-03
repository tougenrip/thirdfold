// The focus's exposure lift (#233): none by day or over anything unseen, up to the cap in the
// dark, less as light reaches the focus, continuous, and never past the floor that keeps an
// unlit night cell dark.

import { describe, expect, it } from 'vitest';
import { NIGHT_DARK } from './cell-maps';
import { DARK_CEILING, exposureFor, LIFT_CAP, MAX_LIFT, type ExposureFocus } from './exposure';

const at = (f: Partial<ExposureFocus>): number =>
	exposureFor({ band: 'dark', focusDark: false, focusLight: 0, focusVisible: true, ...f });

describe('exposureFor', () => {
	it('is 0 in the open by day and at dusk', () => {
		expect(at({ band: 'day' })).toBe(0);
		expect(at({ band: 'dusk' })).toBe(0);
	});

	it('lifts in the dark band, and in a dark area at any hour', () => {
		expect(at({})).toBe(LIFT_CAP);
		expect(at({ band: 'day', focusDark: true })).toBe(LIFT_CAP);
		expect(at({ band: 'dusk', focusDark: true })).toBe(LIFT_CAP);
	});

	it('lifts less as light reaches the focus', () => {
		let last = Infinity;
		for (let light = 0; light <= 1; light += 0.1) {
			const lift = at({ focusLight: light });
			expect(lift).toBeLessThan(last);
			expect(lift).toBeGreaterThan(0);
			last = lift;
		}
	});

	it('is 0 when the viewer cannot see the focus', () => {
		expect(at({ focusVisible: false })).toBe(0);
		expect(at({ band: 'day', focusDark: true, focusVisible: false })).toBe(0);
	});

	it('keeps an unlit night cell under the ceiling', () => {
		expect(LIFT_CAP).toBeLessThanOrEqual(MAX_LIFT);
		expect(LIFT_CAP).toBeGreaterThan(1);
		expect((1 - NIGHT_DARK) * 2 ** at({})).toBeLessThanOrEqual(DARK_CEILING + 1e-9);
		expect(at({ focusLight: -1 })).toBe(LIFT_CAP);
		expect(at({ focusLight: 2 })).toBe(at({ focusLight: 1 }));
	});

	it('is continuous in the light', () => {
		for (let light = 0; light < 1; light += 0.01)
			expect(Math.abs(at({ focusLight: light + 0.001 }) - at({ focusLight: light }))).toBeLessThan(
				0.01
			);
	});
});
