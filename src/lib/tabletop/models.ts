// Models (see src/lib/assets/manifest.ts): loaded on first use, one load per model however many
// props or tokens use it, and kept while any table is up (#188). A model is parts by role:
// `body` and `swing` carry their colours as vertex colours or textures, `accent` takes the
// token's colour; `<role>_lod<n>` meshes are its coarser levels. Until one has loaded, props and
// tokens show their placeholders.
//
// Part lists are plain glTF; cooked models (#186) have meshopt geometry and KTX2 textures,
// whose decoders (decoders.ts) load in a chunk of their own the first time one is needed. Every
// part is made to the same attribute set (position, normal, uv, colour; floats), so a textured
// part and a part list draw with the same program, and its glTF maps go into the kind's slots.
// When the last table goes (initModels/releaseModels), every geometry and texture is freed and
// the transcoder's workers stop: a lost device's replacement starts afresh.

import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ModelEntry, ModelLod } from '$lib/assets/manifest';
import { assetUrl, fetchAsset, loadManifest } from '$lib/assets/load';
import {
	prepareSlotTexture,
	SLOTS,
	worldTexture,
	type ParamsInput,
	type SlotName
} from './materials';
import type { Decoders } from './decoders';

export type Role = 'body' | 'swing' | 'accent';

export interface ModelPart {
	role: Role;
	/** 0 is the full model; 1 and up its coarser levels (the entry's `lods`). */
	lod: number;
	geometry: THREE.BufferGeometry;
	/** Its glTF maps by slot, or null for a part coloured by its vertices alone. */
	maps: Partial<Record<SlotName, THREE.Texture>> | null;
	/** Its glTF material's factors, for a material with `maps`. */
	params: ParamsInput;
}

export interface LoadedModel {
	entry: ModelEntry;
	parts: ModelPart[];
}

/** A role's parts at level `lod`. */
export const partsOf = (model: LoadedModel, role: Role, lod = 0) =>
	model.parts.filter((p) => p.role === role && p.lod === lod);

/**
 * The level to draw at `screenShare` (the model's height over the screen's): the last of the
 * entry's `lods` whose `screenSize` it is below, else 0. Choosing per frame is #274's.
 */
export function lodFor(lods: readonly ModelLod[] | undefined, screenShare: number): number {
	let level = 0;
	lods?.forEach((l, i) => screenShare < l.screenSize && (level = i + 1));
	return level;
}

const ROLE = /^(body|swing|accent)(?:_lod([1-4]))?(?:_\d+)?$/;

/** A mesh's role and level from its name as GLTFLoader gives it (`_<n>` made names unique). */
export function roleOf(name: string): { role: Role; lod: number } | null {
	const match = ROLE.exec(name);
	return match ? { role: match[1] as Role, lod: Number(match[2] ?? 0) } : null;
}

const cache = new Map<string, Promise<LoadedModel | null>>();
/** Models that have loaded (or failed: null), for drawing without waiting. */
const ready = new Map<string, LoadedModel | null>();
const loader = new GLTFLoader();
let renderer: THREE.WebGPURenderer | null = null;
/** Tables using the models; the last to go frees them. */
let users = 0;
/** Bumped on every release of everything: a load begun before it is thrown away. */
let generation = 0;
let decoding: Promise<Decoders> | null = null;
let decoderModule: typeof import('./decoders') | null = null;

/** A table on `r` uses models: textures upload to it, and its device picks the KTX2 format. */
export function initModels(r: THREE.WebGPURenderer): void {
	users++;
	if (renderer !== r && decoding) dropDecoders();
	renderer = r;
}

/** A table is gone; the last frees every model and texture and stops the decoders. */
export function releaseModels(): void {
	if (--users > 0) return;
	users = 0;
	generation++;
	for (const model of ready.values()) if (model) disposeModel(model);
	cache.clear();
	ready.clear();
	dropDecoders();
	renderer = null;
}

function dropDecoders(): void {
	decoderModule?.disposeDecoders();
	decoding = null;
}

