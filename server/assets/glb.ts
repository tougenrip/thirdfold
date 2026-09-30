// Binary glTF (GLB) for models: writing what the pipeline bakes, and
// checking what an author provides or the cook makes. A model is meshes,
// materials and KTX2 textures in one file, and nothing else: no links out
// of it, no extension off the allowlist (gltf-check.ts), no cameras, skins,
// animations or morph targets. The check runs in two stages: the JSON as an
// allowlist before anything is decoded, then the decoded data (index ranges,
// triangles per level of detail, bounds through the node transforms, every
// texture's KTX2 header). Pure over bytes, so an upload path can reuse it.

import { NodeIO, type Texture } from '@gltf-transform/core';
import {
	EXTMeshoptCompression,
	KHRMaterialsEmissiveStrength,
	KHRMeshQuantization,
	KHRTextureBasisu,
	KHRTextureTransform
} from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { LIMITS, type ColorSpace, type Limit } from '../../src/lib/assets/manifest';
import { MAX_JSON_BYTES, gltfProblem } from './gltf-check';
import { checkKtx2, type Ktx2Info } from './ktx2';

/** One mesh of a model: `body`, `swing` (the parts that swing) or `accent` (tinted with the token's colour). */
export interface MeshData {
	name: string;
	positions: Float32Array;
	/** Per-vertex normals, or none: the client works them out (every hard edge has its own vertices). */
	normals: Float32Array | null;
	/** Linear RGB per vertex (0..1), or none (white). */
	colors: Float32Array | null;
	/** Baked occlusion and convexity per vertex (bake.ts), two bytes each, written as `_BAKE`. */
	bake?: Uint8Array;
	indices: Uint16Array | Uint32Array;
}

const MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK = 0x4e4f534a; // 'JSON'
const BIN_CHUNK = 0x004e4942; // 'BIN\0'
const FLOAT = 5126;
const UNSIGNED_BYTE = 5121;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

const pad4 = (n: number) => (n + 3) & ~3;

/** A GLB holding these meshes, each on its own node. */
export function writeGlb(meshes: readonly MeshData[]): Buffer {
	const views: {
		buffer: 0;
		byteOffset: number;
		byteLength: number;
		byteStride?: number;
		target: number;
	}[] = [];
	const accessors: Record<string, unknown>[] = [];
	const chunks: Buffer[] = [];
	let offset = 0;
	const add = (data: ArrayBufferView, target: number, byteStride?: number): number => {
		const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
		const length = pad4(bytes.length);
		chunks.push(Buffer.concat([bytes, Buffer.alloc(length - bytes.length)]));
		const stride = byteStride ? { byteStride } : {};
		views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...stride, target });
		offset += length;
		return views.length - 1;
	};
	const glMeshes = meshes.map((m) => {
		const count = m.positions.length / 3;
		const min = [Infinity, Infinity, Infinity];
		const max = [-Infinity, -Infinity, -Infinity];
		for (let i = 0; i < m.positions.length; i++) {
			min[i % 3] = Math.min(min[i % 3], m.positions[i]);
			max[i % 3] = Math.max(max[i % 3], m.positions[i]);
		}
		const attributes: Record<string, number> = {};
		accessors.push({
			bufferView: add(m.positions, ARRAY_BUFFER),
			componentType: FLOAT,
			count,
			type: 'VEC3',
			min,
			max
		});
		attributes.POSITION = accessors.length - 1;
		if (m.normals) {
			accessors.push({
				bufferView: add(m.normals, ARRAY_BUFFER),
				componentType: FLOAT,
				count,
				type: 'VEC3'
			});
			attributes.NORMAL = accessors.length - 1;
		}
		if (m.colors) {
			// Normalised 16-bit RGBA: precise enough in the darks, where 8 bits band.
			const rgba = new Uint16Array(count * 4);
			for (let i = 0; i < count; i++) {
				for (let c = 0; c < 3; c++) {
					rgba[i * 4 + c] = Math.round(Math.min(Math.max(m.colors[i * 3 + c], 0), 1) * 65535);
				}
				rgba[i * 4 + 3] = 65535;
			}
			accessors.push({
				bufferView: add(rgba, ARRAY_BUFFER),
				componentType: UNSIGNED_SHORT,
				normalized: true,
				count,
				type: 'VEC4'
			});
			attributes.COLOR_0 = accessors.length - 1;
		}
		if (m.bake) {
			// Two bytes a vertex in a stride of four: glTF aligns each vertex's attribute to 4 bytes.
			const padded = new Uint8Array(count * 4);
			for (let i = 0; i < count; i++) padded.set(m.bake.subarray(i * 2, i * 2 + 2), i * 4);
			accessors.push({
				bufferView: add(padded, ARRAY_BUFFER, 4),
				componentType: UNSIGNED_BYTE,
				normalized: true,
				count,
				type: 'VEC2'
			});
			attributes._BAKE = accessors.length - 1;
		}
		accessors.push({
			bufferView: add(m.indices, ELEMENT_ARRAY_BUFFER),
			componentType: m.indices instanceof Uint16Array ? UNSIGNED_SHORT : UNSIGNED_INT,
			count: m.indices.length,
			type: 'SCALAR'
		});
		return { name: m.name, primitives: [{ attributes, indices: accessors.length - 1, mode: 4 }] };
	});
	const bin = Buffer.concat(chunks);
	const json = {
		asset: { version: '2.0', generator: 'thirdfold asset pipeline' },
		scene: 0,
		scenes: [{ nodes: meshes.map((_, i) => i) }],
		nodes: meshes.map((m, i) => ({ name: m.name, mesh: i })),
		meshes: glMeshes,
		accessors,
		bufferViews: views,
		buffers: [{ byteLength: bin.length }]
	};
	const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
	const jsonChunk = Buffer.concat([
		jsonBytes,
		Buffer.alloc(pad4(jsonBytes.length) - jsonBytes.length, 0x20)
	]);
	const header = Buffer.alloc(12);
	const total = 12 + 8 + jsonChunk.length + 8 + bin.length;
	header.writeUInt32LE(MAGIC, 0);
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(total, 8);
	const chunkHeader = (length: number, type: number) => {
		const h = Buffer.alloc(8);
		h.writeUInt32LE(length, 0);
		h.writeUInt32LE(type, 4);
		return h;
	};
	return Buffer.concat([
		header,
		chunkHeader(jsonChunk.length, JSON_CHUNK),
		jsonChunk,
		chunkHeader(bin.length, BIN_CHUNK),
		bin
	]);
}

