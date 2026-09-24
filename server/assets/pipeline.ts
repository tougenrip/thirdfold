// The asset pipeline: builds everything in assets/ into the files the client
// loads (static/assets/) and the manifest that lists them. Repeatable: the
// same sources always build the same bytes, each file named by its content's
// hash, so browsers can cache them for good and a test can tell when the
// built files are out of date.
//
// Sources (see docs/ASSETS.md):
//   assets/materials.json               named surfaces: colour, roughness, metalness, texture
//   assets/textures/<id>.json | .png    a texture recipe, or an image
//   assets/models/<kind>/<id>.json      a model from primitive parts (kind: prop, character, npc, enemy)
//   assets/models/<kind>/<id>.glb       or a model made elsewhere (meshes only), with <id>.meta.json for its swing
//   assets/environments/<id>.json       how a place looks: materials for floor, ground, walls, table
//   assets/audio/<id>.json | .wav | .ogg a sound rendered from a recipe (a bell), or a sound file
//
// Nothing built is executable: models are checked to be meshes only, images
// and sounds by their headers, and every limit in LIMITS holds.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
	ASSET_ID_PATTERN,
	LIMITS,
	MANIFEST_VERSION,
	parseManifest,
	type AudioEntry,
	type EnvironmentDef,
	type Manifest,
	type MaterialDef,
	type ModelEntry,
	type TextureEntry
} from '../../src/lib/assets/manifest';
import { ASSET_IDS } from '../../src/lib/game/props';
import { BELLS, type BellSize } from '../../src/lib/audio/bell';
import { audioInfo, encodeWav, renderBell } from './audio';
import { checkGlb, writeGlb } from './glb';
import { bakeModel, isModelKind, readModelSource } from './models';
import { encodePng, pngSize } from './png';
import { readTextureSource, renderTexture } from './textures';

