// Models (see src/lib/assets/manifest.ts): loaded on first use and kept, one
// load per model however many props or tokens use it. A model is up to three
// geometries: `body` and `swing` carry their colours as vertex colours,
// `accent` takes the token's colour. Until one has loaded, props and tokens
// show their placeholders.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ModelEntry } from '$lib/assets/manifest';
import { assetUrl, loadManifest } from '$lib/assets/load';

export interface LoadedModel {
	entry: ModelEntry;
	body: THREE.BufferGeometry | null;
	swing: THREE.BufferGeometry | null;
	accent: THREE.BufferGeometry | null;
}

const cache = new Map<string, Promise<LoadedModel | null>>();
/** Models that have loaded (or failed: null), for drawing without waiting. */
const ready = new Map<string, LoadedModel | null>();

/** The model if it has loaded (null if it can't), undefined while it hasn't yet. */
export function modelNow(id: string): LoadedModel | null | undefined {
	return ready.get(id);
}

/** Loads a model once; null if the manifest has no such model or it fails to load. */
export function loadModel(id: string): Promise<LoadedModel | null> {
	let loading = cache.get(id);
	if (!loading) {
		loading = load(id).catch((err: Error) => {
			console.warn(`[assets] model "${id}" failed to load:`, err.message);
			return null;
		});
		loading.then((m) => ready.set(id, m));
		cache.set(id, loading);
	}
	return loading;
}

async function load(id: string): Promise<LoadedModel | null> {
	const entry = (await loadManifest()).models[id];
	if (!entry) return null;
	const response = await fetch(assetUrl(entry.file));
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
	const model: LoadedModel = { entry, body: null, swing: null, accent: null };
	gltf.scene.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		const name = o.name as keyof Omit<LoadedModel, 'entry'>;
		if (name !== 'body' && name !== 'swing' && name !== 'accent') return;
		const geometry = (o.geometry as THREE.BufferGeometry).clone();
		// Files carry no normals: every hard edge has its own vertices, so these match.
		if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
		geometry.computeBoundingSphere();
		model[name] = geometry;
		(o.geometry as THREE.BufferGeometry).dispose();
		(Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
	});
	return model;
}
