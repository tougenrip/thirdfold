// The cooked model the client loader's test loads (src/lib/tabletop/models.svelte.spec.ts, #188):
// meshopt geometry and one 8×8 KTX2 texture, with node transforms, two pieces of body to merge,
// a coarser level and an untextured swinging part, as #186's cook will make them. Tiny, so the
// RGBA fallback a GPU without compressed formats transcodes to (SwiftShader) stays small.
// Rebuild it after an encoder upgrade (Node 22, as the asset build):
//   npx -y node@22 node_modules/tsx/dist/cli.mjs server/fixtures/loader-fixture.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Document, NodeIO, type Material } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { encodeToKTX2 } from 'ktx2-encoder';
import { MeshoptEncoder } from 'meshoptimizer';

export const LOADER_FIXTURE = path.join('tests', 'fixtures', 'assets', 'loader', 'cube.glb');

/** A box `size` across on the floor, 24 vertices (a face each, for flat normals) with uvs. */
function box(doc: Document, name: string, size: number, material: Material) {
	const h = size / 2;
	const faces: [number[], number[], number[]][] = [
		// normal, u axis, v axis
		[
			[1, 0, 0],
			[0, 0, -1],
			[0, 1, 0]
		],
		[
			[-1, 0, 0],
			[0, 0, 1],
			[0, 1, 0]
		],
		[
			[0, 1, 0],
			[1, 0, 0],
			[0, 0, -1]
		],
		[
			[0, -1, 0],
			[1, 0, 0],
			[0, 0, 1]
		],
		[
			[0, 0, 1],
			[1, 0, 0],
			[0, 1, 0]
		],
		[
			[0, 0, -1],
			[-1, 0, 0],
			[0, 1, 0]
		]
	];
	const position: number[] = [];
	const normal: number[] = [];
	const uv: number[] = [];
	const index: number[] = [];
	faces.forEach(([n, u, v], f) => {
		for (const [su, sv] of [
			[-1, -1],
			[1, -1],
			[1, 1],
			[-1, 1]
		]) {
			for (let i = 0; i < 3; i++)
				position.push((n[i] + u[i] * su + v[i] * sv) * h + (i === 1 ? h : 0));
			normal.push(...n);
			uv.push((su + 1) / 2, (1 - sv) / 2);
		}
		index.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3);
	});
	const buffer = doc.getRoot().listBuffers()[0];
	const accessor = (type: 'VEC3' | 'VEC2' | 'SCALAR', array: Float32Array | Uint16Array) =>
		doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
	const primitive = doc
		.createPrimitive()
		.setAttribute('POSITION', accessor('VEC3', new Float32Array(position)))
		.setAttribute('NORMAL', accessor('VEC3', new Float32Array(normal)))
		.setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(uv)))
		.setIndices(accessor('SCALAR', new Uint16Array(index)))
		.setMaterial(material);
	return doc.createMesh(name).addPrimitive(primitive);
}

/** An 8×8 checker of two colours, as raw RGBA. */
function checker(): Uint8Array {
	const data = new Uint8Array(8 * 8 * 4);
	for (let i = 0; i < 64; i++) {
		const on = ((i % 8) + Math.floor(i / 8)) % 2 === 0;
		data.set(on ? [200, 60, 40, 255] : [240, 220, 180, 255], i * 4);
	}
	return data;
}

export async function loaderFixture(): Promise<Uint8Array> {
	const ktx2 = await encodeToKTX2(new Uint8Array(1), {
		isUASTC: false,
		generateMipmap: true,
		isKTX2File: true,
		isPerceptual: true,
		isSetKTX2SRGBTransferFunc: true,
		// The raster itself: the encoder is handed it, not a PNG.
		imageDecoder: async () => ({ width: 8, height: 8, data: checker() })
	});
	const doc = new Document();
	doc.createBuffer();
	doc.createExtension(KHRTextureBasisu).setRequired(true);
	const texture = doc.createTexture('checker').setMimeType('image/ktx2').setImage(ktx2);
	const painted = doc
		.createMaterial('painted')
		.setBaseColorTexture(texture)
		.setRoughnessFactor(0.6)
		.setMetallicFactor(0);
	const plain = doc.createMaterial('plain').setBaseColorFactor([0.3, 0.3, 0.3, 1]);
	const scene = doc.createScene();
	// The body stands 0.25 off the floor by its node, so bounds must include the transform.
	const body = doc.createNode('body').setMesh(box(doc, 'body', 0.5, painted));
	body.setTranslation([0, 0.25, 0]);
	// A second piece of body in the same material, which the loader merges into the first.
	const knob = doc.createNode('body').setMesh(box(doc, 'body', 0.2, painted));
	knob.setTranslation([0, 0.25, 0.3]);
	const lod = doc.createNode('body_lod1').setMesh(box(doc, 'body_lod1', 0.5, painted));
	const swing = doc.createNode('swing').setMesh(box(doc, 'swing', 0.2, plain));
	swing.setTranslation([0, 1, 0]);
	for (const node of [body, knob, lod, swing]) scene.addChild(node);
	await MeshoptEncoder.ready;
	await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
	const io = new NodeIO()
		.registerExtensions(ALL_EXTENSIONS)
		.registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
	return io.writeBinary(doc);
}

if (process.argv[1]?.endsWith('loader-fixture.ts')) {
	const glb = await loaderFixture();
	mkdirSync(path.dirname(LOADER_FIXTURE), { recursive: true });
	writeFileSync(LOADER_FIXTURE, glb);
	console.log(`Wrote ${LOADER_FIXTURE} (${glb.length} bytes).`);
}