export interface BuiltAssets {
	manifest: Manifest;
	/** Built files by their path under the output folder. */
	files: Map<string, Buffer>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const COLOR = /^#[0-9a-f]{6}$/;

/** A problem with one source, naming it. */
export class AssetError extends Error {
	constructor(source: string, message: string) {
		super(`${source}: ${message}`);
	}
}

function hash(data: Buffer): string {
	return createHash('sha256').update(data).digest('hex').slice(0, 8);
}

/** Files in a folder (none if it doesn't exist), sorted so builds are stable. */
function list(dir: string): string[] {
	return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function readJson(file: string): unknown {
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch (err) {
		throw new AssetError(file, `not valid JSON (${(err as Error).message})`);
	}
}

/** Splits `name.ext` into an asset id and extension, refusing ids that aren't asset ids. */
function idOf(file: string, dir: string): { id: string; ext: string } {
	const match = /^(.+?)\.([a-z.]+)$/.exec(file);
	if (!match || !ASSET_ID_PATTERN.test(match[1])) {
		throw new AssetError(
			path.join(dir, file),
			'file names must be an asset id (a-z, 0-9, -) and an extension'
		);
	}
	return { id: match[1], ext: match[2] };
}

/** Builds every asset under `dir`. Throws an AssetError naming the first bad source. */
export function buildAssets(dir: string): BuiltAssets {
	const files = new Map<string, Buffer>();
	const emit = (folder: string, id: string, ext: string, data: Buffer): string => {
		const file = `${folder}/${id}.${hash(data)}.${ext}`;
		files.set(file, data);
		return file;
	};

	// Textures first: materials refer to them.
	const textures: Record<string, TextureEntry> = {};
	const textureDir = path.join(dir, 'textures');
	for (const name of list(textureDir)) {
		const source = path.join(textureDir, name);
		const { id, ext } = idOf(name, textureDir);
		if (id in textures) throw new AssetError(source, 'a texture with this id already exists');
		let png: Buffer;
		if (ext === 'json') {
			try {
				const recipe = readTextureSource(readJson(source));
				png = encodePng(recipe.size, recipe.size, renderTexture(recipe));
			} catch (err) {
				throw new AssetError(source, (err as Error).message);
			}
		} else if (ext === 'png') png = readFileSync(source);
		else throw new AssetError(source, 'textures are .json recipes or .png images');
		const size = pngSize(png);
		if (!size) throw new AssetError(source, 'not a PNG');
		if (size.width > LIMITS.textureSize || size.height > LIMITS.textureSize) {
			throw new AssetError(source, `larger than ${LIMITS.textureSize} pixels`);
		}
		if (png.length > LIMITS.textureBytes) throw new AssetError(source, 'file too large');
		textures[id] = { file: emit('textures', id, 'png', png), bytes: png.length, ...size };
	}

	const materials: Record<string, MaterialDef> = {};
	const materialFile = path.join(dir, 'materials.json');
	if (existsSync(materialFile)) {
		const raw = readJson(materialFile);
		if (!isRecord(raw)) throw new AssetError(materialFile, 'not an object');
		for (const [id, m] of Object.entries(raw)) {
			const where = `${materialFile} (${id})`;
			if (!ASSET_ID_PATTERN.test(id)) throw new AssetError(where, 'bad id');
			if (!isRecord(m) || typeof m.color !== 'string' || !COLOR.test(m.color)) {
				throw new AssetError(where, 'needs a colour');
			}
			const unit = (v: unknown, fallback: number) => {
				const n = v ?? fallback;
				if (typeof n !== 'number' || n < 0 || n > 1)
					throw new AssetError(where, 'roughness and metalness are 0 to 1');
				return n;
			};
			const def: MaterialDef = {
				color: m.color,
				roughness: unit(m.roughness, 0.8),
				metalness: unit(m.metalness, 0)
			};
			if (m.map !== undefined) {
				if (typeof m.map !== 'string' || !(m.map in textures)) {
					throw new AssetError(where, `unknown texture "${String(m.map)}"`);
				}
				def.map = m.map;
				def.cells = typeof m.cells === 'number' ? m.cells : 1;
			}
			materials[id] = def;
		}
	}
	const materialColor = (id: string) => materials[id].color;

	const models: Record<string, ModelEntry> = {};
	const modelDir = path.join(dir, 'models');
	for (const kind of list(modelDir)) {
		if (!isModelKind(kind)) {
			throw new AssetError(
				path.join(modelDir, kind),
				'model folders are prop, character, npc and enemy'
			);
		}
		const kindDir = path.join(modelDir, kind);
		for (const name of list(kindDir)) {
			const source = path.join(kindDir, name);
			const { id, ext } = idOf(name, kindDir);
			if (ext === 'meta.json') continue;
			if (id in models) throw new AssetError(source, 'a model with this id already exists');
			let glb: Buffer;
			let swing: ModelEntry['swing'];
			try {
				if (ext === 'json') {
					const model = readModelSource(readJson(source), new Set(Object.keys(materials)));
					glb = writeGlb(bakeModel(model, materialColor));
					swing = model.swing;
				} else if (ext === 'glb') {
					glb = readFileSync(source);
					const meta = path.join(kindDir, `${id}.meta.json`);
					if (existsSync(meta)) {
						const m = readJson(meta);
						if (isRecord(m) && isRecord(m.swing)) swing = m.swing as ModelEntry['swing'];
					}
				} else throw new Error('models are .json part lists or .glb files');
			} catch (err) {
				throw err instanceof AssetError ? err : new AssetError(source, (err as Error).message);
			}
			const checked = checkGlb(glb);
			if (!checked.ok) throw new AssetError(source, checked.error);
			const unknown = checked.info.meshes.filter((m) => !['body', 'swing', 'accent'].includes(m));
			if (unknown.length) {
				throw new AssetError(
					source,
					`meshes must be named body, swing or accent (found ${unknown.join(', ')})`
				);
			}
			if (checked.info.triangles > LIMITS.modelTriangles) {
				throw new AssetError(
					source,
					`${checked.info.triangles} triangles is more than ${LIMITS.modelTriangles}`
				);
			}
			if (glb.length > LIMITS.modelBytes) throw new AssetError(source, 'file too large');
			const round = (v: number[]) =>
				v.map((n) => Math.round(n * 1000) / 1000) as [number, number, number];
			models[id] = {
				file: emit('models', id, 'glb', glb),
				bytes: glb.length,
				kind,
				triangles: checked.info.triangles,
				bounds: { min: round(checked.info.bounds.min), max: round(checked.info.bounds.max) },
				...(swing ? { swing } : {})
			};
		}
	}

	const environments: Record<string, EnvironmentDef> = {};
	const envDir = path.join(dir, 'environments');
	for (const name of list(envDir)) {
		const source = path.join(envDir, name);
		const { id, ext } = idOf(name, envDir);
		if (ext !== 'json') throw new AssetError(source, 'environments are .json');
		const raw = readJson(source);
		if (!isRecord(raw) || typeof raw.name !== 'string')
			throw new AssetError(source, 'needs a name');
		const material = (k: string) => {
			const m = raw[k];
			if (typeof m !== 'string' || !(m in materials)) {
				throw new AssetError(source, `"${k}" must name a material`);
			}
			return m;
		};
		environments[id] = {
			name: raw.name,
			surface: material('surface'),
			ground: material('ground'),
			walls: material('walls'),
			table: material('table')
		};
	}

	const audio: Record<string, AudioEntry> = {};
	const audioDir = path.join(dir, 'audio');
	for (const name of list(audioDir)) {
		const source = path.join(audioDir, name);
		const { id, ext } = idOf(name, audioDir);
		if (id in audio) throw new AssetError(source, 'a sound with this id already exists');
		let data: Buffer;
		if (ext === 'json') {
			const raw = readJson(source);
			const bell = isRecord(raw)
				? (Object.keys(BELLS) as BellSize[]).find((b) => b === raw.bell)
				: undefined;
			const rate = isRecord(raw) ? raw.rate : undefined;
			if (!bell || typeof rate !== 'number' || rate < 8000 || rate > 48000) {
				throw new AssetError(source, 'a sound recipe is { "bell": <size>, "rate": 8000..48000 }');
			}
			data = encodeWav(renderBell(bell, rate), rate);
		} else if (ext === 'wav' || ext === 'ogg') data = readFileSync(source);
		else throw new AssetError(source, 'sounds are .json recipes, .wav or .ogg');
		const info = audioInfo(data);
		if (!info || info.format !== (ext === 'json' ? 'wav' : ext))
			throw new AssetError(source, 'not a WAV or Ogg file');
		if (info.duration > LIMITS.audioSeconds) throw new AssetError(source, 'too long');
		if (data.length > LIMITS.audioBytes) throw new AssetError(source, 'file too large');
		audio[id] = {
			file: emit('audio', id, info.format, data),
			bytes: data.length,
			format: info.format,
			duration: Math.round(info.duration * 1000) / 1000
		};
	}

	// Every prop in the catalogue has a model, so no table is left with placeholders.
	for (const assetId of ASSET_IDS) {
		if (models[assetId]?.kind !== 'prop') {
			throw new AssetError(path.join(modelDir, 'prop'), `no model for the prop "${assetId}"`);
		}
	}

	const manifest: Manifest = {
		version: MANIFEST_VERSION,
		models,
		textures,
		materials,
		environments,
		audio
	};
	const checked = parseManifest(JSON.parse(JSON.stringify(manifest)));
	if (!checked.ok) throw new AssetError('manifest', checked.error);
	return { manifest, files };
}

export const MANIFEST_FILE = 'manifest.json';

export function manifestText(manifest: Manifest): string {
	return `${JSON.stringify(manifest, null, '\t')}\n`;
}

/** Writes the built files and manifest to `out`, removing built files that are no longer made. */
export function writeAssets(out: string, built: BuiltAssets): { written: number; removed: number } {
	let written = 0;
	let removed = 0;
	for (const [file, data] of built.files) {
		const target = path.join(out, file);
		if (existsSync(target)) continue;
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, data);
		written++;
	}
	for (const folder of list(out)) {
		const sub = path.join(out, folder);
		if (folder === MANIFEST_FILE) continue;
		for (const name of list(sub)) {
			if (built.files.has(`${folder}/${name}`)) continue;
			rmSync(path.join(sub, name));
			removed++;
		}
	}
	writeFileSync(path.join(out, MANIFEST_FILE), manifestText(built.manifest));
	return { written, removed };
}

/** What differs between `out` and a fresh build: files missing, stale or changed. Empty when up to date. */
export function staleAssets(out: string, built: BuiltAssets): string[] {
	const problems: string[] = [];
	const manifest = path.join(out, MANIFEST_FILE);
	if (!existsSync(manifest) || readFileSync(manifest, 'utf8') !== manifestText(built.manifest)) {
		problems.push(`${MANIFEST_FILE} is out of date`);
	}
	for (const [file, data] of built.files) {
		const target = path.join(out, file);
		if (!existsSync(target)) problems.push(`${file} is missing`);
		else if (!readFileSync(target).equals(data)) problems.push(`${file} differs`);
	}
	for (const folder of list(out)) {
		if (folder === MANIFEST_FILE) continue;
		for (const name of list(path.join(out, folder))) {
			if (!built.files.has(`${folder}/${name}`))
				problems.push(`${folder}/${name} is no longer built`);
		}
	}
	return problems;
}
