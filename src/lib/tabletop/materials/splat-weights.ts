// The floor splat's rules (#242), plain TypeScript with no three.js: the table of floor styles
// and the constants the terrain kind's graph reads (floors.ts), and `splatWeights`, the graph's
// mirror, which the server project tests. Per fragment of a top, the splat looks at the 2x2 cells
// round the nearest grid corner: the fragment's own cell, the one across x, the one across y and
// the diagonal. A neighbour joins the blend only if it is known (explored, or the GM, or fog off),
// on the same level, and both floors are soft; otherwise the border is the grid line itself.
// Bilinear weights (perturbed by noise on medium and up, so soft borders wander), merged per floor,
// the two heaviest kept, and those two blended by their heights (Mishkinis, "Advanced terrain
// texture splatting"). A kerb floor draws a darker, bevelled band inside its own cell along an edge
// to a different floor it outranks.

import { FLOOR_IDS, VOID, type FloorId } from '../../game/floor';

/** Blends with its soft neighbours across a wandering border. */
export const SOFT = 0;
/** A crisp border on the grid line, no kerb: water (a tint until #293) and the void. */
export const CRISP = 1;
/** Man-made: a crisp border on the grid line with a kerb on its own side. */
export const KERB = 2;

/**
 * Each floor's border style (#248: cobble, flagstone and rock kerbed; mud, snow and gravel
 * soft). Only rule-neutral floors may be soft, so a wandering border never moves where a token
 * can stand; a floor that ever means something to movement must be crisp or kerbed (#85).
 */
export const FLOOR_STYLE: Record<FloorId, number> = {
	plain: SOFT,
	stone: KERB,
	wood: KERB,
	grass: SOFT,
	dirt: SOFT,
	sand: SOFT,
	water: CRISP,
	void: CRISP,
	cobble: KERB,
	flagstone: KERB,
	rock: KERB,
	mud: SOFT,
	snow: SOFT,
	gravel: SOFT
};

/** The styles by `FLOOR_IDS` index, as the graph's uniform array holds them. */
export const STYLE_BY_INDEX: readonly number[] = FLOOR_IDS.map((id) => FLOOR_STYLE[id]);

/** The splat's tuning (cells, or 0-1). Uniforms in the graph, so changing one compiles nothing. */
export const SPLAT = {
	/** How far noise moves a soft border, in cells (the issue's 0.15). */
	reach: 0.15,
	/** Noise frequency, per cell. */
	noiseScale: 1.7,
	/** Mishkinis's depth: how much of the height range blends (0.2). */
	depth: 0.2,
	/** Layer heights (albedo alpha) are scaled into this range, under `1 - depth`, so a weight of 0 never shows. */
	heightRange: 0.5,
	/** A floor without a painted layer stands at this height. */
	flatHeight: 0.5,
	/** The kerb's width, in cells, and how dark and how bevelled it is. */
	kerbWidth: 0.05,
	kerbDark: 0.35,
	kerbBevel: 0.6
};

/** One of the 2x2 cells: its floor's index, its level, and whether the viewer knows it. */
export interface Corner {
	floor: number;
	level: number;
	known: boolean;
}

/** The two floors a fragment blends, heaviest first, their weights summing to 1, and its kerb. */
export interface Splat {
	floors: [number, number];
	weights: [number, number];
	/** The kerb's strength, 0-1, toward the x and y neighbours. */
	kerb: { x: number; y: number };
}

const styleOf = (floor: number) => STYLE_BY_INDEX[floor] ?? CRISP;
const priority = (floor: number) => styleOf(floor) * 16 + floor;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, v: number) => {
	const t = clamp01((v - a) / (b - a));
	return t * t * (3 - 2 * t);
};

/**
 * The splat at a point of a top: `corners` own, across x, across y, diagonal; `q` the point in its
 * own cell (0-1 each way; the neighbours lie on the side of the cell's centre the point is);
 * `noise` the world noise there (-1 to 1 each way, 0 without it). The graph's mirror (floors.ts).
 */
export function splatWeights(
	corners: readonly [Corner, Corner, Corner, Corner],
	q: { x: number; y: number },
	noise: { x: number; y: number } = { x: 0, y: 0 },
	reach = SPLAT.reach,
	kerbWidth = SPLAT.kerbWidth
): Splat {
	const [own] = corners;
	const s = { x: Math.abs(q.x - 0.5), y: Math.abs(q.y - 0.5) };
	// The noise moves the point in the world (toward a neighbour or away), fading to nothing at
	// the cell's centre lines, so both sides of a border, and both 2x2 blocks either side of a
	// centre line, see the same weights.
	const toward = { x: q.x >= 0.5 ? 1 : -1, y: q.y >= 0.5 ? 1 : -1 };
	const moved = (axis: 'x' | 'y') =>
		clamp01(s[axis] + toward[axis] * noise[axis] * reach * clamp01(s[axis] / reach));
	const x = moved('x');
	const y = moved('y');
	const level = (c: Corner) => c.known && c.level === own.level;
	const joins = (c: Corner) =>
		level(c) && styleOf(own.floor) === SOFT && styleOf(c.floor) === SOFT ? 1 : 0;
	const raw = [
		(1 - x) * (1 - y),
		x * (1 - y) * joins(corners[1]),
		(1 - x) * y * joins(corners[2]),
		x * y * joins(corners[3])
	];
	// Merged per floor: the first corner of each floor carries all of its weight.
	const merged = raw.map((w, i) => {
		if (corners.slice(0, i).some((c) => c.floor === corners[i].floor)) return 0;
		return raw.reduce((sum, v, j) => sum + (corners[j].floor === corners[i].floor ? v : 0), 0);
	});
	const order = [0, 1, 2, 3].sort((a, b) => merged[b] - merged[a] || a - b);
	const [first, second] = order;
	const total = merged[first] + merged[second];
	const w2 = merged[second] / total;
	const f1 = corners[first].floor;
	const kerbs = (c: Corner) =>
		styleOf(own.floor) === KERB &&
		level(c) &&
		c.floor !== own.floor &&
		c.floor !== VOID &&
		priority(own.floor) > priority(c.floor);
	const band = (d: number) => 1 - smoothstep(kerbWidth * 0.6, kerbWidth, d);
	return {
		// The fast path: one floor only, and the second fetch reads its layer again.
		floors: [f1, w2 > 0 ? corners[second].floor : f1],
		weights: [1 - w2, w2],
		kerb: {
			x: kerbs(corners[1]) ? band(0.5 - s.x) : 0,
			y: kerbs(corners[2]) ? band(0.5 - s.y) : 0
		}
	};
}

/**
 * Mishkinis's height blend of two layers at heights `h1`, `h2` (0-1, scaled into `heightRange`)
 * with weights `a1`, `a2`: how much of the second shows.
 */
export function heightShare(
	h1: number,
	h2: number,
	a1: number,
	a2: number,
	depth = SPLAT.depth,
	range = SPLAT.heightRange
): number {
	const [p, q] = [h1 * range + a1, h2 * range + a2];
	const top = Math.max(p, q) - depth;
	const [b1, b2] = [Math.max(p - top, 0), Math.max(q - top, 0)];
	return b2 / (b1 + b2);
}
