// Roof fades (#259): each roof region's fade, one texel at its key cell (its smallest cell's x, y,
// the `aRoofKey` its vertices carry), written by roofs.ts `RoofLayer` and read by the surface
// kind's `roof` variant as its mask: a fragment shows where its region's fade beats the screen's
// interleaved gradient noise, so a fading roof dithers out with no transparency sorting. The
// texture is module-wide (one tabletop draws at a time, as the cell maps') and swapped by nothing,
// so a fade writes texels and compiles nothing. The shadow pass never masks (`maskShadowNode`
// true): a fade never redraws the sun's cached shadow, and a room keeps its roof's shade.

import * as THREE from 'three/webgpu';
import {
	attribute,
	bool,
	interleavedGradientNoise,
	ivec2,
	screenCoordinate,
	textureLoad
} from 'three/tsl';
import type { N } from './tsl';

/** A roof's vertex attribute: its region's key cell (x, y) at the texel's middle, its fade's. */
export const ROOF_KEY_ATTRIBUTE = 'aRoofKey';

/** The fade map's side: one texel per cell of the largest table (`GRID_LIMITS.maxCells`, 100). */
export const ROOF_FADE_SIDE = 128;

/** Each region's fade at its key cell: 255 drawn, 0 gone. Never disposed. */
export const ROOF_FADES = new THREE.DataTexture(
	new Uint8Array(ROOF_FADE_SIDE * ROOF_FADE_SIDE).fill(255),
	ROOF_FADE_SIDE,
	ROOF_FADE_SIDE,
	THREE.RedFormat,
	THREE.UnsignedByteType
);
ROOF_FADES.magFilter = ROOF_FADES.minFilter = THREE.NearestFilter;
ROOF_FADES.generateMipmaps = false;
ROOF_FADES.needsUpdate = true;

type Loose = (...args: unknown[]) => N;

/** The roof variant's mask: its region's fade above the pixel's dither noise (0 to under 1). */
export const roofMask = (): N => {
	const key = (ivec2 as unknown as Loose)(attribute(ROOF_KEY_ATTRIBUTE, 'vec2'));
	const fade = (textureLoad as unknown as Loose)(ROOF_FADES, key).x;
	return fade.greaterThan((interleavedGradientNoise as unknown as Loose)(screenCoordinate.xy));
};

/** The shadow pass's mask: always drawn (a constant, so the shadow program is the same). */
export const roofShadowMask = (): N => bool(true) as unknown as N;