function disposeModel(model: LoadedModel): void {
	const textures = new Set<THREE.Texture>();
	for (const p of model.parts) {
		p.geometry.dispose();
		for (const t of Object.values(p.maps ?? {})) textures.add(t);
	}
	for (const t of textures) t.dispose();
}

/** The model if it has loaded (null if it can't), undefined while it hasn't yet. */
export function modelNow(id: string): LoadedModel | null | undefined {
	return ready.get(id);
}

/** Loads a model once; null if the manifest has no such model or it fails to load. */
export function loadModel(id: string): Promise<LoadedModel | null> {
	let loading = cache.get(id);
	if (!loading) {
		const at = generation;
		loading = load(id)
			.catch((err: Error) => {
				console.warn(`[assets] model "${id}" failed to load:`, err.message);
				return null;
			})
			.then((model) => {
				if (at === generation) return model;
				if (model) disposeModel(model); // everything was released meanwhile
				return null;
			});
		loading.then((m) => at === generation && ready.set(id, m));
		cache.set(id, loading);
	}
	return loading;
}

/** The decoders, for the current renderer, loaded the first time a cooked file needs them. */
function decoders(): Promise<Decoders> {
	decoding ??= Promise.all([import('./decoders'), loadManifest()]).then(([module, manifest]) => {
		decoderModule = module;
		const basis = manifest.decoders?.basis;
		if (!renderer) throw new Error('no table to decode for');
		if (!basis) throw new Error('the manifest names no KTX2 transcoder');
		return module.initDecoders(renderer, assetUrl(`${basis.dir}/`));
	});
	return decoding;
}

/** A KTX2 file's texture, transcoded for the current renderer's device. */
export async function ktx2Texture(bytes: ArrayBuffer): Promise<THREE.Texture> {
	const { ktx2 } = await decoders();
	return new Promise((resolve, reject) => ktx2.parse(bytes, resolve, reject));
}

async function load(id: string): Promise<LoadedModel | null> {
	const entry = (await loadManifest()).models[id];
	return entry ? parseModel(entry, await fetchAsset(entry.file, entry.sha256)) : null;
}

/** A model file's parts: every mesh named for a role, at the levels its entry lists. */
export async function parseModel(entry: ModelEntry, bytes: ArrayBuffer): Promise<LoadedModel> {
	if (entry.cooked) {
		const d = await decoders();
		loader.setKTX2Loader(d.ktx2).setMeshoptDecoder(d.meshopt);
	}
	const gltf = await loader.parseAsync(bytes, '');
	gltf.scene.updateMatrixWorld(true);
	const levels = entry.lods?.length ?? 0;
	const groups = new Map<
		string,
		{ part: Omit<ModelPart, 'geometry'>; pieces: THREE.BufferGeometry[] }
	>();
	gltf.scene.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		const role = roleOf(o.name);
		const material = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.Material;
		if (role && role.lod <= levels) {
			const key = `${role.role}:${role.lod}:${material.uuid}`;
			let group = groups.get(key);
			if (!group) groups.set(key, (group = { part: { ...role, ...lookOf(material) }, pieces: [] }));
			const piece = uniform(o.geometry).applyMatrix4(o.matrixWorld);
			// An accent takes the token's colour: without vertex colours it matches the plain mini.
			if (role.role === 'accent') piece.deleteAttribute('color');
			group.pieces.push(piece);
		}
		(o.geometry as THREE.BufferGeometry).dispose();
	});
	gltf.scene.traverse((o) => {
		// The glTF materials only: their maps are the parts' now.
		if (o instanceof THREE.Mesh) [o.material].flat().forEach((m: THREE.Material) => m.dispose());
	});
	const parts = [...groups.values()].map(({ part, pieces }) => {
		const geometry = merge(pieces);
		geometry.computeBoundingSphere();
		return { ...part, geometry };
	});
	return { entry, parts };
}

type GltfMaterial = THREE.MeshStandardMaterial;

