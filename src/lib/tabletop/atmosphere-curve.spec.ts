import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '$lib/assets/manifest-parse';
import { bandOf, canonicalTime, WEATHERS, type Weather } from '$lib/game/world';
import {
	atmosphereAt,
	checkBandContract,
	createAtmosphereState,
	DARK_SUN_DEG,
	elevationOf,
	environmentKey,
	beyondPlay,
	fogFactorAt,
	fogRange,
	HANDOVER_DEG,
	kelvinToLinear,
	MIN_SHADOW_ELEVATION_DEG,
	MOON_FLOOR,
	moonDirection,
	moonIllumination,
	moonPhase,
	PLAY_FOG_BLEND,
	PLAY_FOG_CAP,
	presetOf,
	SHADOW_STEP_DEG,
	shadowDirection,
	shadowNeedsRedraw,
	srgbToLinear,
	sunDirection,
	type AtmosphereState,
	type KeyLight,
	type SkyPreset,
	type Vec3,
	type WeatherNow
} from './atmosphere-curve';
import { viewPose } from './shots';

// The shipped skies as the client fetches them (pipeline.spec.ts checks they are what assets/ builds).
const built = parseManifest(JSON.parse(readFileSync('static/assets/manifest.json', 'utf8')));
if (!built.ok) throw new Error(built.error);
const temperate = presetOf(built.manifest.skies.temperate);

const NONE: WeatherNow = { kind: 'none', intensity: 0 };
const at = (t: number, weather = NONE, preset: SkyPreset = temperate) =>
	atmosphereAt(preset, t, weather);
const hex = (h: string): Vec3 => {
	const n = parseInt(h.slice(1), 16);
	return [n >> 16, (n >> 8) & 255, n & 255].map((c) => srgbToLinear(c / 255)) as Vec3;
};
const closeTo = (a: readonly number[], b: readonly number[], digits = 9) =>
	a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
const angle = (a: Vec3, b: Vec3) =>
	Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * (180 / Math.PI);

/**
 * Every number in a state, by path; not the key's direction and colour (they jump, at key light 0,
 * on the handover: its light, colour times strength, is checked) nor the elevations (degrees).
 */
function numbers(s: AtmosphereState, prefix = ''): [string, number][] {
	const out: [string, number][] = [];
	for (const [k, v] of Object.entries(s)) {
		const path = prefix + k;
		if (/^key\.(dir|body|color)$/.test(path) || path.endsWith('Elevation')) continue;
		if (typeof v === 'number') out.push([path, v]);
		else if (Array.isArray(v)) v.forEach((x, i) => out.push([`${path}.${i}`, x]));
		else if (typeof v === 'object') out.push(...numbers(v as AtmosphereState, `${path}.`));
	}
	return out;
}

const ENCLOSED: SkyPreset = {
	kind: 'enclosed',
	keys: [{ ...temperate.keys[0], minute: 0, hemi: 0.3, fill: { color: '#ff8000', intensity: 0.2 } }]
};

describe('kelvinToLinear', () => {
	it('is near white at 6600 K and warm at 1900 K', () => {
		const white = kelvinToLinear(6600);
		for (const c of white) expect(c).toBeGreaterThan(0.95);
		const [r, g, b] = kelvinToLinear(1900);
		expect(r).toBe(1);
		expect(g).toBeLessThan(0.3);
		expect(b).toBe(0);
	});

	it('goes bluer as it gets hotter, and clamps outside 1000-40000 K', () => {
		const ratio = (k: number) => kelvinToLinear(k)[2] / kelvinToLinear(k)[0];
		for (let k = 2000; k < 40000; k += 500) expect(ratio(k + 500)).toBeGreaterThanOrEqual(ratio(k));
		expect(kelvinToLinear(10)).toEqual(kelvinToLinear(1000));
		expect(kelvinToLinear(1e6)).toEqual(kelvinToLinear(40000));
	});

	it('fills `out` in place', () => {
		const out: Vec3 = [9, 9, 9];
		expect(kelvinToLinear(5000, out)).toBe(out);
	});
});

