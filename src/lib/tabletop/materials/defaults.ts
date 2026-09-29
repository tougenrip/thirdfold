// The shader kinds' texture slots (#169): what each slot holds, how its textures are sampled,
// and the blank texture bound while it has none. A slot is never empty and never changes type,
// colour space, wrap, filters or mapping, so a material swapping a real texture for its blank
// (or back) keeps its program and its node state: r186 keys a material's node state by its
// textures' mapping, and on WebGPU by their wrap and filters too (RenderObject.getMaterialCacheKey).

import * as THREE from 'three/webgpu';

/** What a slot samples: a plain texture, a texture array or a 3D texture. */
export type SlotType = '2d' | 'array' | '3d';

/** The named slots the kinds read. */
export type SlotName = 'albedo' | 'normal' | 'orm' | 'emissive';

export const SLOT_NAMES: readonly SlotName[] = ['albedo', 'normal', 'orm', 'emissive'];

export interface SlotSpec {
	type: SlotType;
	/** sRGB for colour, none for data (normals, occlusion-roughness-metalness). */
	colorSpace: THREE.ColorSpace;
	/** The blank's one texel, RGBA 0-255: what the kind reads when the slot holds nothing. */
	texel: readonly [number, number, number, number];
	wrap: THREE.Wrapping;
	magFilter: THREE.MagnificationTextureFilter;
	minFilter: THREE.MinificationTextureFilter;
}

/**
 * World textures repeat and filter trilinearly (#179 adds anisotropy on top, which is part of
 * the sampler, not the material's key); the blanks share that, so neither backend sees a change.
 */
const WORLD = {
	type: '2d',
	wrap: THREE.RepeatWrapping,
	magFilter: THREE.LinearFilter,
	minFilter: THREE.LinearMipmapLinearFilter
} as const;

export const SLOTS: Record<SlotName, SlotSpec> = {
	/** White: the material's colour shows as it is. */
	albedo: { ...WORLD, colorSpace: THREE.SRGBColorSpace, texel: [255, 255, 255, 255] },
	/** Straight up in tangent space. */
	normal: { ...WORLD, colorSpace: THREE.NoColorSpace, texel: [128, 128, 255, 255] },
	/** Unoccluded, full roughness, no metal: the material's own roughness and metalness hold. */
	orm: { ...WORLD, colorSpace: THREE.NoColorSpace, texel: [255, 255, 0, 255] },
	/** Black: nothing glows. */
	emissive: { ...WORLD, colorSpace: THREE.SRGBColorSpace, texel: [0, 0, 0, 255] }
};

/** The material property that holds a slot's texture (`albedoSlot`, ...). */
export const slotProperty = (slot: SlotName) => `${slot}Slot` as const;

/** Puts a slot's sampling on a texture that will fill it (loaders call this before binding). */
export function prepareSlotTexture<T extends THREE.Texture>(texture: T, spec: SlotSpec): T {
	texture.colorSpace = spec.colorSpace;
	texture.wrapS = texture.wrapT = spec.wrap;
	(texture as unknown as { wrapR: THREE.Wrapping }).wrapR = spec.wrap;
	texture.magFilter = spec.magFilter;
	texture.minFilter = spec.minFilter;
	texture.mapping = THREE.UVMapping;
	texture.generateMipmaps = spec.minFilter !== THREE.LinearFilter;
	texture.needsUpdate = true;
	return texture;
}

/** A 1x1 (x1) texture of `spec`'s type holding its texel. */
export function blankTexture(spec: SlotSpec): THREE.Texture {
	const data = new Uint8Array(spec.texel);
	const texture =
		spec.type === 'array'
			? new THREE.DataArrayTexture(data, 1, 1, 1)
			: spec.type === '3d'
				? new THREE.Data3DTexture(data, 1, 1, 1)
				: new THREE.DataTexture(data, 1, 1);
	return prepareSlotTexture(texture, spec);
}

const blanks = new Map<SlotName, THREE.Texture>();

/**
 * The shared blank for a slot. Never dispose it: every tabletop's materials bind it, and
 * disposing it destroys it in every renderer (as `BLANK` in environment.ts, #151).
 */
export function slotDefault(slot: SlotName): THREE.Texture {
	let blank = blanks.get(slot);
	if (!blank) blanks.set(slot, (blank = blankTexture(SLOTS[slot])));
	return blank;
}
