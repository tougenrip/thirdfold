import { describe, expect, it } from 'vitest';
import { FLASH_MS } from '$lib/game/chat';
import {
	countFlashes,
	flashAt,
	flashPolicy,
	frameSample,
	readReduceFlashing,
	reducesFlashing,
	retrigger,
	type Flash,
	type FlashPolicy,
	type FrameSample
} from './flash';

const normal = flashPolicy(false);
const reduced = flashPolicy(true);

/** The envelope sampled every 5 ms from 0 until just after the last cue's window, cues at `cues`. */
function play(policy: FlashPolicy, cues = [0]): { t: number; k: number }[] {
	let flash: Flash | null = null;
	const out: { t: number; k: number }[] = [];
	const pending = [...cues];
	for (let t = 0; t < cues[cues.length - 1] + FLASH_MS + 100; t += 5) {
		while (pending.length && pending[0] <= t) flash = retrigger(flash, pending.shift()!, policy);
		out.push({ t, k: flashAt(flash, t, policy) });
	}
	return out;
}

/** A dark scene lit by the envelope: luminance 0.02 up to 0.6. */
const frames = (env: { t: number; k: number }[]): FrameSample[] =>
	env.map(({ t, k }) => ({ t, luminance: 0.02 + 0.58 * k, red: 0.4 }));

describe('the flash envelope', () => {
	for (const [name, policy] of [
		['normal', normal],
		['reduced', reduced]
	] as const) {
		it(`is 0 at the cue, 1 through the hold and 0 at FLASH_MS (${name})`, () => {
			const f = retrigger(null, 1000, policy);
			expect(flashAt(f, 1000, policy)).toBe(0);
			expect(flashAt(f, 1000 + policy.riseMs, policy)).toBe(1);
			expect(flashAt(f, 1000 + policy.holdMs, policy)).toBe(1);
			expect(flashAt(f, 1000 + FLASH_MS - 1, policy)).toBeGreaterThan(0);
			expect(flashAt(f, 1000 + FLASH_MS, policy)).toBe(0);
			expect(flashAt(f, 999, policy)).toBe(0);
			expect(flashAt(null, 1000, policy)).toBe(0);
		});

		it(`a second cue during the hold never drops it, and holds on (${name})`, () => {
			const env = play(policy, [0, 600]);
			const held = env.filter((s) => s.t >= policy.riseMs && s.t <= 600 + policy.holdMs);
			expect(held.every((s) => s.k === 1)).toBe(true);
			expect(env.find((s) => s.t === FLASH_MS)!.k).toBeGreaterThan(0);
			expect(env.find((s) => s.t === 600 + FLASH_MS)!.k).toBe(0);
		});

		it(`a cue during the fall rises on from where it is, never dipping (${name})`, () => {
			const cue = 2000;
			const env = play(policy, [0, cue]);
			const before = env.find((s) => s.t === cue - 5)!.k;
			const rising = env.filter((s) => s.t >= cue && s.t <= cue + policy.riseMs);
			expect(before).toBeGreaterThan(0);
			expect(rising[0].k).toBeCloseTo(before, 1);
			for (let i = 1; i < rising.length; i++)
				expect(rising[i].k).toBeGreaterThanOrEqual(rising[i - 1].k);
			expect(rising[rising.length - 1].k).toBe(1);
		});
	}

	it('rises in 5% of the window normally, and fades in over 500 ms or more when reduced', () => {
		expect(normal.riseMs).toBe(0.05 * FLASH_MS);
		expect(reduced.riseMs).toBeGreaterThanOrEqual(500);
		expect(reduced.holdMs).toBeGreaterThan(normal.holdMs);
		expect(reduced.maxEV).toBeLessThanOrEqual(0.5);
		expect(reduced.bloom).toBeLessThan(normal.bloom);
		expect(reduced.hemisphere).toBeLessThan(normal.hemisphere);
		expect([normal.neutralRed, reduced.neutralRed]).toEqual([false, true]);
	});
});

describe('the Reduce flashing setting', () => {
	it('is on for on, off for off, and follows reduced motion for auto', () => {
		expect(reducesFlashing('on', false)).toBe(true);
		expect(reducesFlashing('off', true)).toBe(false);
		expect(reducesFlashing('auto', true)).toBe(true);
		expect(reducesFlashing('auto', false)).toBe(false);
	});

	it('reads back auto for anything it does not know', () => {
		expect(readReduceFlashing('on')).toBe('on');
		expect(readReduceFlashing('off')).toBe('off');
		for (const v of [undefined, null, true, 'yes', 1]) expect(readReduceFlashing(v)).toBe('auto');
	});
});

