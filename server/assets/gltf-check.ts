// The first stage of checking a model (glb.ts checkGlb): its glTF JSON, read
// as an allowlist before any of its data is decoded. glTF has no scripting;
// the risks are extensions that open other code paths, URIs that reach
// outside the file, and data that lies about its size. So only the listed
// properties and extensions pass, nothing links anywhere, every accessor fits
// its buffer view, and what meshopt would decode to is summed and capped
// before it is decoded.

import type { Limit } from '../../src/lib/assets/manifest';

/**
 * The extensions a model may use: compressed geometry and textures, and a few material values.
 * Not KHR_texture_transform, alpha MASK or a second uv set until the client honours them
 * (models.ts, the prop and mini kinds sample at uv() with no transform, opaque).
 */
export const EXTENSIONS = new Set([
	'EXT_meshopt_compression',
	'KHR_mesh_quantization',
	'KHR_texture_basisu',
	'KHR_materials_emissive_strength'
]);

/**
 * A mesh's name, and its node's: its role (`flame` a light fixture's glow, #232), a mini's static
 * pose (`body_pose1` to `body_pose3`, #273), and `_lod<n>` for a coarser level. GLTFLoader strips
 * `.`, `:`, `/`, `[` and `]` from names, so a dotted name would reach the client changed.
 */
export const MESH_NAME = /^(?:body(?:_pose[1-3])?|swing|accent|flame)(?:_lod[12])?$/;
const POSED = /^body_pose[1-3]/;

export const MAX_JSON_BYTES = 256 * 1024;
export const MAX_NODES = 256;
export const MAX_DEPTH = 16;
export const MAX_EMISSIVE_STRENGTH = 50;

const TOP_LEVEL = new Set([
	'asset',
	'scene',
	'scenes',
	'nodes',
	'meshes',
	'accessors',
	'bufferViews',
	'buffers',
	'materials',
	'textures',
	'samplers',
	'images',
	'extensionsUsed',
	'extensionsRequired'
]);
const NODE_KEYS = new Set([
	'name',
	'mesh',
	'children',
	'translation',
	'rotation',
	'scale',
	'matrix'
]);
const MATERIAL_KEYS = new Set([
	'name',
	'pbrMetallicRoughness',
	'normalTexture',
	'occlusionTexture',
	'emissiveTexture',
	'emissiveFactor',
	'alphaMode',
	'alphaCutoff',
	'doubleSided',
	'extensions'
]);
const PBR_KEYS = new Set([
	'baseColorFactor',
	'baseColorTexture',
	'metallicFactor',
	'roughnessFactor',
	'metallicRoughnessTexture'
]);
const VIEW_KEYS = new Set([
	'buffer',
	'byteOffset',
	'byteLength',
	'byteStride',
	'target',
	'name',
	'extensions'
]);
const ACCESSOR_KEYS = new Set([
	'bufferView',
	'byteOffset',
	'componentType',
	'normalized',
	'count',
	'type',
	'min',
	'max',
	'name'
]);

const BYTE = 5120;
const UNSIGNED_BYTE = 5121;
const SHORT = 5122;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const FLOAT = 5126;
const COMPONENT_BYTES: Record<number, number> = {
	[BYTE]: 1,
	[UNSIGNED_BYTE]: 1,
	[SHORT]: 2,
	[UNSIGNED_SHORT]: 2,
	[UNSIGNED_INT]: 4,
	[FLOAT]: 4
};
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

class Refused extends Error {}
const fail = (message: string): never => {
	throw new Refused(message);
};

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const records = (v: unknown, what: string): Json[] => {
	if (v === undefined) return [];
	if (!Array.isArray(v) || !v.every(isRecord)) return fail(`bad ${what}`);
	return v;
};
const isCount = (v: unknown, min = 0): v is number =>
	typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const index = (v: unknown, length: number, what: string): number =>
	isCount(v) && v < length ? v : fail(`bad ${what} index`);
