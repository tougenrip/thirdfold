// The manifest as fetched (see manifest.ts), checked field by field. The
// result is built from known fields only, so anything unknown is dropped; a
// bad field rejects the whole manifest, and the client then draws
// placeholders, as before it loads. The pipeline parses its own output too,
// so a manifest that would fail here never builds.

import {
	ASSET_FILE_PATTERN,
	ASSET_ID_PATTERN,
	AUDIO_LIMITS,
	BASE_PX,
	GRADE_BANDS,
	LICENSES,
	LIMITS,
	MANIFEST_VERSION,
	MODEL_KINDS,
	SHA256_PATTERN,
	TEXTURE_FORMATS,
	TEXTURE_USAGES,
	THUMBNAIL_BYTES,
	TONE_MAPPERS,
	USAGE_SPACE,
	VARIANT_PX,
	limitClass,
	variantId,
	type Credit,
	type EnvironmentDef,
	type FileInfo,
	type GradeBand,
	type Manifest,
	type MaterialDef,
	type ModelEntry,
	type PackInfo,
	type SurfaceEntry,
	type TextureEntry,
	type TextureUsage,
	type ToneMapper,
	type Variant
} from './manifest';

type Parsed = { ok: true; manifest: Manifest } | { ok: false; error: string };

class Invalid extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const COLOR = /^#[0-9a-f]{6}$/;
const finite = (v: unknown, min = -Infinity, max = Infinity): v is number =>
	typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const integer = (v: unknown, min: number, max: number): v is number =>
	finite(v, min, max) && Number.isInteger(v);
const vec3 = (v: unknown): v is [number, number, number] =>
	Array.isArray(v) && v.length === 3 && v.every((n) => finite(n, -100, 100));
const text = (v: unknown, max: number): v is string =>
	typeof v === 'string' && v.length > 0 && v.length <= max;

/** Each entry of a section, checked by `check`; ids must be asset ids. */
function section<T>(
	raw: unknown,
	name: string,
	check: (v: Record<string, unknown>, id: string) => T
): Record<string, T> {
	if (!isRecord(raw)) throw new Invalid(`${name} is not an object`);
	const out: Record<string, T> = {};
	for (const [id, v] of Object.entries(raw)) {
		if (!ASSET_ID_PATTERN.test(id)) throw new Invalid(`bad ${name} id "${id}"`);
		if (!isRecord(v)) throw new Invalid(`${name} ${id} is not an object`);
		out[id] = check(v, id);
	}
	return out;
}

function credit(v: unknown, what: string): Credit {
	const license = isRecord(v) ? LICENSES.find((l) => l === v.license) : undefined;
	if (!isRecord(v) || !license || !text(v.author, 200)) throw new Invalid(`${what}: bad credit`);
	const c: Credit = { license, author: v.author };
	if (v.source !== undefined) {
		if (!text(v.source, 200) || !v.source.startsWith('https://')) {
			throw new Invalid(`${what}: bad credit source`);
		}
		c.source = v.source;
	}
	if (v.modified !== undefined) {
		if (typeof v.modified !== 'boolean') throw new Invalid(`${what}: bad credit`);
		c.modified = v.modified;
	}
	if (v.ai !== undefined) {
		if (!isRecord(v.ai) || !text(v.ai.tool, 100)) throw new Invalid(`${what}: bad credit`);
		c.ai = { tool: v.ai.tool };
	}
	return c;
}

function fileInfo(
	v: Record<string, unknown>,
	what: string,
	maxBytes: number,
	ext: readonly string[]
): FileInfo {
	const file = v.file;
	if (
		typeof file !== 'string' ||
		!ASSET_FILE_PATTERN.test(file) ||
		!ext.some((e) => file.endsWith(`.${e}`))
	) {
		throw new Invalid(`${what}: bad file`);
	}
	if (!integer(v.bytes, 1, maxBytes)) throw new Invalid(`${what}: bad size`);
	// The name carries the digest's first 8 hex digits: they must agree.
	if (
		typeof v.sha256 !== 'string' ||
		!SHA256_PATTERN.test(v.sha256) ||
		file.split('.').at(-2) !== v.sha256.slice(0, 8)
	) {
		throw new Invalid(`${what}: bad sha256`);
	}
	return { file, bytes: v.bytes, sha256: v.sha256, credit: credit(v.credit, what) };
}

/**
 * An entry's larger copies: one or two, of `VARIANT_PX` sizes rising and over `base` (its own
 * largest side), each named for the entry as the base is (same folder and type) and within the
 * class's limits.
 */
