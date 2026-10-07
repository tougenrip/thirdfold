// How a prop glides and plays motions (props.ts): its displacement from where it stands at a
// moment of an animation, on the wall clock.

import type { MotionKind } from '$lib/game/motion';

/** How long a prop takes to glide to a new place or turn. */
export const GLIDE_MS = 450;

/** How a prop is displaced from where it stands, this frame. */
export interface Pose {
	dx: number;
	dy: number;
	dz: number;
	/** Extra turn about the vertical (radians). */
	turn: number;
	/** Swing of its swinging parts about their pivot (radians). */
	swing: number;
}

export type Anim =
	| { kind: 'glide'; start: number; dx: number; dz: number; turn: number }
	| { kind: MotionKind; start: number; throw: number };

export const still = (): Pose => ({ dx: 0, dy: 0, dz: 0, turn: 0, swing: 0 });

/** Adds an animation's displacement at `t` (0 to 1 through it) to a pose. */
export function apply(pose: Pose, a: Anim, t: number): void {
	switch (a.kind) {
		case 'glide': {
			// Eases out: quick to start, settling into place.
			const left = (1 - t) ** 3;
			pose.dx += a.dx * left;
			pose.dz += a.dz * left;
			pose.turn += a.turn * left;
			return;
		}
		case 'shake': {
			const fade = 1 - t;
			pose.dx += Math.sin(t * 90) * 0.035 * fade;
			pose.dz += Math.cos(t * 71) * 0.025 * fade;
			return;
		}
		case 'swing':
			// Thrown, then settling back with a couple of dying bounces.
			pose.swing += a.throw * Math.exp(-4 * t) * Math.cos(t * Math.PI * 3) * (1 - t);
			return;
		case 'land': {
			// Falls in from a little above and bounces once.
			const fall = t < 0.6 ? 1 - (t / 0.6) ** 2 : 0;
			const bounce = t >= 0.6 ? Math.sin(((t - 0.6) / 0.4) * Math.PI) * 0.06 : 0;
			pose.dy += 0.7 * fall + bounce;
			return;
		}
	}
}
