// The dice's material (#275): resin with a clearcoat, numerals engraved by a bump from the numeral
// atlas (`dice-numerals`, a PNG through the asset pipeline: glyph coverage in red, laid out by
// dice-geometry.ts), body and ink colours and the fade per instance. One graph for every die of
// every kind, drawn as one InstancedMesh per kind (dice3d.ts). Not a shader kind (#169): a roll is
// public and may land over black cells, which a kind's `worldModify` would black out; dice write
// "shown" into the scene pass's `hidden` attachment instead (post.ts), so the output stage never
// blacks them out where they fly over a cell the fog hides (#173).
//
// Nothing here changes a program once built: the atlas swaps into its texture node's value (a
// blank until it loads, sampled the same way), the fade is `alphaHash` on an instance attribute
// (never a `transparent` flip), and the resin and metal looks are uniforms.

import * as THREE from 'three/webgpu';
import { attribute, bumpMap, mrt, output, texture, uniform, vec4 } from 'three/tsl';
import { fetchAsset, loadManifest } from '../../assets/load';
import { imageTexture } from '../image-texture';
import { blankTexture, prepareSlotTexture, type SlotSpec } from './defaults';
import { worldTexture } from './texture-quality';
import type { N } from './tsl';

/** Per instance: the body's colour (linear RGB). */
export const DIE_BODY_ATTRIBUTE = 'aDieBody';
/** Per instance: the numerals' ink (linear RGB). */
export const DIE_INK_ATTRIBUTE = 'aDieInk';
/** Per instance: how much of the die shows, 1 unless fading (alpha-hashed). */
export const DIE_FADE_ATTRIBUTE = 'aDieFade';

/** The atlas's sampling: coverage is data, clamped, trilinear. */
const ATLAS_SLOT: SlotSpec = {
	type: '2d',
	colorSpace: THREE.NoColorSpace,
	texel: [0, 0, 0, 255],
	wrap: THREE.ClampToEdgeWrapping,
	magFilter: THREE.LinearFilter,
	minFilter: THREE.LinearMipmapLinearFilter
};

/** The resin, as uniforms shared by every die; `METAL` the other set on the same graph. */
export const diceLook = {
	/** Clearcoat strength: 1, or 0 on the low tier (`setDiceTier`). */
	clearcoat: uniform(1),
	clearcoatRoughness: uniform(0.08),
	roughness: uniform(0.25),
	metalness: uniform(0),
	/** How deep the numerals are engraved: the bump's scale, negative to cut in. */
	engrave: uniform(-1.5)
};

/** The metal preset (a later dice-set picker, not offered yet): values for `diceLook`. */
export const METAL = { roughness: 0.35, metalness: 1 } as const;

/** The low tier draws no clearcoat; the graph is the same, so nothing compiles. */
export function setDiceTier(tier: string): void {
	diceLook.clearcoat.value = tier === 'low' ? 0 : 1;
}

/** The atlas, a blank until the real one loads (page-wide, never disposed, like the paint maps). */
const atlas = texture(blankTexture(ATLAS_SLOT)); // sampled as the atlas is: the swap is a binding
let loading: Promise<void> | null = null;

/** Loads the numeral atlas into the dice's texture node, once for the page. */
export function loadDiceAtlas(): Promise<void> {
	loading ??= loadManifest().then(async (manifest) => {
		const entry = manifest.textures['dice-numerals'];
		if (!entry) return;
		const map = await fetchAsset(entry.file, entry.sha256)
			.then(imageTexture)
			.catch(() => null);
		if (!map) return console.warn('[assets] texture "dice-numerals" failed to load');
		atlas.value = worldTexture(prepareSlotTexture(map, ATLAS_SLOT)); // the tier's anisotropy
	});
	return loading;
}

/**
 * Dice write "shown" into the scene pass's `hidden` attachment. Exported for the post chain's
 * test (`post.svelte.spec.ts`).
 */
export const DICE_SHOWN = mrt({ output, hidden: vec4(0, 0, 0, output.a) });

const n = (node: unknown) => node as N;

/** The dice's material, for an InstancedMesh whose geometry has the three die attributes. */
export function createDiceMaterial(): THREE.MeshPhysicalNodeMaterial {
	void loadDiceAtlas();
	const material = new THREE.MeshPhysicalNodeMaterial();
	const body = n(attribute(DIE_BODY_ATTRIBUTE, 'vec3'));
	const ink = n(attribute(DIE_INK_ATTRIBUTE, 'vec3'));
	// TSL's method form is mix(a, b, this): the glyph's coverage blends body into ink.
	material.colorNode = n(atlas).r.mix(body, ink) as unknown as THREE.Node<'vec3'>;
	material.normalNode = bumpMap(atlas, diceLook.engrave);
	material.roughnessNode = diceLook.roughness;
	material.metalnessNode = diceLook.metalness;
	material.clearcoatNode = diceLook.clearcoat;
	material.clearcoatRoughnessNode = diceLook.clearcoatRoughness;
	material.opacityNode = attribute(DIE_FADE_ATTRIBUTE, 'float');
	material.alphaHash = true;
	material.mrtNode = DICE_SHOWN;
	return material;
}
