// How a table looks (an environment asset, see src/lib/assets/manifest.ts):
// the materials of its floor, raised ground, walls and rim, with their
// textures, loaded when the table first needs them. Textures are PNGs
// loaded as images, once each, shared by every material that uses them. And
// its colour grades (#162): a lookup table per tone mapper and ambient band,
// loaded a tone mapper at a time. Every file comes through fetchAsset (checked
// when it comes from the asset host, #191); a KTX2 texture is transcoded by
// the models' decoders (#188), for this device.

import * as THREE from 'three/webgpu';
import {
	GRADE_TONE_MAPPER,
	type EnvironmentDef,
	type GradeBand,
	type FileInfo,
	type MaterialDef,
	type TextureEntry,
	type ToneMapper
} from '$lib/assets/manifest';
import { fetchAsset, loadManifest } from '$lib/assets/load';
import { imageTexture } from './image-texture';
import { ktx2Texture, slotTexture } from './models';
import { setParams, setSlot, type KindMaterial } from './materials';

/** One surface: its colour and finish, and its texture with how many cells one repeat covers. */
export interface Look {
	color: THREE.Color;
	roughness: number;
	metalness: number;
	map: THREE.Texture | null;
	cells: number;
}

export interface EnvironmentLook {
	surface: Look;
	ground: Look;
	walls: Look;
	table: Look;
	/** 32³ RGBA lookup tables (x red, y green, z blue); null when the environment has no grade. */
	grades: Grades | null;
}

/** A built file: where it is and its digest. */
type Built = Pick<FileInfo, 'file' | 'sha256'>;

/** The size of a grade's lookup table, per side. */
export const LUT_SIZE = 32;

/**
 * A grade strip (1024×32: 32 slices of 32×32 side by side, blue choosing the slice, red across,
 * green down) as a 3D table in Data3DTexture order. Black is forced to exactly black: a browser
 * that perturbs canvas reads against fingerprinting must not lift unexplored cells (#161).
 */
async function loadGrade({ file, sha256 }: Built): Promise<Uint8Array> {
	const blob = new Blob([await fetchAsset(file, sha256)], { type: 'image/png' });
	const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const ctx = canvas.getContext('2d')!;
	ctx.drawImage(bitmap, 0, 0);
	const strip = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
	const n = LUT_SIZE;
	const out = new Uint8Array(n * n * n * 4);
	for (let b = 0; b < n; b++)
		for (let g = 0; g < n; g++)
			for (let r = 0; r < n; r++) {
				const from = (g * n * n + b * n + r) * 4;
				out.set(strip.subarray(from, from + 4), ((b * n + g) * n + r) * 4);
			}
	out.fill(0, 0, 3);
	return out;
}

/**
 * An environment's grades, loaded a tone mapper at a time (its three bands) the first time
 * that tone mapper is wanted: the rest wait for the viewer to pick them, so a table's first
 * frame fetches 3 strips, not all 9.
 */
export class Grades {
	/** The tone mappers loaded so far: their grades by band, or null if they failed to load. */
	readonly ready: Partial<Record<ToneMapper, Record<GradeBand, Uint8Array> | null>> = {};
	private readonly loading = new Map<ToneMapper, Promise<void>>();

	constructor(
		private readonly lut: NonNullable<EnvironmentDef['lut']>,
		private readonly files: Record<string, Built>
	) {}

	/** Loads a tone mapper's grades, once; resolves when they are in `ready`. */
	load(tm: ToneMapper): Promise<void> {
		let loading = this.loading.get(tm);
		if (!loading) {
			const bands = Object.entries(this.lut[tm]);
			loading = Promise.all(
				bands.map(async ([band, id]) => [band, await loadGrade(this.files[id])] as const)
			)
				.then((loaded) => Object.fromEntries(loaded) as Record<GradeBand, Uint8Array>)
				.catch(() => null)
				.then((set) => void (this.ready[tm] = set));
			this.loading.set(tm, loading);
		}
		return loading;
	}
}

const gradeCache = new Map<string, Grades>();

/** An environment's grades (one Grades per environment), with `toneMapper`'s loaded. */
async function gradesOf(
	id: string,
	lut: NonNullable<EnvironmentDef['lut']>,
	files: Record<string, Built>,
	toneMapper: ToneMapper
): Promise<Grades> {
	let grades = gradeCache.get(id);
	if (!grades) gradeCache.set(id, (grades = new Grades(lut, files)));
	await grades.load(toneMapper);
	return grades;
}

const textures = new Map<string, Promise<THREE.Texture | null>>();

/**
 * A texture, once for the page. Its sampling is the albedo slot's, which every look sets.
 * ponytail: never freed, like the PNGs before; a KTX2 one stays in the format of the device it
 * was first transcoded for (free it with the models if a backend switch ever needs another).
 */
function loadTexture(id: string, entry: TextureEntry): Promise<THREE.Texture | null> {
	let loading = textures.get(id);
	if (!loading) {
		loading = fetchAsset(entry.file, entry.sha256)
			.then((bytes) => (entry.format === 'ktx2' ? ktx2Texture(bytes) : imageTexture(bytes)))
			// The albedo slot's sampling, and the tier's anisotropy (#179).
			.then((t) => slotTexture(t, 'albedo'))
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
	const [[surface, ground, walls, table], grades] = await Promise.all([
		Promise.all(
			[env.surface, env.ground, env.walls, env.table ?? env.surface].map((m) =>
				look(manifest.materials[m], manifest.textures)
			)
		),
		env.lut ? gradesOf(id, env.lut, manifest.textures, toneMapper) : null
	]);
	return { surface, ground, walls, table, grades };
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
}