describe('the sun and the moon', () => {
	const path = temperate.path!;

	it('gives unit directions, highest at solar noon, south at noon and west after it', () => {
		let best = -Infinity;
		let bestT = -1;
		for (let t = 0; t < 1440; t++) {
			const d = sunDirection(path, t);
			expect(Math.hypot(...d)).toBeCloseTo(1, 12);
			if (d[1] > best) [best, bestT] = [d[1], t];
		}
		expect(bestT).toBe(780);
		expect(elevationOf(sunDirection(path, 780))).toBeCloseTo(90 - 45 + 10, 9);
		const noon = sunDirection(path, 780);
		expect(noon[0]).toBeCloseTo(0, 12);
		expect(noon[2]).toBeGreaterThan(0); // grid north is -Z, so the noon sun is toward +Z
		expect(sunDirection(path, 900)[0]).toBeLessThan(0); // afternoon: west, -X
		expect(sunDirection(path, 660)[0]).toBeGreaterThan(0);
	});

	it('turns with the path north, about Y', () => {
		const turned = sunDirection({ ...path, north: 90 }, 780);
		expect(turned[0]).toBeCloseTo(sunDirection(path, 780)[2], 12);
		expect(turned[1]).toBeCloseTo(sunDirection(path, 780)[1], 12);
		expect(turned[2]).toBeCloseTo(0, 12);
	});

	it('meets the bands at their edges (noon at 13:00)', () => {
		const e = (t: number) => at(t).sunElevation;
		expect(e(420)).toBeGreaterThan(0); // 07:00, day begins
		expect(e(1139)).toBeGreaterThan(0); // 18:59, day's last minute
		expect(e(1260)).toBeLessThanOrEqual(DARK_SUN_DEG); // 21:00, dark
		expect(e(299)).toBeLessThanOrEqual(DARK_SUN_DEG); // 04:59, still dark
	});

	it('puts the full moon opposite the sun on an equinox path', () => {
		const equinox = { ...path, declination: 0 };
		for (const t of [0, 300, 780, 1200]) {
			const sun = sunDirection(equinox, t);
			closeTo(
				moonDirection(equinox, t, 0.5),
				sun.map((x) => -x),
				12
			);
			closeTo(moonDirection(equinox, t, 0), sun, 12);
		}
	});

	it('runs the phase by whole days, full at half the cycle', () => {
		expect(moonIllumination(0.5)).toBeCloseTo(1, 12);
		expect(moonIllumination(0)).toBeCloseTo(0, 12);
		const p: SkyPreset = { ...temperate, moonCycle: 4, moonPhase: 0 };
		expect([0, 1439, 1440, 2880, 4320, 5760].map((t) => moonPhase(p, t))).toEqual([
			0, 0, 0.25, 0.5, 0.75, 0
		]);
		expect(moonPhase(temperate, 0)).toBeCloseTo(0.5, 12);
		expect(at(1380).moon.illumination).toBeCloseTo(1, 12);
	});
});

