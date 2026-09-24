// Loading assets in the browser: the manifest once, then each file only when
// something needs it. A failed manifest leaves an empty one (every table
// then keeps its placeholders), and says so in the console.

import { base } from '$app/paths';
import { EMPTY_MANIFEST, parseManifest, type Manifest } from './manifest';

let manifest: Promise<Manifest> | null = null;

/** Where a built asset file is served. */
export function assetUrl(file: string): string {
	return `${base}/assets/${file}`;
}

export function loadManifest(): Promise<Manifest> {
	manifest ??= fetch(assetUrl('manifest.json'))
		.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
		.then((raw: unknown) => {
			const parsed = parseManifest(raw);
			if (!parsed.ok) throw new Error(parsed.error);
			return parsed.manifest;
		})
		.catch((err: Error) => {
			console.warn('[assets] no asset manifest; drawing placeholders:', err.message);
			return EMPTY_MANIFEST;
		});
	return manifest;
}
