// Die shapes and their faces. Faces are found by grouping triangles by
// normal, so every polyhedron (including the hand-built d10) is handled the
// same way. Each face is UV-mapped into its label's cell of the numeral atlas
// (#275, `atlasCell`), its numeral's up along `faceUp`. Only three.js maths is
// used here, no DOM, so it can be tested in Node.

import * as THREE from 'three/webgpu';
import { DIE_LABELS } from './dice-faces';
import type { DieKind } from './dice-throw';

export interface DieFace {
	normal: THREE.Vector3;
	centroid: THREE.Vector3;
	/** The face's corners (deduplicated), in no particular order. */
	corners: THREE.Vector3[];
	/** The first vertex of each of its triangles in the (non-indexed) geometry. */
	triangles: number[];
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
	const faces: {
		normal: THREE.Vector3;
		corners: Map<string, THREE.Vector3>;
		triangles: number[];
	}[] = [];
	const a = new THREE.Vector3();
	const b = new THREE.Vector3();
	const c = new THREE.Vector3();
	for (let i = 0; i < pos.count; i += 3) {
		a.fromBufferAttribute(pos, i);
		b.fromBufferAttribute(pos, i + 1);
		c.fromBufferAttribute(pos, i + 2);
		const normal = new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3());
		let face = faces.find((f) => f.normal.dot(normal) > 0.999);
		if (!face) faces.push((face = { normal, corners: new Map(), triangles: [] }));
		face.triangles.push(i);
		for (const v of [a, b, c]) {
			face.corners.set(`${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`, v.clone());
		}
	}
	return faces.map((f) => {
		const corners = [...f.corners.values()];
		const centroid = corners
			.reduce((s, v) => s.add(v), new THREE.Vector3())
			.divideScalar(corners.length);
		return { normal: f.normal, centroid, corners, triangles: f.triangles };
	});
}

export function buildDieModel(kind: DieKind, size: number): DieModel {
	const geometry = baseGeometry(kind, size);
	const faces = facesOf(geometry);
	const inradius = Math.min(...faces.map((f) => f.centroid.dot(f.normal)));
	const model: DieModel = { geometry, faces, inradius, readsAtVertex: kind === 'd4' };
	if (kind === 'd4') {
		// Each face of a tetrahedron is opposite one vertex: the corner not on it.
		const all = faces.flatMap((f) => f.corners);
		model.apexes = faces.map((f) =>
			all.find((v) => !f.corners.some((c) => c.distanceTo(v) < 1e-4))!.clone()
		);
	}
	const uv = new Float32Array(geometry.getAttribute('position').count * 2);
	const pos = geometry.getAttribute('position');
	const p = new THREE.Vector3();
	faces.forEach((face, i) => {
		const map = faceMapping(kind, model, i);
		for (const first of face.triangles)
			for (let v = first; v < first + 3; v++) {
				const [u, w] = map(p.fromBufferAttribute(pos, v));
				uv[v * 2] = u;
				uv[v * 2 + 1] = w;
			}
	});
	geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	return model;
}

/** The atlas is `ATLAS_GRID` × `ATLAS_GRID` cells (`static/assets` texture `dice-numerals`). */
export const ATLAS_GRID = 8;
/** How far from a cell's centre a face may reach, in cells: inside it, with a margin for filtering. */
export const CELL_FILL = 0.47;
/** The radius round a cell's centre its numeral is drawn within, in cells (the atlas, #275). */
export const GLYPH_RADIUS = 0.235;

/**
 * The atlas's cells: 0-19 the numerals 1-20 (6 and 9 dotted), 20 the 0, 21-30 the tens 00-90,
 * 31-36 the d6's pip faces, 37-40 the d4's faces with their three corner numbers.
 */
export function atlasCell(kind: DieKind, face: number): number {
	if (kind === 'd4') return 37 + face;
	if (kind === 'd6') return 31 + face;
	if (kind === 'd100tens') return 21 + face;
	if (kind === 'd100units') return face === 0 ? 20 : face - 1;
	return face;
}