function variants(
	raw: unknown,
	id: string,
	base: { file: string; px: number },
	limit: { bytes: number; gpuBytes: number },
	what: string
): { variants?: Variant[] } {
	if (raw === undefined) return {};
	if (!Array.isArray(raw) || raw.length < 1 || raw.length > VARIANT_PX.length) {
		throw new Invalid(`${what}: bad variants`);
	}
	const folder = base.file.slice(0, base.file.indexOf('/'));
	const ext = base.file.slice(base.file.lastIndexOf('.') + 1);
	let below = base.px;
	return {
		variants: raw.map((v: unknown) => {
			const size = isRecord(v) ? VARIANT_PX.find((px) => px === v.size) : undefined;
			if (!isRecord(v) || !size || size <= below) throw new Invalid(`${what}: bad variant size`);
			below = size;
			const info = fileInfo(v, `${what} ${size} px`, limit.bytes, [ext]);
			if (!info.file.startsWith(`${folder}/${variantId(id, size)}.`)) {
				throw new Invalid(`${what}: a variant is named for its entry`);
			}
			if (!integer(v.gpuBytes, 1, limit.gpuBytes)) throw new Invalid(`${what}: bad GPU size`);
			return { ...info, size, gpuBytes: v.gpuBytes };
		})
	};
}

/** An entry's pack, which the manifest must list. */
function pack(v: unknown, packs: Record<string, PackInfo>, what: string): { pack?: string } {
	if (v === undefined) return {};
	if (typeof v !== 'string' || !Object.hasOwn(packs, v)) throw new Invalid(`${what}: unknown pack`);
	return { pack: v };
}

/** A texture id of the given usage. */
function textureOf(
	v: unknown,
	usage: TextureUsage,
	textures: Record<string, TextureEntry>,
	what: string
): string {
	const t = typeof v === 'string' ? textures[v] : undefined;
	if (!t) throw new Invalid(`${what}: unknown texture`);
	if (t.usage !== usage) throw new Invalid(`${what}: "${v as string}" is not ${usage}`);
	return v as string;
}

/** An environment's grade strips: every tone mapper and band, each a 1024×32 texture. */
function readLut(
	raw: unknown,
	textures: Record<string, TextureEntry>,
	where: string
): Record<ToneMapper, Record<GradeBand, string>> {
	if (!isRecord(raw)) throw new Invalid(`${where}: bad grade`);
	const out = {} as Record<ToneMapper, Record<GradeBand, string>>;
	for (const tm of TONE_MAPPERS) {
		const bands = raw[tm];
		if (!isRecord(bands)) throw new Invalid(`${where}: no ${tm} grade`);
		out[tm] = {} as Record<GradeBand, string>;
		for (const band of GRADE_BANDS) {
			const id = bands[band];
			const t = typeof id === 'string' ? textures[id] : undefined;
			if (!t || t.width !== 1024 || t.height !== 32 || t.usage !== 'lut') {
				throw new Invalid(`${where}: the ${tm} ${band} grade is not a 1024×32 texture`);
			}
			out[tm][band] = id as string;
		}
	}
	return out;
}

function readTexture(
	v: Record<string, unknown>,
	id: string,
	packs: Record<string, PackInfo>
): TextureEntry {
	const what = `texture ${id}`;
	const format = TEXTURE_FORMATS.find((f) => f === v.format);
	if (!format) throw new Invalid(`${what}: bad format`);
	const usage = TEXTURE_USAGES.find((u) => u === v.usage);
	if (!usage) throw new Invalid(`${what}: bad usage`);
	if (v.colorSpace !== USAGE_SPACE[usage]) {
		throw new Invalid(`${what}: ${usage} is ${USAGE_SPACE[usage]}`);
	}
	const limit = LIMITS[limitClass({ usage })];
	const { file } = fileInfo(v, what, limit.bytes, [format]);
	if (!integer(v.width, 1, limit.px) || !integer(v.height, 1, limit.px)) {
		throw new Invalid(`${what}: bad size`);
	}
	const mips = Math.floor(Math.log2(Math.max(v.width, v.height))) + 1;
	if (!integer(v.layers, 1, 256) || !integer(v.levels, 1, mips)) {
		throw new Invalid(`${what}: bad layers or levels`);
	}
	if (!integer(v.gpuBytes, 1, limit.gpuBytes)) throw new Invalid(`${what}: bad GPU size`);
	return {
		...fileInfo(v, what, limit.bytes, [format]),
		format,
		usage,
		colorSpace: USAGE_SPACE[usage],
		width: v.width,
		height: v.height,
		layers: v.layers,
		levels: v.levels,
		gpuBytes: v.gpuBytes,
		...pack(v.pack, packs, what),
		...variants(v.variants, id, { file, px: Math.max(v.width, v.height) }, limit, what)
	};
}

