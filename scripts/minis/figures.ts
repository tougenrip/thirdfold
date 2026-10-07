// The character minis' pilot (#276), the four sculpts: the shield-bearer, the quiet blade with
// twin daggers, the flame-caller and the pilgrim healer (CHARACTERS in
// src/lib/adventure/characters.ts), each with its tint zone (a tabard and shield face, a hooded
// cloak, a robe, a mantle and stole) and what it carries, which falls beside it when it is downed.

import { COMMON, TINT, arm, ball, band, head, legs, part, toes, torso } from './body';
import type { Drop, Figure, Part } from './body';
import { box, cloth, lathe, limb, place, turnTo, twoSided, type V3 } from './mesh';
import type { Sample } from './paint';

const PI = Math.PI;
/**
 * Parts made at the origin (a sword, a staff, a shield) put in a hand at `at`, turned by `turn`;
 * downed, they lie at `drop.at` turned by `drop.turn` in their own frame.
 */
const held = (parts: Part[], at: V3, turn: V3, drop: Drop): Part[] => {
	for (const p of parts) Object.assign(p, { held: place(p.mesh, at, turn), drop });
	return parts;
};
/** Lying flat on the base, `yaw` round: what turns a thing made along +y onto the ground. */
const flat = (yaw: number): V3 => [PI / 2, 0, yaw];

// ---------------------------------------------------------------- the shield-bearer

function warden(): Figure {
	const shieldAt: V3 = [0.262, 0.555, 0.075];
	const facing = turnTo([0.82, 0.05, 0.57]);
	const shieldPaint = (s: Sample) => {
		const r = Math.hypot(s.pos.x - shieldAt[0], s.pos.y - shieldAt[1], s.pos.z - shieldAt[2]);
		if (s.n.x * 0.82 + s.n.z * 0.57 < -0.2) return 'wood';
		if (r > 0.168 || r < 0.042) return 'steel';
		return 'tint';
	};
	const shield = held(
		[
			part(
				lathe(
					[
						[0, -0.022],
						[0.185, -0.022, 1],
						[0.198, -0.004],
						[0.19, 0.014, 1],
						[0.12, 0.024],
						[0.05, 0.03, 1],
						[0.04, 0.05],
						[0, 0.058]
					],
					{ segments: 16, occluder: 'cylinder' }
				),
				shieldPaint,
				'foreL'
			)
		],
		shieldAt,
		facing,
		{ at: [0.27, 0.0225, 0.08], turn: [0, 0, 0] }
	);
	const hand: V3 = [-0.215, 0.47, 0.075];
	const swordTurn: V3 = [PI - 0.5, 0, 0.12];
	const sword = held(
		[
			part(box([0.034, 0.46, 0.009], [0, 0.29, 0]), 'steel', 'foreR'),
			part(box([0.13, 0.022, 0.03], [0, 0.05, 0]), 'brass', 'foreR'),
			part(limb([0, -0.03, 0], [0, 0.045, 0], 0.014, 0.014, 6), 'leather', 'foreR'),
			part(ball(0.02, [0, -0.045, 0]), 'brass', 'foreR')
		],
		hand,
		swordTurn,
		{ at: [-0.12, 0.021, -0.18], turn: flat(-1.9) }
	);
	const breast = (s: Sample) => (s.pos.y > 0.66 ? 'steel' : s.pos.y > 0.62 ? 'leather' : 'mail');
	const tabard = (z: number, lean: number) =>
		part(
			box([0.2, 0.32, 0.022], [0, 0.46, z], [lean, 0, 0]),
			(s: Sample) => (s.pos.y < 0.32 ? 'brass' : 'tint'),
			cloth
		);
	return {
		id: 'warden',
		yaw: 0.5,
		palette: {
			...COMMON,
			tint: TINT,
			mail: { colour: '#7a8189', rough: 0.55, metal: true, grain: 0.3 },
			cloth: { colour: '#55504a', rough: 0.85, grain: 0.1 }
		},
		parts: [
			...legs('mail', (s) => (s.pos.z > 0.02 && s.pos.y > 0.12 ? 'steel' : 'cloth')),
			torso(breast, { width: 1.08 }),
			band(0.625, 0.142, 0.04, 'leather'),
			part(box([0.04, 0.035, 0.016], [0, 0.625, 0.112]), 'brass', 'hips'),
			tabard(0.112, -0.06),
			tabard(-0.108, 0.06),
			...head(),
			// A kettle helm with its brim.
			part(
				lathe(
					[
						[0.07, 1.08],
						[0.128, 1.086, 1],
						[0.124, 1.096, 1],
						[0.092, 1.104],
						[0.09, 1.13],
						[0.072, 1.165],
						[0.04, 1.185],
						[0, 1.19]
					],
					{ segments: 14, sz: 1.06, occluder: 'sphere' }
				),
				'steel',
				'head'
			),
			// Pauldrons.
			...[1, -1].map((s) =>
				part(
					lathe(
						[
							[0.078, -0.005, 1],
							[0.074, 0.025],
							[0.052, 0.055],
							[0, 0.068]
						],
						{ segments: 10, at: [s * 0.172, 0.872, 0], turn: [0, 0, -s * 0.55], occluder: 'sphere' }
					),
					'steel',
					s > 0 ? 'armL' : 'armR'
				)
			),
			...arm(1, [0.205, 0.69, 0.01], [0.25, 0.53, 0.11], 'mail', 'steel'),
			...arm(-1, [-0.2, 0.68, 0.0], [-0.215, 0.5, 0.06], 'mail', 'steel'),
			...shield,
			...sword
		]
	};
}