/** A glTF material's maps as slot textures (sampled, filtered and uploaded), and its factors. */
function lookOf(m: THREE.Material): Pick<ModelPart, 'maps' | 'params'> {
	const s = m as GltfMaterial;
	const found: Partial<Record<SlotName, THREE.Texture | null>> = {
		albedo: s.map,
		normal: s.normalMap,
		// glTF packs occlusion, roughness and metalness as the ORM slot does; a separate
		// occlusion texture is not kept (#186 cooks them into one).
		orm: s.roughnessMap ?? s.metalnessMap ?? s.aoMap,
		emissive: s.emissiveMap
	};
	const maps: Partial<Record<SlotName, THREE.Texture>> = {};
	for (const [slot, t] of Object.entries(found) as [SlotName, THREE.Texture | null][]) {
		if (t) maps[slot] = slotTexture(t, slot);
	}
	const textured = Object.keys(maps).length > 0;
	return {
		maps: textured ? maps : null,
		params: {
			color: s.color,
			roughness: s.roughness ?? 1,
			// The ORM slot's blue can only add metal, so its factor is the map's.
			metalness: maps.orm ? 0 : (s.metalness ?? 0),
			emissive: s.emissive ?? 0,
			emissiveIntensity: s.emissiveIntensity ?? 1
		}
	};
}

/** A loaded texture made ready for `slot`: its sampling, the tier's filtering, uploaded. */
export function slotTexture(t: THREE.Texture, slot: SlotName): THREE.Texture {
	prepareSlotTexture(t, SLOTS[slot]);
	if ((t as THREE.CompressedTexture).isCompressedTexture) {
		// A KTX2 file carries its mips; the GPU can't make them for a compressed format.
		t.generateMipmaps = false;
		if (t.mipmaps.length <= 1) t.minFilter = THREE.LinearFilter;
	}
	worldTexture(t);
	renderer?.initTexture(t); // uploaded now, not on the first frame that shows it
	return t;
}

/** A float copy of `attribute` with `size` components (a missing one 0, a missing alpha 1). */
function floats(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number) {
	const out = new Float32Array(attribute.count * size);
	const get = [attribute.getX, attribute.getY, attribute.getZ, attribute.getW];
	for (let i = 0; i < attribute.count; i++)
		for (let c = 0; c < size; c++)
			out[i * size + c] = c < attribute.itemSize ? get[c].call(attribute, i) : c === 3 ? 1 : 0;
	return new THREE.BufferAttribute(out, size);
}

/** Pieces of one attribute set as one geometry (BufferGeometryUtils would outgrow the chunk). */
function merge(pieces: THREE.BufferGeometry[]): THREE.BufferGeometry {
	if (pieces.length === 1) return pieces[0];
	const out = new THREE.BufferGeometry();
	for (const [name, { itemSize }] of Object.entries(pieces[0].attributes)) {
		const all = pieces.flatMap((g) => [...g.getAttribute(name).array]);
		out.setAttribute(name, new THREE.BufferAttribute(new Float32Array(all), itemSize));
	}
	const index: number[] = [];
	let base = 0;
	for (const g of pieces) {
		for (const i of g.getIndex()!.array) index.push(i + base);
		base += g.getAttribute('position').count;
		g.dispose();
	}
	out.setIndex(index);
	return out;
}

/**
 * A copy with exactly position, normal, uv and colour, as floats (quantized meshopt attributes
 * dequantized), and an index: every part then merges with its kin and compiles the same program
 * as a part list. Files without normals get them made (every hard edge has its own vertices).
 */
function uniform(source: THREE.BufferGeometry): THREE.BufferGeometry {
	const geometry = new THREE.BufferGeometry();
	const position = source.getAttribute('position');
	const count = position.count;
	geometry.setAttribute('position', floats(position, 3));
	const normal = source.getAttribute('normal');
	if (normal) geometry.setAttribute('normal', floats(normal, 3));
	const uv = source.getAttribute('uv');
	geometry.setAttribute(
		'uv',
		uv ? floats(uv, 2) : new THREE.BufferAttribute(new Float32Array(count * 2), 2)
	);
	const color = source.getAttribute('color');
	geometry.setAttribute(
		'color',
		color ? floats(color, 3) : new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3)
	);
	const index = source.getIndex();
	geometry.setIndex(index ? Array.from(index.array) : [...Array(count).keys()]);
	if (!normal) geometry.computeVertexNormals();
	return geometry;
}
