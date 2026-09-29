// The great bell's pilot art (#196), made in house as the Blender export the
// cook expects (docs/ART.md brief A, section 17): `body` (the timber A-frame,
// its iron straps and bolts, the chains) and `swing` (the bell, its headstock
// and clapper, turning about the headstock's axis), one material whose
// baseColor and normal (1024²), ORM (512²) maps, one atlas, and emissive rim mask are
// painted as PNG (bell-art-paint.ts): cast bronze with patina streaking down from the bands,
// the lip and bands worn bright, three bands of illegible lettering, a crack up
// from the lip; dark timber grain; hammered, rusting iron. Same bytes every run
// on Node 22 (PNG deflate differs under Node 26's zlib-ng):
//   npx -y node@22 node_modules/tsx/dist/cli.mjs scripts/make-bell-art.ts
// writes art/prop/great-bell/great-bell.glb and meta.json; then
// `npm run assets:cook` and `npm run assets`.

import { Document, NodeIO, type Material } from '@gltf-transform/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { placementOf, shapeAt, type Shape } from '../server/assets/models';
import { encodePng } from '../server/assets/png';
import { fit } from '../server/assets/cook-textures';
import {
	BELL,
	GLOW,
	INNER,
	IRON,
	SIZE,
	WOOD,
	inset,
	paint,
	profile,
	type Region
} from './bell-art-paint';

const DIR = path.join('art', 'prop', 'great-bell');
/** The headstock's axis, which the swing turns about (cells above the floor). */
const PIVOT = 3.85;

// ---------------------------------------------------------------- geometry

/** A part (a chamfered primitive, as part lists are made) with its UVs in `region`. */
function part(
	shape: Shape,
	size: [number, number, number],
	at: [number, number, number],
	region: Region,
	turn?: [number, number, number]
): THREE.BufferGeometry {
	const g = shapeAt(shape, size);
	const p = g.getAttribute('position');
	const n = g.getAttribute('normal');
	// Planar per face; the grain runs along the part's longest side, at a steady texel density.
	const long = size.indexOf(Math.max(...size));
	const span = [0, 1, 2].map((a) => Math.min(1, size[a] / (a === long ? 4.5 : 0.6)));
	const offset = (((at[0] * 7.3 + at[1] * 3.1 + at[2] * 5.7) % 1) + 1) % 1;
	const uv: number[] = [];
	for (let i = 0; i < p.count; i++) {
		const normal = [n.getX(i), n.getY(i), n.getZ(i)].map(Math.abs);
		const face = normal.indexOf(Math.max(...normal));
		const [a, b] = [0, 1, 2].filter((k) => k !== face);
		const [across, along] = a === long ? [b, a] : [a, b];
		const c = (k: number) => p.getComponent(i, k) / size[k] + 0.5;
		const t = c(along) * span[along];
		uv.push(...inset(region, c(across) * span[across], (t + offset * (1 - span[along])) % 1.0001));
	}
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	return g.applyMatrix4(placementOf({ shape, size, at, ...(turn ? { turn } : {}) }));
}

/** A beam of `section` from `a` to `b` (in a plane of constant x). */
function beam(a: number[], b: number[], section: number, region = WOOD) {
	const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
	const length = Math.hypot(...d);
	const mid = a.map((v, i) => (v + b[i]) / 2) as [number, number, number];
	return part('box', [section, length, section], mid, region, [Math.atan2(d[2], d[1]), 0, 0]);
}

/** A chain of links from `a` to `b`, each link turned a quarter from the last. */
function chain(a: THREE.Vector3, b: THREE.Vector3): THREE.BufferGeometry[] {
	const dir = b.clone().sub(a);
	const count = Math.floor(dir.length() / 0.22);
	const along = new THREE.Quaternion().setFromUnitVectors(
		new THREE.Vector3(0, 1, 0),
		dir.normalize()
	);
	const links: THREE.BufferGeometry[] = [];
	for (let i = 0; i < count; i++) {
		const link = new THREE.TorusGeometry(0.075, 0.02, 4, 8).scale(0.8, 1.45, 1);
		link.rotateY(i % 2 ? Math.PI / 2 : 0);
		link.applyQuaternion(along);
		link.translate(
			...a
				.clone()
				.addScaledVector(dir, 0.11 + i * 0.22)
				.toArray()
		);
		const uv = link.getAttribute('uv');
		for (let k = 0; k < uv.count; k++)
			uv.setXY(k, ...(inset(IRON, uv.getX(k), uv.getY(k)) as [number, number]));
		links.push(link);
	}
	return links;
}

