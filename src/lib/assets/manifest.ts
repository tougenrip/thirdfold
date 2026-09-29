// The asset manifest: every model, texture, material, environment and sound
// the client can load, as the asset pipeline (server/assets) built them from
// the sources in assets/. The client fetches it from /assets/manifest.json
// and loads each file only when something on the table needs it.
//
// Assets are data only: models are glTF binaries with nothing but meshes
// (no scripts, cameras or external files), textures are PNG or KTX2, sounds
// are WAV or Ogg. Scene files and the room refer to assets by id only, never
// by content. Plain TypeScript with relative imports: the pipeline imports it
// too. The parser is manifest-parse.ts.
//
// Version 2 (#184) declares every field M65 fills. New optional fields need
// no version bump and unknown fields are dropped; unknown kinds, formats,
// usages and classes are refused, and a bad field refuses the whole manifest.

/** What an asset is for. Scenes are content too, but server-only (see docs/ASSETS.md). */
export const ASSET_KINDS = [
	'environment',
	'character',
	'npc',
	'enemy',
	'prop',
	'kit',
	'foliage',
	'decor',
	'fx',
	'sky',
	'material',
	'texture',
	'audio'
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** Models: figures (characters, NPCs, enemies), props, kit pieces, plants, decor and effects. */
export const MODEL_KINDS = [
	'prop',
	'character',
	'npc',
	'enemy',
	'kit',
	'foliage',
	'decor',
	'fx'
] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

/** The models a token can be drawn as. */
export const FIGURE_KINDS = ['character', 'npc', 'enemy'] as const;
export type FigureKind = (typeof FIGURE_KINDS)[number];

export const isFigureKind = (kind: string): kind is FigureKind =>
	(FIGURE_KINDS as readonly string[]).includes(kind);

/** The tone mappers a colour grade can be authored after (#158). */
export const TONE_MAPPERS = ['agx', 'aces', 'neutral'] as const;
export type ToneMapper = (typeof TONE_MAPPERS)[number];

/**
 * The tone mapper the whole picture goes through, and every grade (#162) is authored after: the
 * pipeline refuses a grade made for another. Frozen by #158; changing it regrades every LUT and
 * re-baselines every golden image.
 */
export const GRADE_TONE_MAPPER: ToneMapper = 'aces';

/** The ambient bands a grade is made for. */
export const GRADE_BANDS = ['day', 'dusk', 'dark'] as const;
export type GradeBand = (typeof GRADE_BANDS)[number];

/** An asset id: lowercase letters, digits and dashes. Scene files and tokens refer to these. */
export const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** A built file under /assets/: its folder, id, content hash prefix and type. */
export const ASSET_FILE_PATTERN =
	/^[a-z]+\/[a-z0-9][a-z0-9-]{0,47}\.[0-9a-f]{8}\.(glb|png|ktx2|wav|ogg)$/;

/** A file's whole SHA-256, lowercase hex: what a client checks a download from elsewhere by (#191). */
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const MANIFEST_VERSION = 2;

/** What a texture is for. Each has one colour space (USAGE_SPACE). */
export const TEXTURE_USAGES = [
	'albedo',
	'normal',
	'orm',
	'height',
	'emissive',
	'mask',
	'lut',
	'sky'
] as const;
export type TextureUsage = (typeof TEXTURE_USAGES)[number];
export type ColorSpace = 'srgb' | 'linear';

/**
 * The colour space of each usage: colour is sRGB, data linear. Grade strips are read as raw bytes
 * (createImageBitmap without conversion) and authored as sRGB, and so is the sky (#213).
 */
export const USAGE_SPACE: Record<TextureUsage, ColorSpace> = {
	albedo: 'srgb',
	emissive: 'srgb',
	normal: 'linear',
	orm: 'linear',
	height: 'linear',
	mask: 'linear',
	lut: 'srgb',
	sky: 'srgb'
};

export const TEXTURE_FORMATS = ['png', 'ktx2'] as const;
export type TextureFormat = (typeof TEXTURE_FORMATS)[number];

/** The licences an asset may carry (#189). */
export const LICENSES = [
	'CC0-1.0',
	'CC-BY-4.0',
	'LicenseRef-thirdfold-commissioned',
	'LicenseRef-thirdfold-original'
] as const;
export type License = (typeof LICENSES)[number];

/** The classes the limits are set per: a floor tile and a hero mini are not alike. */
export const LIMIT_CLASSES = [
	'kit',
	'prop',
	'foliage',
	'fx',
	'figure',
	'setPiece',
	'texture',
	'sky'
] as const;
export type LimitClass = (typeof LIMIT_CLASSES)[number];

export interface Limit {
	/** Triangles at LOD0 (0 for textures). */
	triangles: number;
	/** The largest side of a texture, in pixels. */
	px: number;
	/** The file's size. */
	bytes: number;
	/** What it takes on the GPU once decoded (see `gpuBytes`). */
	gpuBytes: number;
}

const kB = 1024;
const MB = 1024 * kB;

/**
 * Upper bounds per asset, which the pipeline and the client's parser both enforce, so no asset
 * can make a client download or draw too much. Budgets per table are #193's. A 4096 px sky fits
 * its GPU bytes only as KTX2 (a PNG that size decodes to about 85 MB). A kit piece embeds no
 * texture (its 2 MB on the GPU leaves no room for a 2048 px one): kit textures come through the
 * materials it wears, and trim sheets are materials.
 */
export const LIMITS: Record<LimitClass, Limit> = {
	kit: { triangles: 1_500, px: 2048, bytes: 256 * kB, gpuBytes: 2 * MB },
	prop: { triangles: 20_000, px: 2048, bytes: 4 * MB, gpuBytes: 16 * MB },
	foliage: { triangles: 6_000, px: 2048, bytes: 2 * MB, gpuBytes: 8 * MB },
	fx: { triangles: 2_000, px: 1024, bytes: 1 * MB, gpuBytes: 4 * MB },
	figure: { triangles: 40_000, px: 2048, bytes: 4 * MB, gpuBytes: 16 * MB },
	setPiece: { triangles: 60_000, px: 2048, bytes: 8 * MB, gpuBytes: 32 * MB },
	texture: { triangles: 0, px: 2048, bytes: 4 * MB, gpuBytes: 32 * MB },
	sky: { triangles: 0, px: 4096, bytes: 4 * MB, gpuBytes: 32 * MB }
};

export const AUDIO_LIMITS = { bytes: 2 * MB, seconds: 30 } as const;

/** A thumbnail (#194) is small whatever it shows. */
export const THUMBNAIL_BYTES = 64 * kB;

/** The class a model or texture is held to. Decor is held to props' limits. */
export function limitClass(
	entry: { kind: ModelKind; setPiece?: boolean } | { usage: TextureUsage }
): LimitClass {
	if ('usage' in entry) return entry.usage === 'sky' ? 'sky' : 'texture';
	if (isFigureKind(entry.kind)) return 'figure';
	if (entry.setPiece) return 'setPiece';
	return entry.kind === 'decor' ? 'prop' : entry.kind;
}

/** Where an asset came from and on what terms, in brief (#189 makes it required). */
export interface Credit {
	license: License;
	author: string;
	/** Where a third-party file was taken from (an https URL). */
	source?: string;
	/** Changed from its source. */
	modified?: boolean;
	/** The tool, when AI made or helped make it. */
	ai?: { tool: string };
}

export interface FileInfo {
	/** Path under /assets/ (see ASSET_FILE_PATTERN). */
	file: string;
	bytes: number;
	/** The whole file's SHA-256; the name carries its first 8 hex digits. */
	sha256: string;
	credit?: Credit;
}

export interface ModelLod {
	triangles: number;
	/** The share of the screen's height below which this level is drawn. */
	screenSize: number;
}

export interface ModelEntry extends FileInfo {
	kind: ModelKind;
	/** At LOD0. */
	triangles: number;
	/** In model units (a cell is 1), around the footprint's centre on the floor. */
	bounds: { min: [number, number, number]; max: [number, number, number] };
	/** Its decoded vertex and index bytes, and any textures it carries. */
	gpuBytes: number;
	/** Parts that swing (a hanging bell, a lever's handle): the height they turn about, and how far a swing throws them. */
	swing?: { pivot: number; throw: number };
	/** Levels after LOD0, coarsest last; meshes `<role>_lod<n>` in the same file. */
	lods?: ModelLod[];
	/** A prop held to the set-piece limits (the Hollow's great bell). */
	setPiece?: true;
	/** Cooked (#186): meshopt geometry and KTX2 textures, which need the decoders. */
	cooked?: true;
	/** Manifest materials a kit piece or decor is drawn with instead of textures of its own. */
	materials?: string[];
	/** A kit piece's pivot and footprint in cells (#250). */
	pivot?: [number, number, number];
	footprint?: [number, number];
	/** A light stand-in shown until the model arrives (#192). */
	preview?: FileInfo;
	/** A picture of it for the builder and the turntable (#194). */
	thumbnail?: FileInfo;
	/** The pack it downloads with (#192): a look, never a story place. */
	pack?: string;
}

export interface TextureEntry extends FileInfo {
	format: TextureFormat;
	usage: TextureUsage;
	colorSpace: ColorSpace;
	width: number;
	height: number;
	/** 1 unless it is an array texture. */
	layers: number;
	/** Mip levels in the file (1 for a PNG: the GPU makes the rest). */
	levels: number;
	/** Decoded with mips: 8 bits a pixel for KTX2 at worst, 32 for PNG, times 4/3. */
	gpuBytes: number;
	pack?: string;
}

export interface MaterialDef {
	/** `#rrggbb`. */
	color: string;
	roughness: number;
	metalness: number;
	/** A texture id (usage albedo), if the material has one. */
	map?: string;
	/** How many cells one repeat of the texture covers. */
	cells?: number;
	/** Texture ids for its normal and occlusion-roughness-metalness maps. */
	normal?: string;
	orm?: string;
}

/** A tiling surface of the library (#187): its maps, each a texture id; height rides in albedo's alpha. */
export interface SurfaceEntry {
	albedo: string;
	normal: string;
	orm: string;
}

/** How a place looks: the materials of its floor, its raised ground, its walls and the table's rim. */
export interface EnvironmentDef {
	name: string;
	surface: string;
	ground: string;
	walls: string;
	/** The rim's; without one it wears the floor's (#220 takes the rim away). */
	table?: string;
	/**
	 * Its colour grade (#162): a 1024×32 lookup-table strip (a texture id) per tone mapper and
	 * band. Optional: without one the picture is not graded.
	 */
	lut?: Record<ToneMapper, Record<GradeBand, string>>;
	/** Its surfaces (#187), surface ids in layer order. */
	surfaces?: { floors: string[]; walls: string[] };
}

export interface AudioEntry extends FileInfo {
	format: 'wav' | 'ogg';
	/** Seconds. */
	duration: number;
	pack?: string;
}

/** What a pack's files add up to (#192). */
export interface PackInfo {
	bytes: number;
	gpuBytes: number;
}

export interface Manifest {
	version: typeof MANIFEST_VERSION;
	models: Record<string, ModelEntry>;
	textures: Record<string, TextureEntry>;
	materials: Record<string, MaterialDef>;
	surfaces: Record<string, SurfaceEntry>;
	environments: Record<string, EnvironmentDef>;
	audio: Record<string, AudioEntry>;
	packs: Record<string, PackInfo>;
	/** The KTX2 transcoder (#188), served same-origin: code, never from the asset host. */
	decoders?: { basis: { dir: string; bytes: number } };
}

export const EMPTY_MANIFEST: Manifest = {
	version: MANIFEST_VERSION,
	models: {},
	textures: {},
	materials: {},
	surfaces: {},
	environments: {},
	audio: {},
	packs: {}
};
