// What part-list models carry besides colour (#190): per vertex, how much of the sky it sees
// (ambient occlusion by its own model's parts and the floor it stands on) and how convex the
// surface is there. Both are worked out here at build time, deterministically (the same rays for
// every vertex, from a fixed seed), and written into the GLB as `_BAKE`, which the prop and mini
// kinds read into their ambient occlusion. Changing a constant changes the bytes, so the check
// in `npm run assets -- --check` asks for a rebuild.

import * as THREE from 'three';
import type { PartSource, Shape } from './models';
import { random } from './textures';

/** The attribute the bake sits in while building: (occlusion, convexity), 0..1 each. */
export const BAKE = 'bake';

const RAYS = 32;
/** How far a ray looks for its own model, in units (a cell is 1). */
const REACH = 0.5;
const STEPS = 16;
const SEED = 190;
/** A ray leaves this far off the surface, so it never meets the part it starts on. */
const LIFT = 1e-3;

/** Cosine-weighted directions about +z, the same for every vertex. */
const DIRECTIONS = (() => {
	const rand = random(SEED);
	return Array.from({ length: RAYS }, () => {
		const [u, v] = [rand(), rand()];
		const [r, a] = [Math.sqrt(u), 2 * Math.PI * v];
		return [r * Math.cos(a), r * Math.sin(a), Math.sqrt(1 - u)];
	});
})();

/** A part as space it fills: its shape in a unit frame, and a sphere around it. */
export interface Solid {
	shape: Shape;
	/** World to the unit frame, where the shape fills -0.5..0.5. */
	inverse: number[];
	centre: THREE.Vector3;
	radius: number;
}

export function solidOf(p: PartSource): Solid {
	const m = new THREE.Matrix4().compose(
		new THREE.Vector3(...p.at),
		new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.turn ?? [0, 0, 0]))),
		new THREE.Vector3(...p.size)
	);
	return {
		shape: p.shape,
		inverse: m.clone().invert().elements,
		centre: new THREE.Vector3(...p.at),
		radius: Math.hypot(...p.size) / 2
	};
}

/** Whether the point (x, y, z) is inside `s` (unchamfered: the chamfers are too small to matter). */
function inside(s: Solid, x: number, y: number, z: number): boolean {
	const e = s.inverse;
	const u = e[0] * x + e[4] * y + e[8] * z + e[12];
	const v = e[1] * x + e[5] * y + e[9] * z + e[13];
	const w = e[2] * x + e[6] * y + e[10] * z + e[14];
	if (Math.abs(v) >= 0.5) return false;
	switch (s.shape) {
		case 'box':
			return Math.abs(u) < 0.5 && Math.abs(w) < 0.5;
		case 'cylinder':
			return u * u + w * w < 0.25;
		case 'sphere':
			return u * u + v * v + w * w < 0.25;
		case 'cone':
			return Math.sqrt(u * u + w * w) < 0.5 * (0.5 - v);
	}
}

/** The share of rays from (p, n) that meet nothing within `REACH`: 1 open, 0 shut in. */
export function occlusionAt(p: THREE.Vector3, n: THREE.Vector3, solids: readonly Solid[]): number {
	const near = solids.filter((s) => s.centre.distanceTo(p) < s.radius + REACH + LIFT);
	// A frame about n (Duff et al. 2017), so every vertex turns the same rays the same way.
	const sign = n.z >= 0 ? 1 : -1;
	const a = -1 / (sign + n.z);
	const b = n.x * n.y * a;
	const t = [1 + sign * n.x * n.x * a, sign * b, -sign * n.x];
	const s = [b, sign + n.y * n.y * a, -n.y];
	const [ox, oy, oz] = [p.x + n.x * LIFT, p.y + n.y * LIFT, p.z + n.z * LIFT];
	let open = 0;
	for (const [dx, dy, dz] of DIRECTIONS) {
		const x = t[0] * dx + s[0] * dy + n.x * dz;
		const y = t[1] * dx + s[1] * dy + n.y * dz;
		const z = t[2] * dx + s[2] * dy + n.z * dz;
		let hit = false;
		for (let k = 0; k <= STEPS && !hit; k++) {
			const d = (REACH * k) / STEPS;
			const [qx, qy, qz] = [ox + x * d, oy + y * d, oz + z * d];
			// The floor the model stands on shades what is near it.
			hit = qy < 0 || near.some((solid) => inside(solid, qx, qy, qz));
		}
		if (!hit) open++;
	}
	return open / RAYS;
}

/**
 * Convexity at each vertex of an indexed geometry: the mean, over the triangles at it, of how far
 * each turns away from its normal (0.5 flat, above it an edge or a bump, below it a hollow).
 */
export function convexity(g: THREE.BufferGeometry): Float32Array {
	const index = g.getIndex()!.array;
	const position = g.getAttribute('position');
	const normal = g.getAttribute('normal');
	const sum = new Float32Array(position.count);
	const count = new Uint16Array(position.count);
	const [a, b, c, n, face, centre] = Array.from({ length: 6 }, () => new THREE.Vector3());
	for (let i = 0; i < index.length; i += 3) {
		const [i0, i1, i2] = [index[i], index[i + 1], index[i + 2]];
		a.fromBufferAttribute(position, i0);
		b.fromBufferAttribute(position, i1);
		c.fromBufferAttribute(position, i2);
		centre.copy(a).add(b).add(c).divideScalar(3);
		face.subVectors(c, b).cross(a.clone().sub(b)).normalize();
		for (const v of [i0, i1, i2]) {
			n.fromBufferAttribute(normal, v);
			const at = new THREE.Vector3().fromBufferAttribute(position, v);
			// A face that falls away below the normal's plane makes a convex vertex.
			const away = centre.clone().sub(at).dot(n) <= 0 ? 1 : -1;
			sum[v] += away * n.angleTo(face);
			count[v]++;
		}
	}
	return sum.map((s, v) => Math.min(Math.max(0.5 + s / Math.max(count[v], 1) / Math.PI, 0), 1));
}

/** Bakes occlusion by `solids` and convexity into `g` as its `BAKE` attribute. */
export function bakeInto(g: THREE.BufferGeometry, solids: readonly Solid[]): void {
	const position = g.getAttribute('position');
	const normal = g.getAttribute('normal');
	const bumps = convexity(g);
	const out = new Float32Array(position.count * 2);
	const [p, n] = [new THREE.Vector3(), new THREE.Vector3()];
	for (let i = 0; i < position.count; i++) {
		p.fromBufferAttribute(position, i);
		n.fromBufferAttribute(normal, i).normalize();
		out[i * 2] = occlusionAt(p, n, solids);
		out[i * 2 + 1] = bumps[i];
	}
	g.setAttribute(BAKE, new THREE.BufferAttribute(out, 2));
}
