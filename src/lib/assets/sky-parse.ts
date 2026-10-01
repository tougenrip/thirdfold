// Skies (#213, see manifest.ts `SkyDef`), checked field by field: the
// pipeline checks each source with it, and parseManifest each sky it is sent.
// Closed: every number bounded, anything unknown dropped, and one bad field
// refuses the sky. And which sky a table shows (`resolveSky`).

import {
	DEFAULT_SKY,
	SKY_KINDS,
	SUNLESS_SKY,
	type Manifest,
	type SkyDef,
	type SkyKey
} from './manifest';
import type { WorldLook } from '../game/world';

export type ParsedSky = { ok: true; sky: Omit<SkyDef, 'credit'> } | { ok: false; error: string };

const MINUTES = 1440;
const MAX_KEYS = 16;
const COLOR = /^#[0-9a-f]{6}$/;

class Invalid extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown, min: number, max: number, what: string): number {
	if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
		throw new Invalid(`${what} is not a number from ${min} to ${max}`);
	}
	return v;
}

function color(v: unknown, what: string): string {
	if (typeof v !== 'string' || !COLOR.test(v)) throw new Invalid(`${what} is not #rrggbb`);
	return v;
}

// Each key's numbers and their bounds, and its colours; the fog's and the path's numbers.
const KEY_NUMBERS = {
	sun: [0, 10],
	moon: [0, 10],
	hemi: [0, 10],
	ibl: [0, 10],
	exposure: [-4, 4],
	stars: [0, 1],
	clouds: [0, 1],
	nightGlow: [0, 1]
} as const;
const KEY_COLORS = ['hemiSky', 'hemiGround', 'zenith', 'horizon', 'ground'] as const;
const FOG_NUMBERS = { density: [0, 1], height: [0, 100] } as const;
const PATH_NUMBERS = {
	latitude: [-90, 90],
	declination: [-23.5, 23.5],
	north: [0, 360],
	noon: [0, MINUTES - 1],
	moonCycle: [1, 60],
	moonPhase: [0, 1]
} as const;

/** `v`'s fields in `bounds`, each checked. */
function numbers<K extends string>(
	v: Record<string, unknown>,
	bounds: Record<K, readonly [number, number]>,
	where: string
): Record<K, number> {
	const out = {} as Record<K, number>;
	for (const [k, [min, max]] of Object.entries(bounds) as [K, [number, number]][]) {
		out[k] = num(v[k], min, max, `${where} ${k}`);
	}
	return out;
}

function readKey(v: unknown, enclosed: boolean, where: string): SkyKey {
	if (!isRecord(v)) throw new Invalid(`${where} is not an object`);
	const minute = num(v.minute, 0, MINUTES - 1, `${where} minute`);
	if (!Number.isInteger(minute)) throw new Invalid(`${where} minute is not whole`);
	const f = v.fog;
	if (!isRecord(f)) throw new Invalid(`${where} has no fog`);
	const key = { minute, ...numbers(v, KEY_NUMBERS, where) } as SkyKey;
	for (const k of KEY_COLORS) key[k] = color(v[k], `${where} ${k}`);
	key.fog = { color: color(f.color, `${where} fog`), ...numbers(f, FOG_NUMBERS, `${where} fog`) };
	const sun = v.sunKelvin ?? v.sunColor;
	if (enclosed) {
		// Under a roof of rock: no sun, no moon, and light from the fill alone.
		const fill = v.fill;
		if (sun !== undefined || key.sun > 0 || key.moon > 0 || !isRecord(fill)) {
			throw new Invalid(`${where}: an enclosed sky has no sun or moon, and a fill`);
		}
		key.fill = {
			color: color(fill.color, `${where} fill`),
			intensity: num(fill.intensity, 0, 10, `${where} fill`)
		};
		return key;
	}
	if (v.fill !== undefined || (v.sunKelvin === undefined) === (v.sunColor === undefined)) {
		throw new Invalid(`${where}: an open sky has sunKelvin or sunColor, and no fill`);
	}
	if (v.sunKelvin !== undefined) key.sunKelvin = num(sun, 1000, 40000, `${where} sunKelvin`);
	else key.sunColor = color(sun, `${where} sunColor`);
	return key;
}

/** A sky, without its credit (the manifest's is checked with every other credit). */
export function parseSky(raw: unknown): ParsedSky {
	try {
		if (!isRecord(raw)) throw new Invalid('not an object');
		const kind = SKY_KINDS.find((k) => k === raw.kind);
		if (!kind) throw new Invalid('bad kind');
		if (typeof raw.name !== 'string' || raw.name.length < 1 || raw.name.length > 60) {
			throw new Invalid('bad name');
		}
		const enclosed = kind === 'enclosed';
		if (!Array.isArray(raw.keys) || raw.keys.length < 2 || raw.keys.length > MAX_KEYS) {
			throw new Invalid(`needs 2 to ${MAX_KEYS} keys`);
		}
		const keys = raw.keys.map((k, i) => readKey(k, enclosed, `key ${i}`));
		for (let i = 1; i < keys.length; i++) {
			if (keys[i].minute <= keys[i - 1].minute) throw new Invalid(`key ${i}: minutes must rise`);
		}
		const sky: Omit<SkyDef, 'credit'> = { kind, name: raw.name, keys };
		if (enclosed) {
			if (raw.path !== undefined) throw new Invalid('an enclosed sky has no path');
		} else if (isRecord(raw.path)) sky.path = numbers(raw.path, PATH_NUMBERS, 'path');
		else throw new Invalid('an open sky needs a path');
		return { ok: true, sky };
	} catch (err) {
		if (err instanceof Invalid) return { ok: false, error: err.message };
		throw err;
	}
}

/**
 * The sky a table shows: its look's if the manifest has it, else its environment's, else the
 * default; a sunless table ("Underground") shows the sunless sky instead of an open one. Unknown
 * ids fall back without a word, as unknown environments do. Null only when the manifest has none.
 */
export function resolveSky(
	world: Pick<WorldLook, 'sky' | 'sun'> | null,
	environment: string | null,
	manifest: Pick<Manifest, 'skies' | 'environments'>
): { id: string; sky: SkyDef } | null {
	const known = (id: string | null | undefined) =>
		id && Object.hasOwn(manifest.skies, id) ? id : null;
	const env =
		environment && Object.hasOwn(manifest.environments, environment)
			? manifest.environments[environment]
			: null;
	let id = known(world?.sky) ?? known(env?.sky) ?? known(DEFAULT_SKY);
	if (id && world?.sun === false && manifest.skies[id].kind === 'open')
		id = known(SUNLESS_SKY) ?? id;
	return id ? { id, sky: manifest.skies[id] } : null;
}
