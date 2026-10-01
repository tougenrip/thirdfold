// The flash's envelope and its safety (#222, #223). Pure: no three.js, no DOM,
// so the server test project checks it. A `flash` cue lights the whole table
// for FLASH_MS, exactly the window the server lights it for; `flashAt` says
// how strong it is at a moment, 0 to 1, and a cue arriving while one plays
// extends the hold instead of starting again from dark. Every flashing effect
// reads `flashPolicy`: normally a near-instant rise; with Reduce flashing (the
// viewer's Graphics setting, separate from reduced motion) a fade of 500 ms or
// more, dimmer, over the same window, so it shows exactly what it did.
// `countFlashes` is WCAG 2.3.1's three-flashes rule over sampled frames.

import { FLASH_MS } from '../game/chat';

/** The viewer's Reduce flashing setting: `auto` is on while the device asks for reduced motion. */
export const REDUCE_FLASHING = ['auto', 'on', 'off'] as const;
export type ReduceFlashing = (typeof REDUCE_FLASHING)[number];

/** A saved value, or `auto` for anything else. */
export const readReduceFlashing = (v: unknown): ReduceFlashing =>
	REDUCE_FLASHING.includes(v as ReduceFlashing) ? (v as ReduceFlashing) : 'auto';

/** Whether flashes are reduced: `on`, or `auto` with reduced motion asked for. */
export const reducesFlashing = (setting: ReduceFlashing, reducedMotion: boolean): boolean =>
	setting === 'on' || (setting === 'auto' && reducedMotion);

/** How a flash may look. Every flashing effect goes through it (lightning, finale effects later). */
export interface FlashPolicy {
	/** Time to full strength, ms. */
	riseMs: number;
	/** Full strength until this long after the latest cue, ms; then a linear fall to FLASH_MS. */
	holdMs: number;
	/** The most the exposure may rise, EV (the lift is min(normal lift × k, this)). */
	maxEV: number;
	/** Shares of the normal bloom and hemisphere lifts. */
	bloom: number;
	hemisphere: number;
	/** Over a red grade, lift toward a cool white so saturated red never pulses. */
	neutralRed: boolean;
}

const NORMAL: FlashPolicy = {
	riseMs: 0.05 * FLASH_MS,
	holdMs: 0.3 * FLASH_MS,
	maxEV: Infinity,
	bloom: 1,
	hemisphere: 1,
	neutralRed: false
};

/** A fade, not a flash: WCAG counts nothing slower than this as a transition we allow. */
export const REDUCED_RISE_MS = 500;

const REDUCED: FlashPolicy = {
	riseMs: Math.max(REDUCED_RISE_MS, 0.2 * FLASH_MS),
	holdMs: 0.4 * FLASH_MS,
	maxEV: 0.5,
	bloom: 0.3,
	hemisphere: 0.5,
	neutralRed: true
};

export const flashPolicy = (reduce: boolean): FlashPolicy => (reduce ? REDUCED : NORMAL);

/** A flash playing: when its rise began and when the latest cue came. */
export interface Flash {
	start: number;
	last: number;
}

/** How strong `flash` is at `now`: 0 none (also once over), 1 everything lit. */
export function flashAt(flash: Flash | null, now: number, policy: FlashPolicy): number {
	if (!flash) return 0;
	const since = now - flash.last;
	if (since < 0 || since >= FLASH_MS) return 0;
	const rise = Math.min(1, (now - flash.start) / policy.riseMs);
	const fall =
		since <= policy.holdMs ? 1 : 1 - (since - policy.holdMs) / (FLASH_MS - policy.holdMs);
	return Math.min(rise, fall);
}

/**
 * A cue at `now`: a new flash, or, while one plays, the same one held on. Its rise carries on
 * from where the strength is, so back-to-back cues never dip back into the dark or jump up.
 */
export function retrigger(flash: Flash | null, now: number, policy: FlashPolicy): Flash {
	const k = flashAt(flash, now, policy);
	return { start: now - k * policy.riseMs, last: now };
}

/** One frame's measure: mean relative luminance (0-1) and the red share R/(R+G+B) of its mean. */
export interface FrameSample {
	t: number;
	luminance: number;
	red: number;
}