describe('atmosphereAt', () => {
	it('gives the built temperate sky the old lighting presets at the canonical hours', () => {
		const old = {
			day: { sky: '#fff1dc', ground: '#1c140e', hemi: 0.9, sun: 1.6 },
			dusk: { sky: '#ffd0a0', ground: '#1a2438', hemi: 0.45, sun: 0.55 },
			dark: { sky: '#9ab4ff', ground: '#0a1230', hemi: 0.1, sun: 0 }
		};
		for (const band of ['day', 'dusk', 'dark'] as const) {
			const s = at(canonicalTime(band));
			const o = old[band];
			closeTo(s.hemi.sky, hex(o.sky));
			closeTo(s.hemi.ground, hex(o.ground));
			// The haze is no longer the old brown background (#221): a pale day haze toward the
			// horizon, a warm dusk, a moonlit blue night.
			const [r, g, bl] = s.fog.color;
			if (band === 'day') expect(Math.min(r, g, bl)).toBeGreaterThan(0.3);
			if (band === 'dusk') expect(r).toBeGreaterThan(bl * 1.5);
			if (band === 'dark') expect(bl).toBeGreaterThan(r * 2);
			expect(s.hemi.intensity).toBeCloseTo(o.hemi, 12);
			expect(s.exposure).toBe(0);
			if (band === 'dark') expect(s.key.body).toBe('moon');
			else {
				expect(s.key.body).toBe('sun');
				expect(s.key.intensity).toBeCloseTo(o.sun, 12);
				closeTo(s.key.color, hex('#ffe2b8'));
			}
		}
	});

	it('agrees at 23:59 and 00:00, wraps negative times, and keeps the day for the moon', () => {
		const late = numbers(at(1439));
		const early = new Map(numbers(at(0)));
		for (const [path, v] of late) expect(Math.abs(v - early.get(path)!)).toBeLessThan(0.01);
		expect(at(-1).hemi).toEqual(at(1439).hemi);
		// Absolute minutes: the next day's midnight looks the same, the moon one day on.
		const next = at(1440);
		expect(next.hemi).toEqual(at(0).hemi);
		expect(next.moon.phase).not.toBe(at(0).moon.phase);
	});

	it('is continuous: no field moves more than 0.05 a minute, directions less than 0.3°', () => {
		for (const weather of [NONE, { kind: 'storm', intensity: 1 } as WeatherNow]) {
			let prev = at(0, weather);
			for (let t = 1; t <= 1440; t++) {
				const next = at(t % 1440, weather);
				const before = new Map(numbers(prev));
				for (const [path, v] of numbers(next))
					expect(Math.abs(v - before.get(path)!), `${path} at ${t}`).toBeLessThanOrEqual(0.05);
				for (let c = 0; c < 3; c++) {
					const light = (x: AtmosphereState) => x.key.color[c] * x.key.intensity;
					expect(Math.abs(light(next) - light(prev))).toBeLessThanOrEqual(0.05);
				}
				expect(angle(prev.sunDir, next.sunDir)).toBeLessThan(0.3);
				expect(angle(prev.moonDir, next.moonDir)).toBeLessThan(0.3);
				prev = next;
			}
		}
	});

	it('hands the key light to the moon below -4°, crossing at zero', () => {
		let switches = 0;
		let prev = at(0);
		for (let t = 1; t < 1440; t++) {
			const s = at(t);
			expect(s.key.body).toBe(s.sunElevation >= HANDOVER_DEG ? 'sun' : 'moon');
			if (s.key.body !== prev.key.body) {
				switches++;
				expect(s.key.intensity).toBeLessThan(0.02);
				expect(prev.key.intensity).toBeLessThan(0.02);
			}
			prev = s;
		}
		expect(switches).toBe(2);
	});

	it('keeps a new-moon night lit at the floor', () => {
		const full = at(1380).key.intensity;
		const newMoon = atmosphereAt({ ...temperate, moonPhase: 0 }, 1380, NONE).key.intensity;
		expect(newMoon).toBeCloseTo(full * MOON_FLOOR, 12);
		expect(newMoon).toBeGreaterThan(0);
	});

	it('stays finite and in range every minute, in every weather', () => {
		for (const kind of WEATHERS)
			for (let t = 0; t < 1440; t += 7) {
				const s = at(t, { kind, intensity: 1 });
				for (const [path, v] of numbers(s)) expect(Number.isFinite(v), path).toBe(true);
				const colours = [s.key.color, s.hemi.sky, s.hemi.ground, s.zenith, s.horizon, s.ground];
				for (const v of [...colours, s.fog.color].flat()) expect(v >= 0 && v <= 1).toBe(true);
				expect(s.key.intensity).toBeGreaterThanOrEqual(0);
				expect(s.key.intensity).toBeLessThanOrEqual(2);
				expect(s.hemi.intensity).toBeLessThanOrEqual(2);
				expect(Math.abs(s.exposure)).toBeLessThanOrEqual(1);
				for (const v of [s.stars, s.clouds, s.nightGlow, s.sunGlow, s.fill]) {
					expect(v).toBeGreaterThanOrEqual(0);
					expect(v).toBeLessThanOrEqual(1);
				}
				expect(s.lut.day + s.lut.dusk + s.lut.dark).toBeCloseTo(1, 12);
			}
	});

	it('keeps night blue and noon neutral to warm', () => {
		for (const t of [0, 120, 1320, 1380]) {
			const [r, g, b] = at(t).hemi.sky;
			expect(b).toBeGreaterThan(r);
			expect(b).toBeGreaterThan(g);
		}
		const [r, , b] = at(720).hemi.sky;
		expect(r).toBeGreaterThanOrEqual(b);
	});

	it('weighs the grade by the sun: day at noon, dark at midnight', () => {
		expect(at(720).lut).toEqual({ day: 1, dusk: 0, dark: 0 });
		expect(at(0).lut).toEqual({ day: 0, dusk: 0, dark: 1 });
		expect(at(1170).lut.dusk).toBeGreaterThan(0.5);
	});

	it('moves weather one way as it strengthens, and does nothing at intensity 0', () => {
		for (const kind of WEATHERS as readonly Weather[])
			for (const t of [720, 1170, 1380]) {
				expect(at(t, { kind, intensity: 0 })).toEqual(at(t));
				expect(at(t, { kind, intensity: 3 })).toEqual(at(t, { kind, intensity: 1 }));
				let prev = at(t);
				for (let i = 0.1; i <= 1.0001; i += 0.1) {
					const s = at(t, { kind, intensity: i });
					expect(s.key.intensity).toBeLessThanOrEqual(prev.key.intensity + 1e-12);
					expect(s.hemi.intensity).toBeLessThanOrEqual(prev.hemi.intensity + 1e-12);
					expect(s.fog.density).toBeGreaterThanOrEqual(prev.fog.density - 1e-12);
					expect(s.fog.height).toBeGreaterThanOrEqual(prev.fog.height - 1e-12);
					expect(s.clouds).toBeGreaterThanOrEqual(prev.clouds - 1e-12);
					expect(s.stars).toBeLessThanOrEqual(prev.stars + 1e-12);
					expect(s.exposure).toBeLessThanOrEqual(prev.exposure + 1e-12);
					prev = s;
				}
			}
		const noon = at(720);
		const rain = at(720, { kind: 'rain', intensity: 1 });
		expect(rain.key.intensity).toBeLessThan(noon.key.intensity * 0.5);
		expect(rain.fog.density).toBeGreaterThan(noon.fog.density);
		expect(at(720, { kind: 'storm', intensity: 1 }).key.intensity).toBeLessThan(rain.key.intensity);
		expect(at(720, { kind: 'snow', intensity: 1 }).ground[0]).toBeGreaterThan(noon.ground[0]);
		const dust = at(720, { kind: 'dust', intensity: 1 }).fog.color;
		expect(dust[0]).toBeGreaterThan(dust[2]); // ochre
	});

	it('gives an enclosed sky one state whatever the hour and weather, with no key light', () => {
		const first = at(0, NONE, ENCLOSED);
		expect(first.key.intensity).toBe(0);
		expect(first.fill).toBe(0.2);
		closeTo(first.fillColor, hex('#ff8000'));
		expect(first.hemi.intensity).toBe(0.3);
		for (const t of [0, 400, 720, 1380])
			for (const kind of WEATHERS) expect(at(t, { kind, intensity: 1 }, ENCLOSED)).toEqual(first);
		expect(at(720).fill).toBe(0);
		expect(at(720).fillColor).toEqual([0, 0, 0]);
	});

	it('fills and returns `out`, the same as a fresh state', () => {
		const out = createAtmosphereState();
		for (const t of [0, 360, 720, 1170, 1380]) {
			expect(atmosphereAt(temperate, t, NONE, out)).toBe(out);
			expect(out).toEqual(at(t));
		}
		expect(atmosphereAt(ENCLOSED, 0, NONE, out)).toEqual(at(0, NONE, ENCLOSED));
	});
});

