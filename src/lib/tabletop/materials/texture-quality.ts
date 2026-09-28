// How world textures are filtered by tier (#179): anisotropy (4, 8 or 16, clamped to the device)
// and a mip bias. Neither makes a program. Anisotropy is part of r186's sampler key on WebGPU
// and a texture parameter set at upload on WebGL2, never part of a material's cache key
// (RenderObject.getMaterialCacheKey reads a texture's mapping, filters and wrap only), so a tier
// switch re-uploads the registered textures (`needsUpdate`: WebGPU's Sampler rebuilds on a new
// version, WebGL2 sets TEXTURE_MAX_ANISOTROPY_EXT on upload) and builds new samplers. The bias
// is a uniform every kind's slot samples read on every tier (hooks.ts), so it never makes a
// variant. Anisotropy needs mipmaps and linear filters on both backends: the slots' `WORLD`
// sampling (defaults.ts). Data textures (cell maps, LUTs, the slots' blanks) are never
// registered and keep 1.

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { mipBiasFor, type QualitySettings } from '../quality';

/** The mip bias every slot sample applies, in fragment code only: `mipBiasFor` the tier. */
export const mipBias = uniform(0);

// ponytail: one level for the whole page, as there is one tabletop at a time; tabletops in
// tests share it, the last to set its quality winning.
let anisotropy = 1;
const world = new Set<THREE.Texture>();

function apply(texture: THREE.Texture): void {
	if (texture.anisotropy === anisotropy) return;
	texture.anisotropy = anisotropy;
	texture.needsUpdate = true;
}

/**
 * Registers a world texture (a loaded map, a dice numeral, later paint noise, KTX2 and array
 * textures) and gives it the tier's filtering now and on every tier switch. Every world-texture
 * loader calls this; data textures must not.
 */
export function worldTexture<T extends THREE.Texture>(texture: T): T {
	if (!world.has(texture)) {
		world.add(texture);
		texture.addEventListener('dispose', () => world.delete(texture));
	}
	apply(texture);
	return texture;
}

/**
 * Applies a tier's filtering: its anisotropy, clamped to `maxAnisotropy`
 * (`renderer.getMaxAnisotropy()`: 16 on WebGPU, 0 on WebGL2 without the extension, where it
 * stays 1), to every registered world texture, and its mip bias.
 */
export function setTextureQuality(
	settings: Pick<QualitySettings, 'anisotropy' | 'tier' | 'aa'>,
	maxAnisotropy: number
): void {
	anisotropy = Math.max(1, Math.min(settings.anisotropy, maxAnisotropy));
	for (const texture of world) apply(texture);
	mipBias.value = mipBiasFor(settings);
}
