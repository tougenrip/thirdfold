// The cook's sizes (texture detail, docs/ASSETS.md "Texture detail"): every texture is cooked
// at a 512 px base, written into assets/ and committed, and at 1K and 2K where its source is that
// large, as variants: files named by their hash in `variants/` (never committed, served from the
// asset store) and recorded in assets/variants.lock.json (variants.ts). Recipes (assets/textures/
// <id>.json) are rendered here at 1K and 2K; their base is the build's.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
	BASE_PX,
	LIMITS,
	USAGE_SPACE,
	VARIANT_PX,
	limitClass,
	variantId,
	type ColorSpace,
	type TextureUsage,
	type VariantPx
} from '../../src/lib/assets/manifest';
import { KTX2_SETTINGS, cookImage, type Image } from './cook-textures';
import { checkKtx2 } from './ktx2';
import { readMeta } from './licence';
import { AssetError, isRecord, json, readJson } from './pipeline-files';
import { decodePng } from './png';
import { encodePng } from './png';
import { readTextureSource, renderTexture } from './textures';
import type { VariantRecord } from './variants';

/** A variant the cook made: what it is a copy of, and its bytes. */
export interface VariantOut {
	kind: 'textures' | 'models';
	id: string;
	size: VariantPx;
	ext: 'ktx2' | 'png' | 'glb';
	data: Uint8Array;
	gpuBytes: number;
}

/** What one art entry cooks into: files for assets/, and variants. */
export interface Cooked {
	outputs: Map<string, Uint8Array>;
	variants: VariantOut[];
}

/** The variant sizes a source of `sourcePx` makes, up to `maxPx`: none past what the source has. */
export const variantSizes = (sourcePx: number, maxPx: number): VariantPx[] =>
	VARIANT_PX.filter((s) => s <= sourcePx && s <= maxPx);

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

/** Writes variants into `root` by their hashed names; their records for the lock. */
export function writeVariants(root: string, variants: VariantOut[]): VariantRecord[] {
	return variants.map((v) => {
		const hash = sha256(v.data);
		const file = `${v.kind}/${variantId(v.id, v.size)}.${hash.slice(0, 8)}.${v.ext}`;
		mkdirSync(path.join(root, v.kind), { recursive: true });
		writeFileSync(path.join(root, file), v.data);
		return { size: v.size, file, sha256: hash, bytes: v.data.length, gpuBytes: v.gpuBytes };
	});
}

type Settings = (typeof KTX2_SETTINGS)[keyof typeof KTX2_SETTINGS];

/**
 * An image as KTX2 at the base and each variant size its source reaches: the base at most
 * BASE_PX, and never over `maxPx`. Each variant is checked as the build checks a texture, and one
 * over the class's file size is left out.
 */
export async function ktx2Sizes(
	id: string,
	image: Image,
	usage: TextureUsage,
	maxPx: number,
	settings: Settings = KTX2_SETTINGS[USAGE_SPACE[usage]]
): Promise<{ base: Uint8Array; variants: VariantOut[] }> {
	const space: ColorSpace = USAGE_SPACE[usage];
	const normal = usage === 'normal';
	const base = await cookImage(image, space, Math.min(BASE_PX, maxPx), normal, settings);
	const limit = LIMITS[limitClass({ usage })];
	const variants: VariantOut[] = [];
	for (const size of variantSizes(Math.max(image.width, image.height), maxPx)) {
		const data = await cookImage(image, space, size, normal, settings);
		const checked = checkKtx2(data, {
			maxPx: limit.px,
			maxGpuBytes: limit.gpuBytes,
			colorSpace: space
		});
		if (!checked.ok) throw new Error(`${size} px: ${checked.error}`);
		// Over the class's file size (a 2K normal map of busy detail): it draws the size below.
		if (data.length > limit.bytes) continue;
		variants.push({
			kind: 'textures',
			id,
			size,
			ext: 'ktx2',
			data,
			gpuBytes: checked.info.gpuBytes
		});
	}
	return { base, variants };
}

/** The recipes in assets/textures, by id: what `recipes/<id>` entries of the cook are made from. */
export function recipeIds(names: string[]): string[] {
	return names
		.filter((n) => n.endsWith('.json') && !n.endsWith('.meta.json'))
		.map((n) => n.slice(0, -5));
}

/**
 * A recipe's 1K and 2K as PNG (its base is the build's, at BASE_PX). A size whose PNG is over the
 * texture limits is left out, and the texture draws its largest one below.
 */
export function cookRecipe(dir: string, id: string): Cooked {
	const source = path.join(dir, `${id}.json`);
	const raw = readJson(source);
	const usage = (
		isRecord(raw) && typeof raw.usage === 'string' ? raw.usage : 'albedo'
	) as TextureUsage;
	const limit = LIMITS[limitClass({ usage })];
	const variants: VariantOut[] = [];
	for (const size of VARIANT_PX) {
		let data: Uint8Array;
		try {
			data = encodePng(size, size, renderTexture(readTextureSource(raw), size));
		} catch (err) {
			throw new AssetError(source, (err as Error).message);
		}
		const gpuBytes = Math.ceil((size * size * 4 * 4) / 3);
		if (data.length > limit.bytes || gpuBytes > limit.gpuBytes) continue;
		variants.push({ kind: 'textures', id, size, ext: 'png', data, gpuBytes });
	}
	return { outputs: new Map(), variants };
}

/** The hash of a recipe file, as the cook lock pins it. */
export const recipeSource = (dir: string, id: string) => ({
	[`${id}.json`]: sha256(readFileSync(path.join(dir, `${id}.json`)))
});

/** `art/texture/<id>`: its PNG as KTX2 at the base and the variant sizes it reaches. */
export async function cookTextureEntry(dir: string, id: string): Promise<Cooked> {
	const meta = readMeta(dir);
	const source = path.join(dir, `${id}.png`);
	if (!existsSync(source)) throw new AssetError(dir, `needs ${id}.png`);
	const usage = (meta.usage ?? 'albedo') as TextureUsage;
	if (!(usage in USAGE_SPACE) || usage === 'sky' || usage === 'lut') {
		throw new AssetError(
			dir,
			`a cooked texture's usage is albedo, normal, orm, emissive and the like`
		);
	}
	const maxPx = Math.min(meta.textureSize ?? LIMITS.texture.px, LIMITS.texture.px);
	let cooked;
	try {
		cooked = await ktx2Sizes(id, decodePng(readFileSync(source)), usage, maxPx);
	} catch (err) {
		throw new AssetError(source, (err as Error).message);
	}
	return {
		outputs: new Map([
			[`textures/${id}.ktx2`, cooked.base],
			[`textures/${id}.meta.json`, Buffer.from(json({ usage, provenance: meta.provenance }))]
		]),
		variants: cooked.variants
	};
}
