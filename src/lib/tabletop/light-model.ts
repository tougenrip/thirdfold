// The light model's pure maths (milestone 68): no three.js, no DOM, so the server project tests it.

// ---------------------------------------------------------------------------------------------
// The sun and moon's shadow box (#229)
// ---------------------------------------------------------------------------------------------

type V3 = readonly [number, number, number];

/** The world box that casts and takes the key light's shadow: the grid up to its top. */
export interface ShadowBounds {
	min: V3;
	max: V3;
}

/** The shadow camera's orthographic box, in the light's own space (three's camera fields). */
export interface ShadowFrustum {
	left: number;
	right: number;
	top: number;
	bottom: number;
	near: number;
	far: number;
}

/** The box's size steps by this share of a cell, so a light turning a little keeps its texels. */
const SIZE_STEP = 0.5;
/** Texels of room round the box, so the soft filter's taps at its edge stay on the map. */
const EDGE_TEXELS = 4;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0]
];
const unit = (a: V3): V3 => {
	const l = Math.hypot(a[0], a[1], a[2]);
	return [a[0] / l, a[1] / l, a[2] / l];
};

/** The light camera's axes as three's `Matrix4.lookAt` makes them (up +y), so the box matches. */
export function lightBasis(eye: V3, target: V3): { x: V3; y: V3; z: V3 } {
	let z = sub(eye, target);
	if (dot(z, z) === 0) z = [0, 0, 1];
	z = unit(z);
	const up: V3 = [0, 1, 0];
	let x = cross(up, z);
	if (dot(x, x) === 0) {
		z = unit([z[0], z[1], z[2] + 0.0001]);
		x = cross(up, z);
	}
	x = unit(x);
	return { x, y: cross(z, x), z };
}

/**
 * The key light's shadow box for `bounds`, seen from `eye` toward `target` (the light stands off
 * the play area's centre): the bounds' corners in light space, with the edge's room, sized in
 * steps of half a cell and centred on a whole texel of a `mapSize` map, so a light that turns a
 * little or not at all keeps the same texels (no shimmer). Reaches toward the light by the box's
 * height again, for anything taller than it. Fitted to the grid, never the camera or the world
 * past it, whose ground reads as unshadowed.
 */
export function fitShadowFrustum(
	bounds: ShadowBounds,
	eye: V3,
	target: V3,
	mapSize: number,
	cellSize = 1
): ShadowFrustum {
	const { x, y, z } = lightBasis(eye, target);
	const lo = [Infinity, Infinity, Infinity];
	const hi = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < 8; i++) {
		const p: V3 = [
			i & 1 ? bounds.max[0] : bounds.min[0],
			i & 2 ? bounds.max[1] : bounds.min[1],
			i & 4 ? bounds.max[2] : bounds.min[2]
		];
		const d = sub(p, eye);
		// Distance in front of the light: the camera looks down its -z.
		const c = [dot(d, x), dot(d, y), -dot(d, z)];
		for (let k = 0; k < 3; k++) {
			lo[k] = Math.min(lo[k], c[k]);
			hi[k] = Math.max(hi[k], c[k]);
		}
	}
	const step = SIZE_STEP * cellSize;
	const side = (a: number, b: number) => {
		const half = (b - a) / 2;
		const room = ((2 * half) / mapSize) * EDGE_TEXELS;
		return Math.ceil((half + room) / step) * step;
	};
	const [hx, hy] = [side(lo[0], hi[0]), side(lo[1], hi[1])];
	const snap = (v: number, texel: number) => Math.round(v / texel) * texel;
	const cx = snap((lo[0] + hi[0]) / 2, (2 * hx) / mapSize);
	const cy = snap((lo[1] + hi[1]) / 2, (2 * hy) / mapSize);
	const height = bounds.max[1] - bounds.min[1];
	return {
		left: cx - hx,
		right: cx + hx,
		bottom: cy - hy,
		top: cy + hy,
		near: Math.max(0.01, lo[2] - height),
		far: hi[2] + step
	};
}
