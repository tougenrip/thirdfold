// How a table looks (an environment asset, see src/lib/assets/manifest.ts):
// the materials of its floor, raised ground (and the ground to the horizon) and walls, with their
// textures, loaded when the table first needs them. Textures are PNGs
// loaded as images, once each, shared by every material that uses them. And
// its colour grades (#162): a lookup table per tone mapper and ambient band,
// loaded a tone mapper at a time. Every file comes through fetchAsset (checked
// when it comes from the asset host, #191); a KTX2 texture is transcoded by
// the models' decoders (#188), for this device.

import * as THREE from 'three/webgpu';
import {
	GRADE_TONE_MAPPER,
	type MaterialDef,
	type TextureEntry,
	type ToneMapper
} from '$lib/assets/manifest';
import { fetchAsset, loadManifest } from '$lib/assets/load';
import { imageTexture } from './image-texture';
import {
	followDetail,
	ktx2Texture,
	loadModel,
	partsOf,
	slotTexture,
	type LoadedModel
} from './models';
import { setParams, setSlot, type KindMaterial } from './materials';
import type { Grades } from './grades-load';
import type { FloorSurfaces } from './materials/floors';
import type { KitDef } from '$lib/assets/kit';
import type { WallKit } from './walls';
import type { RoofKit } from './roofs';
import type { PieceMesh } from './world/wall-batch';

export { resolveSky } from '$lib/assets/sky-parse';

/** What the surface chunk (#187, surfaces.ts) frees when the environment's textures go. */
export const releasers = new Set<() => void>();

/** One surface: its colour and finish, and its texture with how many cells one repeat covers. */
export interface Look {
	color: THREE.Color;
	roughness: number;
	metalness: number;
	map: THREE.Texture | null;
	cells: number;
	/** A painted surface's (#187) normal and ORM maps. */
	normal?: THREE.Texture | null;
	orm?: THREE.Texture | null;
}

export interface EnvironmentLook {
	surface: Look;
	ground: Look;
	walls: Look;
	/** The floors' painted surfaces (#187), or null while an environment has none. */
	floors: FloorSurfaces | null;
	/** 32³ RGBA lookup tables (x red, y green, z blue); null when the environment has no grade. */
	grades: Grades | null;
	/** Its architecture kit's pieces (#250, #252), or null when it has none (`plain`). */
	kit: WallKit | null;
	/** Its kit's roofs (#257), or null when it has none (caves, `plain`). */
	roof: RoofKit | null;
}

/** The size of a grade's lookup table, per side. */
export const LUT_SIZE = 32;

const textures = new Map<string, Promise<THREE.Texture | null>>();
/** Trim sheets (M70) by manifest material: their textures are `textures`', freed with them. */
const sheets = new Map<string, Promise<Look | null>>();
/** The KTX2 ones among them: transcoded for one device's formats. */
const transcoded = new Set<string>();

/**
 * Frees the KTX2 textures (releaseModels calls it when the last table goes, or another renderer
 * comes): a new device may not take the format they were transcoded to. PNGs stay for the page.
 */
export function releaseEnvironmentTextures(): void {
	for (const id of transcoded) {
		void textures.get(id)?.then((t) => t?.dispose());
		textures.delete(id);
	}
	transcoded.clear();
	sheets.clear();
	for (const release of releasers) release();
}

/** A texture, once for the page (KTX2 ones once per device), sampled as the slot of its usage. */
export function loadTexture(id: string, entry: TextureEntry): Promise<THREE.Texture | null> {
	let loading = textures.get(id);
	if (!loading) {
		if (entry.format === 'ktx2') transcoded.add(id);
		loading = fetchAsset(entry.file, entry.sha256)
			.then((bytes) => (entry.format === 'ktx2' ? ktx2Texture(bytes) : imageTexture(bytes)))
			// Its slot's sampling, and the tier's anisotropy (#179); then its size by texture detail.
			.then((t) => {
				const slot = entry.usage === 'normal' || entry.usage === 'orm' ? entry.usage : 'albedo';
				if (entry.variants)
					followDetail((m) => m.trackTexture(entry, t, slot), entry.format === 'ktx2');
				return slotTexture(t, slot);
			})
			.catch((err: Error) => {
				console.warn(`[assets] texture "${id}" failed to load:`, err.message);
				return null;
			});
		textures.set(id, loading);
	}
	return loading;
}

async function look(def: MaterialDef, files: Record<string, TextureEntry>): Promise<Look> {
	const map = def.map && files[def.map] ? await loadTexture(def.map, files[def.map]) : null;
	return {
		color: new THREE.Color(def.color),
		roughness: def.roughness,
		metalness: def.metalness,
		map,
		cells: def.cells ?? 1
	};
}

/**
 * The trim sheet a kit piece wears (M70): the first manifest material its entry names (#263), its
 * albedo, normal and ORM through `loadTexture` (so texture detail swaps them in place), else its
 * own glTF maps; null for a piece coloured by its vertices alone (the greybox kits), or a sheet
 * whose albedo fails to load. One Look per material, shared by every piece that wears it.
 */