describe('presetOf', () => {
	it('moves the moon off the path, its phase from a share of the cycle into days', () => {
		const sky = built.manifest.skies.temperate;
		expect(temperate.keys).toBe(sky.keys);
		expect(temperate.path).toEqual({ latitude: 45, declination: 10, north: 0, noon: 780 });
		expect(temperate.moonCycle).toBe(29.5);
		expect(temperate.moonPhase).toBe(14.75);
		const cave = presetOf(built.manifest.skies.underground);
		expect(cave).toEqual({ kind: 'enclosed', keys: built.manifest.skies.underground.keys });
		expect(at(720, NONE, cave).fill).toBe(cave.keys[0].fill!.intensity);
	});
});

describe('checkBandContract', () => {
	it('passes every shipped sky and an enclosed one', () => {
		for (const [id, sky] of Object.entries(built.manifest.skies))
			expect(checkBandContract(presetOf(sky)), id).toEqual([]);
		expect(checkBandContract(ENCLOSED)).toEqual([]);
	});

	it('holds with room to spare: every shipped open sky is a degree inside its bands', () => {
		for (const [id, sky] of Object.entries(built.manifest.skies)) {
			if (sky.kind !== 'open') continue;
			const preset = presetOf(sky);
			for (let t = 0; t < 1440; t++) {
				const e = at(t, NONE, preset).sunElevation;
				const band = bandOf(t);
				if (band === 'day') expect(e, `${id} ${t}`).toBeGreaterThan(1);
				if (band === 'dark') expect(e, `${id} ${t}`).toBeLessThan(DARK_SUN_DEG - 1);
			}
		}
	});

	it('refuses solar noon at 12:00: the sun is too high before dawn', () => {
		const problems = checkBandContract({ ...temperate, path: { ...temperate.path!, noon: 720 } });
		expect(problems.length).toBeGreaterThan(0);
		expect(problems.every((p) => /but the sun/.test(p))).toBe(true);
	});

	it('refuses stars by day, a bright night and keys out of order', () => {
		const keys = temperate.keys;
		const starry = { ...temperate, keys: keys.map((k) => ({ ...k, stars: 0.5 })) };
		expect(checkBandContract(starry).some((p) => /stars show/.test(p))).toBe(true);
		const bright = { ...temperate, keys: keys.map((k) => ({ ...k, hemi: 0.5 })) };
		expect(checkBandContract(bright)).toContain('a dark minute is as bright as a day minute');
		const shuffled = { ...temperate, keys: [keys[1], keys[0], ...keys.slice(2)] };
		expect(checkBandContract(shuffled)).toContain('key 1: minutes must rise');
		expect(checkBandContract({ ...temperate, keys: [keys[0]] })).toContain('needs 2-16 keys');
		const last = keys.length - 1;
		const late = { ...temperate, keys: [...keys.slice(0, -1), { ...keys[last], minute: 1440 }] };
		expect(checkBandContract(late)).toContain(`key ${last}: minute 1440 is not 0-1439`);
	});

	it('refuses a sun too high in the dark (a polar summer)', () => {
		const polar = { ...temperate, path: { ...temperate.path!, latitude: 70, declination: 23 } };
		expect(checkBandContract(polar).some((p) => /is dark but the sun/.test(p))).toBe(true);
	});
});