function readMaterial(
	v: Record<string, unknown>,
	id: string,
	textures: Record<string, TextureEntry>
): MaterialDef {
	const what = `material ${id}`;
	if (typeof v.color !== 'string' || !COLOR.test(v.color)) throw new Invalid(`${what}: bad colour`);
	if (!finite(v.roughness, 0, 1) || !finite(v.metalness, 0, 1)) {
		throw new Invalid(`${what}: bad surface`);
	}
	const m: MaterialDef = { color: v.color, roughness: v.roughness, metalness: v.metalness };
	if (v.map !== undefined) {
		m.map = textureOf(v.map, 'albedo', textures, what);
		if (!finite(v.cells, 0.25, 64)) throw new Invalid(`${what}: bad repeat`);
		m.cells = v.cells;
	}
	if (v.normal !== undefined) m.normal = textureOf(v.normal, 'normal', textures, what);
	if (v.orm !== undefined) m.orm = textureOf(v.orm, 'orm', textures, what);
	return m;
}

function readModel(
	v: Record<string, unknown>,
	id: string,
	materials: Record<string, MaterialDef>,
	packs: Record<string, PackInfo>
): ModelEntry {
	const what = `model ${id}`;
	const kind = MODEL_KINDS.find((k) => k === v.kind);
	if (!kind) throw new Invalid(`${what}: bad kind`);
	if (v.setPiece !== undefined && (v.setPiece !== true || kind !== 'prop')) {
		throw new Invalid(`${what}: only a prop can be a set piece`);
	}
	const setPiece = v.setPiece === true;
	const limit = LIMITS[limitClass({ kind, setPiece })];
	if (!integer(v.triangles, 1, limit.triangles)) throw new Invalid(`${what}: bad triangle count`);
	if (!integer(v.gpuBytes, 1, limit.gpuBytes)) throw new Invalid(`${what}: bad GPU size`);
	const b = v.bounds;
	if (!isRecord(b) || !vec3(b.min) || !vec3(b.max)) throw new Invalid(`${what}: bad bounds`);
	const entry: ModelEntry = {
		...fileInfo(v, what, limit.bytes, ['glb']),
		kind,
		triangles: v.triangles,
		bounds: { min: [...b.min], max: [...b.max] },
		gpuBytes: v.gpuBytes,
		...pack(v.pack, packs, what)
	};
	// A cooked model's base carries textures of at most BASE_PX.
	Object.assign(entry, variants(v.variants, id, { file: entry.file, px: BASE_PX }, limit, what));
	if (setPiece) entry.setPiece = true;
	if (v.swing !== undefined) {
		const s = v.swing;
		if (!isRecord(s) || !finite(s.pivot, 0, 20) || !finite(s.throw, -7, 7)) {
			throw new Invalid(`${what}: bad swing`);
		}
		entry.swing = { pivot: s.pivot, throw: s.throw };
	}
	if (v.lods !== undefined) {
		// Each level coarser than the one before, and drawn smaller.
		if (!Array.isArray(v.lods) || v.lods.length < 1 || v.lods.length > 4) {
			throw new Invalid(`${what}: bad LODs`);
		}
		let triangles = entry.triangles;
		let screen = 1;
		entry.lods = v.lods.map((l) => {
			if (!isRecord(l) || !integer(l.triangles, 1, triangles - 1)) {
				throw new Invalid(`${what}: bad LODs`);
			}
			if (!finite(l.screenSize, Number.MIN_VALUE, screen) || l.screenSize === screen) {
				throw new Invalid(`${what}: bad LODs`);
			}
			triangles = l.triangles;
			screen = l.screenSize;
			return { triangles: l.triangles, screenSize: l.screenSize };
		});
	}
	if (v.cooked !== undefined) {
		if (v.cooked !== true) throw new Invalid(`${what}: bad cooked`);
		entry.cooked = true;
	}
	if (v.materials !== undefined) {
		const list = v.materials;
		if (
			!Array.isArray(list) ||
			list.length > 16 ||
			new Set(list).size !== list.length ||
			!list.every((m) => typeof m === 'string' && Object.hasOwn(materials, m))
		) {
			throw new Invalid(`${what}: unknown materials`);
		}
		entry.materials = [...(list as string[])];
	}
	if (v.pivot !== undefined) {
		if (!vec3(v.pivot)) throw new Invalid(`${what}: bad pivot`);
		entry.pivot = [...v.pivot];
	}
	if (v.footprint !== undefined) {
		const f = v.footprint;
		if (!Array.isArray(f) || f.length !== 2 || !f.every((n) => integer(n, 1, 16))) {
			throw new Invalid(`${what}: bad footprint`);
		}
		entry.footprint = [f[0], f[1]];
	}
	if (v.preview !== undefined) {
		if (!isRecord(v.preview)) throw new Invalid(`${what}: bad preview`);
		entry.preview = fileInfo(v.preview, `${what} preview`, limit.bytes, ['glb']);
	}
	if (v.thumbnail !== undefined) {
		if (!isRecord(v.thumbnail)) throw new Invalid(`${what}: bad thumbnail`);
		entry.thumbnail = fileInfo(v.thumbnail, `${what} thumbnail`, THUMBNAIL_BYTES, ['png']);
	}
	return entry;
}

