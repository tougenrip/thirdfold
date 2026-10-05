// Beyond the grid (#244): the land round the play area, out to the horizon, and the far
// silhouettes that belong to its environment (hills and forest with the mountain and its
// monastery, a mountainside, mesas, cave walls), all fogged into the sky. Pure: landscape.ts turns
// the arrays into meshes.
//
// Its only inputs are scene-level: the environment's id, the world look's `backdrop` and the
// grid's size (`Span`, from world-ground.ts `worldExtents`). Nothing reads a cell, so the GM,
// players and spectators get the same backdrop and it tells nobody about unexplored ground.
//
// The skirt runs from the grid's edge (y = 0, where the chunks' border faces end) down a bevelled
// lip half a level below `backdrop.level`, and rises with seeded noise only beyond the camera's
// reach, so the camera never stands under it. A backdrop kind picks the land, the water or the
// void beyond (`beyondSample`, for the border tiles and #243's chasms); land kinds also pick the
// silhouettes, and null keeps the environment's recipe.

import type { Backdrop, WorldLook } from '../../game/world';
import { STEP_HEIGHT } from '../ground';
import {
	KINDS,
	PLAIN,
	RECIPES,
	type Landmark,
	type Recipe,
	type Ridge,
	type RidgeStyle
} from './recipes';

export type { LookSlot, Recipe, Ridge, RidgeStyle } from './recipes';

/** What lies beyond the border: land, water (a flat sea), or nothing (the void below). */
export type Sample = 'land' | 'water' | 'void';

/** The grid's size as the backdrop needs it, in world units (worldExtents). */
export interface Span {
	halfX: number;
	halfZ: number;
	cellSize: number;
	frame: number;
	/** How far from the grid's centre the camera can stand. */
	reach: number;
	horizon: number;
	/** The haze's range by view depth (atmosphere-curve.ts `fogRange`). */
	fogNear: number;
	fogFar: number;
	/** How far past the grid the haze is held off the map (`PLAY_FOG_BLEND`). */
	clear: number;
}

export interface BeyondInput {
	environment: string | null;
	backdrop: WorldLook['backdrop'];
	span: Span;
}

export interface Beyond {
	kind: Backdrop | null;
	sample: Sample;
	level: number;
	recipe: Recipe;
	span: Span;
}

export interface BeyondMesh {
	positions: Float32Array;
	/** World units (x, -z), as every ground mesh. */
	uvs: Float32Array;
	indices: Uint32Array;
}

/** What the dual grid takes beyond the border for a backdrop kind (#240's border tiles, #243). */
export function beyondSample(kind: Backdrop | null): Sample {
	if (kind === 'sea') return 'water';
	if (kind === 'abyss' || kind === 'prairie-scroll') return 'void';
	return 'land';
}

/** The backdrop for a scene: from its environment, backdrop and grid size, nothing else. */
export function beyondOf({ environment, backdrop, span }: BeyondInput): Beyond {
	const own = (environment && RECIPES[environment]) || PLAIN;
	const recipe = (backdrop.kind && KINDS[backdrop.kind]) || own;
	return {
		kind: backdrop.kind,
		sample: beyondSample(backdrop.kind),
		level: backdrop.level,
		recipe,
		span
	};
}

// Seeded value noise, periodic round the ring.
function hash(i: number, j: number, seed: number): number {
	let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, -2048144789)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const ease = (f: number) => f * f * (3 - 2 * f);
const mod = (a: number, n: number) => ((a % n) + n) % n;
/** 0-1 noise at `t` features, repeating every `period`, row `j`. */
function noise(t: number, period: number, j: number, seed: number): number {
	const i = Math.floor(t);
	const a = hash(mod(i, period), j, seed);
	return a + (hash(mod(i + 1, period), j, seed) - a) * ease(t - i);
}
/** Three octaves round the ring at angle `a` (radians), `bumps` features at the first. */
function fbm(a: number, bumps: number, seed: number, j = 0): number {
	const u = mod(a / (2 * Math.PI), 1);
	let sum = 0;
	for (let o = 0, w = 0.5; o < 3; o++, w /= 2) {
		const period = bumps << o;
		sum += w * noise(u * period, period, j, seed + o);
	}
	return sum / 0.875;
}
function smoothstep(a: number, b: number, x: number): number {
	return ease(Math.min(Math.max((x - a) / (b - a), 0), 1));
}
/** The shortest angle between two directions. */
const turn = (a: number, b: number) => Math.abs(mod(a - b + Math.PI, 2 * Math.PI) - Math.PI);

