// The atmosphere curve (#212): a sky preset, the world's hour and its weather in, every number the
// sky, the key light, the hemisphere, IBL, fog and grade need out. Pure and three-free (relative
// imports only), so the asset pipeline (#213) and the server test project run it too; the renderer
// (#215-#219) only applies what it returns. The one place that decides what 19:30 in rain looks like.
//
// Axes: Y up, grid north along -Z, east along +X (turned by the path's `north`). Directions point
// from the table toward the body. Colours are linear sRGB; presets write them as sRGB `#rrggbb`,
// linearised exactly as three's `Color.setHex` does. Elevations are in degrees.

import type { SkyDef, SkyKey } from '../assets/manifest';
import { bandOf, DAY_MINUTES, type Weather } from '../game/world';
import {
	DEFAULT_PATH,
	elevationOf,
	hexToLinear,
	kelvinToLinear,
	moonDirection,
	moonIllumination,
	smoothstep,
	sunDirection,
	type SunPath,
	type Vec3
} from './sky-maths';

export { DEFAULT_PATH, elevationOf, kelvinToLinear, moonDirection } from './sky-maths';
export { moonIllumination, srgbToLinear, sunDirection, type SunPath, type Vec3 } from './sky-maths';

const RAD = Math.PI / 180;

/**
 * One keyframe of a sky: the manifest's `SkyKey` (#213), the one shape of a key. Values between keys
 * blend by smoothstep, round midnight too; an enclosed sky's first key carries its `fill`.
 */
export type { SkyKey };

export interface SkyPreset {
	/** Enclosed skies (caves, the abyss) ignore the hour and the weather and have no sun. */
	kind: 'open' | 'enclosed';
	/** Open skies only; `DEFAULT_PATH` when absent. */
	path?: SunPath;
	/** Days in a lunar month, and the phase at day 0 in days (half the cycle is full). */
	moonCycle?: number;
	moonPhase?: number;
	/** The moon's light, `#rrggbb` (blue: night reads blue, the Purkinje shift). */
	moonColor?: string;
	/** 2-16 in rising minutes (an enclosed sky uses its first alone). */
	keys: SkyKey[];
}

/**
 * What `atmosphereAt` reads, from a manifest sky (`SkyDef`, the wire and asset shape): the path's
 * moon moves onto the preset, its phase from a share of the cycle (0 new, 0.5 full) into days.
 * Keys are shared, not copied; make it once per sky, since parsed colours are cached per object.
 */
export function presetOf(def: Pick<SkyDef, 'kind' | 'keys' | 'path'>): SkyPreset {
	if (!def.path) return { kind: def.kind, keys: def.keys };
	const { moonCycle, moonPhase, ...path } = def.path;
	return { kind: def.kind, keys: def.keys, path, moonCycle, moonPhase: moonPhase * moonCycle };
}

export interface KeyLight {
	body: 'sun' | 'moon';
	dir: Vec3;
	color: Vec3;
	intensity: number;
}

export interface AtmosphereState {
	sunDir: Vec3;
	moonDir: Vec3;
	sunElevation: number;
	moonElevation: number;
	/** The one directional light: the sun, or the moon below `HANDOVER_DEG`. */
	key: KeyLight;
	hemi: { sky: Vec3; ground: Vec3; intensity: number };
	ibl: number;
	zenith: Vec3;
	horizon: Vec3;
	ground: Vec3;
	/** How strongly the sun's disc and glow show, 0-1 (up, and not behind cloud). */
	sunGlow: number;
	fog: { color: Vec3; density: number; height: number };
	exposure: number;
	stars: number;
	clouds: number;
	moon: { phase: number; illumination: number };
	/** Grade weights by the sun's height, summing to 1 (#162; the band still keys the grade, D5). */
	lut: { day: number; dusk: number; dark: number };
	nightGlow: number;
	/** Enclosed skies' fill, its strength and colour; 0 under an open sky. */
	fill: number;
	fillColor: Vec3;
}

export interface WeatherNow {
	kind: Weather;
	intensity: number;
}

const NO_FILL: Vec3 = [0, 0, 0];
const DEFAULT_MOON = { cycle: 29.5, color: '#9ab4ff' };
/** Below this the sun hands the key light to the moon; both are 0 exactly there. */
export const HANDOVER_DEG = -4;
/** The band contract: dark only with the sun at least this far down. */
export const DARK_SUN_DEG = -6;
/** The moon's light at new moon, as a share of full: a moonless night still reads. */
export const MOON_FLOOR = 0.25;
/** The key light never casts shadows from lower than this (the renderer's clamp, #215). */
export const MIN_SHADOW_ELEVATION_DEG = 12;
/** A shadow map is redrawn once its light has turned this far. */
export const SHADOW_STEP_DEG = 0.5;
/** Fog over the play area never exceeds this, whatever the haze or weather (#217). */
export const PLAY_FOG_CAP = 0.3;
/** Metres beyond the play area over which the cap lifts to 1. */
export const PLAY_FOG_BLEND = 6;

