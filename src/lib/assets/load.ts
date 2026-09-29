// Loading assets in the browser: the manifest once, then each file only when
// something needs it. A failed manifest leaves an empty one (every table
// then keeps its placeholders), and says so in the console.
//
// Built files come from the same origin as the page, or from an asset host
// (VITE_ASSET_BASE_URL, #191) when one is set. A file from elsewhere is
// checked against the manifest's whole SHA-256 before anything decodes it,
// and refused if it differs: the manifest itself always comes with the page.
// Checking needs a secure context (crypto.subtle); a page without one (plain
// http on a LAN) loads everything from its own origin, and so do the native
// shells, which carry the files with them and must work offline.

import { base } from '$app/paths';
import { forPlatform, isNativeShell } from '$lib/api';
import { ASSET_FILE_PATTERN, EMPTY_MANIFEST, type Manifest } from './manifest';
import { parseManifest } from './manifest-parse';

let manifest: Promise<Manifest> | null = null;
let loaded: Manifest | null = null;

/** Where a built asset file is served on this origin (the manifest and the decoders, always). */
export function assetUrl(file: string): string {
	return `${base}/assets/${file}`;
}

/** The asset host, without a trailing slash; empty for the page's own origin (always in a shell). */
const ASSET_BASE = isNativeShell()
	? ''
	: forPlatform(import.meta.env.VITE_ASSET_BASE_URL ?? '').replace(/\/+$/, '');

/**
 * Whether files come from the asset host, checked: the only place texture detail's 1K and 2K
 * variants are (detail.ts). Without one (CI, tests, a native shell) every texture is its base.
 */
export const remoteAssets = (): boolean =>
	ASSET_BASE !== '' && !!globalThis.isSecureContext && !!globalThis.crypto?.subtle;

/** The manifest's URL, versioned by its content so no cache keeps an old one past an update. */
export const manifestUrl = (): string => assetUrl(`manifest.json?v=${__ASSET_MANIFEST__}`);

export function loadManifest(): Promise<Manifest> {
	manifest ??= fetch(manifestUrl())
		.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
		.then((raw: unknown) => {
			const parsed = parseManifest(raw);
			if (!parsed.ok) throw new Error(parsed.error);
			return parsed.manifest;
		})
		.catch((err: Error) => {
			console.warn('[assets] no asset manifest; drawing placeholders:', err.message);
			return EMPTY_MANIFEST;
		})
		.then((m) => (loaded = m));
	return manifest;
}

/** The manifest if it has loaded (or failed: the empty one), for planning without waiting. */
export const manifestNow = (): Manifest | null => loaded;

export type Priority = 'high' | 'low';

/** Downloads at once; the rest wait, what the table needs now ahead of what it may need later. */
const MAX_IN_FLIGHT = 6;
let inFlight = 0;
const waiting: Record<Priority, (() => void)[]> = { high: [], low: [] };

async function acquire(priority: Priority): Promise<void> {
	if (inFlight < MAX_IN_FLIGHT) {
		inFlight++;
		return;
	}
	// The slot is handed over by `release`, so inFlight stays counted.
	await new Promise<void>((resolve) => waiting[priority].push(resolve));
}

function release(): void {
	const next = waiting.high.shift() ?? waiting.low.shift();
	if (next) next();
	else inFlight--;
}

const hex = (digest: ArrayBuffer) =>
	Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * A built file's bytes (`file` as the manifest lists it, `sha256` its whole digest). From the
 * asset host when one is set and the page can check what it gets, else from this origin. Rejects
 * on a failed download or, from the host, on bytes that are not the manifest's: callers keep
 * their placeholder and warn.
 */
export async function fetchAsset(
	file: string,
	sha256: string,
	priority: Priority = 'high'
): Promise<ArrayBuffer> {
	if (!ASSET_FILE_PATTERN.test(file)) throw new Error(`not an asset file: ${file}`);
	const remote = remoteAssets();
	const subtle = globalThis.crypto?.subtle;
	await acquire(priority);
	let bytes: ArrayBuffer;
	try {
		const response = await fetch(remote ? `${ASSET_BASE}/${file}` : assetUrl(file), { priority });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		bytes = await response.arrayBuffer();
	} finally {
		release();
	}
	if (remote && hex(await subtle!.digest('SHA-256', bytes)) !== sha256) {
		throw new Error(`${file} is not what the manifest lists (SHA-256 differs)`);
	}
	return bytes;
}