export function sheetOf(model: LoadedModel): Promise<Look | null> {
	const id = model.entry.materials?.[0];
	if (!id) {
		const part = partsOf(model, 'body').find((p) => p.maps?.albedo);
		if (!part) return Promise.resolve(null);
		const { albedo, normal, orm } = part.maps!;
		const p = part.params;
		const color = new THREE.Color(p.color ?? 0xffffff);
		const [roughness, metalness] = [p.roughness ?? 1, p.metalness ?? 0];
		return Promise.resolve({ color, roughness, metalness, map: albedo!, cells: 1, normal, orm });
	}
	let loading = sheets.get(id);
	if (!loading) {
		loading = loadManifest().then(async ({ materials, textures: files }) => {
			const def = materials[id];
			const get = (t?: string) => (t && files[t] ? loadTexture(t, files[t]) : null);
			const [map, normal, orm] = await Promise.all([
				get(def?.map),
				get(def?.normal),
				get(def?.orm)
			]);
			return map ? { ...(await look(def, {})), map, normal, orm } : null;
		});
		sheets.set(id, loading);
	}
	return loading;
}

/**
 * An environment's looks, or null if the manifest has no such environment. Its grades for
 * `toneMapper` are loaded with it; another tone mapper's load when asked for (Grades.load).
 */
export async function loadEnvironment(
	id: string,
	toneMapper: ToneMapper = GRADE_TONE_MAPPER
): Promise<EnvironmentLook | null> {
	const manifest = await loadManifest();
	const env = manifest.environments[id];
	if (!env) return null;
	const { surfaces: painted } = env;
	const kitDef = manifest.kits[env.kit ?? 'plain'];
	const roofDef = kitDef?.roof ?? null;
	const roofLook = roofDef && manifest.materials[roofDef.material];
	const [[surface, ground, walls], grades, own, kit, roofed, roofPieces] = await Promise.all([
		Promise.all(
			[env.surface, env.ground, env.walls].map((m) =>
				look(manifest.materials[m], manifest.textures)
			)
		),
		// Its grades, from a chunk of their own (grades-load.ts), keeping the renderer's in budget.
		env.lut
			? import('./grades-load').then((m) => m.gradesOf(id, env.lut!, manifest.textures, toneMapper))
			: null,
		// Its painted surfaces (#187), from a chunk only tables that have them load.
		painted ? import('./surfaces').then((m) => m.surfacesOf(painted)) : null,
		loadKit(kitDef),
		roofLook ? look(roofLook, manifest.textures) : null,
		roofDef ? kitPieces(kitDef, 'roofs') : null
	]);
	return {
		surface,
		ground,
		walls: own?.walls ? { ...walls, ...own.walls } : walls,
		floors: own?.floors ?? null,
		grades,
		kit,
		roof: roofDef && {
			roof: roofDef,
			presume: kitDef!.presumeRoofs,
			look: roofed,
			pieces: roofPieces ?? {}
		}
	};
}

/**
 * Puts a look on a material of the shader kinds (#172): its colour and finish, and its texture in
 * the albedo slot (the loaded one itself: slots sample at the kind's own coordinates times
 * `params.repeat`, so no material needs a copy), or `plain` and the blank without a look. The tile
 * size is the layer's (`repeatFor`), from `look.cells`.
 */
export function wear(
	material: KindMaterial,
	look: Look | null,
	plain: { color: THREE.ColorRepresentation; roughness: number }
): void {
	const { color, roughness, metalness } = look ?? { ...plain, metalness: 0 };
	setParams(material, { color, roughness, metalness });
	setSlot(material, 'albedo', look?.map ?? null);
	setSlot(material, 'normal', look?.normal ?? null);
	setSlot(material, 'orm', look?.orm ?? null);
}

/**
 * A kit's pieces (#250) as the walls draw them: each role's variants, every `body` part of its
 * model's full level as one mesh; a role whose models don't all load draws procedurally (#252).
 * Null for a kit with none (`plain`).
 */
export async function loadKit(kit: KitDef | undefined): Promise<WallKit | null> {
	const out = await kitPieces(kit, 'walls');
	return Object.keys(out).length ? (out as WallKit) : null;
}

/**
 * A kit's pieces for the walls (with arches and door leaves, #253) or for the roofs (caps,
 * chimneys with their smoke sockets and dormers, #258); stairs, bridges and cliffs are other
 * layers'. A role whose models don't all load is left out.
 */
async function kitPieces(kit: KitDef | undefined, of: 'walls' | 'roofs') {
	const build = await import('./world/build'); // loaded with the table
	const roles = new Set<string>(of === 'walls' ? build.BATCH_ROLES : build.ROOF_PIECE_ROLES);
	const entries = Object.entries(kit?.pieces ?? {}).filter(([role]) => roles.has(role));
	const out: Record<
		string,
		{ mesh: PieceMesh; weight: number; smoke?: [number, number, number]; sheet?: Look }[]
	> = {};
	await Promise.all(
		entries.map(async ([role, list]) => {
			const models = await Promise.all(list.map((p) => loadModel(p.model)));
			if (models.some((m) => !m)) return;
			// The walls' pieces wear their trim sheet by UV (M70); roofs keep their baked colours.
			const worn = await Promise.all(models.map((m) => (of === 'walls' ? sheetOf(m!) : null)));
			out[role] = models.map((m, i) => {
				const smoke = list[i].sockets?.find((s) => s.kind === 'smoke')?.at;
				const mesh = build.pieceOf(partsOf(m!, 'body').map((p) => p.geometry));
				if (!worn[i]) delete mesh.uvs; // drawn as before: by its vertex colours
				return {
					mesh,
					weight: list[i].weight ?? 1,
					...(smoke ? { smoke } : {}),
					...(worn[i] ? { sheet: worn[i] } : {})
				};
			});
		})
	);
	return out;
}
