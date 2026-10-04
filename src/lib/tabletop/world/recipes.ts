// The backdrops' recipes (#244): what lies beyond the grid for each environment, and for each land
// kind of `WorldLook.backdrop`. Procedural only: no art, no credits (G5). Heights and distances are
// in frames (the play area and its margin), so they suit any table; world/beyond.ts builds them.

import type { Backdrop } from '../../game/world';

export type RidgeStyle = 'hills' | 'forest' | 'mountains' | 'mesas' | 'cave';
/** Which of the environment's looks a silhouette wears (its texture), or none. */
export type LookSlot = 'surface' | 'ground' | 'walls';

export interface Ridge {
	style: RidgeStyle;
	look: LookSlot | null;
	/** Its colour, darker and greyer than the map's. */
	color: number;
	/** Its height in frames (the play area plus its margin). */
	height: number;
	/** Where its foot stands in the haze: 0 where the fog begins, 1 where it hides everything. */
	distance: number;
	/** Features round the ring. */
	bumps: number;
	seed: number;
}

/** A peak on the farthest ridge at an azimuth (atan2(z, x)), with the monastery on top. */
export interface Landmark {
	azimuth: number;
	height: number;
	/** Half its width, in radians. */
	width: number;
	monastery: boolean;
}

export interface Recipe {
	ridges: readonly Ridge[];
	/** How high the land rises toward the horizon, in frames. */
	rise: number;
	landmark?: Landmark;
}

const r = (style: RidgeStyle, look: LookSlot | null, color: number, o: Partial<Ridge>): Ridge => ({
	style,
	look,
	color,
	height: 0.2,
	distance: 0.1,
	bumps: 9,
	seed: 1,
	...o
});

/** The village's mountain, up the path the first bell looks along (bellweather.ts MOUNTAIN_PATH). */
const MOUNTAIN: Landmark = { azimuth: -2.05, height: 0.62, width: 0.32, monastery: true };
const DESERT: Recipe = {
	rise: 0.03,
	ridges: [
		r('mesas', 'surface', 0x8a5a3e, { height: 0.16, distance: 0.1, bumps: 7, seed: 31 }),
		r('mountains', null, 0x76625a, { height: 0.22, distance: 0.4, bumps: 5, seed: 37 })
	]
};
const CAVE = (color: number, seed: number): Recipe => ({
	rise: 0,
	ridges: [r('cave', 'walls', color, { height: 1.1, distance: 0, bumps: 14, seed })]
});

/** Each environment's own (backdrop kind null). */
export const RECIPES: Record<string, Recipe> = {
	village: {
		rise: 0.04,
		landmark: MOUNTAIN,
		ridges: [
			r('forest', 'ground', 0x34452f, { height: 0.07, distance: 0.05, bumps: 11, seed: 3 }),
			r('mountains', 'ground', 0x5d6672, { height: 0.3, distance: 0.3, bumps: 6, seed: 5 })
		]
	},
	'stone-halls': {
		rise: 0.06,
		ridges: [
			r('hills', 'ground', 0x4b5045, { height: 0.12, distance: 0.08, bumps: 8, seed: 11 }),
			r('mountains', 'walls', 0x666a70, { height: 0.55, distance: 0.3, bumps: 5, seed: 13 })
		]
	},
	cavern: CAVE(0x1a1d24, 17),
	'living-cave': CAVE(0x3a1618, 19),
	railcar: DESERT,
	'ghost-town': DESERT
};

/** Without an environment, or one with no recipe: low hills. */
export const PLAIN: Recipe = {
	rise: 0.03,
	ridges: [r('hills', 'ground', 0x4b5045, { height: 0.1, seed: 23 })]
};

/** A land kind's own recipe; null keeps the environment's (sea, abyss and the moving ground). */
export const KINDS: Record<Backdrop, Recipe | null> = {
	none: { rise: 0, ridges: [] },
	plains: { rise: 0.01, ridges: [r('hills', 'ground', 0x55594a, { height: 0.04, seed: 41 })] },
	hills: PLAIN,
	forest: {
		rise: 0.03,
		ridges: [
			r('forest', 'ground', 0x34452f, { height: 0.08, distance: 0.05, bumps: 12, seed: 43 }),
			r('hills', 'ground', 0x4b5045, { height: 0.14, distance: 0.3, seed: 47 })
		]
	},
	mountains: {
		rise: 0.05,
		ridges: [
			r('hills', 'ground', 0x4b5045, { height: 0.1, distance: 0.08, seed: 53 }),
			r('mountains', 'walls', 0x666a70, { height: 0.6, distance: 0.3, bumps: 5, seed: 59 })
		]
	},
	cavern: CAVE(0x1a1d24, 61),
	sea: null,
	abyss: null,
	'prairie-scroll': null
};
