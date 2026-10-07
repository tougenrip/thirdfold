// The four character minis' pilot (#276), made in house the way the great bell's (#196) and the
// stone-halls kit's (#263) were, until docs/ART.md's character brief is commissioned: each
// character a sculpt of lathes, limbs and chamfered boxes (scripts/minis/figures.ts) standing as
// `body` and fallen as `body_pose1` (the downed pose, bent by a small rig: scripts/minis/mesh.ts),
// both on one painted atlas (scripts/minis/paint.ts: albedo with baked cavities and edge
// highlights, ORM with the tint mask in alpha), written as the GLB a Blender export would be into
// art/character/<id>/ with its meta.json. Same bytes every run on Node 22 (PNG deflate differs
// under other zlibs):
//   npx -y node@22 node_modules/tsx/dist/cli.mjs scripts/make-mini-art.ts
// then `npm run assets:cook` and `npm run assets`. The GLBs are gitignored; only the meta.json
// files are committed (docs/ASSETS.md, "The character minis' pilot").

import { Document, NodeIO, type Material } from '@gltf-transform/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { json } from '../server/assets/pipeline-files';
import { fit } from '../server/assets/cook-textures';
import { encodePng } from '../server/assets/png';
import { downedPose, type Figure } from './minis/body';
import { FIGURES } from './minis/figures';
import { boneMatrices, skin } from './minis/mesh';
import { paintAtlas } from './minis/paint';

/** The atlas is painted at this side, then boxed down to the sizes below. */
const SIZE = 512;
/**
 * The maps' sides. Not docs/ART.md's 1024 for the four characters: they stand on every table, so
 * every byte counts against each table's download budget (docs/ASSETS.md, "The character minis'
 * pilot"). Raise them with that budget.
 */
const ALBEDO_PX = 256;
const ORM_PX = 256;
/** The base's radius (0.43) and the 0.1 u a weapon or cloak may reach past it (docs/ART.md 7). */
const REACH = 0.53;
/** docs/ART.md section 7's 1-cell mini ceiling, held per pose. */
const MAX_TRIANGLES = 6000;
const PROVENANCE = {
	license: 'LicenseRef-thirdfold-original',
	author: 'thirdfold contributors',
	modified: false
};

const merged = (parts: THREE.BufferGeometry[]) => {
	const g = mergeGeometries(parts, false);
	if (!g) throw new Error('parts with different attributes');
	return g;
};

/** The figure fallen: its body bent by the downed pose and set on the base, what it held beside it. */
function downed(fig: Figure): THREE.BufferGeometry {
	const bones = boneMatrices(downedPose(fig.yaw));
	const body = fig.parts
		.filter((p) => !p.drop)
		.map((p) => {
			const g = p.mesh.geometry.clone();
			skin(g, bones, p.bone);
			return g;
		});
	const lying = merged(body);
	lying.computeBoundingBox();
	const { min, max } = lying.boundingBox!;
	lying.translate(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
	const dropped = fig.parts
		.filter((p) => p.drop)
		.map(({ mesh, held, drop }) =>
			mesh.geometry.clone().applyMatrix4(
				new THREE.Matrix4()
					.makeTranslation(new THREE.Vector3(...drop!.at))
					.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...drop!.turn)))
					.multiply(held!.clone().invert())
			)
		);
	return merged([lying, ...dropped]);
}

const problems: string[] = [];
/** Notes a problem unless `g` stands within the base and the triangle budget; returns its numbers. */
function check(id: string, pose: string, g: THREE.BufferGeometry) {
	const p = g.getAttribute('position');
	let [reach, top, bottom] = [0, 0, Infinity];
	for (let i = 0; i < p.count; i++) {
		reach = Math.max(reach, Math.hypot(p.getX(i), p.getZ(i)));
		top = Math.max(top, p.getY(i));
		bottom = Math.min(bottom, p.getY(i));
	}
	const triangles = g.getIndex()!.count / 3;
	if (reach > REACH) problems.push(`${id} ${pose}: reaches ${reach.toFixed(3)} u from the centre`);
	if (bottom < -1e-4) problems.push(`${id} ${pose}: goes ${(-bottom).toFixed(3)} u under the base`);
	if (triangles > MAX_TRIANGLES) problems.push(`${id} ${pose}: ${triangles} triangles`);
	return `${pose} ${triangles} triangles, ${top.toFixed(2)} u tall, reach ${reach.toFixed(2)}`;
}

async function glb(
	standing: THREE.BufferGeometry,
	fallen: THREE.BufferGeometry,
	maps: { albedo: Uint8Array; orm: Uint8Array }
) {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const scene = doc.createScene('Scene');
	const png = (name: string, rgba: Uint8Array, px: number) => {
		const small = fit({ width: SIZE, height: SIZE, data: rgba }, px);
		return doc
			.createTexture(name)
			.setMimeType('image/png')
			.setImage(encodePng(small.width, small.height, small.data, 'sub'));
	};
	const orm = png('mini-orm', maps.orm, ORM_PX);
	const material = doc
		.createMaterial('mini')
		.setBaseColorTexture(png('mini-albedo', maps.albedo, ALBEDO_PX))
		.setOcclusionTexture(orm)
		.setMetallicRoughnessTexture(orm)
		.setMetallicFactor(1)
		.setRoughnessFactor(1);
	const node = (name: string, g: THREE.BufferGeometry, m: Material) => {
		const attr = (key: string, type: 'VEC2' | 'VEC3') =>
			doc
				.createAccessor()
				.setBuffer(buffer)
				.setType(type)
				.setArray(new Float32Array(g.getAttribute(key).array));
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
					.setArray(new Uint16Array(g.getIndex()!.array))
			)
			.setMaterial(m);
		// Blender names mesh data apart from its object: the cook renames it to the node's role.
		scene.addChild(doc.createNode(name).setMesh(doc.createMesh(`${name}.001`).addPrimitive(prim)));
	};
	node('body', standing, material);
	node('body_pose1', fallen, material);
	return new NodeIO().writeBinary(doc);
}

for (const make of FIGURES) {
	const fig = make();
	const solids = fig.parts.flatMap((p) => (p.mesh.solid ? [p.mesh.solid] : []));
	const maps = paintAtlas(
		fig.parts.map((p) => ({ part: p.mesh, paint: p.paint })),
		fig.palette,
		solids,
		SIZE
	);
	const standing = merged(fig.parts.map((p) => p.mesh.geometry));
	const fallen = downed(fig);
	const facts = [check(fig.id, 'standing', standing), check(fig.id, 'downed', fallen)];
	const dir = path.join('art', 'character', fig.id);
	mkdirSync(dir, { recursive: true });
	const data = await glb(standing, fallen, maps);
	writeFileSync(path.join(dir, `${fig.id}.glb`), data);
	writeFileSync(
		path.join(dir, 'meta.json'),
		json({ provenance: PROVENANCE, poses: { downed: 1 } })
	);
	console.log(
		`${fig.id}: ${facts.join('; ')}; ${Math.round(maps.density)} px a unit; ${data.length} B`
	);
}
if (problems.length) {
	console.error(problems.join('\n'));
	process.exit(1);
}