export interface GlbInfo {
	/** The names of the nodes that carry meshes, in order: `<role>` or `<role>_lod<n>`. */
	meshes: string[];
	/** At LOD0. */
	triangles: number;
	/** Triangles at LOD1 and LOD2, when the model has them. */
	lods: number[];
	/** Around every vertex, through the node transforms. */
	bounds: { min: [number, number, number]; max: [number, number, number] };
	textures: Ktx2Info[];
	/** Decoded vertex and index arrays, and the textures transcoded. */
	gpuBytes: number;
	/** Meshopt geometry or KTX2 textures, which the client needs its decoders for. */
	cooked: boolean;
}

type Checked = { ok: true; info: GlbInfo } | { ok: false; error: string };

let reader: Promise<NodeIO> | null = null;
/** Reads only the allowlisted extensions, decoding meshopt with the decoder three's loader uses. */
const io = () =>
	(reader ??= MeshoptDecoder.ready.then(() =>
		new NodeIO()
			.registerExtensions([
				EXTMeshoptCompression,
				KHRMeshQuantization,
				KHRTextureBasisu,
				KHRTextureTransform,
				KHRMaterialsEmissiveStrength
			])
			.registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
	));

const LOD = /_lod(\d)$/;
const COOKED = new Set(['EXT_meshopt_compression', 'KHR_texture_basisu']);

