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
import { followDetail, ktx2Texture, loadModel, partsOf, slotTexture } from './models';
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
	const [[surface, ground, walls], grades, own, kit, roofed] = await Promise.all([
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
		roofLook ? look(roofLook, manifest.textures) : null
	]);
	return {
		surface,
		ground,
		walls: own?.walls ? { ...walls, ...own.walls } : walls,
		floors: own?.floors ?? null,
		grades,
		kit,
		roof: roofDef && { roof: roofDef, presume: kitDef!.presumeRoofs, look: roofed }
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
	const { BATCH_ROLES, pieceOf } = await import('./world/build'); // loaded with the table
	// Only what the walls draw (with arches and door leaves, #253): stairs, bridges,
	// cliffs and roofs are other layers' (#255-#257).
	const roles = new Set<string>(BATCH_ROLES);
	const entries = Object.entries(kit?.pieces ?? {}).filter(([role]) => roles.has(role));
	if (!entries.length) return null;
	const out: Record<string, { mesh: PieceMesh; weight: number }[]> = {};
	await Promise.all(
		entries.map(async ([role, list]) => {
			const models = await Promise.all(list.map((p) => loadModel(p.model)));
			if (models.some((m) => !m)) return;
			out[role] = models.map((m, i) => ({
				mesh: pieceOf(partsOf(m!, 'body').map((p) => p.geometry)),
				weight: list[i].weight ?? 1
			}));
		})
	);
	return Object.keys(out).length ? (out as WallKit) : null;
}