// ---------------------------------------------------------------- the quiet blade

function veil(): Figure {
	const dagger = (hand: V3, turn: V3, bone: 'foreL' | 'foreR', drop: Drop) =>
		held(
			[
				part(box([0.024, 0.17, 0.006], [0, 0.11, 0]), 'steel', bone),
				part(box([0.07, 0.016, 0.02], [0, 0.02, 0]), 'iron', bone),
				part(limb([0, -0.05, 0], [0, 0.012, 0], 0.012, 0.012, 6), 'leather', bone)
			],
			hand,
			turn,
			drop
		);
	const hood = twoSided(
		lathe(
			[
				[0.098, 0.93, 1],
				[0.108, 0.99],
				[0.104, 1.06],
				[0.098, 1.12],
				[0.075, 1.17],
				[0.035, 1.195],
				[0, 1.2]
			],
			{ segments: 14, sz: 1.12, arc: [PI / 2 + 0.8, PI / 2 + 2 * PI - 0.8], occluder: null }
		)
	);
	const cloak = twoSided(
		lathe(
			[
				[0.215, 0.24, 1],
				[0.205, 0.42],
				[0.19, 0.6],
				[0.188, 0.78],
				[0.19, 0.87],
				[0.15, 0.925],
				[0.085, 0.955, 1]
			],
			{ segments: 16, sz: 0.82, arc: [PI / 2 + 1.0, PI / 2 + 2 * PI - 1.0], occluder: 'cone' }
		),
		0.01
	);
	return {
		id: 'veil',
		yaw: -0.6,
		palette: {
			...COMMON,
			tint: { ...TINT, colour: '#808080', rough: 0.8 },
			dark: { colour: '#2f2c30', rough: 0.75, grain: 0.12 },
			hide: { colour: '#4d3a2c', rough: 0.65, grain: 0.16 }
		},
		parts: [
			...legs('dark', 'dark'),
			torso(
				(s) =>
					Math.abs(s.pos.x + (s.pos.y - 0.78) * 0.9) < 0.02 && s.pos.z > 0 ? 'leather' : 'hide',
				{
					width: 0.95
				}
			),
			band(0.6, 0.13, 0.045, 'leather'),
			part(box([0.07, 0.06, 0.03], [0.1, 0.58, 0.08], [0, 0.6, 0]), 'leather', 'hips'),
			part(cloak, 'tint', cloth),
			...head(),
			part(hood, 'tint', 'head'),
			// A wrap across the mouth.
			part(
				lathe(
					[
						[0.074, 0.985, 1],
						[0.086, 1.0],
						[0.086, 1.04],
						[0.08, 1.052, 1]
					],
					{ segments: 12, sz: 1.12, occluder: null }
				),
				'dark',
				'head'
			),
			...arm(1, [0.2, 0.71, 0.04], [0.175, 0.58, 0.19], 'dark', 'dark', { cuff: 0.036 }),
			...arm(-1, [-0.2, 0.7, 0.03], [-0.19, 0.53, 0.17], 'dark', 'dark', { cuff: 0.036 }),
			...dagger([0.172, 0.555, 0.235], turnTo([0.1, 0.55, 1]), 'foreL', {
				at: [0.28, 0.012, -0.12],
				turn: flat(0.7)
			}),
			...dagger([-0.188, 0.505, 0.215], turnTo([-0.25, -0.3, 1]), 'foreR', {
				at: [-0.26, 0.012, 0.18],
				turn: flat(-2.2)
			})
		]
	};
}

