// Models authored as primitive parts (boxes, cylinders, spheres, cones: the
// look of every prop and figure in The Hollow Bell) and baked into meshes
// for a GLB. Parts are merged into at most three meshes: `body`, `swing`
// (parts that swing about the model's pivot) and `accent` (tinted with the
// token's colour at the table), each drawn with one call per model however
// many parts it has. Colours are baked in as vertex colours. Each part is
// built at its own size with chamfered edges (#190), so they catch the light,
// and carries its normals and a baked occlusion and convexity (bake.ts).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MODEL_KINDS, type ModelKind } from '../../src/lib/assets/manifest';
import { BAKE, bakeInto, solidOf } from './bake';
import type { MeshData } from './glb';

export const SHAPES = ['box', 'cylinder', 'sphere', 'cone'] as const;
export type Shape = (typeof SHAPES)[number];

export interface PartSource {
	shape: Shape;
	size: [number, number, number];
	at: [number, number, number];
	/** Turn about x, y and z (radians), applied before `at`. */
	turn?: [number, number, number];
	/** `#rrggbb`, or a material from materials.json. */
	color?: string;
	material?: string;
	swings?: boolean;
	/** Takes the token's colour (a figure's cloak, a banner). */
	accent?: boolean;
}

export interface ModelSource {
	parts: PartSource[];
	swing?: { pivot: number; throw: number };
	/** A prop held to the set-piece limits (see LIMITS). */
	setPiece?: true;
}

const MAX_PARTS = 200;
const COLOR = /^#[0-9a-f]{6}$/;

/** A part's chamfer: 8% of its least side, 0.004 to 0.04 u, and never over a quarter of it. */
export function chamferOf(size: readonly number[]): number {
	const least = Math.min(...size);
	return Math.min(Math.max(0.08 * least, 0.004), 0.04, least / 4);
}

/**
 * A box of `size` with its edges and corners chamfered by `c`: 24 points, 44 triangles. Each
 * point lies on one face and takes its normal, so faces stay flat and the chamfers shade smoothly
 * from one face to the next.
 */
