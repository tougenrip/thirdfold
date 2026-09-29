import { readFileSync } from 'node:fs';
import {
	createDefaultContainer,
	KHR_DF_MODEL_ETC1S,
	KHR_SUPERCOMPRESSION_BASISLZ,
	write
} from 'ktx-parse';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/lib/assets/manifest';
import { checkGlb, writeGlb, type MeshData } from './glb';
import { checkKtx2 } from './ktx2';

// The cooked fixtures: scripts/make-asset-fixtures.ts makes them.
const COOKED = readFileSync('tests/fixtures/assets/cube-meshopt.glb');
const CHECKER = readFileSync('tests/fixtures/assets/checker.ktx2');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const triangle = (name = 'body'): MeshData => ({
	name,
	positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
	normals: null,
	colors: null,
	indices: new Uint16Array([0, 1, 2])
});
const PLAIN = writeGlb([triangle()]);

/** A GLB from its JSON and binary chunk. */
function glb(json: Json, bin: Buffer): Buffer {
	let text = JSON.stringify(json);
	while (text.length % 4) text += ' ';
	const header = Buffer.alloc(20);
	header.writeUInt32LE(0x46546c67, 0);
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(20 + text.length + 8 + bin.length, 8);
	header.writeUInt32LE(text.length, 12);
	header.writeUInt32LE(0x4e4f534a, 16);
	const binHeader = Buffer.alloc(8);
	binHeader.writeUInt32LE(bin.length, 0);
	binHeader.writeUInt32LE(0x004e4942, 4);
	return Buffer.concat([header, Buffer.from(text), binHeader, bin]);
}
const parts = (data: Buffer) => {
	const length = data.readUInt32LE(12);
	return {
		json: JSON.parse(data.subarray(20, 20 + length).toString('utf8')) as Json,
		bin: Buffer.from(data.subarray(28 + length))
	};
};
/** `data` with its JSON changed, and its binary chunk too if `editBin` says so. */
function edited(
	data: Buffer,
	edit: (json: Json) => void,
	editBin?: (bin: Buffer, json: Json) => void
) {
	const { json, bin } = parts(data);
	edit(json);
	editBin?.(bin, json);
	return glb(json, bin);
}
/** The plain triangle with a KTX2 image as its material's base colour. */
function withImage(ktx: Uint8Array): Buffer {
	const { json, bin } = parts(PLAIN);
	const offset = bin.length;
	const padded = Buffer.concat([bin, Buffer.from(ktx), Buffer.alloc((4 - (ktx.length % 4)) % 4)]);
	json.buffers[0].byteLength = padded.length;
	json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: ktx.length });
	json.images = [{ bufferView: json.bufferViews.length - 1, mimeType: 'image/ktx2' }];
	json.textures = [{ extensions: { KHR_texture_basisu: { source: 0 } } }];
	json.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
	json.meshes[0].primitives[0].material = 0;
	json.extensionsUsed = json.extensionsRequired = ['KHR_texture_basisu'];
	return glb(json, padded);
}
/** A KTX2 header that claims whatever it likes, with a few bytes of level data. */
function fakeKtx2(change: (c: ReturnType<typeof createDefaultContainer>) => void): Uint8Array {
	const c = createDefaultContainer();
	c.pixelWidth = c.pixelHeight = 8;
	c.levelCount = 1;
	c.supercompressionScheme = KHR_SUPERCOMPRESSION_BASISLZ;
	c.dataFormatDescriptor[0].colorModel = KHR_DF_MODEL_ETC1S;
	c.levels = [{ levelData: new Uint8Array(16), uncompressedByteLength: 0 }];
	change(c);
	return write(c);
}
const refused = async (data: Uint8Array, error: RegExp) =>
	expect(await checkGlb(data)).toEqual({ ok: false, error: expect.stringMatching(error) });

