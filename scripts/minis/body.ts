// The character minis' pilot (#276), what the four share: a heroic-scale body (about 1.2 u to the
// crown, docs/ART.md section 2) of legs, a torso, arms and a head with a painted face, the
// common paints, and the downed pose they all fall into (curled on the right side, inside the base).

import type * as THREE from 'three';
import type { Binding, Bone, Mesh, P, Pose, V3 } from './mesh';
import { cloth, lathe, limb } from './mesh';
import type { PaintDef, PaintFn, Sample } from './paint';

/** Where a held thing lands when its bearer goes down: turned in its own frame, put at `at`. */
export interface Drop {
	at: V3;
	turn: V3;
}

export interface Part {
	mesh: Mesh;
	paint: PaintFn;
	bone: Binding;
	/** A held thing's own frame to the figure's (made at the origin, then put in a hand). */
	held?: THREE.Matrix4;
	drop?: Drop;
}

export interface Figure {
	id: string;
	palette: Record<string, PaintDef>;
	parts: Part[];
	/** The downed pose's turn about the up axis, so the four don't fall alike. */
	yaw: number;
}

export const part = (mesh: Mesh, paint: PaintFn, bone: Binding, drop?: Drop): Part => ({
	mesh,
	paint,
	bone,
	...(drop ? { drop } : {})
});

/** The paints every figure has: skin and the face's, and the dark leathers of belts and boots. */
export const COMMON: Record<string, PaintDef> = {
	skin: { colour: '#d9a07a', rough: 0.6, grain: 0.03 },
	eye: { colour: '#22191a', rough: 0.4, grain: 0 },
	brow: { colour: '#4a3022', rough: 0.8, grain: 0.05 },
	lip: { colour: '#a85e4f', rough: 0.6, grain: 0 },
	leather: { colour: '#6a4429', rough: 0.7, grain: 0.14 },
	boot: { colour: '#3c2a1f', rough: 0.65, grain: 0.12 },
	steel: { colour: '#c2c9d0', rough: 0.45, metal: true, grain: 0.06 },
	iron: { colour: '#5f6268', rough: 0.5, metal: true, grain: 0.1 },
	brass: { colour: '#d8b058', rough: 0.45, metal: true, grain: 0.05 },
	wood: { colour: '#7a5434', rough: 0.75, grain: 0.18 }
};

/** A tint zone's paint: grey at the token colour's luminance, so the shader's hue lands true. */
export const TINT: PaintDef = { colour: '#7d7d7d', rough: 0.85, tint: true, grain: 0.1 };

/** A ball (a hand, a pommel, a stone): a lathe of a half circle. */
export function ball(r: number, at: V3, o: { sx?: number; sz?: number; sy?: number } = {}): Mesh {
	const sy = o.sy ?? 1;
	const profile: P[] = [-90, -50, -15, 20, 55, 90].map((d) => {
		const a = (d * Math.PI) / 180;
		return [r * Math.cos(a), r * sy * Math.sin(a)];
	});
	profile[0][0] = profile.at(-1)![0] = 0;
	return lathe(profile, { segments: 8, at, sx: o.sx, sz: o.sz, occluder: 'sphere' });
}

/** The face painted on the head's front: eyes, brows and a mouth over `base`. */
export const face =
	(base: string): PaintFn =>
	(s: Sample) => {
		const { x, y, z } = s.pos;
		if (z < 0.045) return base;
		const across = Math.abs(Math.abs(x) - 0.032);
		if (Math.abs(y - 1.076) < 0.01 && across < 0.012) return 'eye';
		if (Math.abs(y - 1.094) < 0.005 && across < 0.019) return 'brow';
		if (Math.abs(y - 1.03) < 0.005 && Math.abs(x) < 0.02) return 'lip';
		return base;
	};

/** The neck, the head and a nose, on the head bone. */
export function head(skin = 'skin'): Part[] {
	return [
		part(limb([0, 0.92, 0], [0, 1.0, 0.005], 0.042, 0.038, 7), skin, 'head'),
		part(
			lathe(
				[
					[0, 0.985],
					[0.045, 0.993],
					[0.072, 1.025],
					[0.082, 1.065],
					[0.077, 1.105],
					[0.058, 1.137],
					[0.03, 1.152],
					[0, 1.156]
				],
				{ segments: 12, sz: 1.08, occluder: 'sphere' }
			),
			face(skin),
			'head'
		),
		part(ball(0.016, [0, 1.058, 0.088], { sy: 1.5, sz: 0.9 }), skin, 'head')
	];
}