describe('shadows', () => {
	const key = (dir: Vec3, body: KeyLight['body'] = 'sun', intensity = 1): KeyLight => ({
		body,
		dir,
		color: [1, 1, 1],
		intensity
	});

	it('raises a low light to the least shadow elevation and keeps its bearing', () => {
		const low = shadowDirection([1, 0.05, 0]);
		expect(elevationOf(low)).toBeCloseTo(MIN_SHADOW_ELEVATION_DEG, 9);
		expect(Math.hypot(...low)).toBeCloseTo(1, 12);
		expect(low[2]).toBeCloseTo(0, 12);
		const high: Vec3 = [0, 1, 0];
		expect(shadowDirection(high)).toEqual(high);
	});

	it(`redraws about once per ${SHADOW_STEP_DEG}° the light turns`, () => {
		let drawn: KeyLight | null = null;
		let redraws = 0;
		let arc = 0;
		let prev: Vec3 | null = null;
		for (let t = 480; t <= 1080; t++) {
			const s = at(t);
			const dir = shadowDirection(s.key.dir);
			if (prev) arc += angle(prev, dir);
			prev = dir;
			if (shadowNeedsRedraw(drawn, s.key)) {
				redraws++;
				drawn = { ...s.key, dir: [...s.key.dir] };
			}
		}
		expect(redraws).toBeGreaterThanOrEqual(arc / 0.75);
		expect(redraws).toBeLessThanOrEqual(arc / SHADOW_STEP_DEG + 2);
	});

	it('redraws on a switch of body, never for a light that gives none', () => {
		const sun = key([0, 1, 0]);
		expect(shadowNeedsRedraw(null, sun)).toBe(true);
		expect(shadowNeedsRedraw(sun, key([0, 1, 0]))).toBe(false);
		expect(shadowNeedsRedraw(sun, key([0, 1, 0], 'moon'))).toBe(true);
		expect(shadowNeedsRedraw(null, key([0, 1, 0], 'moon', 0))).toBe(false);
		expect(shadowNeedsRedraw(null, at(720, NONE, ENCLOSED).key)).toBe(false);
	});
});

