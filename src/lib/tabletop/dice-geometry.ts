// Die shapes and their faces. Faces are found by grouping triangles by
// normal, so every polyhedron (including the hand-built d10) is handled the
// same way. Only three.js maths is used here, no DOM, so it can be tested
// in Node.

import * as THREE from 'three';
import type { DieKind } from './dice-throw';

export interface DieFace {
	normal: THREE.Vector3;
	centroid: THREE.Vector3;
	/** The face's corners (deduplicated), in no particular order. */
	corners: THREE.Vector3[];
}

export interface DieModel {
	geometry: THREE.BufferGeometry;
	faces: DieFace[];
	/** Distance from the centre to a face: how high the die's centre sits when at rest. */
	inradius: number;
	/**
	 * The d4 rests on a face with a vertex on top, and is read at that vertex.
	 * The vertex opposite face i carries label i, so resting on face i shows i.
	 */
	readsAtVertex: boolean;
	/** For vertex-read dice: the vertex opposite each face. */
	apexes?: THREE.Vector3[];
}

/** A pentagonal trapezohedron (the d10). Kites are planar when apex = ring height × (5 + 2√5). */
function trapezohedron(radius: number): THREE.BufferGeometry {
	const z = 0.105 * radius;
	const apex = z * (5 + 2 * Math.sqrt(5));
	const top = new THREE.Vector3(0, apex, 0);
	const bottom = new THREE.Vector3(0, -apex, 0);
	const upper = (i: number) => {
		const a = (i * 2 * Math.PI) / 5;
		return new THREE.Vector3(Math.cos(a) * radius, z, Math.sin(a) * radius);
	};
	const lower = (i: number) => {
		const a = ((i + 0.5) * 2 * Math.PI) / 5;
		return new THREE.Vector3(Math.cos(a) * radius, -z, Math.sin(a) * radius);
	};
	const tris: THREE.Vector3[] = [];
	const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) =>
		tris.push(a, b, c, a, c, d);
	for (let i = 0; i < 5; i++) {
		quad(top, upper(i + 1), lower(i), upper(i));
		quad(bottom, lower(i), upper(i + 1), lower(i + 1));
	}
	const geometry = new THREE.BufferGeometry().setFromPoints(tris);
	geometry.computeVertexNormals();
	return geometry;
}

function baseGeometry(kind: DieKind, size: number): THREE.BufferGeometry {
	switch (kind) {
		case 'd4':
			return new THREE.TetrahedronGeometry(size * 0.75);
		case 'd6':
			return new THREE.BoxGeometry(size * 0.8, size * 0.8, size * 0.8).toNonIndexed();
		case 'd8':
			return new THREE.OctahedronGeometry(size * 0.62);
		case 'd12':
			return new THREE.DodecahedronGeometry(size * 0.6);
		case 'd20':
			return new THREE.IcosahedronGeometry(size * 0.62);
		default:
			return trapezohedron(size * 0.55);
	}
}

/** Groups a non-indexed geometry's triangles into flat faces. */
export function facesOf(geometry: THREE.BufferGeometry): DieFace[] {
	const pos = geometry.getAttribute('position');
	const faces: { normal: THREE.Vector3; corners: Map<string, THREE.Vector3> }[] = [];
	const a = new THREE.Vector3();
	const b = new THREE.Vector3();
	const c = new THREE.Vector3();
	for (let i = 0; i < pos.count; i += 3) {
		a.fromBufferAttribute(pos, i);
		b.fromBufferAttribute(pos, i + 1);
		c.fromBufferAttribute(pos, i + 2);
		const normal = new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3());
		let face = faces.find((f) => f.normal.dot(normal) > 0.999);
		if (!face) faces.push((face = { normal, corners: new Map() }));
		for (const v of [a, b, c]) {
			face.corners.set(`${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`, v.clone());
		}
	}
	return faces.map((f) => {
		const corners = [...f.corners.values()];
		const centroid = corners
			.reduce((s, v) => s.add(v), new THREE.Vector3())
			.divideScalar(corners.length);
		return { normal: f.normal, centroid, corners };
	});
}

export function buildDieModel(kind: DieKind, size: number): DieModel {
	const geometry = baseGeometry(kind, size);
	const faces = facesOf(geometry);
	const inradius = Math.min(...faces.map((f) => f.centroid.dot(f.normal)));
	if (kind !== 'd4') return { geometry, faces, inradius, readsAtVertex: false };
	// Each face of a tetrahedron is opposite one vertex: the corner not on it.
	const all = faces.flatMap((f) => f.corners);
	const apexes = faces.map((f) =>
		all.find((v) => !f.corners.some((c) => c.distanceTo(v) < 1e-4))!.clone()
	);
	return { geometry, faces, inradius, readsAtVertex: true, apexes };
}

/** Orientation that puts face `face` up (or, for a d4, down), turned `yaw` radians about the vertical. */
export function landingQuaternion(model: DieModel, face: number, yaw: number): THREE.Quaternion {
	const target = new THREE.Vector3(0, model.readsAtVertex ? -1 : 1, 0);
	const align = new THREE.Quaternion().setFromUnitVectors(model.faces[face].normal, target);
	return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(align);
}