describe('checkGlb', () => {
	it('passes a cooked model: meshopt geometry, KTX2 colour and normal maps', async () => {
		const checked = await checkGlb(COOKED);
		expect(checked).toMatchObject({
			ok: true,
			info: {
				meshes: ['body'],
				triangles: 12,
				lods: [],
				cooked: true,
				textures: [
					{ width: 8, height: 8, levels: 4, codec: 'etc1s', colorSpace: 'srgb' },
					{ width: 8, height: 8, levels: 4, codec: 'uastc', colorSpace: 'linear' }
				]
			}
		});
		// Quantised positions come back through the node's transform.
		const { bounds } = checked.ok ? checked.info : { bounds: null };
		[-0.5, 0, -0.5].forEach((v, i) => expect(bounds!.min[i]).toBeCloseTo(v, 3));
		[0.5, 1, 0.5].forEach((v, i) => expect(bounds!.max[i]).toBeCloseTo(v, 3));
	});

	it('passes plain meshes, with bounds through node transforms and levels of detail counted', async () => {
		expect(await checkGlb(PLAIN)).toMatchObject({
			ok: true,
			info: { triangles: 1, cooked: false }
		});
		const moved = edited(PLAIN, (j) => (j.nodes[0].translation = [2, 0, 0]));
		expect(await checkGlb(moved)).toMatchObject({
			ok: true,
			info: { bounds: { min: [2, 0, 0], max: [3, 1, 0] } }
		});
		const lod = writeGlb([triangle(), triangle('body_lod1'), triangle('accent')]);
		expect(await checkGlb(lod)).toMatchObject({
			ok: true,
			info: { meshes: ['body', 'body_lod1', 'accent'], triangles: 2, lods: [1] }
		});
		expect(await checkGlb(withImage(CHECKER))).toMatchObject({ ok: true, info: { cooked: true } });
	});

	it('refuses links out of the file', async () => {
		await refused(
			edited(COOKED, (j) => (j.images[0] = { uri: 'x.ktx2', mimeType: 'image/ktx2' })),
			/URIs are not allowed/
		);
		await refused(
			edited(PLAIN, (j) => (j.buffers[0].uri = 'data:,x')),
			/URIs are not allowed/
		);
	});

	it('refuses extensions off the allowlist, wherever they are', async () => {
		await refused(
			edited(COOKED, (j) => j.extensionsUsed.push('KHR_lights_punctual')),
			/extension KHR_lights_punctual is not allowed/
		);
		await refused(
			edited(COOKED, (j) => (j.materials[0].extensions = { KHR_materials_clearcoat: {} })),
			/extension KHR_materials_clearcoat is not allowed/
		);
		await refused(
			edited(PLAIN, (j) => (j.extensionsRequired = ['KHR_draco_mesh_compression'])),
			/KHR_draco_mesh_compression is not allowed/
		);
		// Allowed by glTF, but the client doesn't honour them yet: refused until it does.
		await refused(
			edited(COOKED, (j) => {
				j.extensionsUsed.push('KHR_texture_transform');
				j.materials[0].pbrMetallicRoughness.baseColorTexture.extensions = {
					KHR_texture_transform: { scale: [2, 2] }
				};
			}),
			/extension KHR_texture_transform is not allowed/
		);
		await refused(
			edited(COOKED, (j) => (j.materials[0].alphaMode = 'MASK')),
			/alphaMode must be OPAQUE/
		);
		await refused(
			edited(COOKED, (j) => (j.materials[0].pbrMetallicRoughness.baseColorTexture.texCoord = 1)),
			/only texCoord 0/
		);
		await refused(
			edited(PLAIN, (j) => {
				j.accessors.push({ ...j.accessors[0], type: 'VEC2', min: undefined, max: undefined });
				j.meshes[0].primitives[0].attributes.TEXCOORD_1 = j.accessors.length - 1;
			}),
			/attribute TEXCOORD_1 is not allowed/
		);
		// three reads KHR_meshopt_compression too, but gltf-transform 4.5.1 cannot decode it to check.
		await refused(
			edited(COOKED, (j) => (j.extensionsUsed = ['KHR_meshopt_compression'])),
			/KHR_meshopt_compression is not allowed/
		);
	});

	it('refuses skins, animations, cameras and morph targets', async () => {
		await refused(
			edited(PLAIN, (j) => (j.skins = [])),
			/"skins" is not allowed/
		);
		await refused(
			edited(PLAIN, (j) => (j.animations = [])),
			/"animations" is not allowed/
		);
		await refused(
			edited(PLAIN, (j) => (j.cameras = [])),
			/"cameras" is not allowed/
		);
		await refused(
			edited(PLAIN, (j) => (j.nodes[0].camera = 0)),
			/node 0: "camera"/
		);
		await refused(
			edited(PLAIN, (j) => (j.nodes[0].skin = 0)),
			/node 0: "skin"/
		);
		await refused(
			edited(PLAIN, (j) => (j.meshes[0].primitives[0].targets = [{ POSITION: 0 }])),
			/"targets" is not allowed/
		);
	});

	it('refuses textures over the class limit, as data where colour goes, or with a fallback', async () => {
		const huge = fakeKtx2((c) => (c.pixelWidth = c.pixelHeight = 16384));
		expect(await checkGlb(withImage(huge))).toEqual({
			ok: false,
			error: expect.stringMatching(/16384×16384 is larger than 2048 pixels/)
		});
		expect(await checkGlb(withImage(CHECKER), { ...LIMITS.prop, px: 4 })).toMatchObject({
			ok: false
		});
		const normalAsColour = (j: Json) =>
			(j.materials[0].pbrMetallicRoughness.baseColorTexture.index = 1);
		await refused(edited(COOKED, normalAsColour), /used as both colour and data/);
		await refused(
			edited(COOKED, (j) => {
				normalAsColour(j);
				delete j.materials[0].normalTexture;
			}),
			/declared linear where srgb is needed/
		);
		await refused(
			edited(COOKED, (j) => (j.textures[0].source = 0)),
			/texture: "source"/
		);
		await refused(
			edited(COOKED, (j) => (j.images[0].mimeType = 'image/png')),
			/must be KTX2/
		);
	});

	it('refuses data that lies about its size', async () => {
		await refused(
			edited(PLAIN, (j) => (j.accessors[0].count = 1000)),
			/runs past its buffer view/
		);
		await refused(
			edited(PLAIN, (j) => (j.bufferViews[0].byteLength = 1e6)),
			/past its buffer/
		);
		// A decode bomb: a meshopt view that says it decodes to 2 GB, refused before decoding.
		await refused(
			edited(COOKED, (j) => {
				Object.assign(j.bufferViews[3].extensions.EXT_meshopt_compression, {
					count: 2 ** 27,
					byteStride: 16
				});
			}),
			/meshopt data decodes past/
		);
		await refused(
			edited(COOKED, (j) => (j.buffers[1].byteLength = 2 ** 31)),
			/meshopt data decodes past/
		);
		// Many accessors over one view: each would be copied out when decoded.
		const small = { ...LIMITS.prop, gpuBytes: 100 };
		const copies = edited(PLAIN, (j) => j.accessors.push(j.accessors[0], j.accessors[0]));
		expect(await checkGlb(copies, small)).toEqual({
			ok: false,
			error: 'accessors hold more than 100 bytes'
		});
		// The whole gate is checkGlb's own: the GPU bytes with textures, and every level's triangles.
		expect(await checkGlb(withImage(CHECKER), small)).toEqual({
			ok: false,
			error: 'too large on the GPU'
		});
		const two = { ...triangle('body_lod1'), indices: new Uint16Array([0, 1, 2, 0, 2, 1]) };
		expect(await checkGlb(writeGlb([triangle(), two]), { ...LIMITS.prop, triangles: 1 })).toEqual({
			ok: false,
			error: 'LOD 1: 2 triangles is more than 1'
		});
		await refused(
			edited(PLAIN, (j) => (j.asset.generator = 'x'.repeat(300_000))),
			/JSON chunk over/
		);
	});

	it('refuses an index past the vertices, found once decoded', async () => {
		const past = edited(
			PLAIN,
			() => {},
			(bin, j) => bin.writeUInt16LE(99, j.bufferViews[j.accessors[1].bufferView].byteOffset)
		);
		await refused(past, /index past the vertices/);
	});

	it('refuses names off the roles, and node trees that are not trees', async () => {
		await refused(writeGlb([triangle('body.lod1')]), /mesh "body\.lod1" must be named/);
		await refused(
			edited(PLAIN, (j) => (j.nodes[0].name = 'Cube')),
			/node "Cube" must be named/
		);
		await refused(
			edited(PLAIN, (j) => {
				j.nodes.push({ name: 'a', children: [2] }, { name: 'b', children: [1] });
			}),
			/cycle/
		);
		await refused(
			edited(PLAIN, (j) => (j.nodes[0].children = [0])),
			/one parent/
		);
	});

	it('refuses what is not a GLB, or has more after it', async () => {
		await refused(Buffer.from('not a model at all, just text'), /not a GLB/);
		const longer = Buffer.concat([PLAIN, Buffer.alloc(4)]);
		longer.writeUInt32LE(longer.length, 8);
		await refused(longer, /trailing or missing data/);
		expect(await checkGlb(PLAIN, { ...LIMITS.prop, bytes: 100 })).toEqual({
			ok: false,
			error: 'file too large'
		});
	});
});