const linear = (c: number) => {
	const s = c / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** A frame's `FrameSample` from its RGBA8 sRGB pixels (read back from a canvas). */
export function frameSample(t: number, rgba: ArrayLike<number>): FrameSample {
	let r = 0;
	let g = 0;
	let b = 0;
	const n = Math.floor(rgba.length / 4);
	for (let i = 0; i < n * 4; i += 4) {
		r += linear(rgba[i]);
		g += linear(rgba[i + 1]);
		b += linear(rgba[i + 2]);
	}
	if (n === 0) return { t, luminance: 0, red: 0 };
	const sum = r + g + b;
	return { t, luminance: (0.2126 * r + 0.7152 * g + 0.0722 * b) / n, red: sum > 0 ? r / sum : 0 };
}

/** WCAG 2.3.1: a transition is a change of this much relative luminance… */
export const FLASH_DELTA = 0.1;
/** …where the darker state is below this. */
export const FLASH_DARKER = 0.8;
/** A saturated red: R/(R+G+B) at least this. */
export const SATURATED_RED = 0.8;

export interface FlashCount {
	/** The most general flashes (pairs of opposing transitions) in any one second. */
	flashes: number;
	/** The most red flashes (pairs of changes into or out of saturated red) in any one second. */
	redFlashes: number;
	/** The quickest general transition, ms (Infinity with none). */
	fastestMs: number;
}

/**
 * Counts flashes in frames sampled in time order, as WCAG 2.3.1's Understanding document defines
 * them. Transitions are the swings between turning points of at least FLASH_DELTA (smaller wiggles
 * don't break a swing), counted where the darker end is below FLASH_DARKER; a swing lasts from the
 * last sample at one extreme to the first at the next. The area is not modelled: a whole-screen
 * change always exceeds it.
 */
export function countFlashes(samples: readonly FrameSample[]): FlashCount {
	const general: { at: number; ms: number }[] = [];
	const red: number[] = [];
	if (samples.length === 0) return { flashes: 0, redFlashes: 0, fastestMs: Infinity };
	const swing = (from: FrameSample, to: FrameSample) => {
		if (Math.min(from.luminance, to.luminance) < FLASH_DARKER)
			general.push({ at: to.t, ms: to.t - from.t });
	};
	// Before a direction is known: the lowest and highest so far. After: the swing's start (the
	// last sample at the extreme before it) and the extreme so far, first and last reached.
	let lo = samples[0];
	let hi = samples[0];
	let dir = 0;
	let pivot = samples[0];
	let first = samples[0];
	let last = samples[0];
	let wasRed = samples[0].red >= SATURATED_RED;
	for (const s of samples) {
		const isRed = s.red >= SATURATED_RED;
		if (isRed !== wasRed) red.push(s.t);
		wasRed = isRed;
		const v = s.luminance;
		if (dir === 0) {
			if (v <= lo.luminance) lo = s;
			if (v >= hi.luminance) hi = s;
			if (hi.luminance - lo.luminance < FLASH_DELTA) continue;
			dir = s === hi ? 1 : -1;
			pivot = dir > 0 ? lo : hi;
			first = last = s;
		} else if (dir * (v - first.luminance) > 0) first = last = s;
		else if (v === first.luminance) last = s;
		else if (dir * (first.luminance - v) >= FLASH_DELTA) {
			swing(pivot, first);
			[pivot, first, last, dir] = [last, s, s, -dir];
		}
	}
	if (dir !== 0) swing(pivot, first);
	return {
		flashes: mostInASecond(general.map((g) => g.at)),
		redFlashes: mostInASecond(red),
		fastestMs: Math.min(Infinity, ...general.map((g) => g.ms))
	};
}

/** The most pairs of transitions (at these times, in order) within any one second. */
function mostInASecond(times: readonly number[]): number {
	let most = 0;
	for (let i = 0, j = 0; i < times.length; i++) {
		while (times[i] - times[j] >= 1000) j++;
		most = Math.max(most, Math.floor((i - j + 1) / 2));
	}
	return most;
}