// ---------------------------------------------------------------- the flame-caller

function ember(): Figure {
	const robe = (s: Sample) => (s.pos.y < 0.045 ? 'brass' : 'tint');
	const staffHand: V3 = [-0.225, 0.64, 0.1];
	const staff = held(
		[
			part(limb([0, -0.58, 0], [0, 0.3, 0], 0.016, 0.014, 7), 'wood', 'foreR'),
			// Iron prongs round a stone at the head (the fire is VFX, #312).
			...[0, 1, 2].map((k) => {
				const a = (k * 2 * PI) / 3;
				const [c, sn] = [Math.cos(a), Math.sin(a)];
				return part(
					limb([c * 0.012, 0.28, sn * 0.012], [c * 0.04, 0.37, sn * 0.04], 0.007, 0.005, 5),
					'iron',
					'foreR'
				);
			}),
			part(ball(0.03, [0, 0.35, 0]), 'stone', 'foreR')
		],
		staffHand,
		[0, 0, 0],
		{ at: [-0.155, 0.046, -0.145], turn: flat(PI / 2 - 0.35) }
	);
	const spikes = [
		[0.0, 0.3, -0.5],
		[0.5, 0.25, -0.25],
		[-0.5, 0.25, -0.25],
		[0.35, 0.45, 0.1],
		[-0.35, 0.45, 0.1]
	].map(([x, y, z]) => {
		const dir: V3 = [x, y + 0.6, z];
		const len = Math.hypot(...dir);
		const tip: V3 = [x * 0.07, 1.1 + y * 0.07, z * 0.07];
		return part(
			limb(tip, tip.map((v, i) => v + (dir[i] / len) * 0.07) as V3, 0.032, 0.006, 6),
			'hair',
			'head'
		);
	});
	return {
		id: 'ember',
		yaw: 2.4,
		palette: {
			...COMMON,
			tint: { ...TINT, colour: '#858585' },
			hair: { colour: '#7a3a1c', rough: 0.8, grain: 0.2 },
			sash: { colour: '#3a2a24', rough: 0.8, grain: 0.1 },
			stone: { colour: '#d0582a', rough: 0.3, grain: 0.15 }
		},
		parts: [
			...toes(),
			part(
				lathe(
					[
						[0, 0.004],
						[0.205, 0.0, 1],
						[0.2, 0.03],
						[0.175, 0.2],
						[0.15, 0.4],
						[0.135, 0.55],
						[0.13, 0.6]
					],
					{ segments: 16, sz: 0.85, occluder: 'cone' }
				),
				robe,
				cloth
			),
			torso('tint'),
			band(0.6, 0.13, 0.05, 'sash'),
			part(box([0.035, 0.18, 0.012], [0.05, 0.5, 0.118], [-0.1, 0, 0.12]), 'sash', cloth),
			part(box([0.06, 0.07, 0.035], [-0.12, 0.56, 0.08], [0, -0.5, 0]), 'leather', 'hips'),
			// A high collar.
			part(
				lathe(
					[
						[0.1, 0.9, 1],
						[0.105, 0.93],
						[0.09, 0.98, 1]
					],
					{ segments: 12, sz: 0.85, occluder: null }
				),
				'brass',
				'spine'
			),
			...head(),
			part(
				lathe(
					[
						[0.08, 1.045, 1],
						[0.088, 1.08],
						[0.088, 1.12],
						[0.07, 1.155],
						[0.03, 1.172],
						[0, 1.175]
					],
					{ segments: 12, sz: 1.08, arc: [PI / 2 + 0.95, PI / 2 + 2 * PI - 0.95], occluder: null }
				),
				'hair',
				'head'
			),
			...spikes,
			// Wide sleeves: the left hand held out, the right gripping the staff.
			...arm(1, [0.215, 0.72, 0.05], [0.175, 0.66, 0.21], 'tint', 'tint', { cuff: 0.055 }),
			...arm(-1, [-0.235, 0.74, 0.03], [-0.225, 0.64, 0.07], 'tint', 'tint', { cuff: 0.055 }),
			...staff
		]
	};
}

// ---------------------------------------------------------------- the pilgrim healer

