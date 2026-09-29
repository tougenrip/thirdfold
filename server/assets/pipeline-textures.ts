// Textures for the asset pipeline (pipeline.ts): recipes and PNGs from
// assets/textures, and the colour grades' lookup-table strips from
// assets/grades. Each states what it is for (its usage, and so its colour
// space) and what it takes on the GPU.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
	LIMITS,
	TEXTURE_USAGES,
	TONE_MAPPERS,
	USAGE_SPACE,
	limitClass,
	type Credit,
	type EnvironmentDef,
	type TextureEntry,
	type TextureUsage
} from '../../src/lib/assets/manifest';
import { BANDS, LUT_SIZE, readGrades, renderGrade, stripProblem } from './grades';
import { MAX_LAYERS, checkKtx2 } from './ktx2';
import { creditOf, provenanceFor } from './licence';
import { AssetError, checkMeta, idOf, isRecord, list, readJson, type Emit } from './pipeline-files';
import { encodePng, pngSize } from './png';
import { readTextureSource, renderTexture } from './textures';

/** A texture's usage as its source states it: albedo unless it says otherwise. */
function usageOf(raw: unknown, source: string): TextureUsage {
	const usage = isRecord(raw) ? (raw.usage ?? 'albedo') : 'albedo';
	const known = TEXTURE_USAGES.find((u) => u === usage);
	if (!known) throw new AssetError(source, `usage must be one of ${TEXTURE_USAGES.join(', ')}`);
	return known;
}

/** A PNG's entry, checked against its class's limits. */
function pngTexture(
	emit: Emit,
	source: string,
	id: string,
	png: Buffer,
	usage: TextureUsage,
	credit: Credit
): TextureEntry {
	const size = pngSize(png);
	if (!size) throw new AssetError(source, 'not a PNG');
	const limit = LIMITS[limitClass({ usage })];
	if (size.width > limit.px || size.height > limit.px) {
		throw new AssetError(source, `larger than ${limit.px} pixels`);
	}
	if (png.length > limit.bytes) throw new AssetError(source, 'file too large');
	// 32 bits a pixel once decoded, and a third more for the mips the GPU makes.
	const gpuBytes = Math.ceil((size.width * size.height * 4 * 4) / 3);
	if (gpuBytes > limit.gpuBytes) throw new AssetError(source, 'too large on the GPU');
	return {
		...emit('textures', id, 'png', png),
		bytes: png.length,
		format: 'png',
		usage,
		colorSpace: USAGE_SPACE[usage],
		...size,
		layers: 1,
		levels: 1,
		gpuBytes,
		credit
	};
}

/** A KTX2 texture's entry: its header checked against its usage's class (arrays, and a sky's six faces). */
function ktx2Texture(
	emit: Emit,
	source: string,
	id: string,
	data: Buffer,
	usage: TextureUsage,
	credit: Credit
): TextureEntry {
	const limit = LIMITS[limitClass({ usage })];
	if (data.length > limit.bytes) throw new AssetError(source, 'file too large');
	const checked = checkKtx2(data, {
		maxPx: limit.px,
		maxGpuBytes: limit.gpuBytes,
		maxLayers: MAX_LAYERS,
		cube: usage === 'sky',
		colorSpace: USAGE_SPACE[usage]
	});
	if (!checked.ok) throw new AssetError(source, checked.error);
	const { width, height, layers, levels, gpuBytes } = checked.info;
	return {
		...emit('textures', id, 'ktx2', data),
		bytes: data.length,
		format: 'ktx2',
		usage,
		colorSpace: USAGE_SPACE[usage],
		width,
		height,
		layers,
		levels,
		gpuBytes,
		credit
	};
}

/**
 * assets/textures: `<id>.json` recipes, or `<id>.png` or `<id>.ktx2` images with an optional
 * `<id>.meta.json` for their usage.
 */
export function buildTextures(dir: string, emit: Emit): Record<string, TextureEntry> {
	const textures: Record<string, TextureEntry> = {};
	const textureDir = path.join(dir, 'textures');
	for (const name of list(textureDir)) {
		const source = path.join(textureDir, name);
		const { id, ext } = idOf(name, textureDir);
		if (ext === 'meta.json') {
			checkMeta(textureDir, id, existsSync(path.join(textureDir, `${id}.ktx2`)) ? 'ktx2' : 'png');
			continue;
		}
		if (Object.hasOwn(textures, id))
			throw new AssetError(source, 'a texture with this id already exists');
		let png: Buffer;
		let usage: TextureUsage;
		if (ext === 'json') {
			const raw = readJson(source);
			usage = usageOf(raw, source);
			try {
				const recipe = readTextureSource(raw);
				png = encodePng(recipe.size, recipe.size, renderTexture(recipe));
			} catch (err) {
				throw new AssetError(source, (err as Error).message);
			}
		} else if (ext === 'png') {
			png = readFileSync(source);
			const meta = path.join(textureDir, `${id}.meta.json`);
			usage = usageOf(existsSync(meta) ? readJson(meta) : {}, meta);
		} else if (ext === 'ktx2') {
			const meta = path.join(textureDir, `${id}.meta.json`);
			const usage = usageOf(existsSync(meta) ? readJson(meta) : {}, meta);
			const credit = creditOf(provenanceFor(textureDir, id, ext));
			textures[id] = ktx2Texture(emit, source, id, readFileSync(source), usage, credit);
			continue;
		} else throw new AssetError(source, 'textures are .json recipes, or .png or .ktx2 images');
		const credit = creditOf(provenanceFor(textureDir, id, ext));
		textures[id] = pngTexture(emit, source, id, png, usage, credit);
	}
	return textures;
}

/** assets/grades: each band of an environment for each tone mapper, as a lookup-table strip. */
export function buildGrades(
	dir: string,
	emit: Emit,
	environments: Record<string, EnvironmentDef>,
	textures: Record<string, TextureEntry>
): void {
	const gradeDir = path.join(dir, 'grades');
	for (const name of list(gradeDir)) {
		const source = path.join(gradeDir, name);
		const { id, ext } = idOf(name, gradeDir);
		if (ext !== 'json') throw new AssetError(source, 'grades are .json');
		if (!(id in environments)) throw new AssetError(source, `no environment "${id}"`);
		const credit = creditOf(provenanceFor(gradeDir, id, ext));
		let grades;
		try {
			grades = readGrades(readJson(source));
		} catch (err) {
			throw new AssetError(source, (err as Error).message);
		}
		const lut = {} as NonNullable<EnvironmentDef['lut']>;
		for (const tm of TONE_MAPPERS) {
			lut[tm] = {} as NonNullable<EnvironmentDef['lut']>[typeof tm];
			for (const band of BANDS) {
				const strip = renderGrade(grades[band][tm]);
				const problem = stripProblem(strip);
				if (problem) throw new AssetError(source, `${band} after ${tm}: ${problem}`);
				const texture = `grade-${id}-${band}-${tm}`;
				if (Object.hasOwn(textures, texture))
					throw new AssetError(source, `texture "${texture}" exists`);
				const png = encodePng(LUT_SIZE * LUT_SIZE, LUT_SIZE, strip, 'sub');
				textures[texture] = pngTexture(emit, source, texture, png, 'lut', credit);
				lut[tm][band] = texture;
			}
		}
		environments[id].lut = lut;
	}
}