/**
 * Out to here from the edge the lip goes down, and the next loop is this far out. The abyss's plane
 * lies `ABYSS` frames below, from where the haze is no longer held off the map (`Span.clear`): in
 * between is a gap onto the mist, with no wall at the edge.
 */
const LIP_CELLS = 0.35;
const DROP_CELLS = 1.5;
const ABYSS = 0.6;

/** How far below the ground the abyss's plane lies, in the haze (PLAY_FOG_DEPTH lets it fill). */
const abyssDepth = (b: Beyond) =>
	Math.max(20 * STEP_HEIGHT * b.span.cellSize, ABYSS * b.span.frame);

/**
 * The skirt's height at (x, z): null over the grid. Exported for the camera rig (#280), which
 * keeps the camera above it, and for anything placed beyond the grid.
 */
export function beyondHeightAt(b: Beyond, x: number, z: number): number | null {
	const { halfX, halfZ, cellSize: c, frame, reach, horizon } = b.span;
	if (Math.abs(x) < halfX && Math.abs(z) < halfZ) return null;
	const d = Math.hypot(Math.max(Math.abs(x) - halfX, 0), Math.max(Math.abs(z) - halfZ, 0));
	const step = STEP_HEIGHT * c;
	const lip = 0.5 * step;
	const edge = smoothstep(0, LIP_CELLS * c, d);
	if (b.kind === 'abyss')
		return d <= LIP_CELLS * c ? -lip * edge : -Math.max(20 * step, ABYSS * frame);
	// The moving ground (#243, #344) two levels below: still until it moves.
	if (b.kind === 'prairie-scroll') return -(lip + 2 * step) * edge;
	const flat = edge * (b.level * step - lip);
	if (b.sample === 'water' || b.recipe.rise === 0) return flat;
	const out = Math.hypot(x, z);
	const a = Math.atan2(z, x);
	const rise = smoothstep(reach, reach + 0.6 * (horizon - reach), out);
	if (rise === 0) return flat;
	const n = fbm(a, 16, 7, Math.floor(out / frame)) * 0.5 + fbm(a, 5, 9) * 0.5;
	return flat + b.recipe.rise * frame * rise * (0.3 + 0.7 * n);
}

/** Directions round the skirt and loops out to the horizon: fewer on the low tier. */
export const SKIRT = { low: { segments: 32, loops: 6 }, other: { segments: 128, loops: 12 } };

/**
 * The land from the grid's edge to the horizon: an annulus whose hole is exactly the grid's
 * rectangle (its corners are vertices, so it meets the chunks with no gap or overlap). The first
 * loops are the rectangle offset outward (the lip's bevel along the border), the rest run out to a
 * circle at the horizon, closer together near the grid. Heights from `beyondHeightAt`.
 */
