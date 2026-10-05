// Leaving the table (#220): the play area and the world around it, as pure
// maths. The play extent is the grid's box (picking, views, shots, the
// shadow box, how far the camera may pull back); the world extent is how far
// the ground runs (the land out to the horizon, the haze, the far plane).
// What lies beyond (the skirt to the horizon and the silhouettes, world/beyond.ts) is built from
// the grid's size only (`spanOf`), never from its cells, so it tells nobody anything about
// unexplored ground. No three.js here.

import type { SquareGrid } from '../game/grid';
import { fogRange, PLAY_FOG_BLEND } from './atmosphere-curve';
import { WALL_HEIGHT } from './ground';
import type { Vec3 } from './shots';
import type { Span } from './world/beyond';

/** The far plane as tuned for the Hollow: never nearer. */
const MIN_FAR = 200;
/**
 * Cells of room round the grid when framing it: the old table's rim, kept so
 * views, shots and the haze frame a table exactly as they did.
 */
const FRAME_MARGIN = 3;
/**
 * The horizon lies this many fog-fars beyond the camera's reach: fog is by
 * view depth, and a point at the edge of the view is nearer in depth than in
 * distance (cos 45° ≈ 0.71 covers any sane field of view).
 */
const HORIZON_SLACK = 1.5;

/** The camera may tilt to about 85 degrees from straight down (#220). */
export const MAX_POLAR_ANGLE = (85 * Math.PI) / 180;
/** How far above the ground under it the camera always stays, in world units. */
export const GROUND_CLEARANCE = 0.5;

export interface PlayExtent {
	/** The grid's size in world units, x and z, and a cell's. */
	width: number;
	depth: number;
	cellSize: number;
	/** The larger of the two. */
	across: number;
	/** What views and shots frame: `across` plus the old rim on each side. */
	frame: number;
	/** The bounding sphere of the grid's box up to `top`: the shadow box and picking. */
	center: Vec3;
	radius: number;
	/** How far the camera may pull back from its target. */
	maxDistance: number;
	/** How far out from the grid's centre the camera can stand, its target on the grid. */
	reach: number;
}

export interface WorldExtent {
	/** The land's outer radius, round the grid's centre. */
	horizon: number;
	fogNear: number;
	fogFar: number;
	/** The camera's far plane: it sees the horizon from as far as it may pull back. */
	far: number;
}

export interface Extents {
	play: PlayExtent;
	world: WorldExtent;
}

export interface ExtentOptions {
	/** The highest world height anything reaches (a raised floor plus its wall); a wall by default. */
	top?: number;
}

export function worldExtents(grid: SquareGrid, opts: ExtentOptions = {}): Extents {
	const width = grid.width * grid.cellSize;
	const depth = grid.height * grid.cellSize;
	const across = Math.max(width, depth);
	const frame = across + FRAME_MARGIN * 2 * grid.cellSize;
	const top = opts.top ?? WALL_HEIGHT * grid.cellSize;
	const maxDistance = frame * 2;
	// The camera stands at most this far out from the grid's centre (its target on the grid).
	const reach = maxDistance + Math.hypot(width, depth) / 2;
	// The haze (#221's retune, atmosphere-curve.ts): past the play area as the views frame it.
	const { near: fogNear, far: fogFar } = fogRange(frame);
	const horizon = reach + fogFar * HORIZON_SLACK;
	return {
		play: {
			width,
			depth,
			cellSize: grid.cellSize,
			across,
			frame,
			center: { x: 0, y: top / 2, z: 0 },
			radius: Math.hypot(width / 2, top / 2, depth / 2),
			maxDistance,
			reach
		},
		world: {
			horizon,
			fogNear,
			fogFar,
			far: Math.max(MIN_FAR, Math.hypot(horizon + reach, maxDistance))
		}
	};
}

/** The grid's size as the backdrop beyond it needs it (world/beyond.ts): nothing about its cells. */
export function spanOf(extents: Extents): Span {
	const { play, world } = extents;
	const [halfX, halfZ] = [play.width / 2, play.depth / 2];
	return {
		halfX,
		halfZ,
		cellSize: play.cellSize,
		frame: play.frame,
		reach: play.reach,
		horizon: world.horizon,
		fogNear: world.fogNear,
		fogFar: world.fogFar,
		clear: PLAY_FOG_BLEND
	};
}

/** The camera's height kept `clearance` above the ground under it (`groundY`). */
export function aboveGround(position: Vec3, groundY: number, clearance = GROUND_CLEARANCE): number {
	return Math.max(position.y, groundY + clearance);
}
