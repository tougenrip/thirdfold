// The sky's pure maths (#212): sRGB to linear, black-body colour, and where the sun and moon stand
// on a path at an hour; the dome's star field (#214) and when the sky is captured again (#216).
// Three-free (relative imports only); atmosphere-curve.ts re-exports the first, sky.ts uses the rest.
// Axes: Y up, grid north along -Z, east along +X; directions point toward the body.

import { DAY_MINUTES } from '../game/world';
import type { Tier } from './quality';

export type Vec3 = [number, number, number];

/** Where the sun runs: degrees of latitude and declination, the turn of north about Y, solar noon. */
export interface SunPath {
	latitude: number;
	declination: number;
	north: number;
	/** The minute of solar noon: 780 (13:00), because the bands of world.ts are symmetric about it. */
	noon: number;
}

export const DEFAULT_PATH: SunPath = { latitude: 45, declination: 10, north: 0, noon: 780 };

const RAD = Math.PI / 180;

export function srgbToLinear(c: number): number {
	return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

export function hexToLinear(hex: string, out: Vec3): Vec3 {
	const n = parseInt(hex.slice(1), 16);
	out[0] = srgbToLinear(((n >> 16) & 255) / 255);
	out[1] = srgbToLinear(((n >> 8) & 255) / 255);
	out[2] = srgbToLinear((n & 255) / 255);
	return out;
}

/** A black body's colour by Tanner Helland's fit (1000-40000 K), as sRGB, linearised. */
export function kelvinToLinear(kelvin: number, out: Vec3 = [0, 0, 0]): Vec3 {
	const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
	const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
	const g =
		t <= 66
			? 99.4708025861 * Math.log(t) - 161.1195681661
			: 288.1221695283 * Math.pow(t - 60, -0.0755148492);
	const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
	const c = (v: number) => srgbToLinear(Math.min(255, Math.max(0, v)) / 255);
	out[0] = c(r);
	out[1] = c(g);
	out[2] = c(b);
	return out;
}

/** The unit direction toward a body on `path` at hour angle `h` (radians, 0 at noon). */
function onPath(path: SunPath, h: number, out: Vec3): Vec3 {
	const phi = path.latitude * RAD;
	const delta = path.declination * RAD;
	const up = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(h);
	const east = -Math.cos(delta) * Math.sin(h);
	const north = Math.sin(delta) * Math.cos(phi) - Math.cos(delta) * Math.sin(phi) * Math.cos(h);
	const r = path.north * RAD;
	const x = east;
	const z = -north;
	out[0] = x * Math.cos(r) + z * Math.sin(r);
	out[1] = up;
	out[2] = -x * Math.sin(r) + z * Math.cos(r);
	return out;
}

const hourAngle = (path: SunPath, time: number) => ((time - path.noon) / DAY_MINUTES) * 2 * Math.PI;

/** Toward the sun at `time` (minutes; the day is dropped). */
export function sunDirection(path: SunPath, time: number, out: Vec3 = [0, 0, 0]): Vec3 {
	return onPath(path, hourAngle(path, time), out);
}

/** Toward the moon: the sun's path, `phase` of a turn behind it (full, 0.5, opposite). */
export function moonDirection(
	path: SunPath,
	time: number,
	phase: number,
	out: Vec3 = [0, 0, 0]
): Vec3 {
	return onPath(path, hourAngle(path, time) - 2 * Math.PI * phase, out);
}

/** The lit share of the moon's disc at `phase`. */
export function moonIllumination(phase: number): number {
	return (1 - Math.cos(2 * Math.PI * phase)) / 2;
}

export function elevationOf(dir: Vec3): number {
	return Math.asin(Math.min(1, Math.max(-1, dir[1]))) / RAD;
}

export function smoothstep(a: number, b: number, x: number): number {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
}

/** Mulberry32, as the dice's (dice-faces.ts, which the server's build can't reach from here). */
function seededRandom(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), a | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** The stars on the dome: unit directions, sizes in CSS px and linear colours (brightness in them). */
export interface StarField {
	directions: Float32Array<ArrayBuffer>;
	sizes: Float32Array<ArrayBuffer>;
	colors: Float32Array<ArrayBuffer>;
}

/** Stars drawn per tier (#214): the count changes with the tier only; low draws no dome at all. */
export const STAR_COUNTS: Record<Tier, number> = { low: 0, medium: 1500, high: 3000, ultra: 3000 };
export const STAR_COUNT = 3000;
/** How far below the horizon stars are placed (they fade out there). */
const STAR_FLOOR = -0.1;
/** Coloured giants: a few percent, warm or blue. */
const GIANTS = 0.04;
const WARM: Vec3 = [1, 0.62, 0.36];
const BLUE: Vec3 = [0.62, 0.74, 1];

/**
 * `n` stars from `seed`, the same on every client (no `Math.random`, as the dice): even over the
 * sphere above `STAR_FLOOR`, most faint and small, a few bright, a few tinted.
 */
export function starField(seed: number, n: number): StarField {
	const rand = seededRandom(seed);
	const directions = new Float32Array(n * 3);
	const sizes = new Float32Array(n);
	const colors = new Float32Array(n * 3);
	for (let i = 0; i < n; i++) {
		// Uniform in y is uniform over the sphere's area.
		const y = STAR_FLOOR + (1 - STAR_FLOOR) * rand();
		const a = 2 * Math.PI * rand();
		const r = Math.sqrt(1 - y * y);
		directions.set([r * Math.cos(a), y, r * Math.sin(a)], i * 3);
		const bright = rand() ** 6;
		sizes[i] = 1 + 2 * bright;
		const giant = rand() < GIANTS ? (rand() < 0.5 ? WARM : BLUE) : null;
		const b = 0.15 + 0.85 * bright;
		for (let c = 0; c < 3; c++) colors[i * 3 + c] = b * (giant ? giant[c] : 1);
	}
	return { directions, sizes, colors };
}

/** How often the sky may be captured again, per tier (ms); low captures once per table. */
export const CAPTURE_INTERVAL_MS: Record<Tier, number> = {
	low: Infinity,
	medium: 5000,
	high: 2000,
	ultra: 2000
};

/**
 * When to capture the sky into the environment again (#216): when its `environmentKey` changed,
 * at most once per `interval`, and once more when a throttled key is still waiting (`nextAt`), so
 * the last state is always the one captured. An infinite interval captures once until `reset`.
 */
export class CaptureThrottle {
	private last = -Infinity;
	private done: string | null = null;
	private wanted: string | null = null;

	constructor(public interval: number) {}

	/** A new table: its first sky is captured at once. */
	reset(): void {
		this.last = -Infinity;
		this.done = this.wanted = null;
	}

	/** Whether to capture `key` at `now` (ms); counted as captured when it says so. */
	due(key: string, now: number): boolean {
		this.wanted = key;
		if (key === this.done || now - this.last < this.interval) return false;
		this.done = key;
		this.last = now;
		return true;
	}

	/** When a throttled key falls due (the trailing capture), or null when none waits. */
	nextAt(): number | null {
		const waiting = this.wanted !== null && this.wanted !== this.done;
		return waiting && Number.isFinite(this.interval) ? this.last + this.interval : null;
	}
}