/** A square wave: `n` pulses of `ms` bright then `ms` dark from t = 100, sampled every 10 ms. */
function pulses(n: number, ms: number, lo = 0.05, hi = 0.5, red = 0.3): FrameSample[] {
	const out: FrameSample[] = [];
	for (let t = 0; t < n * 2 * ms + 300; t += 10) {
		const on = t >= 100 && t - 100 < n * 2 * ms && Math.floor((t - 100) / ms) % 2 === 0;
		out.push({ t, luminance: on ? hi : lo, red: on ? red : 0.3 });
	}
	return out;
}

describe('countFlashes (WCAG 2.3.1)', () => {
	it('counts 4 flashes in a second, which fails', () => {
		expect(countFlashes(pulses(4, 120)).flashes).toBe(4);
	});

	it('counts 3 flashes in a second as 3, which passes', () => {
		expect(countFlashes(pulses(3, 160)).flashes).toBe(3);
	});

	it('ignores changes under 10%, and those between bright states', () => {
		expect(countFlashes(pulses(10, 50, 0.1, 0.19)).flashes).toBe(0);
		expect(countFlashes(pulses(10, 50, 0.85, 1)).flashes).toBe(0);
		expect(countFlashes(pulses(10, 50, 0.75, 1)).flashes).toBeGreaterThan(3);
	});

	it('does not let small wiggles break a swing', () => {
		const ramp: FrameSample[] = [];
		for (let t = 0; t <= 1000; t += 10)
			ramp.push({ t, luminance: t / 1000 + (t % 20 ? 0.03 : 0), red: 0.3 });
		const c = countFlashes(ramp);
		expect(c.flashes).toBe(0);
		expect(c.fastestMs).toBeGreaterThanOrEqual(980);
	});

	it('times a transition from the last frame at one extreme to the first at the next', () => {
		expect(countFlashes(pulses(1, 300)).fastestMs).toBe(10);
		const fade = frames(play(reduced));
		expect(countFlashes(fade).fastestMs).toBe(reduced.riseMs);
		expect(countFlashes([]).fastestMs).toBe(Infinity);
	});

	it('catches a saturated-red pulse, even at an unchanged luminance', () => {
		const c = countFlashes(pulses(4, 120, 0.2, 0.2, 0.9));
		expect(c.flashes).toBe(0);
		expect(c.redFlashes).toBe(4);
		expect(countFlashes(pulses(4, 120, 0.2, 0.2, 0.7)).redFlashes).toBe(0);
	});

	it('passes the Bell flash in both modes, and back-to-back tolls', () => {
		// The Keeper tolls every enemy turn, a window apart by default; closer still, for safety.
		for (const cues of [[0], [0, FLASH_MS], [0, 1200, 2400], [0, 300, 600, 900]]) {
			const n = countFlashes(frames(play(normal, cues)));
			expect(n.flashes).toBeLessThanOrEqual(3);
			const r = countFlashes(frames(play(reduced, cues)));
			expect(r.flashes).toBeLessThanOrEqual(3);
			expect(r.fastestMs).toBeGreaterThanOrEqual(500);
			expect(r.redFlashes).toBe(0);
		}
		// Normally the rise is the quick flare it is meant to be.
		expect(countFlashes(frames(play(normal))).fastestMs).toBeLessThan(500);
	});
});

describe('frameSample', () => {
	it('measures the mean relative luminance and red share of a frame', () => {
		expect(frameSample(0, [255, 255, 255, 255, 255, 255, 255, 255]).luminance).toBeCloseTo(1);
		const red = frameSample(5, [255, 0, 0, 255]);
		expect(red).toEqual({ t: 5, luminance: expect.closeTo(0.2126), red: 1 });
		expect(frameSample(0, [0, 0, 0, 255])).toEqual({ t: 0, luminance: 0, red: 0 });
		expect(frameSample(0, [])).toEqual({ t: 0, luminance: 0, red: 0 });
		expect(frameSample(0, [128, 128, 128, 255]).luminance).toBeCloseTo(0.2158, 3);
	});
});
