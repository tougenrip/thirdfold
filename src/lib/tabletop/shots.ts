// Cinematic camera moves: the story points the camera at something for a
// moment (the monastery on the mountain, the bell in its tower, a door that
// wasn't there, the size of the Hollow) and then gives it back. Pure maths on
// plain vectors, so it is tested without three.js; the renderer plays it.
// A shot never takes the camera away for long, and any drag or scroll by the
// viewer ends it where it is: the player keeps control.

import type { Shot } from '$lib/game/chat';

export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

export interface Pose {
	position: Vec3;
	target: Vec3;
}

/** How long a shot takes to get there, stays, and comes back (ms). */
export const SHOT_MS = { go: 1400, hold: 2600, back: 1200 } as const;
export const SHOT_TOTAL = SHOT_MS.go + SHOT_MS.hold + SHOT_MS.back;

/** Distance (in cells) and elevation (radians above the table) of each framing. */
const FRAMES = {
	close: { cells: 10, elevation: 0.66 },
	wide: { cells: 15, elevation: 0.8 }
} as const;

/**
 * Where the camera goes for a shot, seen from where it is now (keeping its
 * direction round the table, so the move reads as a turn of the head).
 * `focus` is the world point to look at (null: the table's centre);
 * `extent` the table's size and `cell` a cell's size, in world units.
 */
export function shotPose(
	from: Pose,
	focus: Vec3 | null,
	frame: Shot['frame'],
	extent: number,
	cell: number
): Pose {
	const target = frame === 'table' || !focus ? { x: 0, y: 0, z: 0 } : { ...focus };
	let dx = from.position.x - from.target.x;
	let dz = from.position.z - from.target.z;
	const flat = Math.hypot(dx, dz);
	if (flat < 1e-6) {
		dx = 0;
		dz = 1;
	} else {
		dx /= flat;
		dz /= flat;
	}
	const distance = frame === 'table' ? extent * 1.3 : FRAMES[frame].cells * cell;
	const elevation = frame === 'table' ? 1.05 : FRAMES[frame].elevation;
	return {
		target,
		position: {
			x: target.x + dx * Math.cos(elevation) * distance,
			y: target.y + Math.sin(elevation) * distance,
			z: target.z + dz * Math.cos(elevation) * distance
		}
	};
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function lerp(a: Vec3, b: Vec3, k: number): Vec3 {
	return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
}

function mix(a: Pose, b: Pose, k: number): Pose {
	return { position: lerp(a.position, b.position, k), target: lerp(a.target, b.target, k) };
}

/** The camera `elapsed` ms into a shot from `home` to `shot` and back; `done` once it is home. */
export function shotAt(home: Pose, shot: Pose, elapsed: number): { pose: Pose; done: boolean } {
	if (elapsed < SHOT_MS.go)
		return { pose: mix(home, shot, ease(elapsed / SHOT_MS.go)), done: false };
	if (elapsed < SHOT_MS.go + SHOT_MS.hold) return { pose: shot, done: false };
	const back = (elapsed - SHOT_MS.go - SHOT_MS.hold) / SHOT_MS.back;
	if (back >= 1) return { pose: home, done: true };
	return { pose: mix(shot, home, ease(back)), done: false };
}
