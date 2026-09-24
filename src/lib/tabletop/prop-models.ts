// How each catalog asset looks: a few primitive parts. Placeholder geometry
// by design; swapping in real models later only changes this file.
// Units are cells, relative to the centre of the unrotated footprint on the
// floor (x along the asset's width, z along its depth, y up).

import type { AssetId } from '$lib/game/props';

export type Shape = 'box' | 'cylinder' | 'sphere' | 'cone';

export interface Part {
	shape: Shape;
	size: [number, number, number];
	at: [number, number, number];
	color: number;
	/** Swings with the prop (a hanging bell and its chains, a lever's handle), about its pivot. */
	swings?: boolean;
}

/** Height (model units) of the beam a hanging bell swings from. */
export const SWING_PIVOT = 2.55;

/** Height each asset's swinging parts turn about (a bell's beam, a lever's hinge). */
export const SWING_PIVOTS: Partial<Record<AssetId, number>> = {
	'belfry-bell': SWING_PIVOT,
	lever: 0.22,
	'lever-down': 0.22
};

/** How far a motion's swing throws the swinging parts to begin with (radians). */
export const SWING_THROW: Partial<Record<AssetId, number>> = {
	'belfry-bell': 0.5,
	// Pulled: the handle comes down from upright and settles, bouncing a little.
	'lever-down': -Math.PI / 2,
	lever: Math.PI / 2
};

const WOOD = 0x8a5a33;
const DARK_WOOD = 0x5a3a22;
const LIGHT_WOOD = 0xb68a55;
const STONE = 0x9a948a;
const LIGHT_STONE = 0xc9c3b6;
const IRON = 0x3d3a38;
const WATER = 0x0c2733;

const legs = (dx: number, dz: number, h: number, t = 0.08): Part[] =>
	[
		[-dx, -dz],
		[dx, -dz],
		[-dx, dz],
		[dx, dz]
	].map(([x, z]) => ({ shape: 'box', size: [t, h, t], at: [x, h / 2, z], color: DARK_WOOD }));