/** Both legs, thigh, shin and a boot each, on the leg bones. */
export function legs(thigh: PaintFn, shin: PaintFn, boot: PaintFn = 'boot'): Part[] {
	return [1, -1].flatMap((s) => {
		const side = s > 0 ? 'L' : 'R';
		return [
			part(
				limb([s * 0.08, 0.56, 0], [s * 0.085, 0.3, 0.008], 0.064, 0.048),
				thigh,
				`thigh${side}` as Bone
			),
			part(
				limb([s * 0.085, 0.31, 0.008], [s * 0.085, 0.08, -0.008], 0.049, 0.037),
				shin,
				`shin${side}` as Bone
			),
			part(
				lathe(
					[
						[0.042, 0, 1],
						[0.048, 0.03],
						[0.042, 0.065],
						[0.03, 0.1],
						[0, 0.11]
					],
					{ segments: 9, sz: 1.7, at: [s * 0.085, 0, 0.025], occluder: 'sphere' }
				),
				boot,
				`shin${side}` as Bone
			)
		];
	});
}

/** A boot's toe under a robe, on the shin bones. */
export function toes(boot = 'boot'): Part[] {
	return [1, -1].map((s) =>
		part(
			lathe(
				[
					[0.04, 0, 1],
					[0.045, 0.025],
					[0.035, 0.055],
					[0, 0.065]
				],
				{ segments: 8, sz: 1.6, at: [s * 0.075, 0, 0.07], occluder: 'sphere' }
			),
			boot,
			s > 0 ? 'shinL' : 'shinR'
		)
	);
}

/** The torso from the hips to the neck, deeper than wide, bending with the spine above the waist. */
export function torso(paint: PaintFn, o: { width?: number; depth?: number } = {}): Part {
	const w = o.width ?? 1;
	return part(
		lathe(
			[
				[0.122 * w, 0.48, 1],
				[0.135 * w, 0.56],
				[0.128 * w, 0.66],
				[0.142 * w, 0.78],
				[0.152 * w, 0.87],
				[0.118 * w, 0.935],
				[0.05, 0.965],
				[0, 0.97]
			],
			{ segments: 14, sz: o.depth ?? 0.72, occluder: 'cylinder' }
		),
		paint,
		cloth
	);
}

/** A ring round the waist or the chest: a belt, a sash. */
export function band(y: number, r: number, h: number, paint: PaintFn, depth = 0.74): Part {
	return part(
		lathe(
			[
				[r - 0.004, y - h / 2, 1],
				[r + 0.006, y - h / 2 + 0.004, 1],
				[r + 0.006, y + h / 2 - 0.004, 1],
				[r - 0.004, y + h / 2, 1]
			],
			{ segments: 14, sz: depth, occluder: null }
		),
		paint,
		cloth
	);
}

/** One arm: shoulder to elbow, elbow to wrist, and a hand past the wrist. */
export function arm(
	side: 1 | -1,
	elbow: V3,
	wrist: V3,
	upper: PaintFn,
	fore: PaintFn,
	o: { cuff?: number; hand?: PaintFn } = {}
): Part[] {
	const L = side > 0 ? 'L' : 'R';
	const shoulder: V3 = [side * 0.165, 0.895, 0];
	const dir = wrist.map((v, i) => v - elbow[i]);
	const len = Math.hypot(...dir);
	const hand = wrist.map((v, i) => v + (dir[i] / len) * 0.03) as V3;
	return [
		part(limb(shoulder, elbow, 0.046, 0.039), upper, `arm${L}` as Bone),
		part(limb(elbow, wrist, 0.039, o.cuff ?? 0.033), fore, `fore${L}` as Bone),
		part(ball(0.033, hand, { sy: 1.25 }), o.hand ?? 'skin', `fore${L}` as Bone)
	];
}

/** The downed pose: knees drawn up, curled forward, arms fallen, lying on the right side. */
export function downedPose(yaw: number): Pose {
	return {
		root: [0, yaw, Math.PI / 2],
		thighL: [-1.55, 0, 0.1],
		shinL: [2.0, 0, 0],
		thighR: [-1.35, 0, -0.1],
		shinR: [2.1, 0, 0],
		spine: [0.6, 0, 0.06],
		head: [0.45, 0.3, 0.22],
		armL: [-0.95, 0, 0.3],
		foreL: [-1.0, 0, 0],
		armR: [-0.6, 0, -0.2],
		foreR: [-1.2, 0, 0]
	};
}