/** The bell: its profile turned about y, UVs round (u) and down (v) the outside or the inside. */
function bell(): THREE.BufferGeometry {
	const pts = profile();
	const segments = 64;
	const arc = [0];
	for (let j = 1; j < pts.length; j++) {
		arc.push(arc[j - 1] + Math.hypot(pts[j].r - pts[j - 1].r, pts[j].y - pts[j - 1].y));
	}
	const outsideEnd = pts.findIndex((p) => !p.outside) - 1;
	const pos: number[] = [];
	const nrm: number[] = [];
	const uv: number[] = [];
	for (let j = 0; j < pts.length; j++) {
		const [prev, next] = [pts[Math.max(0, j - 1)], pts[Math.min(pts.length - 1, j + 1)]];
		// Down the outside and up the inside, (-dy, dr) points out of the metal.
		const [dr, dy] = [next.r - prev.r, next.y - prev.y];
		const len = Math.hypot(dr, dy);
		const v = pts[j].outside
			? arc[j] / arc[outsideEnd]
			: (arc[j] - arc[outsideEnd + 1]) / (arc.at(-1)! - arc[outsideEnd + 1]);
		for (let i = 0; i <= segments; i++) {
			const a = (i / segments) * Math.PI * 2;
			const [c, s] = [Math.cos(a), Math.sin(a)];
			pos.push(pts[j].r * c, pts[j].y, pts[j].r * s);
			nrm.push((-dy / len) * c, dr / len, (-dy / len) * s);
			uv.push(...inset(pts[j].outside ? BELL : INNER, i / segments, v));
		}
	}
	const index: number[] = [];
	const at = (j: number, i: number) => j * (segments + 1) + i;
	const [p, q] = [new THREE.Vector3(), new THREE.Vector3()];
	const vert = (k: number) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
	for (let j = 0; j < pts.length - 1; j++) {
		// The lip's rim joins outside to inside; the seam between them is sharp.
		if (j === outsideEnd) continue;
		for (let i = 0; i < segments; i++) {
			for (const tri of [
				[at(j, i), at(j + 1, i), at(j + 1, i + 1)],
				[at(j, i), at(j + 1, i + 1), at(j, i + 1)]
			]) {
				const [a, b, c] = tri.map(vert);
				const cross = p.subVectors(b, a).cross(q.subVectors(c, a));
				if (cross.lengthSq() < 1e-14) continue; // at the axis
				const n = new THREE.Vector3(nrm[tri[0] * 3], nrm[tri[0] * 3 + 1], nrm[tri[0] * 3 + 2]);
				index.push(...(cross.dot(n) >= 0 ? tri : [tri[0], tri[2], tri[1]]));
			}
		}
	}
	// The lip's underside, flat, its own vertices so its edges stay sharp.
	const base = pos.length / 3;
	for (const j of [outsideEnd, outsideEnd + 1]) {
		for (let i = 0; i <= segments; i++) {
			const a = (i / segments) * Math.PI * 2;
			pos.push(pts[j].r * Math.cos(a), pts[j].y, pts[j].r * Math.sin(a));
			nrm.push(0, -1, 0);
			uv.push(...inset(BELL, i / segments, 1));
		}
	}
	for (let i = 0; i < segments; i++) {
		const [a, b] = [base + i, base + segments + 1 + i];
		index.push(a, a + 1, b + 1, a, b + 1, b);
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	g.setIndex(index);
	return g;
}

function frame(): THREE.BufferGeometry[] {
	const parts: THREE.BufferGeometry[] = [];
	for (const x of [-1.36, 1.36]) {
		const side = Math.sign(x);
		// An A-shaped trestle: two raking legs, a sill, a collar, a cap under the tie beam.
		for (const z of [-1.25, 1.25]) parts.push(beam([x, 0.18, z], [x, 4.1, z * 0.16], 0.22));
		parts.push(part('box', [0.26, 0.2, 2.9], [x, 0.1, 0], WOOD));
		parts.push(part('box', [0.18, 0.18, 1.5], [x, 2.2, 0], WOOD));
		parts.push(part('box', [0.3, 0.26, 0.7], [x, 4.12, 0], WOOD));
		// The bearing the gudgeon turns in, and the iron that holds the joints.
		parts.push(part('box', [0.28, 0.34, 0.42], [x, PIVOT, 0], IRON));
		parts.push(part('box', [0.3, 0.07, 0.76], [x, 3.62, 0], IRON));
		parts.push(part('box', [0.3, 0.07, 1.6], [x, 2.2, 0], IRON));
		for (const z of [-1.2, 1.2]) parts.push(part('box', [0.3, 0.26, 0.07], [x, 0.14, z], IRON));
		for (const [y, z] of [
			[3.62, -0.26],
			[3.62, 0.26],
			[2.2, -0.55],
			[2.2, 0.55],
			[PIVOT, 0.12],
			[PIVOT, -0.12]
		]) {
			parts.push(
				part('cylinder', [0.08, 0.06, 0.08], [x + side * 0.16, y, z], IRON, [0, 0, Math.PI / 2])
			);
		}
		// Chains from the tie beam's ends down to rings in the floor.
		for (const z of [-1.3, 1.3]) {
			parts.push(
				...chain(new THREE.Vector3(side * 1.44, 4.26, 0), new THREE.Vector3(side * 1.44, 0.08, z))
			);
			parts.push(part('cylinder', [0.14, 0.08, 0.14], [side * 1.44, 0.04, z], IRON));
		}
	}
	parts.push(part('box', [3.0, 0.26, 0.28], [0, 4.38, 0], WOOD));
	for (const x of [-1.36, 1.36]) parts.push(part('box', [0.08, 0.34, 0.36], [x, 4.38, 0], IRON));
	return parts;
}

function swinging(): THREE.BufferGeometry[] {
	return [
		bell(),
		// The headstock the bell hangs from, its gudgeons, the straps down to the crown.
		part('box', [2.3, 0.3, 0.36], [0, PIVOT, 0], WOOD),
		part('cylinder', [0.11, 0.34, 0.11], [-1.2, PIVOT, 0], IRON, [0, 0, Math.PI / 2]),
		part('cylinder', [0.11, 0.34, 0.11], [1.2, PIVOT, 0], IRON, [0, 0, Math.PI / 2]),
		part('box', [0.1, 0.56, 0.4], [-0.3, 3.62, 0], IRON),
		part('box', [0.1, 0.56, 0.4], [0.3, 3.62, 0], IRON),
		part('box', [0.9, 0.08, 0.42], [0, 4.01, 0], IRON),
		// The clapper: a rod and its ball, inside.
		part('cylinder', [0.07, 1.75, 0.07], [0, 2.5, 0], IRON),
		part('sphere', [0.3, 0.34, 0.3], [0, 1.5, 0], IRON)
	];
}

// ---------------------------------------------------------------- export

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('Scene');

function node(name: string, geometry: THREE.BufferGeometry, material: Material) {
	const attr = (key: string, type: 'VEC2' | 'VEC3') =>
		doc
			.createAccessor()
			.setBuffer(buffer)
			.setType(type)
			.setArray(new Float32Array(geometry.getAttribute(key).array));
	const index = geometry.getIndex()!.array;
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', attr('position', 'VEC3'))
		.setAttribute('NORMAL', attr('normal', 'VEC3'))
		.setAttribute('TEXCOORD_0', attr('uv', 'VEC2'))
		.setIndices(
			doc
				.createAccessor()
				.setBuffer(buffer)
				.setType('SCALAR')
				.setArray(
					geometry.getAttribute('position').count > 65535
						? new Uint32Array(index)
						: new Uint16Array(index)
				)
		)
		.setMaterial(material);
	// Blender names mesh data apart from its object: the cook renames it to the node's role.
	scene.addChild(doc.createNode(name).setMesh(doc.createMesh(`${name}.001`).addPrimitive(prim)));
}

const maps = paint();
const png = (name: string, size: number, rgba: Uint8Array) =>
	doc
		.createTexture(name)
		.setMimeType('image/png')
		.setImage(encodePng(size, size, rgba, 'sub'));
// Occlusion, roughness and metal change slowly: half the size is a quarter of the download.
const half = fit({ width: SIZE, height: SIZE, data: maps.orm }, SIZE / 2);
const orm = png('bell-orm', SIZE / 2, half.data);
const bronze = doc
	.createMaterial('bell')
	.setBaseColorTexture(png('bell-albedo', SIZE, maps.albedo))
	.setNormalTexture(png('bell-normal', SIZE, maps.normal))
	.setOcclusionTexture(orm)
	.setMetallicRoughnessTexture(orm)
	.setMetallicFactor(1)
	.setRoughnessFactor(1)
	.setEmissiveTexture(png('bell-glow', GLOW, maps.glow))
	.setEmissiveFactor([0.2, 0.2, 0.2]);

const merged = (parts: THREE.BufferGeometry[]) => {
	const g = mergeGeometries(parts, false);
	if (!g) throw new Error('parts with different attributes');
	return g;
};
node('body', merged(frame()), bronze);
node('swing', merged(swinging()), bronze);

mkdirSync(DIR, { recursive: true });
const glb = await new NodeIO().writeBinary(doc);
writeFileSync(path.join(DIR, 'great-bell.glb'), glb);
const meta = {
	provenance: {
		license: 'LicenseRef-thirdfold-original',
		author: 'thirdfold contributors',
		modified: false
	},
	swing: { pivot: PIVOT, throw: 0.3 },
	setPiece: true,
	pack: 'cavern',
	textureSize: SIZE
};
writeFileSync(path.join(DIR, 'meta.json'), JSON.stringify(meta, null, '\t') + '\n');
console.log(`Wrote ${DIR}/great-bell.glb (${glb.length} B) and meta.json`);
