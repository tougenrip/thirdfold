// Models authored as primitive parts (boxes, cylinders, spheres, cones: the
// look of every prop and figure in The Hollow Bell) and baked into meshes
// for a GLB. Parts are merged into at most three meshes: `body`, `swing`
// (parts that swing about the model's pivot) and `accent` (tinted with the
// token's colour at the table), each drawn with one call per model however
// many parts it has. Colours are baked in as vertex colours.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MODEL_KINDS, type ModelKind } from '../../src/lib/assets/manifest';
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
}

const MAX_PARTS = 200;
const COLOR = /^#[0-9a-f]{6}$/;

/** Unit shapes, the same the placeholders used: one cell across, centred. */
function unitShape(shape: Shape): THREE.BufferGeometry {
	switch (shape) {
		case 'box':
			return new THREE.BoxGeometry(1, 1, 1);
		case 'cylinder':
			return new THREE.CylinderGeometry(0.5, 0.5, 1, 18);
		case 'sphere':
			return new THREE.SphereGeometry(0.5, 16, 12);
		case 'cone':
			return new THREE.ConeGeometry(0.5, 1, 18);
	}
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
	if (parts.some((p) => p.swings) && !source.swing)
		throw new Error('swinging parts need a "swing"');
	return source;
}

/** The meshes of a model: parts merged by role, colours baked in. */
export function bakeModel(source: ModelSource, materialColor: (id: string) => string): MeshData[] {
	const groups: Record<'body' | 'swing' | 'accent', THREE.BufferGeometry[]> = {
		body: [],
		swing: [],
		accent: []
	};
	const color = new THREE.Color();
	for (const p of source.parts) {
		const g = unitShape(p.shape);
		g.deleteAttribute('uv');
		const matrix = new THREE.Matrix4().compose(
			new THREE.Vector3(...p.at),
			new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.turn ?? [0, 0, 0]))),
			new THREE.Vector3(...p.size)
		);
		g.applyMatrix4(matrix);
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
		const indices = index
			? index.array
			: Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
		meshes.push({
			name,
			positions: new Float32Array(positions),
			// The client works normals out again: smaller files, and the same shading.
			normals: null,
			colors: merged.getAttribute('color')
				? new Float32Array(merged.getAttribute('color').array as Float32Array)
				: null,
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
