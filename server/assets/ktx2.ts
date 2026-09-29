// KTX2 textures, standalone (floor arrays, skies) or inside a model: only
// Basis Universal (ETC1S with BasisLZ, or UASTC with Zstd or nothing), of a
// size the asset's class allows, whose every declared range lies inside the
// file. The header is checked by hand before ktx-parse reads the rest, so a
// file that lies about its levels is refused before anything trusts it.
// Pure over bytes, so an upload path can use it as it is.

import {
	KHR_DF_MODEL_ETC1S,
	KHR_DF_MODEL_UASTC,
	KHR_DF_TRANSFER_LINEAR,
	KHR_DF_TRANSFER_SRGB,
	KHR_SUPERCOMPRESSION_BASISLZ,
	KHR_SUPERCOMPRESSION_ZSTD,
	read
} from 'ktx-parse';
import type { ColorSpace } from '../../src/lib/assets/manifest';

export interface Ktx2Rules {
	/** The largest side, in pixels. */
	maxPx: number;
	/** What it may take on the GPU (see Ktx2Info.gpuBytes). */
	maxGpuBytes: number;
	/** Array layers allowed: 1 unless it is an array texture (at most MAX_LAYERS). */
	maxLayers?: number;
	/** Six faces allowed (a sky). */
	cube?: boolean;
	/** The colour space it must declare, if its use is known. */
	colorSpace?: ColorSpace;
}

export interface Ktx2Info {
	width: number;
	height: number;
	levels: number;
	layers: number;
	faces: number;
	codec: 'etc1s' | 'uastc';
	colorSpace: ColorSpace;
	/** Transcoded with mips, at 8 bits a pixel at worst. */
	gpuBytes: number;
}

export type Ktx2Checked = { ok: true; info: Ktx2Info } | { ok: false; error: string };

/** The most layers an array texture (a floor set) may have. */
export const MAX_LAYERS = 32;

const IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
const HEADER = 80;
const LEVEL = 24;

/** Whether `data` is a KTX2 texture these rules allow, and what it holds. */
export function checkKtx2(data: Uint8Array, rules: Ktx2Rules): Ktx2Checked {
	const bad = (error: string): Ktx2Checked => ({ ok: false, error: `KTX2: ${error}` });
	if (data.length < HEADER || IDENTIFIER.some((b, i) => data[i] !== b)) {
		return { ok: false, error: 'not a KTX2 file' };
	}
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const u32 = (at: number) => view.getUint32(at, true);
	// Offsets and lengths past 4 GB are lies in any file we accept.
	const u64 = (at: number) => (u32(at + 4) === 0 ? u32(at) : Infinity);
	const inside = (offset: number, length: number) => offset + length <= data.length;

	const [vkFormat, typeSize, width, height, depth, layerCount, faces, levels, scheme] = [
		12, 16, 20, 24, 28, 32, 36, 40, 44
	].map(u32);
	if (vkFormat !== 0 || typeSize !== 1) return bad('only Basis Universal textures are allowed');
	if (depth !== 0) return bad('3D textures are not allowed');
	for (const side of [width, height]) {
		if (side < 4 || side % 4) return bad(`${width}×${height} is not a multiple of 4`);
		if (side > rules.maxPx) return bad(`${width}×${height} is larger than ${rules.maxPx} pixels`);
	}
	const layers = Math.max(layerCount, 1);
	if (layers > Math.min(rules.maxLayers ?? 1, MAX_LAYERS)) {
		return bad(`${layerCount} layers is more than allowed`);
	}
	if (faces !== 1 && !(faces === 6 && rules.cube)) return bad(`${faces} faces is not allowed`);
	const maxLevels = Math.floor(Math.log2(Math.max(width, height))) + 1;
	if (levels < 1 || levels > maxLevels) return bad(`${levels} mip levels for ${width}×${height}`);
	// None (0), BasisLZ (1) or Zstd (2); never zlib or anything later.
	if (scheme > KHR_SUPERCOMPRESSION_ZSTD) {
		return bad(`supercompression ${scheme} is not allowed`);
	}
	if (!inside(HEADER, levels * LEVEL)) return bad('truncated level index');
	for (const [offset, length] of [
		[u32(48), u32(52)],
		[u32(56), u32(60)],
		[u64(64), u64(72)]
	]) {
		if (!inside(offset, length)) return bad('a block runs past the end of the file');
	}
	let declared = 0;
	for (let i = 0; i < levels; i++) {
		const at = HEADER + i * LEVEL;
		const length = u64(at + 8);
		if (length === 0 || !inside(u64(at), length)) return bad(`level ${i} runs past the file`);
		declared += u64(at + 16);
	}

	const gpuBytes = Math.ceil((width * height * layers * faces * 4) / 3);
	if (gpuBytes > rules.maxGpuBytes) return bad('too large on the GPU');
	// What Zstd would inflate the levels to, declared before anything is inflated.
	if (declared > rules.maxGpuBytes) return bad('levels inflate past the limit');

	let container: ReturnType<typeof read>;
	try {
		container = read(data);
	} catch {
		return bad('does not parse');
	}
	const dfd = container.dataFormatDescriptor[0];
	const codec =
		dfd?.colorModel === KHR_DF_MODEL_ETC1S
			? 'etc1s'
			: dfd?.colorModel === KHR_DF_MODEL_UASTC
				? 'uastc'
				: null;
	if (!codec) return bad('neither ETC1S nor UASTC');
	if ((codec === 'etc1s') !== (scheme === KHR_SUPERCOMPRESSION_BASISLZ)) {
		return bad('ETC1S goes with BasisLZ, UASTC with Zstd or nothing');
	}
	const colorSpace =
		dfd.transferFunction === KHR_DF_TRANSFER_SRGB
			? 'srgb'
			: dfd.transferFunction === KHR_DF_TRANSFER_LINEAR
				? 'linear'
				: null;
	if (!colorSpace) return bad('neither sRGB nor linear');
	if (rules.colorSpace && colorSpace !== rules.colorSpace) {
		return bad(`declared ${colorSpace} where ${rules.colorSpace} is needed`);
	}
	return {
		ok: true,
		info: { width, height, levels, layers, faces, codec, colorSpace, gpuBytes }
	};
}