export function skirtMesh(b: Beyond, low: boolean): BeyondMesh {
	const { halfX: hw, halfZ: hd, cellSize: c, horizon } = b.span;
	const { segments, loops } = low ? SKIRT.low : SKIRT.other;
	const corner = Math.atan2(hd, hw);
	const angles = [corner, Math.PI - corner, Math.PI + corner, 2 * Math.PI - corner];
	for (let i = 0; i < segments; i++) angles.push((i / segments) * 2 * Math.PI);
	angles.sort((p, q) => p - q);
	const around = angles.filter((a, i) => i === 0 || a - angles[i - 1] > 1e-9);
	const abyss = b.kind === 'abyss';
	// Out from the edge, and the height where it isn't the function's: the abyss's plane starts
	// under the edge (below a gap, so no wall stands at it) and runs on under the grid.
	const deep = -abyssDepth(b);
	const steps: [number, number | null][] = abyss
		? [
				[0, null],
				[LIP_CELLS * c, null],
				[0, deep],
				[Math.max(DROP_CELLS * c, b.span.clear), deep]
			]
		: [
				[0, null],
				[LIP_CELLS * c, null],
				[DROP_CELLS * c, null]
			];
	const rows = steps.length + loops;
	const corners: number[] = [];

	const positions = new Float32Array(around.length * rows * 3);
	const uvs = new Float32Array(around.length * rows * 2);
	around.forEach((a, i) => {
		const cos = Math.cos(a);
		const sin = Math.sin(a);
		// Where the ray from the centre leaves the rectangle, snapped onto its edge.
		const t = Math.min(hw / Math.abs(cos), hd / Math.abs(sin)); // x / 0 is Infinity
		let [px, pz] = [cos * t, sin * t];
		const onX = Math.abs(Math.abs(px) - hw) < 1e-9 * (hw + 1);
		const onZ = Math.abs(Math.abs(pz) - hd) < 1e-9 * (hd + 1);
		if (onX) px = Math.sign(cos) * hw;
		if (onZ) pz = Math.sign(sin) * hd;
		// Outward: the side's normal, or the diagonal at a corner (so each loop is `d` out).
		const [nx, nz] =
			onX && onZ
				? [Math.SQRT1_2 * Math.sign(cos), Math.SQRT1_2 * Math.sign(sin)]
				: onX
					? [Math.sign(cos), 0]
					: [0, Math.sign(sin)];
		if (onX && onZ) corners.push(i);
		const put = (k: number, x: number, z: number, y: number | null = null) => {
			const v = i * rows + k;
			positions.set([x, y ?? beyondHeightAt(b, x, z) ?? 0, z], v * 3);
			uvs.set([x, -z], v * 2);
		};
		steps.forEach(([d, y], k) => put(k, px + nx * d, pz + nz * d, y));
		const last = steps[steps.length - 1][0];
		const [qx, qz] = [px + nx * last, pz + nz * last];
		for (let k = 1; k <= loops; k++) {
			const f = (k / loops) ** 2;
			put(steps.length - 1 + k, qx + (cos * horizon - qx) * f, qz + (sin * horizon - qz) * f);
		}
	});
	const ring = band(around.length, rows, abyss ? 1 : -1);
	if (!abyss) return { positions, uvs, indices: ring };
	// The abyss's floor under the grid: its four corners on the plane, in angle order, facing up.
	const [c0, c1, c2, c3] = corners.map((i) => i * rows + 2);
	const indices = new Uint32Array(ring.length + 6);
	indices.set(ring);
	indices.set([c0, c2, c1, c0, c3, c2], ring.length);
	return { positions, uvs, indices };
}

/** Triangles between columns round a ring and rows outward, wound to face up and in; none past row `gap`. */
function band(columns: number, rows: number, gap = -1): Uint32Array {
	const indices = new Uint32Array(columns * (rows - (gap < 0 ? 1 : 2)) * 6);
	let o = 0;
	for (let i = 0; i < columns; i++) {
		const a = i * rows;
		const b = ((i + 1) % columns) * rows;
		for (let k = 0; k < rows - 1; k++) {
			if (k === gap) continue;
			// Angles rise from +x toward +z, so (a, b, a+1) faces up (+y).
			indices.set([a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1], o);
			o += 6;
		}
	}
	return indices;
}

/** Each style's cross-section from its foot: [out, up], out in `SPAN` frames, up of its height. */
const PROFILES: Record<RidgeStyle, readonly (readonly [number, number])[]> = {
	hills: [
		[0, 0],
		[0.35, 0.6],
		[0.7, 0.92],
		[1, 1]
	],
	forest: [
		[0, 0],
		[0.1, 0.75],
		[0.5, 0.95],
		[1, 1]
	],
	mountains: [
		[0, 0],
		[0.25, 0.4],
		[0.55, 0.85],
		[0.75, 1]
	],
	mesas: [
		[0, 0],
		[0.04, 0.85],
		[0.07, 1],
		[0.5, 1]
	],
	cave: [
		[0, 0],
		[0.04, 0.55],
		[0.1, 0.9],
		[0.16, 1]
	]
};
const SPAN = 0.3;
/** Columns round a ridge: fewer on the low tier. */
export const RIDGE_SEGMENTS = { low: 72, other: 240 };