/** The numeral drawn in a numeral cell (0-30), as the atlas draws it: 6 and 9 dotted. */
export function cellText(cell: number): string {
	const text = cell < 20 ? String(cell + 1) : cell === 20 ? '0' : `${cell - 21}0`;
	return text === '6' || text === '9' ? `${text}.` : text;
}

/**
 * Which way is "up" for a face's numeral: on a cube axis-aligned; on a d4 towards the corner of
 * its lowest number; else towards its farthest corner (a d10's kite's tip).
 */
export function faceUp(kind: DieKind, model: DieModel, index: number): THREE.Vector3 {
	const face = model.faces[index];
	if (kind === 'd6')
		return Math.abs(face.normal.y) > 0.9 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
	const corners =
		kind === 'd4'
			? [...face.corners].sort((a, b) => apexOf(model, a) - apexOf(model, b))
			: [...face.corners].sort((a, b) => b.distanceTo(face.centroid) - a.distanceTo(face.centroid));
	return corners[0].clone().sub(face.centroid);
}

/** The d4 vertex (its label's index) at a corner. */
function apexOf(model: DieModel, corner: THREE.Vector3): number {
	return model.apexes!.findIndex((v) => v.distanceTo(corner) < 1e-4);
}

/**
 * A face's corners in its cell, centred on the face's centroid, in cell units (x right, y up,
 * the numeral's up), seen from outside the die. Scaled so the face stays within `CELL_FILL` of the
 * centre, and on numeral faces so its inscribed circle is `GLYPH_RADIUS` where the face allows.
 */
export function faceInCell(kind: DieKind, model: DieModel, index: number) {
	const face = model.faces[index];
	const n = face.normal;
	const up = faceUp(kind, model, index);
	const y = up.sub(n.clone().multiplyScalar(up.dot(n))).normalize();
	const x = new THREE.Vector3().crossVectors(y, n);
	const local = (p: THREE.Vector3): [number, number] => {
		const d = p.clone().sub(face.centroid);
		return [d.dot(x), d.dot(y)];
	};
	const corners = face.corners.map(local);
	const reach = Math.max(...corners.flat().map(Math.abs));
	// The face's inscribed radius about its centroid: its nearest edge (corners in angle order).
	const ring = [...corners].sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
	const inner = Math.min(
		...ring.map(([ax, ay], i) => {
			const [bx, by] = ring[(i + 1) % ring.length];
			return Math.abs(ax * by - ay * bx) / Math.hypot(bx - ax, by - ay);
		})
	);
	const pictured = kind === 'd4' || kind === 'd6';
	const scale = pictured ? CELL_FILL / reach : Math.min(GLYPH_RADIUS / inner, CELL_FILL / reach);
	const at = (p: THREE.Vector3): [number, number] => {
		const [s, t] = local(p);
		return [s * scale, t * scale];
	};
	return { at, corners: face.corners.map(at) };
}

/** A face's point to atlas UVs: its cell, row 0 at the image's top, v up. */
function faceMapping(kind: DieKind, model: DieModel, index: number) {
	const cell = atlasCell(kind, index);
	const [col, row] = [cell % ATLAS_GRID, Math.floor(cell / ATLAS_GRID)];
	const { at } = faceInCell(kind, model, index);
	return (p: THREE.Vector3): [number, number] => {
		const [s, t] = at(p);
		return [(col + 0.5 + s) / ATLAS_GRID, 1 - (row + 0.5 - t) / ATLAS_GRID];
	};
}

/** What the atlas draws in each d4 cell: each corner's number, where that corner is in the cell. */
export function d4Cells(): { label: string; at: [number, number] }[][] {
	const model = buildDieModel('d4', 1);
	return model.faces.map((face, i) => {
		const { corners } = faceInCell('d4', model, i);
		return face.corners.map((c, k) => ({
			label: DIE_LABELS.d4[apexOf(model, c)],
			at: corners[k]
		}));
	});
}

/** Orientation that puts face `face` up (or, for a d4, down), turned `yaw` radians about the vertical. */
export function landingQuaternion(model: DieModel, face: number, yaw: number): THREE.Quaternion {
	const target = new THREE.Vector3(0, model.readsAtVertex ? -1 : 1, 0);
	const align = new THREE.Quaternion().setFromUnitVectors(model.faces[face].normal, target);
	return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(align);
}
