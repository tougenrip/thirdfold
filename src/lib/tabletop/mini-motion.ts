// How a miniature moves (#272): all of it whole-object transforms on the wall clock, never a
// skinned animation, so a figure stays one instance of its batch and costs nothing at rest. Pure:
// `miniPose` reads a token's `MiniMotion` at a time and gives the offsets the token layer writes
// into its instance matrices (tokens.ts). Distances are in cells (the mini's own size), angles
// in radians.
//
// - a move glides with a hop, 0.2 to 0.35 cell high by its length, and lands with a squash
// - picked up (the viewer's selected, movable mini) it lifts and tilts toward the camera
// - a flier (`Token.lift`) bobs slowly, each on its own phase (the only ambient motion)
// - a fallen character tips over with one small bounce, and stands up when revived
//
// Under reduced motion a move glides flat and nothing hops, squashes, tilts or bobs; a fallen
// character is simply lying down.

export interface MiniMotion {
	/** The current move: when it began, how long it takes (0: none yet), its hop's height. */
	moveStart: number;
	moveMs: number;
	hop: number;
	/** Picked up, since when, and how far it was lifted (0..1) when that changed. */
	picked: boolean;
	pickAt: number;
	pickFrom: number;
	/** Fallen, since when, and its tip angle when that changed. */
	fallen: boolean;
	fallAt: number;
	fallFrom: number;
	/** A flier, and its bob's phase. */
	flier: boolean;
	phase: number;
}

export interface MiniPose {
	/** The move's eased progress, exactly 1 at rest. */
	along: number;
	/** Up, the whole mini: the hop. */
	hop: number;
	/** How far picked up, 0..1: the whole mini lifts `PICK_LIFT` and the figure tilts `PICK_TILT`. */
	pick: number;
	/** The figure's height scale; its width takes half the difference the other way. */
	squash: number;
	/** Up, the figure only. */
	bob: number;
	/** The figure's tip angle, 0 standing to `LYING` down. */
	fall: number;
	/** Anything but the bob still to come. */
	busy: boolean;
}

export const HOP_MIN = 0.2;
export const HOP_MAX = 0.35;
export const SQUASH = 0.1;
export const SQUASH_MS = 140;
export const PICK_LIFT = 0.12;
export const PICK_TILT = (8 * Math.PI) / 180;
export const PICK_MS = 150;
export const BOB = 0.03;
export const BOB_MS = 2400;
export const LYING = Math.PI / 2;
export const FALL_MS = 350;
export const STAND_MS = 300;
/** Where in the fall the figure first hits the base, and how far (of `LYING`) it bounces back. */
const IMPACT = 0.7;
const BOUNCE = 0.08;

/** A mini at rest: standing, put down, not moving. */
export function restingMotion(id: string, flier = false): MiniMotion {
	return {
		moveStart: 0,
		moveMs: 0,
		hop: 0,
		picked: false,
		pickAt: -Infinity,
		pickFrom: 0,
		fallen: false,
		fallAt: -Infinity,
		fallFrom: 0,
		flier,
		phase: phaseOf(id)
	};
}

/** The move's length: a few hundred ms, longer for more cells. */
export function moveMs(cells: number): number {
	return Math.min(180 + cells * 70, 700);
}

/** Starts a move of `cells` at `now`. */
export function startMove(m: MiniMotion, now: number, cells: number): void {
	m.moveStart = now;
	m.moveMs = moveMs(cells);
	m.hop = Math.min(HOP_MAX, Math.max(HOP_MIN, 0.15 + 0.05 * cells));
}

/** Picks the mini up or puts it down at `now`, from wherever it is. Returns true if it changed. */
export function pick(m: MiniMotion, on: boolean, now: number, reduced: boolean): boolean {
	if (m.picked === on) return false;
	m.pickFrom = pickAt(m, now, reduced);
	m.picked = on;
	m.pickAt = now;
	return true;
}

/**
 * Tips the mini over or stands it up at `now`, from its angle then; `snap` puts it there at once
 * (a mini that has only just come onto the table). Returns true if it changed.
 */
export function fall(m: MiniMotion, on: boolean, now: number, snap = false): boolean {
	if (m.fallen === on) return false;
	m.fallFrom = fallAt(m, now, false);
	m.fallen = on;
	m.fallAt = snap ? -Infinity : now;
	return true;
}

/** Where the mini is at `now`. */
export function miniPose(m: MiniMotion, now: number, reduced: boolean): MiniPose {
	const t = m.moveMs > 0 ? clamp((now - m.moveStart) / m.moveMs) : 1;
	const along = t >= 1 ? 1 : t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
	const hop = reduced || t >= 1 ? 0 : Math.sin(Math.PI * t) * m.hop;
	const landed = m.moveMs > 0 ? (now - m.moveStart - m.moveMs) / SQUASH_MS : 1;
	const squashing = !reduced && landed >= 0 && landed < 1;
	const squash = squashing ? 1 - SQUASH * Math.sin(Math.PI * landed) : 1;
	const picking = !reduced && now - m.pickAt < PICK_MS;
	const tipping = !reduced && now - m.fallAt < (m.fallen ? FALL_MS : STAND_MS);
	return {
		along,
		hop,
		pick: pickAt(m, now, reduced),
		squash,
		bob: m.flier && !reduced ? BOB * Math.sin((2 * Math.PI * now) / BOB_MS + m.phase) : 0,
		fall: fallAt(m, now, reduced),
		busy: t < 1 || squashing || picking || tipping
	};
}

/** Whether the mini bobs, asking for ambient frames. */
export function bobs(m: MiniMotion, reduced: boolean): boolean {
	return m.flier && !reduced;
}

/** A stable phase per token id (FNV-1a), so fliers don't bob in step. */
export function phaseOf(id: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
	return ((h >>> 0) / 0x100000000) * 2 * Math.PI;
}

function pickAt(m: MiniMotion, now: number, reduced: boolean): number {
	if (reduced) return 0;
	const target = m.picked ? 1 : 0;
	const u = (now - m.pickAt) / PICK_MS;
	if (u >= 1) return target;
	const eased = 1 - (1 - clamp(u)) ** 2; // out: quick off the table, soft at the top
	return m.pickFrom + (target - m.pickFrom) * eased;
}

function fallAt(m: MiniMotion, now: number, reduced: boolean): number {
	const target = m.fallen ? LYING : 0;
	if (reduced) return target;
	const u = clamp((now - m.fallAt) / (m.fallen ? FALL_MS : STAND_MS));
	if (u >= 1) return target;
	if (!m.fallen) return m.fallFrom * (1 - (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2));
	// Falls faster and faster, hits the base, bounces up a little and settles.
	const k =
		u < IMPACT ? (u / IMPACT) ** 2 : 1 - BOUNCE * Math.sin((Math.PI * (u - IMPACT)) / (1 - IMPACT));
	return m.fallFrom + (LYING - m.fallFrom) * k;
}

function clamp(x: number): number {
	return Math.min(Math.max(x, 0), 1);
}
