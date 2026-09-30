// How much of each lighting preset (day, dusk, dark) an hour takes (#208), until the sky (#114)
// and its atmosphere curves (#218) replace the presets. Pure and three-free, tested in the server
// project. One-hot at the bands' canonical hours (12:00, 19:30, 23:00, `canonicalTime`), so a table
// from before the world look draws exactly as it did; linear between keys, so at most two mix.

import type { Ambient } from '$lib/game/lights';
import { DAY_MINUTES } from '$lib/game/world';

export type PresetWeights = Record<Ambient, number>;

/** [minute, preset], in order, from 04:30 round to the next 04:30. */
const KEYS: readonly [number, Ambient][] = [
	[270, 'dark'], // 04:30
	[360, 'dusk'], // 06:00
	[480, 'day'], // 08:00
	[1050, 'day'], // 17:30
	[1170, 'dusk'], // 19:30
	[1320, 'dark'], // 22:00
	[270 + DAY_MINUTES, 'dark']
];

/** A band's preset alone. */
export function oneHot(band: Ambient): PresetWeights {
	return { day: 0, dusk: 0, dark: 0, [band]: 1 };
}

/** The presets' weights at `time` (minutes after midnight), summing to 1. */
export function presetWeights(time: number): PresetWeights {
	const t = ((((time - KEYS[0][0]) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES) + KEYS[0][0];
	let i = 1;
	while (KEYS[i][0] < t) i++;
	const [t0, a] = KEYS[i - 1];
	const [t1, b] = KEYS[i];
	if (a === b) return oneHot(a);
	const k = (t - t0) / (t1 - t0);
	const w = oneHot(a);
	w[a] -= k;
	w[b] += k;
	return w;
}