function readEnvironment(
	v: Record<string, unknown>,
	id: string,
	m: Pick<Manifest, 'materials' | 'textures' | 'surfaces'>
): EnvironmentDef {
	const what = `environment ${id}`;
	if (!text(v.name, 60)) throw new Invalid(`${what}: bad name`);
	const material = (k: string) => {
		const name = v[k];
		if (typeof name !== 'string' || !Object.hasOwn(m.materials, name)) {
			throw new Invalid(`${what}: unknown ${k} material`);
		}
		return name;
	};
	const env: EnvironmentDef = {
		name: v.name,
		surface: material('surface'),
		ground: material('ground'),
		walls: material('walls')
	};
	if (v.table !== undefined) env.table = material('table');
	if (v.lut !== undefined) env.lut = readLut(v.lut, m.textures, what);
	if (v.surfaces !== undefined) {
		const s = v.surfaces;
		const ids = (list: unknown): list is string[] =>
			Array.isArray(list) &&
			list.length <= 16 &&
			list.every((x) => typeof x === 'string' && Object.hasOwn(m.surfaces, x));
		if (!isRecord(s) || !ids(s.floors) || !ids(s.walls)) {
			throw new Invalid(`${what}: unknown surfaces`);
		}
		env.surfaces = { floors: [...s.floors], walls: [...s.walls] };
	}
	return env;
}

const packSize = (n: unknown) => integer(n, 0, 2 ** 32);
const DECODER_DIR = /^decoders\/basis-[0-9a-f]{8}$/;

export function parseManifest(raw: unknown): Parsed {
	try {
		if (!isRecord(raw)) throw new Invalid('not an object');
		if (raw.version !== MANIFEST_VERSION) {
			throw new Invalid(`unknown version ${String(raw.version)}`);
		}
		const packs = section(raw.packs ?? {}, 'pack', (v, id) => {
			if (!packSize(v.bytes) || !packSize(v.gpuBytes)) throw new Invalid(`pack ${id}: bad size`);
			return { bytes: v.bytes as number, gpuBytes: v.gpuBytes as number };
		});
		const textures = section(raw.textures, 'texture', (v, id) => readTexture(v, id, packs));
		const materials = section(raw.materials, 'material', (v, id) => readMaterial(v, id, textures));
		const surfaces = section(raw.surfaces ?? {}, 'surface', (v, id): SurfaceEntry => ({
			albedo: textureOf(v.albedo, 'albedo', textures, `surface ${id}`),
			normal: textureOf(v.normal, 'normal', textures, `surface ${id}`),
			orm: textureOf(v.orm, 'orm', textures, `surface ${id}`)
		}));
		const models = section(raw.models, 'model', (v, id) => readModel(v, id, materials, packs));
		const environments = section(raw.environments, 'environment', (v, id) =>
			readEnvironment(v, id, { materials, textures, surfaces })
		);
		const audio = section(raw.audio, 'audio', (v, id) => {
			const info = fileInfo(v, `audio ${id}`, AUDIO_LIMITS.bytes, ['wav', 'ogg']);
			const format = (['wav', 'ogg'] as const).find((f) => f === v.format);
			if (!format || !info.file.endsWith(`.${format}`)) {
				throw new Invalid(`audio ${id}: bad format`);
			}
			if (!finite(v.duration, 0, AUDIO_LIMITS.seconds)) {
				throw new Invalid(`audio ${id}: bad length`);
			}
			return { ...info, format, duration: v.duration, ...pack(v.pack, packs, `audio ${id}`) };
		});
		const manifest: Manifest = {
			version: MANIFEST_VERSION,
			models,
			textures,
			materials,
			surfaces,
			environments,
			audio,
			packs
		};
		if (raw.decoders !== undefined) {
			const basis = isRecord(raw.decoders) ? raw.decoders.basis : undefined;
			if (
				!isRecord(basis) ||
				typeof basis.dir !== 'string' ||
				!DECODER_DIR.test(basis.dir) ||
				!integer(basis.bytes, 1, 8 * 1024 * 1024)
			) {
				throw new Invalid('bad decoders');
			}
			manifest.decoders = { basis: { dir: basis.dir, bytes: basis.bytes } };
		}
		return { ok: true, manifest };
	} catch (err) {
		if (err instanceof Invalid) return { ok: false, error: err.message };
		throw err;
	}
}