const numbers = (v: unknown, length: number, what: string) => {
	if (!Array.isArray(v) || v.length !== length || !v.every(Number.isFinite)) fail(`bad ${what}`);
};
const onlyKeys = (o: Json, allowed: Set<string>, what: string) => {
	for (const key of Object.keys(o)) {
		if (!allowed.has(key)) fail(`${what}: "${key}" is not allowed`);
	}
};

/** No link anywhere, and no extension off the list, however deep. */
function walk(v: unknown, depth = 0): void {
	if (depth > 32) fail('nested too deeply');
	if (Array.isArray(v)) {
		for (const x of v) walk(x, depth + 1);
		return;
	}
	if (!isRecord(v)) return;
	for (const [key, x] of Object.entries(v)) {
		if (key === 'uri') fail('external or data URIs are not allowed');
		if (key === 'extensions') {
			if (!isRecord(x)) fail('bad extensions');
			for (const name of Object.keys(x as Json)) {
				if (!EXTENSIONS.has(name)) fail(`extension ${name} is not allowed`);
			}
		}
		if (key === 'extensionsUsed' || key === 'extensionsRequired') {
			if (!Array.isArray(x)) fail(`bad ${key}`);
			for (const name of x as unknown[]) {
				if (typeof name !== 'string' || !EXTENSIONS.has(name)) {
					fail(`extension ${String(name)} is not allowed`);
				}
			}
		}
		walk(x, depth + 1);
	}
}

/** Whether an attribute's format suits its semantic (quantised integers only with KHR_mesh_quantization). */
function attributeFormat(name: string, type: string, ct: number, norm: boolean, quant: boolean) {
	const ints = [BYTE, UNSIGNED_BYTE, SHORT, UNSIGNED_SHORT].includes(ct);
	const signedNorm = norm && (ct === BYTE || ct === SHORT);
	const unsignedNorm = norm && (ct === UNSIGNED_BYTE || ct === UNSIGNED_SHORT);
	switch (name) {
		case 'POSITION':
			return type === 'VEC3' && (ct === FLOAT || (quant && ints));
		case 'NORMAL':
			return type === 'VEC3' && (ct === FLOAT || (quant && signedNorm));
		case 'TANGENT':
			return type === 'VEC4' && (ct === FLOAT || (quant && signedNorm));
		case 'TEXCOORD_0':
			return type === 'VEC2' && (ct === FLOAT || unsignedNorm || (quant && ints));
		case 'COLOR_0':
			return (type === 'VEC3' || type === 'VEC4') && (ct === FLOAT || unsignedNorm);
		case '_BAKE':
			return type === 'VEC2' && ct === UNSIGNED_BYTE && norm;
		default:
			return false;
	}
}

/**
 * Checks a model's glTF JSON against `limit` (its class's): throws nothing, returns the problem
 * or null. `binLength` is the GLB's binary chunk, the only data a model has.
 */
export function gltfProblem(json: Json, binLength: number, limit: Limit): string | null {
	try {
		check(json, binLength, limit);
		return null;
	} catch (err) {
		if (err instanceof Refused) return err.message;
		throw err;
	}
}