export const PROP_MODELS: Record<AssetId, Part[]> = {
	table: [
		{ shape: 'box', size: [1.9, 0.08, 0.9], at: [0, 0.72, 0], color: WOOD },
		...legs(0.85, 0.35, 0.68)
	],
	chair: [
		{ shape: 'box', size: [0.5, 0.06, 0.5], at: [0, 0.45, 0], color: WOOD },
		{ shape: 'box', size: [0.5, 0.5, 0.06], at: [0, 0.72, -0.22], color: WOOD },
		...legs(0.2, 0.2, 0.42, 0.06)
	],
	crate: [
		{ shape: 'box', size: [0.8, 0.8, 0.8], at: [0, 0.4, 0], color: LIGHT_WOOD },
		{ shape: 'box', size: [0.84, 0.08, 0.84], at: [0, 0.4, 0], color: DARK_WOOD }
	],
	barrel: [
		{ shape: 'cylinder', size: [0.7, 0.9, 0.7], at: [0, 0.45, 0], color: WOOD },
		{ shape: 'cylinder', size: [0.74, 0.06, 0.74], at: [0, 0.2, 0], color: IRON },
		{ shape: 'cylinder', size: [0.74, 0.06, 0.74], at: [0, 0.7, 0], color: IRON }
	],
	chest: [
		{ shape: 'box', size: [0.8, 0.42, 0.55], at: [0, 0.21, 0], color: WOOD },
		{ shape: 'box', size: [0.84, 0.14, 0.59], at: [0, 0.49, 0], color: DARK_WOOD },
		{ shape: 'box', size: [0.12, 0.14, 0.04], at: [0, 0.4, 0.29], color: 0xd4ac0d }
	],
	bed: [
		{ shape: 'box', size: [0.9, 0.3, 1.9], at: [0, 0.15, 0], color: DARK_WOOD },
		{ shape: 'box', size: [0.84, 0.16, 1.6], at: [0, 0.38, 0.12], color: 0xe8e0d0 },
		{ shape: 'box', size: [0.6, 0.1, 0.25], at: [0, 0.5, -0.72], color: 0xf5f0e6 },
		{ shape: 'box', size: [0.9, 0.7, 0.08], at: [0, 0.35, -0.92], color: DARK_WOOD }
	],
	bookshelf: [
		{ shape: 'box', size: [1.9, 1.8, 0.45], at: [0, 0.9, 0], color: DARK_WOOD },
		{ shape: 'box', size: [1.7, 0.45, 0.1], at: [0, 1.4, 0.19], color: 0x8e3a2e },
		{ shape: 'box', size: [1.7, 0.45, 0.1], at: [0, 0.85, 0.19], color: 0x2e5a8e },
		{ shape: 'box', size: [1.7, 0.45, 0.1], at: [0, 0.3, 0.19], color: 0x3e7a3a }
	],
	pillar: [
		{ shape: 'box', size: [0.9, 0.15, 0.9], at: [0, 0.075, 0], color: STONE },
		{ shape: 'cylinder', size: [0.62, 2.1, 0.62], at: [0, 1.2, 0], color: LIGHT_STONE },
		{ shape: 'box', size: [0.8, 0.12, 0.8], at: [0, 2.3, 0], color: STONE }
	],
	statue: [
		{ shape: 'box', size: [0.8, 0.3, 0.8], at: [0, 0.15, 0], color: STONE },
		{ shape: 'cylinder', size: [0.4, 0.9, 0.4], at: [0, 0.75, 0], color: LIGHT_STONE },
		{ shape: 'sphere', size: [0.3, 0.3, 0.3], at: [0, 1.35, 0], color: LIGHT_STONE }
	],
	tree: [
		{ shape: 'cylinder', size: [0.25, 1.0, 0.25], at: [0, 0.5, 0], color: 0x5a3a22 },
		{ shape: 'cone', size: [1.1, 1.5, 1.1], at: [0, 1.6, 0], color: 0x2f6b34 },
		{ shape: 'cone', size: [0.8, 1.0, 0.8], at: [0, 2.2, 0], color: 0x3a8040 }
	],
	rug: [{ shape: 'box', size: [1.9, 0.02, 1.9], at: [0, 0.012, 0], color: 0x7a2a2e }],
	well: [
		{ shape: 'cylinder', size: [1.5, 0.7, 1.5], at: [0, 0.35, 0], color: STONE },
		{ shape: 'cylinder', size: [1.1, 0.72, 1.1], at: [0, 0.36, 0], color: 0x141210 },
		{ shape: 'box', size: [0.1, 1.3, 0.1], at: [-0.62, 1.0, 0], color: DARK_WOOD },
		{ shape: 'box', size: [0.1, 1.3, 0.1], at: [0.62, 1.0, 0], color: DARK_WOOD },
		{ shape: 'box', size: [1.5, 0.14, 0.9], at: [0, 1.72, 0], color: WOOD },
		{ shape: 'cylinder', size: [0.12, 1.2, 0.12], at: [0, 1.35, 0], color: IRON }
	],
	noticeboard: [
		{ shape: 'box', size: [0.08, 1.5, 0.08], at: [-0.34, 0.75, 0], color: DARK_WOOD },
		{ shape: 'box', size: [0.08, 1.5, 0.08], at: [0.34, 0.75, 0], color: DARK_WOOD },
		{ shape: 'box', size: [0.84, 0.6, 0.06], at: [0, 1.15, 0], color: WOOD },
		{ shape: 'box', size: [0.26, 0.32, 0.02], at: [-0.18, 1.18, 0.04], color: 0xe8e0c8 },
		{ shape: 'box', size: [0.22, 0.26, 0.02], at: [0.2, 1.12, 0.04], color: 0xd9cfae }
	],
	'chest-open': [
		{ shape: 'box', size: [0.8, 0.42, 0.55], at: [0, 0.21, 0], color: WOOD },
		{ shape: 'box', size: [0.72, 0.04, 0.47], at: [0, 0.4, 0], color: 0x1a120c },
		{ shape: 'box', size: [0.84, 0.59, 0.1], at: [0, 0.72, -0.3], color: DARK_WOOD },
		{ shape: 'box', size: [0.12, 0.04, 0.14], at: [0, 0.2, 0.29], color: 0xd4ac0d }
	],
	rubble: [
		{ shape: 'box', size: [0.7, 0.06, 0.14], at: [-0.05, 0.03, -0.15], color: LIGHT_WOOD },
		{ shape: 'box', size: [0.55, 0.06, 0.14], at: [0.1, 0.07, 0.05], color: DARK_WOOD },
		{ shape: 'box', size: [0.45, 0.06, 0.14], at: [-0.1, 0.03, 0.22], color: LIGHT_WOOD },
		{ shape: 'box', size: [0.14, 0.12, 0.14], at: [0.28, 0.06, -0.25], color: DARK_WOOD }
	],
	hatch: [
		{ shape: 'box', size: [0.8, 0.03, 0.8], at: [0, 0.015, 0], color: DARK_WOOD },
		{ shape: 'box', size: [0.1, 0.035, 0.1], at: [0.25, 0.02, 0], color: IRON }
	],
	'hatch-open': [
		{ shape: 'box', size: [0.7, 0.02, 0.7], at: [0, 0.01, 0], color: 0x0c0907 },
		{ shape: 'box', size: [0.8, 0.8, 0.03], at: [0, 0.4, -0.4], color: DARK_WOOD }
	],
	brazier: [
		{ shape: 'cylinder', size: [0.12, 0.7, 0.12], at: [0, 0.35, 0], color: IRON },
		{ shape: 'cylinder', size: [0.5, 0.08, 0.5], at: [0, 0.05, 0], color: IRON },
		{ shape: 'cylinder', size: [0.6, 0.2, 0.6], at: [0, 0.78, 0], color: IRON },
		{ shape: 'cylinder', size: [0.5, 0.06, 0.5], at: [0, 0.86, 0], color: 0x2a1d14 }
	],
	ashes: [
		{ shape: 'cylinder', size: [0.8, 0.05, 0.6], at: [0, 0.025, 0], color: 0x8f8a84 },
		{ shape: 'sphere', size: [0.25, 0.12, 0.2], at: [0.15, 0.05, 0.05], color: 0xb9b3aa },
		{ shape: 'cone', size: [0.14, 0.18, 0.14], at: [-0.2, 0.09, -0.1], color: 0xb08d57 }
	],
	altar: [
		{ shape: 'box', size: [1.8, 0.9, 0.8], at: [0, 0.45, 0], color: LIGHT_STONE },
		{ shape: 'box', size: [1.9, 0.06, 0.9], at: [0, 0.93, 0], color: 0xe8e0d0 },
		{ shape: 'cylinder', size: [0.08, 0.3, 0.08], at: [-0.6, 1.11, 0], color: 0xf2e6c8 },
		{ shape: 'cylinder', size: [0.08, 0.3, 0.08], at: [0.6, 1.11, 0], color: 0xf2e6c8 }
	],
	pew: [
		{ shape: 'box', size: [1.8, 0.08, 0.45], at: [0, 0.45, 0], color: DARK_WOOD },
		{ shape: 'box', size: [1.8, 0.5, 0.06], at: [0, 0.72, -0.2], color: DARK_WOOD },
		{ shape: 'box', size: [0.08, 0.45, 0.45], at: [-0.86, 0.22, 0], color: DARK_WOOD },
		{ shape: 'box', size: [0.08, 0.45, 0.45], at: [0.86, 0.22, 0], color: DARK_WOOD }
	],
	gravestone: [
		{ shape: 'box', size: [0.6, 0.8, 0.14], at: [0, 0.4, -0.2], color: STONE },
		{ shape: 'box', size: [0.5, 0.04, 0.7], at: [0, 0.02, 0.1], color: 0x4a4038 }
	],
	grate: [
		{ shape: 'box', size: [0.8, 0.03, 0.8], at: [0, 0.015, 0], color: 0x141210 },
		{ shape: 'box', size: [0.06, 0.04, 0.8], at: [-0.25, 0.03, 0], color: IRON },
		{ shape: 'box', size: [0.06, 0.04, 0.8], at: [0, 0.03, 0], color: IRON },
		{ shape: 'box', size: [0.06, 0.04, 0.8], at: [0.25, 0.03, 0], color: IRON }
	],
	stairs: [
		{ shape: 'box', size: [0.9, 0.02, 0.9], at: [0, 0.01, 0], color: 0x0c0907 },
		{ shape: 'box', size: [0.8, 0.03, 0.2], at: [0, 0.02, -0.3], color: STONE },
		{ shape: 'box', size: [0.8, 0.03, 0.2], at: [0, 0.02, -0.05], color: 0x6a655d },
		{ shape: 'box', size: [0.8, 0.03, 0.2], at: [0, 0.02, 0.2], color: 0x4a4640 }
	],
	rope: [
		{ shape: 'cylinder', size: [0.06, 2.6, 0.06], at: [0, 1.3, 0], color: 0xc8a86a },
		{ shape: 'sphere', size: [0.16, 0.2, 0.16], at: [0, 0.35, 0], color: 0xa8864a }
	],
	bell: [
		{ shape: 'box', size: [0.12, 2.6, 0.12], at: [-0.85, 1.3, 0], color: DARK_WOOD },
		{ shape: 'box', size: [0.12, 2.6, 0.12], at: [0.85, 1.3, 0], color: DARK_WOOD },
		{ shape: 'box', size: [1.9, 0.16, 0.2], at: [0, 2.6, 0], color: DARK_WOOD },
		{ shape: 'cone', size: [1.3, 1.3, 1.3], at: [0, 1.75, 0], color: 0x7a6a3a },
		{ shape: 'sphere', size: [0.2, 0.2, 0.2], at: [0, 1.0, 0], color: IRON }
	],
	anvil: [
		{ shape: 'box', size: [0.35, 0.4, 0.35], at: [0, 0.2, 0], color: DARK_WOOD },
		{ shape: 'box', size: [0.7, 0.2, 0.3], at: [0, 0.5, 0], color: IRON },
		{ shape: 'cone', size: [0.2, 0.3, 0.2], at: [0.45, 0.52, 0], color: IRON }
	],
	chains: [
		{ shape: 'cylinder', size: [0.05, 1.8, 0.05], at: [-0.2, 1.4, 0], color: IRON },
		{ shape: 'cylinder', size: [0.05, 1.4, 0.05], at: [0.05, 1.6, 0.1], color: IRON },
		{ shape: 'cylinder', size: [0.05, 2.0, 0.05], at: [0.25, 1.3, -0.1], color: IRON },
		{ shape: 'sphere', size: [0.12, 0.12, 0.12], at: [-0.2, 0.5, 0], color: IRON },
		{ shape: 'sphere', size: [0.12, 0.12, 0.12], at: [0.25, 0.3, -0.1], color: IRON }
	],
	// Hung from a beam well above the belfry floor, so it can swing (see the toll effect).
	'belfry-bell': [
		{ shape: 'box', size: [0.14, 2.6, 0.14], at: [-0.5, 1.3, 0], color: DARK_WOOD },
		{ shape: 'box', size: [0.14, 2.6, 0.14], at: [0.5, 1.3, 0], color: DARK_WOOD },
		{ shape: 'box', size: [1.3, 0.16, 0.22], at: [0, 2.6, 0], color: DARK_WOOD },
		{ shape: 'cylinder', size: [0.04, 0.5, 0.04], at: [-0.15, 2.3, 0], color: IRON, swings: true },
		{ shape: 'cylinder', size: [0.04, 0.5, 0.04], at: [0.15, 2.3, 0], color: IRON, swings: true },
		{ shape: 'cone', size: [0.9, 0.9, 0.9], at: [0, 1.65, 0], color: 0x7a6a3a, swings: true },
		{ shape: 'sphere', size: [0.16, 0.16, 0.16], at: [0, 1.15, 0], color: IRON, swings: true }
	],
	// An iron lever in a stone block: up, and pulled down toward the room.
	lever: [
		{ shape: 'box', size: [0.5, 0.3, 0.5], at: [0, 0.15, 0], color: STONE },
		{ shape: 'box', size: [0.12, 0.04, 0.36], at: [0, 0.31, 0], color: 0x141210 },
		{ shape: 'box', size: [0.07, 0.75, 0.07], at: [0, 0.6, 0], color: IRON, swings: true },
		{ shape: 'sphere', size: [0.16, 0.16, 0.16], at: [0, 0.98, 0], color: DARK_WOOD, swings: true }
	],
	'lever-down': [
		{ shape: 'box', size: [0.5, 0.3, 0.5], at: [0, 0.15, 0], color: STONE },
		{ shape: 'box', size: [0.12, 0.04, 0.36], at: [0, 0.31, 0], color: 0x141210 },
		{ shape: 'box', size: [0.07, 0.07, 0.75], at: [0, 0.26, 0.38], color: IRON, swings: true },
		{
			shape: 'sphere',
			size: [0.16, 0.16, 0.16],
			at: [0, 0.26, 0.76],
			color: DARK_WOOD,
			swings: true
		}
	],
	handbell: [
		{ shape: 'cone', size: [0.34, 0.32, 0.34], at: [0, 0.16, 0], color: 0xc9a24a },
		{ shape: 'cylinder', size: [0.06, 0.24, 0.06], at: [0, 0.42, 0], color: DARK_WOOD },
		{ shape: 'sphere', size: [0.1, 0.1, 0.1], at: [0, 0.56, 0], color: DARK_WOOD }
	],
	sconce: [
		{ shape: 'cylinder', size: [0.3, 0.05, 0.3], at: [0, 0.025, 0], color: IRON },
		{ shape: 'cylinder', size: [0.06, 1.0, 0.06], at: [0, 0.5, 0], color: IRON },
		{ shape: 'cone', size: [0.2, 0.18, 0.2], at: [0, 1.05, 0], color: IRON },
		{ shape: 'cylinder', size: [0.1, 0.12, 0.1], at: [0, 1.16, 0], color: 0x2a1d14 }
	],
	carvings: [
		{ shape: 'box', size: [0.9, 1.1, 0.12], at: [0, 0.55, -0.4], color: STONE },
		{ shape: 'box', size: [0.08, 0.5, 0.03], at: [-0.25, 0.6, -0.33], color: 0xe8dcc0 },
		{ shape: 'box', size: [0.3, 0.08, 0.03], at: [0, 0.85, -0.33], color: 0xe8dcc0 },
		{ shape: 'sphere', size: [0.16, 0.16, 0.03], at: [0.2, 0.55, -0.33], color: 0xe8dcc0 },
		{ shape: 'box', size: [0.08, 0.3, 0.03], at: [0.05, 0.35, -0.33], color: 0xe8dcc0 }
	],
	'great-bell': [
		// The frame: four black posts and a beam across the top.
		{ shape: 'box', size: [0.25, 4.2, 0.25], at: [-1.3, 2.1, -1.3], color: IRON },
		{ shape: 'box', size: [0.25, 4.2, 0.25], at: [1.3, 2.1, -1.3], color: IRON },
		{ shape: 'box', size: [0.25, 4.2, 0.25], at: [-1.3, 2.1, 1.3], color: IRON },
		{ shape: 'box', size: [0.25, 4.2, 0.25], at: [1.3, 2.1, 1.3], color: IRON },
		{ shape: 'box', size: [2.9, 0.3, 0.3], at: [0, 4.2, 0], color: IRON },
		// The Bell itself: vast, black, hanging clear of the floor, with its lip glowing faintly.
		{ shape: 'cylinder', size: [0.5, 0.5, 0.5], at: [0, 3.8, 0], color: 0x1d1d24 },
		{ shape: 'cone', size: [2.4, 2.6, 2.4], at: [0, 2.3, 0], color: 0x1d1d24 },
		{ shape: 'cylinder', size: [2.5, 0.18, 2.5], at: [0, 1.05, 0], color: 0x5b7fb5 },
		{ shape: 'sphere', size: [0.4, 0.4, 0.4], at: [0, 1.0, 0], color: 0x2a2a33 }
	],
	gear: [
		// A great cog on its drum, the teeth standing proud of the rim.
		{ shape: 'cylinder', size: [0.5, 0.9, 0.5], at: [0, 0.45, 0], color: IRON },
		{ shape: 'cylinder', size: [1.7, 0.22, 1.7], at: [0, 1.0, 0], color: 0x6b5a3e },
		{ shape: 'box', size: [2.0, 0.2, 0.22], at: [0, 1.0, 0], color: 0x6b5a3e },
		{ shape: 'box', size: [0.22, 0.2, 2.0], at: [0, 1.0, 0], color: 0x6b5a3e },
		{ shape: 'cylinder', size: [0.4, 0.3, 0.4], at: [0, 1.15, 0], color: IRON }
	],
	water: [{ shape: 'box', size: [2, 0.04, 2], at: [0, 0.02, 0], color: WATER }],
	'water-sm': [{ shape: 'box', size: [1, 0.04, 1], at: [0, 0.02, 0], color: WATER }],
	'water-lg': [{ shape: 'box', size: [4, 0.04, 4], at: [0, 0.02, 0], color: WATER }]
};
