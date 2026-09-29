// Texture detail's larger copies (docs/ASSETS.md "Texture detail"): a texture's or cooked
// model's 1K and 2K variants. The cook makes them (cook-variants.ts) into `variants/`, which git
// ignores, and records each in assets/variants.lock.json, which is committed; the asset store
// serves them (store.ts publishes and pulls them). The build reads only the lock, so the manifest
// is the same bytes whether or not the files are here, as the cook treats art kept elsewhere;
// a file that is here must be what the lock says.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
	ASSET_FILE_PATTERN,
	SHA256_PATTERN,
	VARIANT_PX,
	type Manifest,
	type Variant,
	type VariantPx
} from '../../src/lib/assets/manifest';
import { AssetError, isRecord, json } from './pipeline-files';

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

/** Where the cook writes variants, as `<folder>/<id>-1k|2k.<hash>.<ext>`: never committed. */
export const VARIANTS_DIR = 'variants';
export const VARIANT_LOCK = 'variants.lock.json';

/** A variant as the lock records it: the manifest's, less the credit (its base's). */
export type VariantRecord = Omit<Variant, 'credit'>;
export interface VariantLock {
	textures: Record<string, VariantRecord[]>;
	models: Record<string, VariantRecord[]>;
}

/** `<dir>/variants.lock.json`, checked; empty when there is none. */
export function readVariantLock(dir: string): VariantLock {
	const file = path.join(dir, VARIANT_LOCK);
	if (!existsSync(file)) return { textures: {}, models: {} };
	const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
	const section = (v: unknown) => {
		if (!isRecord(v)) throw new AssetError(file, 'needs "textures" and "models"');
		for (const [id, list] of Object.entries(v)) {
			const ok =
				Array.isArray(list) &&
				list.every(
					(r) =>
						isRecord(r) &&
						VARIANT_PX.includes(r.size as VariantPx) &&
						typeof r.file === 'string' &&
						ASSET_FILE_PATTERN.test(r.file) &&
						typeof r.sha256 === 'string' &&
						SHA256_PATTERN.test(r.sha256) &&
						Number.isInteger(r.bytes) &&
						Number.isInteger(r.gpuBytes)
				);
			if (!ok) throw new AssetError(file, `bad variants for ${id}`);
		}
		return v as Record<string, VariantRecord[]>;
	};
	if (!isRecord(raw)) throw new AssetError(file, 'not an object');
	return { textures: section(raw.textures), models: section(raw.models) };
}

/** The lock as written: ids sorted, each entry's variants smallest first. */
export function variantLockText(lock: VariantLock): string {
	const sorted = (s: Record<string, VariantRecord[]>) =>
		Object.fromEntries(
			Object.keys(s)
				.sort()
				.map((id) => [id, [...s[id]].sort((a, b) => a.size - b.size)])
		);
	return json({ textures: sorted(lock.textures), models: sorted(lock.models) });
}

/**
 * Puts the lock's variants on their manifest entries, credited as their base. A variant of an
 * entry the build didn't make is an error (the parser checks the rest: sizes, names, limits).
 */
export function attachVariants(manifest: Manifest, lock: VariantLock, where: string): void {
	for (const kind of ['textures', 'models'] as const) {
		for (const [id, records] of Object.entries(lock[kind])) {
			const entry = manifest[kind][id];
			if (!entry) throw new AssetError(where, `variants of ${kind} "${id}", which isn't built`);
			if (records.length) entry.variants = records.map((r) => ({ ...r, credit: entry.credit }));
		}
	}
}

/** Every variant file the lock lists, with its hash. */
export const lockedVariants = (lock: VariantLock): [string, string][] =>
	[...Object.values(lock.textures), ...Object.values(lock.models)].flatMap((list) =>
		list.map((r) => [r.file, r.sha256] as [string, string])
	);

/** Variant files here that differ from the lock (those not here are kept elsewhere). */
export function staleVariants(root: string, lock: VariantLock): string[] {
	return lockedVariants(lock).flatMap(([file, hash]) => {
		const at = path.join(root, file);
		return existsSync(at) && sha256(readFileSync(at)) !== hash
			? [`${file} is not what ${VARIANT_LOCK} lists`]
			: [];
	});
}
