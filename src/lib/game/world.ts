// The world's look: the hour, the sky, weather, haze, the colour grade and
// what lies beyond the grid, as plain data saved with the table (scene file
// v10) and shared by the server and the renderer.
//
// Only one thing here is a rule: the hour sets the ambient band (`bandOf`)
// on a table with a sun. Underground (`sun: false`) the band is set on its
// own and the hour is look only. Everything else is presentation and never
// reaches a rule; rules read `room.ambient`, never `world.time`.

import type { Ambient } from './lights';
import { MAX_LEVEL } from './terrain';
import { TOKEN_COLOR_PATTERN } from './token';
import { ASSET_ID_PATTERN } from '../assets/manifest';

export const DAY_MINUTES = 1440;
export const MAX_RATE = 60;
export const MAX_EXPOSURE = 2;
export const MAX_SEED = 0xffffffff;
export const WEATHERS = ['none', 'rain', 'snow', 'storm', 'fog', 'ash', 'dust'] as const;
export type Weather = (typeof WEATHERS)[number];
export const BACKDROPS = [
	'none',
	'plains',
	'hills',
	'forest',
	'mountains',
	'sea',
	'abyss',
	'cavern',
	'prairie-scroll'
] as const;
export type Backdrop = (typeof BACKDROPS)[number];

export interface WorldLook {
	/** The hour, in whole minutes after midnight, 0-1439. */
	time: number;
	/** Game minutes per real second, 0-60; 0 is a stopped clock. */
	rate: number;
	/** The hour moves a sun here and sets the band; false underground. */
	sun: boolean;
	/** A sky asset's id; null for the environment's. */
	sky: string | null;
	/** Intensity 0-1, seed a uint32, since in ms since epoch (stamped by the server). */
	weather: { kind: Weather; intensity: number; seed: number; since: number };
	/** Density 0-1; colour `#rrggbb`, or null for the grade's. */
	haze: { density: number; color: string | null };
	/** A grade asset's id or null for the environment's; exposure in EV, -2 to 2. */
	grade: { preset: string | null; exposure: number };
	/** Null for the environment's; the level it lies at, 0 to MAX_LEVEL. */
	backdrop: { kind: Backdrop | null; level: number };
}

/** A change to the look: any fields, nested ones field by field. `weather.since` is never sent. */
export interface WorldPatch {
	time?: number;
	rate?: number;
	sun?: boolean;
	sky?: string | null;
	weather?: Partial<Omit<WorldLook['weather'], 'since'>>;
	haze?: Partial<WorldLook['haze']>;
	grade?: Partial<WorldLook['grade']>;
	backdrop?: Partial<WorldLook['backdrop']>;
}

/**
 * The band at an hour: day 07:00-18:59, dusk 05:00-06:59 and 19:00-20:59,
 * dark otherwise. These are rules: moving them changes what players see.
 */
export function bandOf(time: number): Ambient {
	if (time >= 420 && time < 1140) return 'day';
	if ((time >= 300 && time < 420) || (time >= 1140 && time < 1260)) return 'dusk';
	return 'dark';
}

const CANONICAL: Record<Ambient, number> = { day: 720, dusk: 1170, dark: 1380 };

/** The hour a band stands for: 12:00, 19:30 or 23:00. */
export function canonicalTime(band: Ambient): number {
	return CANONICAL[band];
}

/** The band a look sets: the hour's with a sun, else whatever the table has. */
export function ambientFor(look: WorldLook, current: Ambient): Ambient {
	return look.sun ? bandOf(look.time) : current;
}

/** The look moved into `band`: with a sun, the hour snaps to the band's only when outside it. */
export function withBand(look: WorldLook, band: Ambient): WorldLook {
	if (!look.sun || bandOf(look.time) === band) return look;
	return { ...look, time: canonicalTime(band) };
}

export const DEFAULT_WORLD: WorldLook = {
	time: CANONICAL.day,
	rate: 0,
	sun: true,
	sky: null,
	weather: { kind: 'none', intensity: 0, seed: 0, since: 0 },
	haze: { density: 0, color: null },
	grade: { preset: null, exposure: 0 },
	backdrop: { kind: null, level: 0 }
};

/** The default look at a band's hour (how older tables come forward). */
export function defaultWorldFor(ambient: Ambient): WorldLook {
	return { ...structuredClone(DEFAULT_WORLD), time: canonicalTime(ambient) };
}

/** `look` with `patch` merged in; the weather's `since` is stamped `now` when its kind changes. */
export function applyWorldPatch(look: WorldLook, patch: WorldPatch, now: number): WorldLook {
	const kind = patch.weather?.kind;
	return {
		...look,
		...pick(patch, ['time', 'rate', 'sun', 'sky']),
		weather: {
			...look.weather,
			...patch.weather,
			since: kind !== undefined && kind !== look.weather.kind ? now : look.weather.since
		},
		haze: { ...look.haze, ...patch.haze },
		grade: { ...look.grade, ...patch.grade },
		backdrop: { ...look.backdrop, ...patch.backdrop }
	};
}

function pick<T extends object, K extends keyof T>(from: T, keys: K[]): Partial<Pick<T, K>> {
	const out: Partial<Pick<T, K>> = {};
	for (const k of keys) if (from[k] !== undefined) out[k] = from[k];
	return out;
}

// Parsing. A field is `undefined` when absent and `BAD` when present but invalid.

