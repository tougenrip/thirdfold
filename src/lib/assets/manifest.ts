// The asset manifest: every model, texture, material, environment and sound
// the client can load, as the asset pipeline (server/assets) built them from
// the sources in assets/. The client fetches it from /assets/manifest.json
// and loads each file only when something on the table needs it.
//
// Assets are data only: models are glTF binaries with nothing but meshes
// (no scripts, extensions, cameras or external files), textures are PNGs,
// sounds are WAV or Ogg. Scene files and the room refer to assets by
// id only, never by content. Plain TypeScript with relative imports: the
// pipeline imports it too.

/** What an asset is for. Scenes are content too, but server-only (see docs/ASSETS.md). */
export const ASSET_KINDS = [
	'environment',
	'character',
	'npc',
	'enemy',
	'prop',
	'material',
	'texture',
	'audio'
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** Models are figures (characters, NPCs, enemies) or props. */
export const MODEL_KINDS = ['prop', 'character', 'npc', 'enemy'] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

/** An asset id: lowercase letters, digits and dashes. Scene files and tokens refer to these. */
export const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** A built file under /assets/: its folder, id, content hash and type. */
export const ASSET_FILE_PATTERN =
	/^[a-z]+\/[a-z0-9][a-z0-9-]{0,47}\.[0-9a-f]{8}\.(glb|png|wav|ogg)$/;

export const MANIFEST_VERSION = 1;

/** Upper bounds the pipeline enforces, so no asset can make a client download or draw too much. */
export const LIMITS = {
	modelBytes: 512 * 1024,
	modelTriangles: 20_000,
	textureBytes: 512 * 1024,
	textureSize: 1024,
	audioBytes: 2 * 1024 * 1024,
	audioSeconds: 30
} as const;

export interface FileInfo {
	/** Path under /assets/ (see ASSET_FILE_PATTERN). */
	file: string;
	bytes: number;
}

export interface ModelEntry extends FileInfo {
	kind: ModelKind;
	triangles: number;
	/** In model units (a cell is 1), around the footprint's centre on the floor. */
	bounds: { min: [number, number, number]; max: [number, number, number] };
	/** Parts that swing (a hanging bell, a lever's handle): the height they turn about, and how far a swing throws them. */
	swing?: { pivot: number; throw: number };
}

export interface TextureEntry extends FileInfo {
	width: number;
	height: number;
}

export interface MaterialDef {
	/** `#rrggbb`. */
	color: string;
	roughness: number;
	metalness: number;
	/** A texture id, if the material has one. */
	map?: string;
	/** How many cells one repeat of the texture covers. */
	cells?: number;
}

/** How a place looks: the materials of its floor, its raised ground, its walls and the table's rim. */
export interface EnvironmentDef {
	name: string;
	surface: string;
	ground: string;
	walls: string;
	table: string;
}

export interface AudioEntry extends FileInfo {
	format: 'wav' | 'ogg';
	/** Seconds. */
	duration: number;
}

export interface Manifest {
	version: number;
	models: Record<string, ModelEntry>;
	textures: Record<string, TextureEntry>;
	materials: Record<string, MaterialDef>;
	environments: Record<string, EnvironmentDef>;
	audio: Record<string, AudioEntry>;
}

export const EMPTY_MANIFEST: Manifest = {
	version: MANIFEST_VERSION,
	models: {},
	textures: {},
	materials: {},
	environments: {},
	audio: {}
};

type Parsed = { ok: true; manifest: Manifest } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const COLOR = /^#[0-9a-f]{6}$/;
const finite = (v: unknown, min = -Infinity, max = Infinity): v is number =>
	typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const vec3 = (v: unknown): v is [number, number, number] =>
	Array.isArray(v) && v.length === 3 && v.every((n) => finite(n, -100, 100));

class Invalid extends Error {}

/** Each entry of a section, checked by `check`; ids must be asset ids. */
function section<T>(
	raw: unknown,
	name: string,
	check: (v: unknown, id: string) => T
): Record<string, T> {
	if (!isRecord(raw)) throw new Invalid(`${name} is not an object`);
	const out: Record<string, T> = {};
	for (const [id, v] of Object.entries(raw)) {
		if (!ASSET_ID_PATTERN.test(id)) throw new Invalid(`bad ${name} id "${id}"`);
		out[id] = check(v, id);
	}
	return out;
}

function fileInfo(
	v: Record<string, unknown>,
	what: string,
	maxBytes: number,
	ext: readonly string[]
): FileInfo {
	if (
		typeof v.file !== 'string' ||
		!ASSET_FILE_PATTERN.test(v.file) ||
		!ext.some((e) => (v.file as string).endsWith(`.${e}`))
	) {
		throw new Invalid(`${what}: bad file`);
	}
	if (!finite(v.bytes, 1, maxBytes) || !Number.isInteger(v.bytes)) {
		throw new Invalid(`${what}: bad size`);
	}
	return { file: v.file, bytes: v.bytes };
}

/**
 * The manifest as fetched, checked field by field: anything out of place
 * rejects it whole (the client then draws placeholders, as before it loads).
 */
export function parseManifest(raw: unknown): Parsed {
	try {
		if (!isRecord(raw)) throw new Invalid('not an object');
		if (raw.version !== MANIFEST_VERSION)
			throw new Invalid(`unknown version ${String(raw.version)}`);
		const textures = section(raw.textures, 'texture', (v, id) => {
			if (!isRecord(v)) throw new Invalid(`texture ${id}`);
			const size = (n: unknown) => finite(n, 1, LIMITS.textureSize) && Number.isInteger(n);
			if (!size(v.width) || !size(v.height)) throw new Invalid(`texture ${id}: bad size`);
			return {
				...fileInfo(v, `texture ${id}`, LIMITS.textureBytes, ['png']),
				width: v.width as number,
				height: v.height as number
			};
		});
		const materials = section(raw.materials, 'material', (v, id) => {
			if (!isRecord(v) || typeof v.color !== 'string' || !COLOR.test(v.color)) {
				throw new Invalid(`material ${id}: bad colour`);
			}
			if (!finite(v.roughness, 0, 1) || !finite(v.metalness, 0, 1)) {
				throw new Invalid(`material ${id}: bad surface`);
			}
			const m: MaterialDef = { color: v.color, roughness: v.roughness, metalness: v.metalness };
			if (v.map !== undefined) {
				if (typeof v.map !== 'string' || !(v.map in textures)) {
					throw new Invalid(`material ${id}: unknown texture`);
				}
				m.map = v.map;
				if (!finite(v.cells, 0.25, 64)) throw new Invalid(`material ${id}: bad repeat`);
				m.cells = v.cells;
			}
			return m;
		});
		const models = section(raw.models, 'model', (v, id) => {
			if (!isRecord(v)) throw new Invalid(`model ${id}`);
			const kind = MODEL_KINDS.find((k) => k === v.kind);
			if (!kind) throw new Invalid(`model ${id}: bad kind`);
			if (!finite(v.triangles, 1, LIMITS.modelTriangles) || !Number.isInteger(v.triangles)) {
				throw new Invalid(`model ${id}: bad triangle count`);
			}
			const b = v.bounds;
			if (!isRecord(b) || !vec3(b.min) || !vec3(b.max))
				throw new Invalid(`model ${id}: bad bounds`);
			const entry: ModelEntry = {
				...fileInfo(v, `model ${id}`, LIMITS.modelBytes, ['glb']),
				kind,
				triangles: v.triangles,
				bounds: { min: [...b.min], max: [...b.max] }
			};
			if (v.swing !== undefined) {
				const s = v.swing;
				if (!isRecord(s) || !finite(s.pivot, 0, 20) || !finite(s.throw, -7, 7)) {
					throw new Invalid(`model ${id}: bad swing`);
				}
				entry.swing = { pivot: s.pivot, throw: s.throw };
			}
			return entry;
		});
		const environments = section(raw.environments, 'environment', (v, id) => {
			if (!isRecord(v) || typeof v.name !== 'string' || v.name.length > 60) {
				throw new Invalid(`environment ${id}: bad name`);
			}
			const material = (k: string) => {
				const m = v[k];
				if (typeof m !== 'string' || !(m in materials)) {
					throw new Invalid(`environment ${id}: unknown ${k} material`);
				}
				return m;
			};
			return {
				name: v.name,
				surface: material('surface'),
				ground: material('ground'),
				walls: material('walls'),
				table: material('table')
			};
		});
		const audio = section(raw.audio, 'audio', (v, id) => {
			if (!isRecord(v)) throw new Invalid(`audio ${id}`);
			const info = fileInfo(v, `audio ${id}`, LIMITS.audioBytes, ['wav', 'ogg']);
			const format = (['wav', 'ogg'] as const).find((f) => f === v.format);
			if (!format || !info.file.endsWith(`.${format}`))
				throw new Invalid(`audio ${id}: bad format`);
			if (!finite(v.duration, 0, LIMITS.audioSeconds)) throw new Invalid(`audio ${id}: bad length`);
			return { ...info, format, duration: v.duration };
		});
		return {
			ok: true,
			manifest: { version: MANIFEST_VERSION, models, textures, materials, environments, audio }
		};
	} catch (err) {
		if (err instanceof Invalid) return { ok: false, error: err.message };
		throw err;
	}
}
