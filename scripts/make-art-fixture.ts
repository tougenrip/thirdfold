// Writes the cook's test art (cook.spec.ts): a prop as Blender would export
// it, a sphere `body` with a 16×16 albedo and normal map embedded as PNG, and
// a small `accent` box, plus its meta.json. Run it once with
// `npx -y node@22 node_modules/tsx/dist/cli.mjs scripts/make-art-fixture.ts`; the output
// is committed.

import { Document, NodeIO } from '@gltf-transform/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BoxGeometry, SphereGeometry, type BufferGeometry } from 'three';
import { encodePng } from '../server/assets/png';

const DIR = path.join('tests', 'fixtures', 'art', 'prop', 'test-orb');

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('Scene');

function mesh(
	name: string,
	geometry: BufferGeometry,
	material: ReturnType<Document['createMaterial']>
) {
	const attr = (key: string, type: 'VEC2' | 'VEC3') =>
		doc
			.createAccessor()
			.setBuffer(buffer)
			.setType(type)
			.setArray(new Float32Array(geometry.getAttribute(key).array));
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
				.setArray(new Uint16Array(geometry.getIndex()!.array))
		)
		.setMaterial(material);
	// Blender names mesh data apart from its object: the cook renames it to the node's role.
	return doc.createNode(name).setMesh(doc.createMesh(`${name}.001`).addPrimitive(prim));
}

const pixels = (f: (x: number, y: number) => number[]) => {
	const rgba = new Uint8Array(16 * 16 * 4);
	for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) rgba.set(f(x, y), (y * 16 + x) * 4);
	return encodePng(16, 16, rgba);
};
const albedo = doc
	.createTexture('albedo')
	.setMimeType('image/png')
	.setImage(pixels((x, y) => [120 + x * 8, 90 + y * 6, 60, 255]));
const normal = doc
	.createTexture('normal')
	.setMimeType('image/png')
	.setImage(pixels((x) => [128 + ((x % 4) - 2) * 20, 128, 250, 255]));

const stone = doc
	.createMaterial('stone')
	.setBaseColorTexture(albedo)
	.setNormalTexture(normal)
	.setRoughnessFactor(0.8);
const brass = doc
	.createMaterial('brass')
	.setBaseColorFactor([0.8, 0.6, 0.2, 1])
	.setMetallicFactor(1);

scene.addChild(mesh('body', new SphereGeometry(0.4, 32, 16), stone).setTranslation([0, 0.4, 0]));
scene.addChild(mesh('accent', new BoxGeometry(0.2, 0.1, 0.2), brass).setTranslation([0, 0.85, 0]));

mkdirSync(DIR, { recursive: true });
writeFileSync(path.join(DIR, 'test-orb.glb'), await new NodeIO().writeBinary(doc));
const meta = {
	provenance: { license: 'LicenseRef-thirdfold-original', author: 'thirdfold', modified: false },
	textureSize: 16
};
writeFileSync(path.join(DIR, 'meta.json'), JSON.stringify(meta, null, '\t') + '\n');
