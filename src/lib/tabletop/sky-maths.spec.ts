// The dome's star field (#214) and the environment's capture throttle (#216): pure, so every
// client draws the same sky and a sweep of the hour captures the sky a bounded number of times.

import { describe, expect, it } from 'vitest';
import { CAPTURE_INTERVAL_MS, CaptureThrottle, STAR_COUNT, starField } from './sky-maths';

describe('starField', () => {
	it('is the same for a seed and differs between seeds', () => {
		const a = starField(7, 200);
		expect(starField(7, 200)).toEqual(a);
		expect(starField(8, 200).directions).not.toEqual(a.directions);
	});

	it('places unit directions above the floor, sizes 1-3 px, most faint, a few tinted', () => {
		const { directions, sizes, colors } = starField(1, STAR_COUNT);
		expect(directions.length).toBe(STAR_COUNT * 3);
		let faint = 0;
		let tinted = 0;
		for (let i = 0; i < STAR_COUNT; i++) {
			const [x, y, z] = directions.subarray(i * 3, i * 3 + 3);
			expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
			expect(y).toBeGreaterThanOrEqual(-0.1);
			expect(sizes[i]).toBeGreaterThanOrEqual(1);
			expect(sizes[i]).toBeLessThanOrEqual(3);
			const [r, g, b] = colors.subarray(i * 3, i * 3 + 3);
			if (Math.max(r, g, b) < 0.3) faint++;
			if (r !== g || g !== b) tinted++;
		}
		expect(faint / STAR_COUNT).toBeGreaterThan(0.5);
		expect(tinted).toBeGreaterThan(0);
		expect(tinted / STAR_COUNT).toBeLessThan(0.1);
	});
});

describe('CaptureThrottle', () => {
	it('captures a 10 s, 24-hour sweep at most 6 times plus the trailing one', () => {
		const t = new CaptureThrottle(CAPTURE_INTERVAL_MS.high);
		let captures = 0;
		// A new key every 16 ms frame for 10 s.
		for (let now = 0, i = 0; now < 10_000; now += 16, i++) if (t.due(`k${i}`, now)) captures++;
		expect(captures).toBeLessThanOrEqual(6);
		const at = t.nextAt();
		expect(at).not.toBeNull();
		expect(t.due('final', at! - 1)).toBe(false);
		expect(t.due('final', at!)).toBe(true);
		expect(t.nextAt()).toBeNull();
	});

	it('never captures an unchanged key again, and waits for nothing then', () => {
		const t = new CaptureThrottle(2000);
		expect(t.due('a', 0)).toBe(true);
		expect(t.due('a', 10_000)).toBe(false);
		expect(t.nextAt()).toBeNull();
	});

	it('captures once per table on low', () => {
		const t = new CaptureThrottle(CAPTURE_INTERVAL_MS.low);
		expect(t.due('a', 0)).toBe(true);
		expect(t.due('b', 1e9)).toBe(false);
		expect(t.nextAt()).toBeNull();
		t.reset();
		expect(t.due('b', 1e9)).toBe(true);
	});
});