function chamferedBox(size: readonly number[], c: number): THREE.BufferGeometry {
	const positions: number[] = [];
	const normals: number[] = [];
	for (let k = 0; k < 8; k++) {
		const s = [k & 1 ? 1 : -1, k & 2 ? 1 : -1, k & 4 ? 1 : -1];
		for (let a = 0; a < 3; a++) {
			for (let i = 0; i < 3; i++) positions.push(s[i] * (size[i] / 2 - (i === a ? 0 : c)));
			for (let i = 0; i < 3; i++) normals.push(i === a ? s[i] : 0);
		}
	}
	/** The point of the corner with signs `s` that lies on the face across axis `a`. */
	const at = (s: number[], a: number) =>
		((s[0] > 0 ? 1 : 0) | (s[1] > 0 ? 2 : 0) | (s[2] > 0 ? 4 : 0)) * 3 + a;
	const cycle = [
		[-1, -1],
		[1, -1],
		[1, 1],
		[-1, 1]
	];
	const polygons: number[][] = [];
	for (let a = 0; a < 3; a++) {
		const [b, e] = [(a + 1) % 3, (a + 2) % 3];
		const signs = (sa: number, sb: number, se: number) => {
			const s = [0, 0, 0];
			[s[a], s[b], s[e]] = [sa, sb, se];
			return s;
		};
		for (const side of [-1, 1]) polygons.push(cycle.map(([u, v]) => at(signs(side, u, v), a)));
		// The chamfer along axis a, between the faces across b and e.
		for (const [u, v] of cycle) {
			const [lo, hi] = [signs(-1, u, v), signs(1, u, v)];
			polygons.push([at(lo, b), at(hi, b), at(hi, e), at(lo, e)]);
		}
	}
	for (let k = 0; k < 8; k++) polygons.push([k * 3, k * 3 + 1, k * 3 + 2]);
	const point = (i: number) => new THREE.Vector3().fromArray(positions, i * 3);
	const indices: number[] = [];
	for (const polygon of polygons) {
		// Wound outward: the box is convex about the origin.
		const [p, q, r] = polygon.map(point);
		const ring = q.sub(p).cross(r.sub(p)).dot(p) < 0 ? polygon.reverse() : polygon;
		for (let i = 1; i + 1 < ring.length; i++) indices.push(ring[0], ring[i], ring[i + 1]);
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
	g.setIndex(indices);
	return g;
}

/**
 * A cylinder (or cone) of `size` with its rims chamfered by `c`, 18 sides, lathed from a
 * profile, with normals by the face each point lies on as the box's. An oval stretches its
 * chamfer across its wider side only.
 */
function chamferedLathe(cone: boolean, [w, h, d]: readonly number[], c: number) {
	const r = Math.min(w, d) / 2;
	const [y0, y1] = [-h / 2, h / 2];
	const profile = cone
		? [
				[0, y0],
				[r - c, y0],
				[r, y0 + c],
				[0, y1]
			]
		: [
				[0, y0],
				[r - c, y0],
				[r, y0 + c],
				[r, y1 - c],
				[r - c, y1],
				[0, y1]
			];
	const g = new THREE.LatheGeometry(
		profile.map(([x, y]) => new THREE.Vector2(x, y)),
		18
	);
	const position = g.getAttribute('position');
	const normal = g.getAttribute('normal');
	const n = profile.length;
	// A side's normal as (outward, up): a cone's leans up by its slope.
	const slope = Math.hypot(h - c, r);
	const [out, up] = cone ? [(h - c) / slope, r / slope] : [1, 0];
	for (let i = 0; i < position.count; i++) {
		const j = i % n;
		// Outward along this meridian, from its first point on the side.
		const [x, z] = [position.getX(i - j + 2) / r, position.getZ(i - j + 2) / r];
		if (j <= 1) normal.setXYZ(i, 0, -1, 0);
		else if (!cone && j >= n - 2) normal.setXYZ(i, 0, 1, 0);
		else normal.setXYZ(i, x * out, up, z * out);
	}
	return g.scale(w / 2 / r, 1, d / 2 / r);
}

/** A part's shape at its own size, centred: chamfers keep their width however it is stretched. */
export function shapeAt(shape: Shape, size: readonly number[]): THREE.BufferGeometry {
	const c = chamferOf(size);
	const g =
		shape === 'box'
			? chamferedBox(size, c)
			: shape === 'sphere'
				? new THREE.SphereGeometry(0.5, 16, 12).scale(size[0], size[1], size[2])
				: chamferedLathe(shape === 'cone', size, c);
	g.deleteAttribute('uv');
	return withoutSlivers(g);
}

/** Without its triangles of no area (a lathe's at the axis). */
function withoutSlivers(g: THREE.BufferGeometry): THREE.BufferGeometry {
	const index = g.getIndex()!.array;
	const p = g.getAttribute('position');
	const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
	const kept: number[] = [];
	for (let i = 0; i < index.length; i += 3) {
		a.fromBufferAttribute(p, index[i]);
		b.fromBufferAttribute(p, index[i + 1]).sub(a);
		c.fromBufferAttribute(p, index[i + 2]).sub(a);
		if (b.cross(c).lengthSq() > 1e-18) kept.push(index[i], index[i + 1], index[i + 2]);
	}
	g.setIndex(kept);
	return g;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const vec3 = (v: unknown, min: number, max: number): v is [number, number, number] =>
	Array.isArray(v) &&
	v.length === 3 &&
	v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max);

/** A model source as read from its JSON file, checked; throws with what is wrong. */
export function readModelSource(raw: unknown, materials: ReadonlySet<string>): ModelSource {
	if (!isRecord(raw) || !Array.isArray(raw.parts)) throw new Error('needs "parts"');
	if (raw.parts.length === 0 || raw.parts.length > MAX_PARTS) {
		throw new Error(`needs 1 to ${MAX_PARTS} parts`);
	}
	const parts = raw.parts.map((p, i): PartSource => {
		const where = `part ${i + 1}`;
		if (!isRecord(p)) throw new Error(`${where} is not an object`);
		const shape = SHAPES.find((s) => s === p.shape);
		if (!shape) throw new Error(`${where}: unknown shape`);
		if (!vec3(p.size, 0.001, 20)) throw new Error(`${where}: bad size`);
		if (!vec3(p.at, -20, 20)) throw new Error(`${where}: bad position`);
		if (p.turn !== undefined && !vec3(p.turn, -7, 7)) throw new Error(`${where}: bad turn`);
		if (p.color !== undefined && (typeof p.color !== 'string' || !COLOR.test(p.color))) {
			throw new Error(`${where}: bad colour`);
		}
		if (
			p.material !== undefined &&
			(typeof p.material !== 'string' || !materials.has(p.material))
		) {
			throw new Error(`${where}: unknown material`);
		}
		if (p.accent && p.swings) throw new Error(`${where}: an accent can't swing`);
		if (!p.accent && p.color === undefined && p.material === undefined) {
			throw new Error(`${where}: needs a colour or a material`);
		}
		return {
			shape,
			size: p.size,
			at: p.at,
			...(p.turn ? { turn: p.turn as [number, number, number] } : {}),
			...(p.color ? { color: p.color as string } : {}),
			...(p.material ? { material: p.material as string } : {}),
			...(p.swings === true ? { swings: true } : {}),
			...(p.accent === true ? { accent: true } : {})
		};
	});
	const source: ModelSource = { parts };
	if (raw.swing !== undefined) {
		const s = raw.swing;
		if (!isRecord(s) || typeof s.pivot !== 'number' || typeof s.throw !== 'number') {
			throw new Error('bad "swing"');
		}
		source.swing = { pivot: s.pivot, throw: s.throw };
	}
	if (raw.setPiece !== undefined) {
		if (raw.setPiece !== true) throw new Error('"setPiece" is true or absent');
		source.setPiece = true;
	}
	if (parts.some((p) => p.swings) && !source.swing)
		throw new Error('swinging parts need a "swing"');
	return source;
}

/** Where a part stands: its turn, then its position (its shape is built at its size). */
export const placementOf = (p: PartSource) =>
	new THREE.Matrix4().compose(
		new THREE.Vector3(...p.at),
		new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.turn ?? [0, 0, 0]))),
		new THREE.Vector3(1, 1, 1)
	);