/** A ridge's crest height at angle `a`, landmark included, in world units. */
export function crestAt(b: Beyond, ridge: Ridge, a: number, landmark?: Landmark): number {
	const H = ridge.height * b.span.frame;
	const n = fbm(a, ridge.bumps, ridge.seed);
	let top: number;
	if (ridge.style === 'mountains') top = H * (0.25 + 0.75 * (1 - Math.abs(2 * n - 1)) ** 1.5);
	else if (ridge.style === 'mesas') top = H * (0.12 + 0.88 * smoothstep(0.47, 0.53, n));
	else if (ridge.style === 'forest')
		top = H * (0.5 + 0.3 * n + 0.2 * fbm(a, ridge.bumps * 16, ridge.seed + 5));
	else if (ridge.style === 'cave') top = H * (0.7 + 0.3 * n);
	else top = H * (0.45 + 0.55 * n);
	if (!landmark) return top;
	const peak = Math.max(0, 1 - (turn(a, landmark.azimuth) / landmark.width) ** 2) ** 1.5;
	return Math.max(top, landmark.height * b.span.frame * peak);
}

/**
 * One silhouette: a ring of ridge facing the grid, its foot on the skirt, its crest from the
 * style's noise (the landmark's peak on the farthest ridge, with the monastery's hall and tower on
 * it). Cave walls are rough and rise into darkness with no ceiling.
 */
export function ridgeMesh(b: Beyond, index: number, low: boolean): BeyondMesh {
	const ridge = b.recipe.ridges[index];
	const { frame, fogNear, fogFar, cellSize } = b.span;
	const last = index === b.recipe.ridges.length - 1;
	const landmark = last ? b.recipe.landmark : undefined;
	const profile = PROFILES[ridge.style];
	const columns = low ? RIDGE_SEGMENTS.low : RIDGE_SEGMENTS.other;
	const foot = fogNear + ridge.distance * (fogFar - fogNear);
	const rows = profile.length;
	const pos: number[] = [];
	const uv: number[] = [];
	for (let i = 0; i < columns; i++) {
		const a = (i / columns) * 2 * Math.PI;
		const crest = crestAt(b, ridge, a, landmark);
		const ground = beyondHeightAt(b, Math.cos(a) * foot, Math.sin(a) * foot) ?? 0;
		for (let k = 0; k < rows; k++) {
			const [out, up] = profile[k];
			const rough =
				ridge.style === 'cave' ? fbm(a, ridge.bumps * 4, ridge.seed + 3, k) * 0.06 * frame : 0;
			const radius = foot + out * SPAN * frame + rough;
			// The foot sinks a step into the land; the rest stands from the land, or level 0 above a drop.
			const y = k === 0 ? ground - STEP_HEIGHT * cellSize : Math.max(ground, 0) + crest * up;
			const [x, z] = [Math.cos(a) * radius, Math.sin(a) * radius];
			pos.push(x, y, z);
			uv.push(x, -z);
		}
	}
	const ring = band(columns, rows);
	const indices = Array.from(ring);
	if (landmark?.monastery) {
		const a = landmark.azimuth;
		const radius = foot + profile[rows - 1][0] * SPAN * frame;
		const ground = beyondHeightAt(b, Math.cos(a) * foot, Math.sin(a) * foot) ?? 0;
		const base = Math.max(ground, 0) + crestAt(b, ridge, a, landmark) - 0.02 * frame;
		// The hall along the crest and the bell tower at its end, set into the peak.
		card(pos, uv, indices, a, radius, 0, base, 0.06 * frame, 0.05 * frame);
		card(pos, uv, indices, a, radius, 0.06 * frame, base, 0.018 * frame, 0.13 * frame);
	}
	return {
		positions: Float32Array.from(pos),
		uvs: Float32Array.from(uv),
		indices: Uint32Array.from(indices)
	};
}

/**
 * A flat silhouette facing the grid at angle `a`, `radius` out, shifted `side` along the ring:
 * `w` half its width, `h` its height above `y`. Seen from beyond the ring it is culled, as the
 * ridges are, so it never stands between the camera and the grid.
 */
function card(
	pos: number[],
	uv: number[],
	idx: number[],
	a: number,
	radius: number,
	side: number,
	y: number,
	w: number,
	h: number
): void {
	const [c, s] = [Math.cos(a), Math.sin(a)];
	const first = pos.length / 3;
	// Counter-clockwise seen from the grid: along the ring (-sin, cos), then up.
	for (const [u, v] of [
		[-w, 0],
		[w, 0],
		[w, h],
		[-w, h]
	]) {
		const [x, z] = [c * radius - s * (side + u), s * radius + c * (side + u)];
		pos.push(x, y + v, z);
		uv.push(x, -z);
	}
	idx.push(first, first + 1, first + 2, first, first + 2, first + 3);
}