describe('checkKtx2', () => {
	const rules = { maxPx: 2048, maxGpuBytes: LIMITS.texture.gpuBytes };

	it('passes an ETC1S texture and reads its header', () => {
		expect(checkKtx2(CHECKER, { ...rules, colorSpace: 'srgb' })).toEqual({
			ok: true,
			info: {
				width: 8,
				height: 8,
				levels: 4,
				layers: 1,
				faces: 1,
				codec: 'etc1s',
				colorSpace: 'srgb',
				gpuBytes: 86
			}
		});
	});

	it('refuses malformed files', () => {
		const header = (at: number, value: number) => {
			const copy = Buffer.from(CHECKER);
			copy.writeUInt32LE(value, at);
			return checkKtx2(copy, rules);
		};
		expect(checkKtx2(Buffer.from('not a texture at all, nor anything like one'), rules)).toEqual({
			ok: false,
			error: 'not a KTX2 file'
		});
		expect(checkKtx2(CHECKER.subarray(0, 90), rules)).toMatchObject({
			error: expect.stringMatching(/truncated level index/)
		});
		expect(header(80 + 8, 1e6)).toMatchObject({
			error: expect.stringMatching(/level 0 runs past/)
		});
		expect(header(44, 3)).toMatchObject({ error: expect.stringMatching(/supercompression 3/) });
		expect(header(40, 9)).toMatchObject({ error: expect.stringMatching(/9 mip levels/) });
		expect(header(12, 37)).toMatchObject({ error: expect.stringMatching(/Basis Universal/) });
		expect(
			checkKtx2(
				fakeKtx2((c) => (c.pixelWidth = 6)),
				rules
			)
		).toMatchObject({
			error: expect.stringMatching(/not a multiple of 4/)
		});
		expect(
			checkKtx2(
				fakeKtx2((c) => (c.supercompressionScheme = 0)),
				rules
			)
		).toMatchObject({ error: expect.stringMatching(/ETC1S goes with BasisLZ/) });
	});

	it('refuses the wrong colour space, and a cube or an array where none is allowed', () => {
		expect(checkKtx2(CHECKER, { ...rules, colorSpace: 'linear' })).toMatchObject({
			error: expect.stringMatching(/declared srgb where linear is needed/)
		});
		const cube = Buffer.from(CHECKER);
		cube.writeUInt32LE(6, 36);
		expect(checkKtx2(cube, rules)).toMatchObject({ error: expect.stringMatching(/6 faces/) });
		expect(checkKtx2(cube, { ...rules, cube: true })).toMatchObject({
			ok: true,
			info: { faces: 6 }
		});
		const tall = fakeKtx2((c) => {
			c.pixelHeight = 12;
			c.faceCount = 6;
		});
		expect(checkKtx2(tall, { ...rules, cube: true })).toMatchObject({
			error: expect.stringMatching(/faces are square/)
		});
		const array = Buffer.from(CHECKER);
		array.writeUInt32LE(4, 32);
		expect(checkKtx2(array, rules)).toMatchObject({ error: expect.stringMatching(/4 layers/) });
		expect(checkKtx2(array, { ...rules, maxLayers: 32 })).toMatchObject({ info: { layers: 4 } });
	});
});
