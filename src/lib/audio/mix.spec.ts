import { describe, expect, it } from 'vitest';
import { busGain, DEFAULT_MIX, loadMix, saveMix } from './mix';
import { BELL_PARTIALS, BELLS, bellPartials } from './bell';

const memory = (items: Record<string, string> = {}) => {
	const map = new Map(Object.entries(items));
	return {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v)
	};
};

describe('the sound mix', () => {
	it('is remembered in this browser, and read back field by field', () => {
		const storage = memory();
		expect(loadMix(storage)).toEqual(DEFAULT_MIX);
		saveMix(storage, { ...DEFAULT_MIX, muted: true, music: 0.25 });
		expect(loadMix(storage)).toEqual({ ...DEFAULT_MIX, muted: true, music: 0.25 });
		const odd = memory({ 'thirdfold:audio': JSON.stringify({ music: 7, effects: 'loud' }) });
		expect(loadMix(odd)).toEqual({ ...DEFAULT_MIX, music: 1 });
		expect(loadMix(memory({ 'thirdfold:audio': '{nope' }))).toEqual(DEFAULT_MIX);
	});

	it('sets each bus from its level and the master, and mutes all of them', () => {
		expect(busGain({ ...DEFAULT_MIX, master: 0.5, music: 0.5 }, 'music')).toBe(0.25);
		expect(busGain({ ...DEFAULT_MIX, muted: true }, 'effects')).toBe(0);
	});
});

describe('the bell', () => {
	it('rings the partials of a real bell: the hum an octave down, the minor-third tierce, the nominal', () => {
		const ratios = BELL_PARTIALS.map((p) => p.ratio);
		expect(ratios).toContain(0.5);
		expect(ratios.find((r) => r > 1.15 && r < 1.22)).toBeDefined();
		expect(ratios).toContain(2);
		// The low partials ring longest.
		const [hum, prime] = bellPartials(BELLS.great.note, BELLS.great.ring);
		expect(hum.freq).toBe(BELLS.great.note / 2);
		expect(hum.length).toBeGreaterThan(prime.length);
	});

	it('makes the great bell the deepest and longest of its family', () => {
		for (const size of ['flash', 'hand', 'chime'] as const) {
			expect(BELLS.great.note).toBeLessThan(BELLS[size].note);
			expect(BELLS.great.ring).toBeGreaterThan(BELLS[size].ring);
		}
	});
});