describe('environmentKey', () => {
	it('is the same for the same state and changes a bounded number of times a day', () => {
		expect(environmentKey(at(600))).toBe(environmentKey(at(600)));
		let changes = 0;
		let prev = environmentKey(at(0));
		for (let t = 1; t < 1440; t++) {
			const k = environmentKey(at(t));
			if (k !== prev) changes++;
			prev = k;
		}
		expect(changes).toBeGreaterThan(10);
		expect(changes).toBeLessThanOrEqual(300); // the shipped temperate: 235
		expect(environmentKey(at(720))).toBe(environmentKey(at(722)));
	});

	it('follows weather and not the hour under an enclosed sky', () => {
		expect(environmentKey(at(720, { kind: 'storm', intensity: 1 }))).not.toBe(
			environmentKey(at(720))
		);
		expect(environmentKey(at(0, NONE, ENCLOSED))).toBe(environmentKey(at(720, NONE, ENCLOSED)));
	});
});

describe('fog', () => {
	const thick = (t: number) => at(t, { kind: 'fog', intensity: 1 }).fog;

	it('never covers the map past a few percent, from the default poses and every distance (#377)', () => {
		expect(PLAY_FOG_CAP).toBeLessThanOrEqual(0.05);
		const sizes = [4, 8, 16, 20, 32, 48, 64];
		for (const w of sizes)
			for (const h of [4, w, 64]) {
				const extent = Math.max(w, h) + 6;
				const range = fogRange(extent);
				// The fixtures' overview (1.1 times the grid out, 55° up) and the default views, each
				// also pulled back as far as the controls allow (world-ground.ts: twice the frame).
				const overview = {
					position: { x: 0, y: Math.sin(0.96) * 1.1 * extent, z: Math.cos(0.96) * 1.1 * extent },
					target: { x: 0, y: 0, z: 0 }
				};
				const poses = [overview, viewPose('tactical', extent), viewPose('tabletop', extent)];
				for (const { position: p0, target: q } of poses)
					for (const pulled of [1, (2 * extent) / Math.hypot(p0.x, p0.y, p0.z)]) {
						const p = { x: p0.x * pulled, y: p0.y * pulled, z: p0.z * pulled };
						const len = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
						const f = [(q.x - p.x) / len, (q.y - p.y) / len, (q.z - p.z) / len];
						for (const t of [720, 1170, 1380])
							for (const [x, z] of [
								[-w / 2, -h / 2],
								[w / 2, -h / 2],
								[-w / 2, h / 2],
								[w / 2, h / 2],
								[w / 2, 0],
								[0, 0]
							]) {
								const viewZ = (x - p.x) * f[0] + (0 - p.y) * f[1] + (z - p.z) * f[2];
								const fromPlay = beyondPlay(x, z, w / 2, h / 2);
								expect(fromPlay).toBe(0);
								expect(fogFactorAt(thick(t), range, viewZ, 0, fromPlay)).toBeLessThanOrEqual(
									PLAY_FOG_CAP
								);
							}
					}
			}
	});

	it('measures the map as a rectangle, so a long map is clear to its ends (#377)', () => {
		expect(beyondPlay(0, 0, 24, 4)).toBe(0);
		expect(beyondPlay(-24, 4, 24, 4)).toBe(0);
		// Along the long side: what a circle round the map would have fogged, the rectangle keeps.
		expect(beyondPlay(23, 0, 24, 4)).toBe(0);
		expect(beyondPlay(0, 7, 24, 4)).toBe(3);
		expect(beyondPlay(-27, -8, 24, 4)).toBe(5);
	});

	it('thickens only past the edge, over a wider blend, to the whole haze beyond (#377)', () => {
		const range = fogRange(70);
		expect(fogFactorAt(thick(720), range, 400, 0, 200)).toBeGreaterThan(0.99);
		const inside = fogFactorAt(thick(720), range, 400, 0, 0);
		expect(inside).toBe(PLAY_FOG_CAP);
		const rising = [1, 4, 8, 12, PLAY_FOG_BLEND].map((m) =>
			fogFactorAt(thick(720), range, 400, 0, m)
		);
		for (let i = 1; i < rising.length; i++) expect(rising[i]).toBeGreaterThan(rising[i - 1]);
		// A cell past the edge is still mostly clear: the haze frames the map, it doesn't start at it.
		expect(rising[0]).toBeLessThan(0.1);
		expect(PLAY_FOG_BLEND).toBeGreaterThanOrEqual(12);
	});

	it('is range fog alone above the height fog, and grows range with tables past the Hollow', () => {
		const fog = { color: [0, 0, 0] as Vec3, density: 0.05, height: 2 };
		expect(fogFactorAt(fog, { near: 10, far: 20 }, 5, 3, 100)).toBe(0);
		expect(fogFactorAt(fog, { near: 10, far: 20 }, 5, 0, 100)).toBeGreaterThan(0);
		expect(fogRange(20)).toEqual({ near: 40, far: 90 });
		expect(fogRange(108)).toEqual({ near: 162, far: 378 });
	});

	it('leaves the play area clear at noon under every open sky (#221)', () => {
		for (const [id, sky] of Object.entries(built.manifest.skies)) {
			if (sky.kind !== 'open') continue;
			const fog = at(720, NONE, presetOf(sky)).fog;
			for (const extent of [10, 26, 42, 54, 70]) {
				const range = fogRange(extent);
				for (const view of ['tactical', 'tabletop'] as const) {
					const { position: p } = viewPose(view, extent);
					// The far corner, the farthest play cell the pose sees (the extent is the grid + 6).
					const half = (extent - 6) / 2;
					const far = Math.hypot(p.x + half, p.y, p.z + half);
					expect(fogFactorAt(fog, range, far, 0, 0), `${id} ${extent} ${view}`).toBeLessThan(0.08);
				}
			}
		}
	});
});

it('imports nothing from three.js, and only relatively', () => {
	for (const file of ['./atmosphere-curve.ts', './sky-maths.ts']) {
		const source = readFileSync(new URL(file, import.meta.url), 'utf8');
		expect(source).not.toMatch(/from ['"]three/);
		expect(source).not.toMatch(/from ['"]\$lib/);
	}
});
