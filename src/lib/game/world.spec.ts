import { describe, expect, it } from 'vitest';
import type { Ambient } from './lights';
import { MAX_LEVEL } from './terrain';
import {
	ambientFor,
	applyWorldPatch,
	bandOf,
	canonicalTime,
	DEFAULT_WORLD,
	defaultWorldFor,
	parseWorldLook,
	parseWorldPatch,
	withBand,
	type WorldLook
} from './world';

const at = (h: number, m: number) => h * 60 + m;
const BANDS: Ambient[] = ['day', 'dusk', 'dark'];

describe('bandOf', () => {
	it('puts every edge in its band', () => {
		const edges: [number, Ambient][] = [
			[at(0, 0), 'dark'],
			[at(4, 59), 'dark'],
			[at(5, 0), 'dusk'],
			[at(6, 59), 'dusk'],
			[at(7, 0), 'day'],
			[at(18, 59), 'day'],
			[at(19, 0), 'dusk'],
			[at(20, 59), 'dusk'],
			[at(21, 0), 'dark'],
			[at(23, 59), 'dark']
		];
		for (const [time, band] of edges) expect(bandOf(time), `${time}`).toBe(band);
	});

	it('round-trips each band through its canonical hour', () => {
		expect(BANDS.map(canonicalTime)).toEqual([720, 1170, 1380]);
		for (const b of BANDS) expect(bandOf(canonicalTime(b))).toBe(b);
	});
});

describe('ambientFor and withBand', () => {
	const sunless: WorldLook = { ...DEFAULT_WORLD, sun: false, time: at(3, 0) };

	it('takes the band from the hour with a sun, and never changes it without one', () => {
		expect(ambientFor({ ...DEFAULT_WORLD, time: at(22, 0) }, 'day')).toBe('dark');
		for (const b of BANDS) expect(ambientFor(sunless, b)).toBe(b);
	});

	it('snaps the hour only outside the band, and never without a sun', () => {
		const dusk = { ...DEFAULT_WORLD, time: at(19, 10) };
		expect(withBand(dusk, 'dusk')).toBe(dusk);
		expect(withBand(dusk, 'dark').time).toBe(1380);
		expect(withBand(DEFAULT_WORLD, 'dusk').time).toBe(1170);
		expect(withBand(sunless, 'day')).toBe(sunless);
	});

	it('defaults each band to its canonical hour', () => {
		for (const b of BANDS) {
			expect(defaultWorldFor(b)).toEqual({ ...DEFAULT_WORLD, time: canonicalTime(b) });
		}
	});
});

describe('applyWorldPatch', () => {
	it('merges nested fields one by one and stamps since only on a new weather kind', () => {
		const rain = applyWorldPatch(DEFAULT_WORLD, { weather: { kind: 'rain', intensity: 0.5 } }, 99);
		expect(rain.weather).toEqual({ kind: 'rain', intensity: 0.5, seed: 0, since: 99 });
		const harder = applyWorldPatch(
			rain,
			{ weather: { intensity: 1 }, haze: { density: 0.2 } },
			500
		);
		expect(harder.weather.since).toBe(99);
		expect(harder.haze).toEqual({ density: 0.2, color: null });
		expect(applyWorldPatch(harder, { weather: { kind: 'rain' } }, 700).weather.since).toBe(99);
		expect(applyWorldPatch(harder, { time: 60 }, 700)).toEqual({ ...harder, time: 60 });
	});
});

describe('parseWorldLook', () => {
	it('reads a whole look back, dropping unknown keys', () => {
		expect(parseWorldLook({ ...DEFAULT_WORLD, extra: 1 })).toEqual(DEFAULT_WORLD);
	});

	it('clamps numbers into range and wraps the hour', () => {
		const look = parseWorldLook({
			...DEFAULT_WORLD,
			time: -30.4,
			rate: 90,
			weather: { kind: 'snow', intensity: 3, seed: -5, since: 12.6 },
			haze: { density: -1, color: '#aabbcc' },
			grade: { preset: 'cool-dusk', exposure: 9 },
			backdrop: { kind: 'sea', level: 99.6 }
		});
		expect(look).toEqual({
			...DEFAULT_WORLD,
			time: 1410,
			rate: 60,
			weather: { kind: 'snow', intensity: 1, seed: 0, since: 13 },
			haze: { density: 0, color: '#aabbcc' },
			grade: { preset: 'cool-dusk', exposure: 2 },
			backdrop: { kind: 'sea', level: MAX_LEVEL }
		});
		expect(parseWorldLook({ ...DEFAULT_WORLD, time: 1440 + 61 })?.time).toBe(61);
	});

	it('rejects unknown kinds, wrong types, bad colours and ids, and missing fields', () => {
		const bad: unknown[] = [
			{ ...DEFAULT_WORLD, weather: { ...DEFAULT_WORLD.weather, kind: 'hail' } },
			{ ...DEFAULT_WORLD, backdrop: { kind: 'moon', level: 0 } },
			{ ...DEFAULT_WORLD, haze: { density: 0, color: 'red' } },
			{ ...DEFAULT_WORLD, sky: 'Bad Id' },
			{ ...DEFAULT_WORLD, grade: { preset: '../x', exposure: 0 } },
			{ ...DEFAULT_WORLD, time: '12:00' },
			{ ...DEFAULT_WORLD, sun: 1 },
			{ ...DEFAULT_WORLD, rate: Number.NaN },
			{ ...DEFAULT_WORLD, weather: { kind: 'none', intensity: 0, seed: 0 } },
			{ ...DEFAULT_WORLD, grade: undefined },
			null,
			[]
		];
		for (const raw of bad) expect(parseWorldLook(raw), JSON.stringify(raw)).toBeNull();
	});
});

describe('parseWorldPatch', () => {
	it('takes any valid fields, clamped', () => {
		expect(parseWorldPatch({ time: 1500, grade: { exposure: -4 } })).toEqual({
			time: 60,
			grade: { exposure: -2 }
		});
		expect(parseWorldPatch({ sky: null, backdrop: { kind: null } })).toEqual({
			sky: null,
			backdrop: { kind: null }
		});
	});

	it('rejects an empty patch, an empty group, a since and anything invalid', () => {
		for (const raw of [
			{},
			{ unknown: 1 },
			{ weather: {} },
			{ weather: { kind: 'rain', since: 5 } },
			{ weather: { kind: 'drizzle' } },
			{ haze: { color: '#FFF' } },
			'noon'
		]) {
			expect(parseWorldPatch(raw), JSON.stringify(raw)).toBeNull();
		}
	});
});