/** The moon's phase at absolute `time` in minutes: 0 new, 0.5 full. */
export function moonPhase(preset: SkyPreset, time: number): number {
	const cycle = preset.moonCycle ?? DEFAULT_MOON.cycle;
	const at = preset.moonPhase ?? cycle / 2;
	const day = Math.floor(time / DAY_MINUTES);
	return ((((day + at) % cycle) + cycle) % cycle) / cycle;
}

// Keys parsed once each (colours to linear); presets are data and never change in place.

interface Parsed {
	sunColor: Vec3;
	hemiSky: Vec3;
	hemiGround: Vec3;
	zenith: Vec3;
	horizon: Vec3;
	ground: Vec3;
	fogColor: Vec3;
	fillColor: Vec3;
}
const parsedKeys = new WeakMap<SkyKey, Parsed>();
const moonColours = new WeakMap<SkyPreset, Vec3>();

function parsed(key: SkyKey): Parsed {
	let p = parsedKeys.get(key);
	if (!p) {
		const v = (hex: string) => hexToLinear(hex, [0, 0, 0]);
		p = {
			sunColor:
				key.sunKelvin !== undefined ? kelvinToLinear(key.sunKelvin) : v(key.sunColor ?? '#ffffff'),
			hemiSky: v(key.hemiSky),
			hemiGround: v(key.hemiGround),
			zenith: v(key.zenith),
			horizon: v(key.horizon),
			ground: v(key.ground),
			fogColor: v(key.fog.color),
			fillColor: v(key.fill?.color ?? '#000000')
		};
		parsedKeys.set(key, p);
	}
	return p;
}

function moonColour(preset: SkyPreset): Vec3 {
	let c = moonColours.get(preset);
	if (!c)
		moonColours.set(preset, (c = hexToLinear(preset.moonColor ?? DEFAULT_MOON.color, [0, 0, 0])));
	return c;
}