/** Whether `data` is a model within `limit` (its class's; a prop's by default), and what it holds. */
export async function checkGlb(data: Uint8Array, limit: Limit = LIMITS.prop): Promise<Checked> {
	const bad = (error: string): Checked => ({ ok: false, error });
	if (data.length > limit.bytes) return bad('file too large');
	if (data.length < 20) return bad('not a GLB file');
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const u32 = (at: number) => view.getUint32(at, true);
	if (u32(0) !== MAGIC) return bad('not a GLB file');
	if (u32(4) !== 2) return bad('not glTF 2.0');
	if (u32(8) !== data.length) return bad('length does not match');
	const jsonLength = u32(12);
	if (u32(16) !== JSON_CHUNK || 20 + jsonLength > data.length) return bad('no JSON chunk first');
	if (jsonLength > MAX_JSON_BYTES) return bad(`JSON chunk over ${MAX_JSON_BYTES} bytes`);
	let json: unknown;
	try {
		json = JSON.parse(Buffer.from(data.subarray(20, 20 + jsonLength)).toString('utf8'));
	} catch {
		return bad('JSON chunk does not parse');
	}
	if (typeof json !== 'object' || json === null || Array.isArray(json)) {
		return bad('JSON chunk is not an object');
	}
	const binStart = 20 + jsonLength;
	if (binStart + 8 > data.length || u32(binStart + 4) !== BIN_CHUNK) return bad('no binary chunk');
	const binLength = u32(binStart);
	if (binStart + 8 + binLength !== data.length) return bad('trailing or missing data');
	const problem = gltfProblem(json as Record<string, unknown>, binLength, limit);
	if (problem) return bad(problem);

	let doc;
	try {
		doc = await (await io()).readBinary(data);
	} catch (err) {
		return bad(`does not decode: ${(err as Error).message}`);
	}
	const root = doc.getRoot();
	const meshes: string[] = [];
	const levels = [0, 0, 0];
	const min: [number, number, number] = [Infinity, Infinity, Infinity];
	const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
	const p = [0, 0, 0];
	for (const node of root.listNodes()) {
		const mesh = node.getMesh();
		if (!mesh) continue;
		meshes.push(node.getName());
		const lod = Number(LOD.exec(mesh.getName())?.[1] ?? 0);
		const m = node.getWorldMatrix();
		for (const prim of mesh.listPrimitives()) {
			const position = prim.getAttribute('POSITION')!;
			const count = position.getCount();
			const indices = prim.getIndices();
			const corners = indices ? indices.getCount() : count;
			if (corners % 3) return bad('triangles need three corners each');
			const array = indices?.getArray() ?? [];
			for (let i = 0; i < array.length; i++) {
				if (array[i] >= count) return bad('an index past the vertices');
			}
			levels[lod] += corners / 3;
			for (let i = 0; i < count; i++) {
				position.getElement(i, p);
				for (let axis = 0; axis < 3; axis++) {
					const w = m[axis] * p[0] + m[4 + axis] * p[1] + m[8 + axis] * p[2] + m[12 + axis];
					min[axis] = Math.min(min[axis], w);
					max[axis] = Math.max(max[axis], w);
				}
			}
		}
	}
	if (![...min, ...max].every(Number.isFinite)) return bad('bad bounds');

	// Each texture's colour space by the slots it fills: colour is sRGB, data linear.
	const spaces = new Map<Texture, ColorSpace>();
	const slot = (texture: Texture | null, space: ColorSpace) => {
		if (!texture) return true;
		if ((spaces.get(texture) ?? space) !== space) return false;
		spaces.set(texture, space);
		return true;
	};
	for (const material of root.listMaterials()) {
		const fits =
			slot(material.getBaseColorTexture(), 'srgb') &&
			slot(material.getEmissiveTexture(), 'srgb') &&
			slot(material.getNormalTexture(), 'linear') &&
			slot(material.getOcclusionTexture(), 'linear') &&
			slot(material.getMetallicRoughnessTexture(), 'linear');
		if (!fits) return bad('a texture used as both colour and data');
	}
	let gpuBytes = 0;
	for (const accessor of root.listAccessors()) gpuBytes += accessor.getArray()?.byteLength ?? 0;
	const textures: Ktx2Info[] = [];
	for (const texture of root.listTextures()) {
		const checked = checkKtx2(texture.getImage() ?? new Uint8Array(), {
			maxPx: limit.px,
			maxGpuBytes: limit.gpuBytes,
			colorSpace: spaces.get(texture)
		});
		if (!checked.ok) return bad(`texture "${texture.getName()}": ${checked.error}`);
		textures.push(checked.info);
		gpuBytes += checked.info.gpuBytes;
	}
	// The whole gate here, so an upload gets it too: every level within the class's triangles.
	for (const [lod, triangles] of levels.entries()) {
		if (triangles > limit.triangles) {
			const what = lod ? `LOD ${lod}: ` : '';
			return bad(`${what}${triangles} triangles is more than ${limit.triangles}`);
		}
	}
	if (gpuBytes > limit.gpuBytes) return bad('too large on the GPU');
	return {
		ok: true,
		info: {
			meshes,
			triangles: levels[0],
			lods: levels.slice(1).filter((t) => t > 0),
			bounds: { min, max },
			textures,
			gpuBytes,
			cooked: root.listExtensionsUsed().some((e) => COOKED.has(e.extensionName))
		}
	};
}
