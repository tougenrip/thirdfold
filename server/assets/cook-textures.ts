// Textures for the cook (cook.ts): an artist's PNG to a KTX2 texture, with
// the Basis Universal encoder (ktx2-encoder, WASM, single-threaded, so the
// same PNG gives the same bytes on any machine). Colour (albedo, emissive) is
// ETC1S with sRGB transfer; data (normal, ORM) is UASTC with RDO and Zstd,
// linear. Always every mip level, and a power-of-two size.

import { encodeToKTX2 } from 'ktx2-encoder';
import type { ColorSpace } from '../../src/lib/assets/manifest';
import { decodePng } from './png';

export type Image = { width: number; height: number; data: Uint8Array };

/** The encoder settings per colour space: what the lock records, so a change re-cooks. */
export const KTX2_SETTINGS = {
	srgb: { isUASTC: false, qualityLevel: 128, compressionLevel: 2 },
	linear: { isUASTC: true, enableRDO: true, rdoQualityLevel: 0.5, needSupercompression: true },
	/**
	 * The surface library's data maps (#187), which repeat under the whole table: its normals
	 * with a stronger RDO, and its ORM (soft occlusion and roughness) as ETC1S, a sixth the size.
	 */
	surfaceNormal: { isUASTC: true, enableRDO: true, rdoQualityLevel: 3, needSupercompression: true },
	surfaceOrm: { isUASTC: false, qualityLevel: 128, compressionLevel: 2 }
};

type Settings = (typeof KTX2_SETTINGS)[keyof typeof KTX2_SETTINGS];

/** Halves an image (a box filter) until neither side is over `max`. */
export function fit(image: Image, max: number): Image {
	let { width, height, data } = image;
	while (width > max || height > max) {
		const w = Math.max(1, width >> 1);
		const h = Math.max(1, height >> 1);
		const out = new Uint8Array(w * h * 4);
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				for (let c = 0; c < 4; c++) {
					let sum = 0;
					for (const [dx, dy] of [
						[0, 0],
						[1, 0],
						[0, 1],
						[1, 1]
					]) {
						const sx = Math.min(x * 2 + dx, width - 1);
						const sy = Math.min(y * 2 + dy, height - 1);
						sum += data[(sy * width + sx) * 4 + c];
					}
					out[(y * w + x) * 4 + c] = (sum + 2) >> 2;
				}
			}
		}
		[width, height, data] = [w, h, out];
	}
	return { width, height, data };
}

const powerOfTwo = (n: number) => n >= 4 && (n & (n - 1)) === 0;

/** The encoder prints its progress however it is set; the cook's output is the lock, not that. */
async function quietly<T>(run: () => Promise<T>): Promise<T> {
	const write = process.stdout.write;
	process.stdout.write = () => true;
	try {
		return await run();
	} finally {
		process.stdout.write = write;
	}
}

/**
 * A PNG as KTX2 for `space` (a normal map tuned as one), at most `maxPx` a side. Throws on a PNG
 * the decoder refuses, or a size that isn't a power of two (at least 4).
 */
export async function cookTexture(
	png: Uint8Array,
	space: ColorSpace,
	maxPx: number,
	normalMap = false
): Promise<Uint8Array> {
	return cookImage(decodePng(png), space, maxPx, normalMap);
}

/** An RGBA image as KTX2, as `cookTexture` (the surface library's stylised maps, #187). */
export async function cookImage(
	source: Image,
	space: ColorSpace,
	maxPx: number,
	normalMap = false,
	settings: Settings = KTX2_SETTINGS[space]
): Promise<Uint8Array> {
	const image = fit(source, maxPx);
	if (!powerOfTwo(image.width) || !powerOfTwo(image.height)) {
		throw new Error(`${image.width}×${image.height}: a texture's sides must be powers of two`);
	}
	const srgb = space === 'srgb';
	return quietly(() =>
		encodeToKTX2(new Uint8Array(0), {
			...settings,
			isNormalMap: normalMap,
			isPerceptual: srgb,
			isSetKTX2SRGBTransferFunc: srgb,
			generateMipmap: true,
			isKTX2File: true,
			imageDecoder: async () => image
		})
	);
}