function saint(): Figure {
	const staffHand: V3 = [-0.215, 0.56, 0.08];
	const staff = held(
		[
			part(limb([0, -0.52, 0], [0, 0.36, 0], 0.016, 0.014, 7), 'wood', 'foreR'),
			// A gourd for water, tied under the top.
			part(
				lathe(
					[
						[0, -0.05],
						[0.03, -0.042],
						[0.037, -0.02],
						[0.022, 0.002],
						[0.016, 0.02],
						[0.02, 0.04],
						[0, 0.05]
					],
					{ segments: 8, at: [0.026, 0.24, 0.0], occluder: 'sphere' }
				),
				'gourd',
				'foreR'
			)
		],
		staffHand,
		[0, 0, -0.05],
		{ at: [-0.007, 0.064, -0.215], turn: flat(PI / 2 + 0.35) }
	);
	const book = held(
		[
			part(box([0.1, 0.13, 0.007], [0, 0, 0.0145]), 'leather', 'foreL'),
			part(box([0.1, 0.13, 0.007], [0, 0, -0.0145]), 'leather', 'foreL'),
			part(box([0.009, 0.13, 0.035], [-0.046, 0, 0]), 'leather', 'foreL'),
			part(box([0.09, 0.122, 0.023], [0.004, 0, 0]), 'page', 'foreL')
		],
		[0.105, 0.68, 0.16],
		[0.35, -0.3, 0],
		{ at: [0.27, 0.019, 0.05], turn: [PI / 2, 0, 0.3] }
	);
	const robe = (s: Sample) => (s.pos.y < 0.05 ? 'trim' : 'wool');
	const mantle = twoSided(
		lathe(
			[
				[0.21, 0.66, 1],
				[0.205, 0.74],
				[0.19, 0.84],
				[0.15, 0.91],
				[0.095, 0.955, 1]
			],
			{ segments: 16, sz: 0.8, occluder: null }
		),
		0.008
	);
	return {
		id: 'saint',
		yaw: -2.2,
		palette: {
			...COMMON,
			tint: { ...TINT, colour: '#8a8a8a' },
			wool: { colour: '#a89478', rough: 0.9, grain: 0.12 },
			trim: { colour: '#6e5a44', rough: 0.85, grain: 0.1 },
			felt: { colour: '#5b4433', rough: 0.9, grain: 0.1 },
			shell: { colour: '#e8dcc2', rough: 0.5, grain: 0.05 },
			gourd: { colour: '#b9894a', rough: 0.6, grain: 0.1 },
			page: { colour: '#e4d6b4', rough: 0.8, grain: 0.05 },
			beard: { colour: '#c9c2b6', rough: 0.85, grain: 0.15 }
		},
		parts: [
			...toes(),
			part(
				lathe(
					[
						[0, 0.004],
						[0.2, 0.0, 1],
						[0.196, 0.03],
						[0.172, 0.25],
						[0.146, 0.48],
						[0.135, 0.6]
					],
					{ segments: 16, sz: 0.85, occluder: 'cone' }
				),
				robe,
				cloth
			),
			torso('wool'),
			band(0.6, 0.13, 0.03, 'leather'),
			part(mantle, 'tint', cloth),
			// The stole, down the front from the shoulders.
			...[1, -1].map((s) =>
				part(box([0.045, 0.36, 0.012], [s * 0.06, 0.6, 0.118], [-0.05, 0, 0]), 'tint', cloth)
			),
			part(box([0.09, 0.1, 0.04], [-0.135, 0.5, 0.06], [0, -0.4, 0]), 'leather', 'hips'),
			...head(),
			part(
				lathe(
					[
						[0, 0.965],
						[0.032, 0.975],
						[0.052, 1.0],
						[0.06, 1.03, 1]
					],
					{ segments: 10, sz: 0.8, at: [0, 0, 0.045], occluder: null }
				),
				'beard',
				'head'
			),
			// A pilgrim's hat, wide-brimmed, a shell on its front.
			part(
				lathe(
					[
						[0.08, 1.1],
						[0.205, 1.108, 1],
						[0.205, 1.122, 1],
						[0.1, 1.13],
						[0.094, 1.17],
						[0.075, 1.205],
						[0, 1.215]
					],
					{ segments: 16, sz: 1.0, occluder: 'cylinder' }
				),
				'felt',
				'head'
			),
			part(ball(0.022, [0, 1.145, 0.098], { sy: 1.1, sz: 0.4 }), 'shell', 'head'),
			...arm(1, [0.2, 0.71, 0.05], [0.13, 0.66, 0.15], 'wool', 'wool', { cuff: 0.045 }),
			...arm(-1, [-0.215, 0.7, 0.02], [-0.215, 0.56, 0.05], 'wool', 'wool', { cuff: 0.045 }),
			...book,
			...staff
		]
	};
}

export const FIGURES: (() => Figure)[] = [warden, veil, ember, saint];
