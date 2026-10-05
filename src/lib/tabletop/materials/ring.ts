// The tile ring's nodes (#254, tile-ring.ts): one fade by distance from the camera's target, read
// by the terrain kind's `dropped` graph (the bed: the ground sinks by `aBed` under tiles) and by
// the instanced prop graph (a tile sinks by `params.sink` past the ring; 0 for every prop). All
// uniforms and an attribute: the camera moving, the tier and the tiles coming and going compile
// nothing.

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { RING_BAND } from '../tile-ring';
import { tsl, type N } from './tsl';

/** The per-vertex bed on the world's chunks: 1 under tiles, 0 elsewhere (`tileBeds`). */
export const BED_ATTRIBUTE = 'aBed';

export const ringUniforms = {
	/** The camera's target, world x and z. */
	centre: uniform(new THREE.Vector2()),
	/** World units; 0 draws no tiles (low). */
	radius: uniform(0),
	band: uniform(RING_BAND),
	/** How far the ground sinks under tiles, in world units (0 on low). */
	bed: uniform(0)
};

const u = ringUniforms as unknown as Record<keyof typeof ringUniforms, N>;

/** `ringFade` at a world xz: 1 inside the ring, 0 past it (everywhere at radius 0). */
export function ringFadeNode(xz: N): N {
	const d = xz.sub(u.centre).length();
	return tsl.smoothstep(u.radius.sub(u.band), u.radius, d).oneMinus();
}

/** How far the ground sinks at a vertex of a chunk's top: the bed where tiles are, by the fade. */
export function bedSink(xz: N): N {
	return tsl.attribute(BED_ATTRIBUTE, 'float').mul(u.bed).mul(ringFadeNode(xz));
}
