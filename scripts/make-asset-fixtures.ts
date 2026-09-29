// Tiny cooked assets for tests: a meshopt-compressed cube with KTX2 textures,
// and a standalone 8×8 ETC1S KTX2, both deterministic (same bytes every run).
//   npx -y node@22 node_modules/tsx/dist/cli.mjs scripts/make-asset-fixtures.ts
// writes tests/fixtures/assets/cube-meshopt.glb and checker.ktx2.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import {
	EXTMeshoptCompression,
	KHRMeshQuantization,
	KHRTextureBasisu
} from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { encodeToKTX2 } from 'ktx2-encoder';
import { MeshoptEncoder } from 'meshoptimizer';

const OUT = path.join('tests', 'fixtures', 'assets');
const SIZE = 8;

/** An 8×8 RGBA image from a colour per pixel. */
function image(color: (x: number, y: number) => [number, number, number]): Uint8Array {
	const data = new Uint8Array(SIZE * SIZE * 4);
	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			data.set([...color(x, y), 255], (y * SIZE + x) * 4);
		}
	}
	return data;
}

/** KTX2 from raw RGBA: ETC1S for colour (BasisLZ), UASTC with Zstd for data. */
async function ktx2(rgba: Uint8Array, srgb: boolean): Promise<Uint8Array> {
	return encodeToKTX2(rgba, {
		isUASTC: !srgb,
		needSupercompression: !srgb,
		qualityLevel: 128,
		generateMipmap: true,
		isPerceptual: srgb,
		isSetKTX2SRGBTransferFunc: srgb,
		isNormalMap: !srgb,
		imageDecoder: async (data) => ({ width: SIZE, height: SIZE, data })
	});
}

/** A unit cube on the floor, each face with its own vertices and UVs. */
function cube(doc: Document, checker: Uint8Array, normal: Uint8Array) {
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	for (let axis = 0; axis < 3; axis++) {
		for (const sign of [-1, 1]) {
			const base = positions.length / 3;
			const u = (axis + 1) % 3;
			const v = (axis + 2) % 3;
			for (const [a, b] of [
				[-1, -1],
				[1, -1],
				[1, 1],
				[-1, 1]
			]) {
				const p = [0, 0, 0];
				p[axis] = sign * 0.5;
				p[u] = a * 0.5;
				p[v] = b * 0.5 * sign;
				p[1] += 0.5;
				positions.push(...p);
				const n = [0, 0, 0];
				n[axis] = sign;
				normals.push(...n);
				uvs.push((a + 1) / 2, (b + 1) / 2);
			}
			indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
		}
	}
	const buffer = doc.createBuffer();
	const accessor = (type: 'VEC2' | 'VEC3' | 'SCALAR', array: Float32Array | Uint16Array) =>
		doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
	const material = doc
		.createMaterial('checker')
		.setBaseColorTexture(doc.createTexture('checker').setMimeType('image/ktx2').setImage(checker))
		.setNormalTexture(doc.createTexture('flat').setMimeType('image/ktx2').setImage(normal));
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', accessor('VEC3', new Float32Array(positions)))
		.setAttribute('NORMAL', accessor('VEC3', new Float32Array(normals)))
		.setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(uvs)))
		.setIndices(accessor('SCALAR', new Uint16Array(indices)))
		.setMaterial(material);
	const mesh = doc.createMesh('body').addPrimitive(prim);
	doc.createScene().addChild(doc.createNode('body').setMesh(mesh));
}

const checker = await ktx2(
	image((x, y) => ((x + y) % 2 ? [230, 200, 120] : [60, 40, 30])),
	true
);
const normal = await ktx2(
	image(() => [128, 128, 255]),
	false
);

await MeshoptEncoder.ready;
const doc = new Document();
doc.createExtension(KHRTextureBasisu).setRequired(true);
cube(doc, checker, normal);
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
const io = new NodeIO()
	.registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, KHRTextureBasisu])
	.registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const glb = await io.writeBinary(doc);

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'cube-meshopt.glb'), glb);
writeFileSync(path.join(OUT, 'checker.ktx2'), checker);
console.log(`Wrote ${OUT}: cube-meshopt.glb (${glb.length} B), checker.ktx2 (${checker.length} B)`);
