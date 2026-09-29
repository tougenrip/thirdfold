// The decoders cooked assets need (#188): meshopt geometry and KTX2 textures, whose transcoder
// runs in workers. A chunk of its own, imported only by models.ts's dynamic import() the first
// time a cooked file loads, so part-list tables never download it and the renderer chunk stays
// in its budget (scripts/check-bundle.mjs fails if KTX2Loader is in the renderer's closure).
//
// One KTX2Loader at a time, for one renderer: it picks the compressed format that renderer's
// device takes (ASTC, BC7, BC1/3, ETC, else plain RGBA), so another renderer (after a lost
// device, or on the WebGL2 fallback) gets a loader of its own and the old one's workers stop.

import type * as THREE from 'three/webgpu';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export interface Decoders {
	ktx2: KTX2Loader;
	meshopt: typeof MeshoptDecoder;
}

let current: { renderer: THREE.WebGPURenderer; ktx2: KTX2Loader } | null = null;

/**
 * The decoders for `renderer` (initialised: `detectSupport` asks its backend), the transcoder
 * fetched from `transcoderPath` (same origin: it is code, never from the asset host).
 */
export async function initDecoders(
	renderer: THREE.WebGPURenderer,
	transcoderPath: string
): Promise<Decoders> {
	if (current?.renderer !== renderer) {
		disposeDecoders();
		const ktx2 = new KTX2Loader()
			.setTranscoderPath(transcoderPath)
			.setWorkerLimit(2)
			.detectSupport(renderer);
		current = { renderer, ktx2 };
	}
	await MeshoptDecoder.ready;
	return { ktx2: current.ktx2, meshopt: MeshoptDecoder };
}

/** Stops the transcoder's workers. */
export function disposeDecoders(): void {
	current?.ktx2.dispose();
	current = null;
}