/**
 * The meshes of a model: parts chamfered and merged by role, with colours, normals, and occlusion
 * and convexity baked in (bake.ts).
 */
export function bakeModel(source: ModelSource, materialColor: (id: string) => string): MeshData[] {
	const groups: Record<'body' | 'swing' | 'accent', THREE.BufferGeometry[]> = {
		body: [],
		swing: [],
		accent: []
	};
	const color = new THREE.Color();
	const solids = source.parts.map(solidOf);
	for (const p of source.parts) {
		const g = shapeAt(p.shape, p.size).applyMatrix4(placementOf(p));
		bakeInto(g, solids);
		const role = p.accent ? 'accent' : p.swings ? 'swing' : 'body';
		if (role !== 'accent') {
			color.setStyle(p.color ?? materialColor(p.material!));
			const count = g.getAttribute('position').count;
			const colors = new Float32Array(count * 3);
			for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
			g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
		}
		groups[role].push(g);
	}
	const meshes: MeshData[] = [];
	for (const [name, list] of Object.entries(groups)) {
		if (!list.length) continue;
		const merged = mergeGeometries(list, false);
		if (!merged) throw new Error(`could not merge the ${name} parts`);
		const index = merged.getIndex();
		const positions = merged.getAttribute('position').array as Float32Array;
		const indices = index!.array;
		const bake = merged.getAttribute(BAKE).array;
		meshes.push({
			name,
			positions: new Float32Array(positions),
			normals: new Float32Array(merged.getAttribute('normal').array as Float32Array),
			colors: merged.getAttribute('color')
				? new Float32Array(merged.getAttribute('color').array as Float32Array)
				: null,
			bake: Uint8Array.from(bake, (v) => Math.round(Math.min(Math.max(v, 0), 1) * 255)),
			indices:
				positions.length / 3 <= 0xffff ? Uint16Array.from(indices) : Uint32Array.from(indices)
		});
		for (const g of list) g.dispose();
	}
	return meshes;
}

export function isModelKind(folder: string): folder is ModelKind {
	return (MODEL_KINDS as readonly string[]).includes(folder);
}
