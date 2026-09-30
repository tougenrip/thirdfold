// Leaving the table (#220): the play area and the world around it, as pure
// maths. The play extent is the grid's box (picking, views, shots, the
// shadow box, how far the camera may pull back); the world extent is how far
// the ground runs (the ring out to the horizon, the haze, the far plane).
// The ring is built from the grid's size only, never from its cells, so it
// tells nobody anything about unexplored ground. No three.js here: the
// renderer turns the arrays into a mesh.

import type { SquareGrid } from '../game/grid';
import { WALL_HEIGHT } from './ground';
import type { Vec3 } from './shots';

/** The distance haze and far plane as tuned for a framing `across` this wide (the Hollow's). */
const WORLD = { fogNear: 40, fogFar: 90, far: 200, across: 54 };
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
	/** The grid's size in world units, x and z. */
	width: number;
	depth: number;
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
	/** The ring's outer radius, round the grid's centre. */
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
	// Haze and far plane grow with a table wider than the Hollow, so a long
	// table (a train) is not lost in the haze from where the camera frames it.
	const grow = Math.max(1, frame / WORLD.across);
	const fogNear = WORLD.fogNear * grow;
	const fogFar = WORLD.fogFar * grow;
	const horizon = reach + fogFar * HORIZON_SLACK;
	return {
		play: {
			width,
			depth,
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
			far: Math.max(WORLD.far * grow, Math.hypot(horizon + reach, maxDistance))
		}
	};
}

export interface RingGeometry {
	/** x, y, z per vertex, on the y = 0 plane. */
	positions: Float32Array;
	/** World units (x, -z), so a texture tiles on across the play plane's edge. */
	uvs: Float32Array;
	/** Triangles, wound to face up. */
	indices: Uint32Array;
}

/** Loops from the grid's edge to the horizon, closer together near the grid. */
const RING_LOOPS = 6;

/**
 * The ground outside the grid: an annulus whose hole is exactly the grid's
 * rectangle (its corners are vertices, so the ring meets the play plane with
 * no gap and no overlap) and whose rim is a circle at the horizon.
 * `segments` directions round the circle (fewer on a low tier), plus the corners.
 */
export function ringVertices(extent: Extents, segments: number): RingGeometry {
	const hw = extent.play.width / 2;
	const hd = extent.play.depth / 2;
	const radius = extent.world.horizon;
	const corner = Math.atan2(hd, hw);
	const angles = [corner, Math.PI - corner, Math.PI + corner, 2 * Math.PI - corner];
	const n = Math.max(4, Math.floor(segments));
	for (let i = 0; i < n; i++) angles.push((i / n) * 2 * Math.PI);
	angles.sort((a, b) => a - b);
	const around = angles.filter((a, i) => i === 0 || a - angles[i - 1] > 1e-9);

	const count = around.length * (RING_LOOPS + 1);
	const positions = new Float32Array(count * 3);
	const uvs = new Float32Array(count * 2);
	around.forEach((a, i) => {
		const c = Math.cos(a);
		const s = Math.sin(a);
		// Where the ray from the centre leaves the rectangle.
		const t = Math.min(hw / Math.abs(c), hd / Math.abs(s)); // x / 0 is Infinity
		const inner = { x: c * t, z: s * t };
		// Snap onto the edge exactly, so no float slop opens a crack.
		if (Math.abs(Math.abs(inner.x) - hw) < 1e-9 * (hw + 1)) inner.x = Math.sign(c) * hw;
		if (Math.abs(Math.abs(inner.z) - hd) < 1e-9 * (hd + 1)) inner.z = Math.sign(s) * hd;
		for (let k = 0; k <= RING_LOOPS; k++) {
			const f = (k / RING_LOOPS) ** 2;
			const x = inner.x + (c * radius - inner.x) * f;
			const z = inner.z + (s * radius - inner.z) * f;
			const v = i * (RING_LOOPS + 1) + k;
			positions.set([x, 0, z], v * 3);
			uvs.set([x, -z], v * 2);
		}
	});

	const indices = new Uint32Array(around.length * RING_LOOPS * 6);
	let o = 0;
	for (let i = 0; i < around.length; i++) {
		const a = i * (RING_LOOPS + 1);
		const b = ((i + 1) % around.length) * (RING_LOOPS + 1);
		for (let k = 0; k < RING_LOOPS; k++) {
			// Angles rise from +x toward +z, so (a, b, a+1) faces up (+y).
			indices.set([a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1], o);
			o += 6;
		}
	}
	return { positions, uvs, indices };
}

/** The camera's height kept `clearance` above the ground under it (`groundY`). */
export function aboveGround(position: Vec3, groundY: number, clearance = GROUND_CLEARANCE): number {
	return Math.max(position.y, groundY + clearance);
}