const BAD = Symbol('bad');
type Field<T> = T | undefined | typeof BAD;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(v: unknown, min: number, max: number, whole = false): Field<number> {
	if (v === undefined) return undefined;
	if (typeof v !== 'number' || !Number.isFinite(v)) return BAD;
	const n = whole ? Math.round(v) : v;
	return Math.min(max, Math.max(min, n));
}

function time(v: unknown): Field<number> {
	if (v === undefined) return undefined;
	if (typeof v !== 'number' || !Number.isFinite(v)) return BAD;
	return ((Math.round(v) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

function bool(v: unknown): Field<boolean> {
	return v === undefined ? undefined : typeof v === 'boolean' ? v : BAD;
}

function oneOf<T extends string>(
	list: readonly T[],
	v: unknown,
	nullable = false
): Field<T | null> {
	if (v === undefined) return undefined;
	if (v === null) return nullable ? null : BAD;
	return list.includes(v as T) ? (v as T) : BAD;
}

function pattern(re: RegExp, v: unknown): Field<string | null> {
	if (v === undefined || v === null) return v as undefined | null;
	return typeof v === 'string' && re.test(v) ? v : BAD;
}

/** Each nested group's fields, parsed; BAD if the group or any field is invalid. */
function group<T>(
	v: unknown,
	fields: { [K in keyof T]: (x: unknown) => Field<T[K]> }
): Field<Partial<T>> {
	if (v === undefined) return undefined;
	if (!isRecord(v)) return BAD;
	const out: Partial<T> = {};
	for (const key of Object.keys(fields) as (keyof T)[]) {
		const value = fields[key](v[key as string]);
		if (value === BAD) return BAD;
		if (value !== undefined) out[key] = value as T[keyof T];
	}
	return out;
}

const WEATHER_FIELDS = {
	kind: (x: unknown) => oneOf(WEATHERS, x) as Field<Weather>,
	intensity: (x: unknown) => num(x, 0, 1),
	seed: (x: unknown) => num(x, 0, MAX_SEED, true)
};
const HAZE_FIELDS = {
	density: (x: unknown) => num(x, 0, 1),
	color: (x: unknown) => pattern(TOKEN_COLOR_PATTERN, x)
};
const GRADE_FIELDS = {
	preset: (x: unknown) => pattern(ASSET_ID_PATTERN, x),
	exposure: (x: unknown) => num(x, -MAX_EXPOSURE, MAX_EXPOSURE)
};
const BACKDROP_FIELDS = {
	kind: (x: unknown) => oneOf(BACKDROPS, x, true),
	level: (x: unknown) => num(x, 0, MAX_LEVEL, true)
};

/** A patch's fields; BAD when any is invalid (including a `weather.since`, which only the server sets). */
function patchFields(raw: Record<string, unknown>): WorldPatch | typeof BAD {
	if (isRecord(raw.weather) && raw.weather.since !== undefined) return BAD;
	const fields = {
		time: time(raw.time),
		rate: num(raw.rate, 0, MAX_RATE),
		sun: bool(raw.sun),
		sky: pattern(ASSET_ID_PATTERN, raw.sky),
		weather: group(raw.weather, WEATHER_FIELDS),
		haze: group(raw.haze, HAZE_FIELDS),
		grade: group(raw.grade, GRADE_FIELDS),
		backdrop: group(raw.backdrop, BACKDROP_FIELDS)
	};
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(fields)) {
		if (value === BAD) return BAD;
		if (value !== undefined) out[key] = value;
	}
	return out as WorldPatch;
}

/** A change to the look (`world_set`, effects, a new table), or null: at least one field, all valid. */
export function parseWorldPatch(raw: unknown): WorldPatch | null {
	if (!isRecord(raw)) return null;
	const patch = patchFields(raw);
	if (patch === BAD) return null;
	const empty = (g: object | undefined) => g !== undefined && Object.keys(g).length === 0;
	if (Object.keys(patch).length === 0) return null;
	if (empty(patch.weather) || empty(patch.haze) || empty(patch.grade) || empty(patch.backdrop)) {
		return null;
	}
	return patch;
}

/** A whole look (the scene file's), or null: every field present and valid. Unknown keys are dropped. */
export function parseWorldLook(raw: unknown): WorldLook | null {
	if (!isRecord(raw) || !isRecord(raw.weather)) return null;
	const since = num(raw.weather.since, 0, Number.MAX_SAFE_INTEGER, true);
	const patch = patchFields({ ...raw, weather: { ...raw.weather, since: undefined } });
	if (patch === BAD || since === BAD || since === undefined) return null;
	const { weather, haze, grade, backdrop } = patch;
	if (
		patch.time === undefined ||
		patch.rate === undefined ||
		patch.sun === undefined ||
		patch.sky === undefined ||
		weather?.kind === undefined ||
		weather.intensity === undefined ||
		weather.seed === undefined ||
		haze?.density === undefined ||
		haze.color === undefined ||
		grade?.preset === undefined ||
		grade.exposure === undefined ||
		backdrop?.kind === undefined ||
		backdrop.level === undefined
	) {
		return null;
	}
	return {
		time: patch.time,
		rate: patch.rate,
		sun: patch.sun,
		sky: patch.sky,
		weather: { kind: weather.kind, intensity: weather.intensity, seed: weather.seed, since },
		haze: { density: haze.density, color: haze.color },
		grade: { preset: grade.preset, exposure: grade.exposure },
		backdrop: { kind: backdrop.kind, level: backdrop.level }
	};
}
