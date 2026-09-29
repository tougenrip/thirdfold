// The asset pipeline: builds everything in assets/ into the files the client
// loads (static/assets/) and the manifest that lists them. Repeatable: the
// same sources always build the same bytes, each file named by its content's
// hash, so browsers can cache them for good and a test can tell when the
// built files are out of date.
//
// Sources (see docs/ASSETS.md):
//   assets/materials.json               named surfaces: colour, roughness, metalness, texture
//   assets/textures/<id>.json | .png | .ktx2  a recipe, or an image (<id>.meta.json: its usage)
//   assets/models/<kind>/<id>.json      a model from primitive parts (kind: a MODEL_KINDS folder)
//   assets/models/<kind>/<id>.glb       or a model made elsewhere or cooked, with <id>.meta.json for its swing
//   assets/environments/<id>.json       how a place looks: materials for floor, ground, walls, table?
//   assets/grades/<environment>.json    its colour grade per band, rendered per tone mapper
//   assets/audio/<id>.json | .wav | .ogg a sound rendered from a recipe (a bell), or a sound file
//
// Nothing built is executable: models are checked against an allowlist
// (glb.ts, gltf-check.ts), images and sounds by their headers (KTX2 in
// ktx2.ts), and every limit in LIMITS holds for the asset's class. Every
// file is listed with its whole SHA-256. Models are built in
// pipeline-models.ts, textures and grades in pipeline-textures.ts, sounds in
// pipeline-audio.ts.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
	ASSET_ID_PATTERN,
	MANIFEST_VERSION,
	type EnvironmentDef,
	type Manifest,
	type MaterialDef,
	type TextureEntry,
	type TextureUsage
} from '../../src/lib/assets/manifest';
import { parseManifest } from '../../src/lib/assets/manifest-parse';
import { ASSET_IDS } from '../../src/lib/game/props';
import { buildAudio } from './pipeline-audio';
import { AssetError, emitter, idOf, isRecord, list, readJson } from './pipeline-files';
import { buildModels } from './pipeline-models';
import { buildGrades, buildTextures } from './pipeline-textures';

export { AssetError } from './pipeline-files';

export interface BuiltAssets {
	manifest: Manifest;
	/** Built files by their path under the output folder. */
	files: Map<string, Buffer>;
}

const COLOR = /^#[0-9a-f]{6}$/;

/** assets/materials.json: named surfaces, whose maps are textures of the right usage. */
function buildMaterials(
	dir: string,
	textures: Record<string, TextureEntry>
): Record<string, MaterialDef> {
	const materials: Record<string, MaterialDef> = {};
	const materialFile = path.join(dir, 'materials.json');
	if (!existsSync(materialFile)) return materials;
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
		const texture = (v: unknown, usage: TextureUsage) => {
			if (typeof v !== 'string' || !Object.hasOwn(textures, v)) {
				throw new AssetError(where, `unknown texture "${String(v)}"`);
			}
			if (textures[v].usage !== usage) throw new AssetError(where, `"${v}" is not ${usage}`);
			return v;
		};
		const def: MaterialDef = {
			color: m.color,
			roughness: unit(m.roughness, 0.8),
			metalness: unit(m.metalness, 0)
		};
		if (m.map !== undefined) {
			def.map = texture(m.map, 'albedo');
			def.cells = typeof m.cells === 'number' ? m.cells : 1;
		}
		if (m.normal !== undefined) def.normal = texture(m.normal, 'normal');
		if (m.orm !== undefined) def.orm = texture(m.orm, 'orm');
		materials[id] = def;
	}
	return materials;
}

/** assets/environments: the materials of each place's floor, ground, walls and (optionally) rim. */
function buildEnvironments(
	dir: string,
	materials: Record<string, MaterialDef>
): Record<string, EnvironmentDef> {
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
			if (typeof m !== 'string' || !Object.hasOwn(materials, m)) {
				throw new AssetError(source, `"${k}" must name a material`);
			}
			return m;
		};
		environments[id] = {
			name: raw.name,
			surface: material('surface'),
			ground: material('ground'),
			walls: material('walls'),
			...(raw.table !== undefined ? { table: material('table') } : {})
		};
	}
	return environments;
}

/** Builds every asset under `dir`. Throws an AssetError naming the first bad source. */
export async function buildAssets(dir: string): Promise<BuiltAssets> {
	const files = new Map<string, Buffer>();
	const emit = emitter(files);
	// Textures first: materials refer to them, and models to materials.
	const textures = buildTextures(dir, emit);
	const materials = buildMaterials(dir, textures);
	const models = await buildModels(dir, emit, materials);
	const environments = buildEnvironments(dir, materials);
	buildGrades(dir, emit, environments, textures);
	const audio = buildAudio(dir, emit);

	// Every prop in the catalogue has a model, so no table is left with placeholders.
	for (const assetId of ASSET_IDS) {
		if (models[assetId]?.kind !== 'prop') {
			throw new AssetError(path.join(dir, 'models', 'prop'), `no model for the prop "${assetId}"`);
		}
	}

	const manifest: Manifest = {
		version: MANIFEST_VERSION,
		models,
		textures,
		materials,
		surfaces: {},
		environments,
		audio,
		packs: {}
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
