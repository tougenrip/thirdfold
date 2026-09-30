// The sky's pure maths (#212): sRGB to linear, black-body colour, and where the sun and moon stand
// on a path at an hour. Three-free (relative imports only); atmosphere-curve.ts re-exports it.
// Axes: Y up, grid north along -Z, east along +X; directions point toward the body.

import { DAY_MINUTES } from '../game/world';

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