/** The two keys round `time` (minute of day) and how far from the first to the second, smoothed. */
function bracket(keys: readonly SkyKey[], time: number): [SkyKey, SkyKey, number] {
	const t = ((time % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
	let i = keys.length - 1;
	while (i >= 0 && keys[i].minute > t) i--;
	// Before the first key, or after the last: between the last and the first, round midnight.
	const a = keys[(i + keys.length) % keys.length];
	const b = keys[(i + 1) % keys.length];
	let span = b.minute - a.minute;
	let from = t - a.minute;
	if (span <= 0) span += DAY_MINUTES;
	if (from < 0) from += DAY_MINUTES;
	return [a, b, smoothstep(0, 1, from / span)];
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
function mix(out: Vec3, a: Vec3, b: Vec3, k: number): Vec3 {
	out[0] = lerp(a[0], b[0], k);
	out[1] = lerp(a[1], b[1], k);
	out[2] = lerp(a[2], b[2], k);
	return out;
}
function copy(out: Vec3, from: readonly number[]): Vec3 {
	out[0] = from[0];
	out[1] = from[1];
	out[2] = from[2];
	return out;
}

/**
 * What weather does at full intensity, scaled down by its intensity. Every factor moves one way
 * as intensity rises (the sun and hemisphere only dim, clouds and fog only grow, exposure only
 * falls), so the result is monotonic. Overcast is a preset, not a weather.
 */
interface Mod {
	sun: number;
	hemi: number;
	clouds: number;
	fog: number;
	fogAdd: number;
	height: number;
	ev: number;
	tint: Vec3;
	tintBy: number;
	whiten: number;
}
const NONE: Mod = {
	...{ sun: 1, hemi: 1, clouds: 0, fog: 0, fogAdd: 0, height: 0, ev: 0 },
	...{ tint: [0, 0, 0], tintBy: 0, whiten: 0 }
};
const mod = (m: Partial<Mod>): Mod => ({ ...NONE, ...m });
const WEATHER: Record<Weather, Mod> = {
	none: NONE,
	rain: mod({ sun: 0.35, hemi: 0.85, clouds: 0.7, fog: 2, fogAdd: 0.004, height: 1, ev: -0.3 }),
	storm: mod({ sun: 0.12, hemi: 0.6, clouds: 0.95, fog: 3, fogAdd: 0.006, height: 2, ev: -0.7 }),
	fog: mod({ sun: 0.6, hemi: 0.9, clouds: 0.3, fog: 5, fogAdd: 0.02, height: 4, ev: -0.1 }),
	snow: mod({ sun: 0.55, clouds: 0.6, fog: 2, fogAdd: 0.006, height: 2, whiten: 0.5 }),
	ash: mod({ sun: 0.45, hemi: 0.8, clouds: 0.5, fog: 3, fogAdd: 0.01, height: 3, ev: -0.3 }),
	dust: mod({ sun: 0.55, hemi: 0.9, clouds: 0.2, fog: 3, fogAdd: 0.01, height: 3, ev: -0.1 })
};
/** What each weather tints the haze toward (linear), and how far at full intensity. */
const TINTS: [Weather, Vec3, number][] = [
	['rain', [0.18, 0.2, 0.23], 0.3],
	['storm', [0.06, 0.07, 0.09], 0.5],
	['fog', [0.5, 0.52, 0.55], 0.4],
	['snow', [0.7, 0.74, 0.8], 0.4],
	['ash', [0.12, 0.12, 0.12], 0.6],
	['dust', [0.45, 0.3, 0.12], 0.6]
];
for (const [kind, tint, by] of TINTS) Object.assign(WEATHER[kind], { tint, tintBy: by });
const SNOW: Vec3 = [0.8, 0.82, 0.85];

/** A state to fill (what `atmosphereAt` allocates when given none). */
export function createAtmosphereState(): AtmosphereState {
	const v = (): Vec3 => [0, 0, 0];
	return {
		sunDir: v(),
		moonDir: v(),
		sunElevation: 0,
		moonElevation: 0,
		key: { body: 'sun', dir: v(), color: v(), intensity: 0 },
		hemi: { sky: v(), ground: v(), intensity: 0 },
		ibl: 0,
		zenith: v(),
		horizon: v(),
		ground: v(),
		sunGlow: 0,
		fog: { color: v(), density: 0, height: 0 },
		exposure: 0,
		stars: 0,
		clouds: 0,
		moon: { phase: 0, illumination: 0 },
		lut: { day: 1, dusk: 0, dark: 0 },
		nightGlow: 0,
		fill: 0,
		fillColor: v()
	};
}

/** The keys' values at their blend into `out` (colours, strengths, fog, exposure, the rest). */
function sample(out: AtmosphereState, a: SkyKey, b: SkyKey, k: number): void {
	const pa = parsed(a);
	const pb = parsed(b);
	mix(out.hemi.sky, pa.hemiSky, pb.hemiSky, k);
	mix(out.hemi.ground, pa.hemiGround, pb.hemiGround, k);
	out.hemi.intensity = lerp(a.hemi, b.hemi, k);
	out.ibl = lerp(a.ibl, b.ibl, k);
	mix(out.zenith, pa.zenith, pb.zenith, k);
	mix(out.horizon, pa.horizon, pb.horizon, k);
	mix(out.ground, pa.ground, pb.ground, k);
	mix(out.fog.color, pa.fogColor, pb.fogColor, k);
	out.fog.density = lerp(a.fog.density, b.fog.density, k);
	out.fog.height = lerp(a.fog.height, b.fog.height, k);
	out.exposure = lerp(a.exposure, b.exposure, k);
	out.stars = lerp(a.stars, b.stars, k);
	out.clouds = lerp(a.clouds, b.clouds, k);
	out.nightGlow = lerp(a.nightGlow, b.nightGlow, k);
	mix(out.key.color, pa.sunColor, pb.sunColor, k);
}

/**
 * Everything the sky needs at `time` (minutes; the minute of day sets the sun, whole days the
 * moon's phase) under `weather`, into `out` (reused: no allocation on tween frames). Deterministic.
 */
export function atmosphereAt(
	preset: SkyPreset,
	time: number,
	weather: WeatherNow,
	out: AtmosphereState = createAtmosphereState()
): AtmosphereState {
	if (preset.kind === 'enclosed') return enclosed(preset, out);
	const [a, b, k] = bracket(preset.keys, time);
	sample(out, a, b, k);
	const path = preset.path ?? DEFAULT_PATH;
	const phase = moonPhase(preset, time);
	sunDirection(path, time, out.sunDir);
	moonDirection(path, time, phase, out.moonDir);
	out.sunElevation = elevationOf(out.sunDir);
	out.moonElevation = elevationOf(out.moonDir);
	out.moon.phase = phase;
	out.moon.illumination = moonIllumination(phase);
	out.fill = 0;
	copy(out.fillColor, NO_FILL);

	// The key light: the sun fading out to 0 at the handover, then the moon fading in below it.
	const e = out.sunElevation;
	const sunFade = smoothstep(HANDOVER_DEG, 0, e);
	const key = out.key;
	if (e >= HANDOVER_DEG) {
		key.body = 'sun';
		copy(key.dir, out.sunDir);
		key.intensity = lerp(a.sun, b.sun, k) * sunFade;
	} else {
		key.body = 'moon';
		copy(key.dir, out.moonDir);
		copy(key.color, moonColour(preset));
		const moonFade = 1 - smoothstep(HANDOVER_DEG - 4, HANDOVER_DEG, e);
		const lit = Math.max(MOON_FLOOR, out.moon.illumination);
		key.intensity = lerp(a.moon, b.moon, k) * lit * moonFade;
	}

	// Weather.
	const m = Math.min(1, Math.max(0, weather.intensity));
	const w = WEATHER[weather.kind] ?? NONE;
	key.intensity *= 1 - m * (1 - w.sun);
	out.hemi.intensity *= 1 - m * (1 - w.hemi);
	const cover = m * w.clouds;
	out.clouds += (1 - out.clouds) * cover;
	out.stars *= 1 - cover;
	out.fog.density = out.fog.density * (1 + m * w.fog) + m * w.fogAdd;
	out.fog.height += m * w.height;
	out.exposure += m * w.ev;
	mix(out.fog.color, out.fog.color, w.tint, m * w.tintBy);
	mix(out.horizon, out.horizon, SNOW, m * w.whiten);
	mix(out.ground, out.ground, SNOW, m * w.whiten);

	// The glow fades over a wider band than the light: it is seen from far off, the disc below the rim.
	out.sunGlow = smoothstep(DARK_SUN_DEG, 2, e) * (1 - 0.8 * out.clouds);
	const day = smoothstep(0, 10, e);
	const dark = 1 - smoothstep(-10, HANDOVER_DEG, e);
	out.lut.day = day;
	out.lut.dark = dark;
	out.lut.dusk = Math.max(0, 1 - day - dark);
	return out;
}

/** An enclosed sky: its first key, whatever the hour and weather; no sun, no moon, key light 0. */
function enclosed(preset: SkyPreset, out: AtmosphereState): AtmosphereState {
	const first = preset.keys[0];
	sample(out, first, first, 0);
	copy(out.sunDir, [0, -1, 0]);
	copy(out.moonDir, [0, -1, 0]);
	out.sunElevation = -90;
	out.moonElevation = -90;
	out.key.body = 'sun';
	copy(out.key.dir, [0, 1, 0]);
	out.key.intensity = 0;
	out.moon.phase = 0;
	out.moon.illumination = 0;
	out.sunGlow = 0;
	out.lut.day = 1;
	out.lut.dusk = 0;
	out.lut.dark = 0;
	out.fill = first.fill?.intensity ?? 0;
	copy(out.fillColor, parsed(first).fillColor);
	return out;
}

/**
 * Whether a preset agrees with the rules' bands (`bandOf`), minute by minute with no weather: by
 * day the sun is up and no stars show; in the dark the sun is at least `DARK_SUN_DEG` down and the
 * moon is the key; every day minute's hemisphere is brighter than every dark minute's. Returns the
 * problems, none when it holds. Enclosed skies have no hour, so only their shape is checked.
 */
export function checkBandContract(preset: SkyPreset): string[] {
	const problems: string[] = [];
	const { keys } = preset;
	const fewest = preset.kind === 'enclosed' ? 1 : 2;
	if (keys.length < fewest || keys.length > 16) problems.push(`needs ${fewest}-16 keys`);
	for (let i = 0; i < keys.length; i++) {
		const minute = keys[i].minute;
		if (!Number.isInteger(minute) || minute < 0 || minute >= DAY_MINUTES)
			problems.push(`key ${i}: minute ${minute} is not 0-1439`);
		else if (i > 0 && minute <= keys[i - 1].minute) problems.push(`key ${i}: minutes must rise`);
	}
	if (problems.length || preset.kind === 'enclosed') return problems;
	const s = createAtmosphereState();
	const none: WeatherNow = { kind: 'none', intensity: 0 };
	let dimmestDay = Infinity;
	let brightestDark = -Infinity;
	const at = (t: number) =>
		`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
	for (let t = 0; t < DAY_MINUTES; t++) {
		atmosphereAt(preset, t, none, s);
		const band = bandOf(t);
		if (band === 'day') {
			dimmestDay = Math.min(dimmestDay, s.hemi.intensity);
			if (s.sunElevation <= 0) problems.push(`${at(t)} is day but the sun is down`);
			if (s.stars > 0) problems.push(`${at(t)} is day but stars show`);
		} else if (band === 'dark') {
			brightestDark = Math.max(brightestDark, s.hemi.intensity);
			if (s.sunElevation > DARK_SUN_DEG)
				problems.push(`${at(t)} is dark but the sun is above ${DARK_SUN_DEG}°`);
			if (s.key.body !== 'moon') problems.push(`${at(t)} is dark but the moon is not the key`);
		}
		if (problems.length >= 8) return problems;
	}
	if (dimmestDay <= brightestDark) problems.push('a dark minute is as bright as a day minute');
	return problems;
}

const shadowFrom: Vec3 = [0, 0, 0];
const shadowTo: Vec3 = [0, 0, 0];

/** The key light's direction for shadows: `dir` raised to at least `MIN_SHADOW_ELEVATION_DEG`. */
export function shadowDirection(dir: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
	const least = Math.sin(MIN_SHADOW_ELEVATION_DEG * RAD);
	if (dir[1] >= least) return copy(out, dir);
	const flat = Math.hypot(dir[0], dir[2]) || 1;
	const across = Math.cos(MIN_SHADOW_ELEVATION_DEG * RAD) / flat;
	out[0] = dir[0] * across;
	out[1] = least;
	out[2] = dir[2] * across;
	return out;
}

/**
 * Whether the shadow map must be drawn again for `next`, given the key light as it was `drawn`
 * last (null: never): when the light turned `SHADOW_STEP_DEG` or more, or switched body; never
 * while `next` gives no light.
 */
export function shadowNeedsRedraw(drawn: KeyLight | null, next: KeyLight): boolean {
	if (next.intensity <= 0) return false;
	if (!drawn || drawn.body !== next.body) return true;
	const a = shadowDirection(drawn.dir, shadowFrom);
	const b = shadowDirection(next.dir, shadowTo);
	const cos = Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
	return Math.acos(cos) / RAD >= SHADOW_STEP_DEG;
}

/**
 * The state as the captured sky sees it, quantized (#216): the environment is captured again only
 * when this changes. Colours in sqrt steps (so night's dim colours count), the sun by about 5°.
 */
export function environmentKey(s: AtmosphereState): string {
	const c = (v: Vec3) => v.map((x) => Math.round(Math.sqrt(Math.max(0, x)) * 32)).join('.');
	const n = (x: number, step: number) => Math.round(x / step);
	const sun = s.sunGlow > 0 ? s.sunDir.map((x) => n(x, 0.08)).join('.') : '-';
	return [
		c(s.zenith),
		c(s.horizon),
		c(s.ground),
		sun,
		n(s.sunGlow, 0.1),
		n(s.clouds, 0.1),
		n(s.stars, 0.1)
	].join('|');
}

/**
 * Range fog's start and end for a table `extent` across (#221): it starts past the far edge of the
 * play area as the default poses see it (about 1.5 extents away), so the table itself stays clear
 * and only the world beyond fades; never nearer than 40 and 90, and inside the camera's far plane.
 */
export function fogRange(extent: number): { near: number; far: number } {
	return { near: Math.max(40, 1.5 * extent), far: Math.max(90, 3.5 * extent) };
}

/**
 * How much fog covers a point, as the scene's fog node works it out (#217): the larger of range
 * fog (three's `rangeFogFactor`) and height fog (`exponentialHeightFogFactor`) at view depth
 * `viewZ` and world height `y`, held to `PLAY_FOG_CAP` over the play area and rising to 1 over
 * `PLAY_FOG_BLEND` metres past it (`fromPlay`: metres beyond the play area's edge, ≤ 0 inside).
 */
export function fogFactorAt(
	fog: AtmosphereState['fog'],
	range: { near: number; far: number },
	viewZ: number,
	y: number,
	fromPlay: number
): number {
	const ranged = smoothstep(range.near, range.far, viewZ);
	const m = Math.max(0, fog.height - y) * viewZ * fog.density;
	const height = 1 - Math.exp(-m * m);
	const cap = PLAY_FOG_CAP + (1 - PLAY_FOG_CAP) * smoothstep(0, PLAY_FOG_BLEND, fromPlay);
	return Math.min(Math.max(ranged, height), cap);
}