function check(json: Json, binLength: number, limit: Limit): void {
	for (const key of Object.keys(json)) {
		if (!TOP_LEVEL.has(key)) fail(`"${key}" is not allowed in a model`);
	}
	if (!isRecord(json.asset) || json.asset.version !== '2.0') fail('not glTF 2.0');
	walk(json);
	const quant =
		Array.isArray(json.extensionsUsed) && json.extensionsUsed.includes('KHR_mesh_quantization');

	// Buffers: the GLB's own, and meshopt's fallbacks, which hold nothing until decoded.
	const buffers = records(json.buffers, 'buffers');
	if (!buffers.length) fail('a model has one embedded buffer');
	let fallbackBytes = 0;
	buffers.forEach((b, i) => {
		const fallback = isRecord(b.extensions) && isRecord(b.extensions.EXT_meshopt_compression);
		if (fallback !== i > 0) fail('a model has one embedded buffer, and meshopt fallbacks');
		if (!isCount(b.byteLength)) fail('bad buffer length');
		if (i === 0 && (b.byteLength as number) > binLength) fail('buffer longer than its chunk');
		if (fallback) fallbackBytes += b.byteLength as number;
	});

	// Buffer views, and the decode bomb: what meshopt says it will write, before it writes it.
	const views = records(json.bufferViews, 'buffer views');
	let decoded = 0;
	for (const v of views) {
		const m = isRecord(v.extensions) ? v.extensions.EXT_meshopt_compression : undefined;
		if (isRecord(m)) decoded += (m.count as number) * (m.byteStride as number);
	}
	if (!(decoded + fallbackBytes <= limit.gpuBytes)) {
		fail(`meshopt data decodes past ${limit.gpuBytes} bytes`);
	}
	const compressed = new Set<number>();
	views.forEach((v, i) => {
		onlyKeys(v, VIEW_KEYS, 'buffer view');
		const buffer = buffers[index(v.buffer, buffers.length, 'buffer')];
		const offset = v.byteOffset ?? 0;
		if (!isCount(offset) || !isCount(v.byteLength, 1)) fail('bad buffer view');
		if ((offset as number) + (v.byteLength as number) > (buffer.byteLength as number)) {
			fail('buffer view past its buffer');
		}
		const stride = v.byteStride;
		if (stride !== undefined && (!isCount(stride, 4) || stride > 252 || stride % 4)) {
			fail('bad byte stride');
		}
		const m = isRecord(v.extensions) ? v.extensions.EXT_meshopt_compression : undefined;
		if (m === undefined) {
			if (v.buffer !== 0) fail('only meshopt data may sit in a fallback buffer');
			return;
		}
		if (!isRecord(m) || m.buffer !== 0) fail('meshopt data must be in the file');
		const data = m as Json;
		const start = data.byteOffset ?? 0;
		if (!isCount(start) || !isCount(data.byteLength, 1)) fail('bad meshopt data');
		if ((start as number) + (data.byteLength as number) > (buffers[0].byteLength as number)) {
			fail('meshopt data past the buffer');
		}
		if (!isCount(data.count, 1) || !isCount(data.byteStride, 1) || data.byteStride > 256) {
			fail('bad meshopt count or stride');
		}
		if ((data.count as number) * (data.byteStride as number) > (v.byteLength as number)) {
			fail('meshopt data decodes past its view');
		}
		if (!['ATTRIBUTES', 'TRIANGLES', 'INDICES'].includes(data.mode as string)) {
			fail('bad meshopt mode');
		}
		compressed.add(i);
	});

	// Accessors fit their views, whatever they say, and all of them together fit the GPU budget:
	// decoding copies each one out, so many accessors over one view would multiply the data.
	const accessors = records(json.accessors, 'accessors');
	let accessorBytes = 0;
	for (const a of accessors) {
		onlyKeys(a, ACCESSOR_KEYS, 'accessor');
		const view = views[index(a.bufferView, views.length, 'buffer view')];
		const size = COMPONENT_BYTES[a.componentType as number];
		const components = COMPONENTS[a.type as string];
		if (!size || !components) fail('bad accessor type');
		if (a.normalized !== undefined && typeof a.normalized !== 'boolean') fail('bad accessor');
		if (a.normalized && a.componentType === FLOAT) fail('a float accessor is never normalised');
		const offset = a.byteOffset ?? 0;
		if (!isCount(a.count, 1) || !isCount(offset)) fail('bad accessor count or offset');
		const element = size * components;
		const stride = (view.byteStride as number | undefined) ?? element;
		const end = (offset as number) + ((a.count as number) - 1) * stride + element;
		if (end > (view.byteLength as number)) fail('accessor runs past its buffer view');
		accessorBytes += (a.count as number) * element;
		if (accessorBytes > limit.gpuBytes) fail(`accessors hold more than ${limit.gpuBytes} bytes`);
		for (const bound of ['min', 'max']) {
			if (a[bound] !== undefined) numbers(a[bound], components, `accessor ${bound}`);
		}
	}

	// Images are KTX2 in the file; textures take them through KHR_texture_basisu only.
	const images = records(json.images, 'images');
	for (const image of images) {
		onlyKeys(image, new Set(['bufferView', 'mimeType', 'name']), 'image');
		if (image.mimeType !== 'image/ktx2') fail('images must be KTX2');
		const i = index(image.bufferView, views.length, 'image buffer view');
		if (views[i].buffer !== 0 || compressed.has(i)) fail('an image must be stored plainly');
	}
	const samplers = records(json.samplers, 'samplers');
	for (const s of samplers) {
		onlyKeys(s, new Set(['magFilter', 'minFilter', 'wrapS', 'wrapT', 'name']), 'sampler');
	}
	const textures = records(json.textures, 'textures');
	for (const t of textures) {
		onlyKeys(t, new Set(['sampler', 'extensions', 'name']), 'texture');
		if (t.sampler !== undefined) index(t.sampler, samplers.length, 'sampler');
		const basisu = isRecord(t.extensions) ? t.extensions.KHR_texture_basisu : undefined;
		if (!isRecord(basisu)) fail('a texture must use KHR_texture_basisu');
		index((basisu as Json).source, images.length, 'image');
	}

	const materials = records(json.materials, 'materials');
	const textureInfo = (v: unknown) => {
		if (v === undefined) return;
		if (!isRecord(v)) return fail('bad texture reference');
		onlyKeys(v, new Set(['index', 'texCoord', 'scale', 'strength', 'extensions']), 'texture');
		index(v.index, textures.length, 'texture');
		if (v.texCoord !== undefined && v.texCoord !== 0) fail('only texCoord 0');
	};
	for (const m of materials) {
		onlyKeys(m, MATERIAL_KEYS, 'material');
		const pbr = m.pbrMetallicRoughness;
		if (pbr !== undefined) {
			if (!isRecord(pbr)) fail('bad material');
			onlyKeys(pbr as Json, PBR_KEYS, 'material');
			textureInfo((pbr as Json).baseColorTexture);
			textureInfo((pbr as Json).metallicRoughnessTexture);
		}
		textureInfo(m.normalTexture);
		textureInfo(m.occlusionTexture);
		textureInfo(m.emissiveTexture);
		if (m.emissiveFactor !== undefined) numbers(m.emissiveFactor, 3, 'emissive factor');
		if (m.alphaMode !== undefined && m.alphaMode !== 'OPAQUE') fail('alphaMode must be OPAQUE');
		const strength = isRecord(m.extensions)
			? m.extensions.KHR_materials_emissive_strength
			: undefined;
		if (strength !== undefined) {
			const s = isRecord(strength) ? strength.emissiveStrength : undefined;
			if (!(typeof s === 'number' && s >= 0 && s <= MAX_EMISSIVE_STRENGTH)) {
				fail(`emissive strength must be 0 to ${MAX_EMISSIVE_STRENGTH}`);
			}
		}
	}

	const meshes = records(json.meshes, 'meshes');
	if (!meshes.length) fail('no meshes');
	for (const mesh of meshes) {
		onlyKeys(mesh, new Set(['name', 'primitives']), 'mesh');
		if (typeof mesh.name !== 'string' || !MESH_NAME.test(mesh.name)) {
			fail(
				`mesh "${String(mesh.name)}" must be named body, swing, accent or flame (body_pose1 to _pose3; and _lod1 or _lod2)`
			);
		}
		const primitives = records(mesh.primitives, 'primitives');
		if (!primitives.length) fail('a mesh without primitives');
		for (const p of primitives) {
			onlyKeys(p, new Set(['attributes', 'indices', 'material', 'mode']), 'primitive');
			if ((p.mode ?? 4) !== 4) fail('only triangles');
			if (p.material !== undefined) index(p.material, materials.length, 'material');
			if (!isRecord(p.attributes) || p.attributes.POSITION === undefined) {
				fail('a primitive needs positions');
			}
			let count: number | undefined;
			for (const [name, i] of Object.entries(p.attributes as Json)) {
				const a = accessors[index(i, accessors.length, 'accessor')];
				if (
					!attributeFormat(
						name,
						a.type as string,
						a.componentType as number,
						a.normalized === true,
						quant
					)
				) {
					fail(`attribute ${name} is not allowed in that format`);
				}
				if (count !== undefined && a.count !== count) fail('attributes of different lengths');
				count = a.count as number;
			}
			if (p.indices !== undefined) {
				const a = accessors[index(p.indices, accessors.length, 'accessor')];
				const ct = a.componentType as number;
				if (
					a.type !== 'SCALAR' ||
					a.normalized ||
					![UNSIGNED_BYTE, UNSIGNED_SHORT, UNSIGNED_INT].includes(ct)
				) {
					fail('indices must be unsigned integers');
				}
			}
		}
	}

	// Posed minis tint through the mini kind's mask, never an accent (#273), and pose a body.
	const names = meshes.map((m) => m.name as string);
	if (names.some((n) => POSED.test(n))) {
		if (names.some((n) => n.startsWith('accent'))) fail('a model with poses has no accent');
		if (!names.includes('body')) fail('a model with poses needs its body');
	}

	// Nodes: a small tree of transforms, each mesh on a node named for its role.
	const nodes = records(json.nodes, 'nodes');
	if (nodes.length > MAX_NODES) fail(`more than ${MAX_NODES} nodes`);
	const parent = new Array<number>(nodes.length).fill(-1);
	nodes.forEach((n, i) => {
		onlyKeys(n, NODE_KEYS, `node ${i}`);
		if (n.mesh !== undefined) {
			index(n.mesh, meshes.length, 'mesh');
			if (typeof n.name !== 'string' || !MESH_NAME.test(n.name)) {
				fail(`node "${String(n.name)}" must be named for its mesh's role`);
			}
		}
		if (n.translation !== undefined) numbers(n.translation, 3, 'translation');
		if (n.rotation !== undefined) numbers(n.rotation, 4, 'rotation');
		if (n.scale !== undefined) numbers(n.scale, 3, 'scale');
		if (n.matrix !== undefined) numbers(n.matrix, 16, 'matrix');
		if (n.children === undefined) return;
		if (!Array.isArray(n.children)) fail('bad children');
		for (const c of n.children as unknown[]) {
			const child = index(c, nodes.length, 'child');
			if (parent[child] !== -1 || child === i) fail('a node has one parent');
			parent[child] = i;
		}
	});
	let reached = 0;
	const descend = (i: number, depth: number) => {
		if (depth > MAX_DEPTH) fail(`nodes nest deeper than ${MAX_DEPTH}`);
		reached++;
		for (const c of (nodes[i].children as number[] | undefined) ?? []) descend(c, depth + 1);
	};
	parent.forEach((p, i) => p === -1 && descend(i, 1));
	if (reached !== nodes.length) fail('nodes form a cycle');
	const scenes = records(json.scenes, 'scenes');
	for (const s of scenes) {
		onlyKeys(s, new Set(['nodes', 'name']), 'scene');
		if (s.nodes !== undefined && !Array.isArray(s.nodes)) fail('bad scene');
		for (const n of (s.nodes as unknown[] | undefined) ?? []) {
			if (parent[index(n, nodes.length, 'scene node')] !== -1) fail('a scene holds only roots');
		}
	}
	if (json.scene !== undefined) index(json.scene, scenes.length, 'scene');
}
