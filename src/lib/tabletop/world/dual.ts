// Dual-grid cases (#239): for each render tile (one per grid corner, its
// corners the four cells round it), which of its eight sectors (shape.ts
// `SECTORS`) are inside a mask, and how an ambiguous tile (a saddle) joins.
//
// Saddles follow the rules on ground-only obstacles (levels and void):
// - a diagonal pair joins only if `canStep` connects it (both ways), else the
//   other pair does if `canStep` connects that;
// - where both connect (a one-level checkerboard) the higher pair joins, so a
//   riser stays continuous;
// - where neither does (two cells two levels or more above the other two, or
//   walkable ground across void corners) the saddle is pinched at the grid
//   corner, with no rounding: nothing may suggest a passage;
// - land and water, which the rules don't separate, join by a hash of the
//   tile, the same on every client.
// A tile with an unexplored corner that is still ambiguous is pinched.

import { FLOOR_IDS, VOID } from '../../game/floor';
import { canStep, type Obstacles } from '../../game/objects';
import { CORNERS, groundObstacles, SECTOR_H, SECTOR_V, type WorldShape } from './shape';

const WATER = FLOOR_IDS.indexOf('water');

/** `walkable`: not void. `land`: not water. A number L: a level band, level >= L. */
export type DualMask = 'walkable' | 'land' | number;

/** How a tile's ambiguity resolves: the inside pair joins, the outside pair, or a pinch. */
export const JOIN = { none: 0, in: 1, out: 2, pinch: 3 } as const;
export type Join = (typeof JOIN)[keyof typeof JOIN];

export interface DualCase {
	/** Bit k set: sector k (clockwise from north, `SECTORS`) is inside the mask. */
	sectors: number;
	/**
	 * The classic marching-squares case, corners clockwise from NW as bits 1, 2,
	 * 4, 8 (so the saddles are 5 and 10), or -1 when an unexplored corner is split
	 * across the mask.
	 */
	corners: number;
	join: Join;
}

/** The marching-squares case of eight sectors, or -1 if a corner's two halves differ. */
export function cornerCase(sectors: number): number {
	let out = 0;
	for (let k = 0; k < 4; k++) {
		const h = (sectors >> SECTOR_H[k]) & 1;
		const v = (sectors >> SECTOR_V[k]) & 1;
		if (h !== v) return -1;
		out |= h << k;
	}
	return out;
}

/** How many times the mask changes going once round the tile's centre. */
export function transitions(sectors: number): number {
	let n = 0;
	for (let k = 0; k < 8; k++) if (((sectors >> k) & 1) !== ((sectors >> ((k + 1) & 7)) & 1)) n++;
	return n;
}

/** A stable bit per tile, for land and water saddles. */
export function tileHash(tx: number, ty: number): number {
	let h = Math.imul(tx, 73856093) ^ Math.imul(ty, 19349663);
	h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
	return (h ^ (h >>> 15)) & 1;
}

/** Ground-only obstacles, built once per shape. */
const obstaclesOf = new WeakMap<WorldShape, Obstacles>();

/** The tile at grid corner (tx, ty) under a mask. */
export function dualCase(shape: WorldShape, tx: number, ty: number, mask: DualMask): DualCase {
	const { grid } = shape;
	const tile = (ty * (grid.width + 1) + tx) * 8;
	const values = mask === 'walkable' || mask === 'land' ? shape.tiles.floor : shape.tiles.levels;
	const inside =
		mask === 'walkable'
			? (v: number) => v !== VOID
			: mask === 'land'
				? (v: number) => v !== WATER
				: (v: number) => v >= mask;
	let sectors = 0;
	for (let k = 0; k < 8; k++) if (inside(values[tile + k])) sectors |= 1 << k;
	const corners = cornerCase(sectors);
	if (transitions(sectors) < 4) return { sectors, corners, join: JOIN.none };
	const cells = CORNERS.map(({ dx, dy }) => ({ x: tx + dx, y: ty + dy }));
	const known =
		(corners === 5 || corners === 10) &&
		cells.every(
			(c) =>
				c.x >= 0 &&
				c.y >= 0 &&
				c.x < grid.width &&
				c.y < grid.height &&
				(!shape.known || shape.known[c.y * grid.width + c.x])
		);
	if (!known) return { sectors, corners, join: JOIN.pinch };
	if (mask === 'land') return { sectors, corners, join: tileHash(tx, ty) ? JOIN.in : JOIN.out };
	let o = obstaclesOf.get(shape);
	if (!o) obstaclesOf.set(shape, (o = groundObstacles(shape)));
	const ob = o;
	const joins = (p: number, q: number) =>
		canStep(ob, cells[p], cells[q]) && canStep(ob, cells[q], cells[p]);
	// Case 5: NW and SE inside; case 10: NE and SW. Inside is the higher pair in a band.
	const [a, b] = corners === 5 ? [0, 2] : [1, 3];
	if (joins(a, b)) return { sectors, corners, join: JOIN.in };
	if (joins((a + 1) & 3, (b + 1) & 3)) return { sectors, corners, join: JOIN.out };
	return { sectors, corners, join: JOIN.pinch };
}
