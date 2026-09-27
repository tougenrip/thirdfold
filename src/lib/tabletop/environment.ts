// How a table looks (an environment asset, see src/lib/assets/manifest.ts):
// the materials of its floor, raised ground, walls and rim, with their
// textures, loaded when the table first needs them. Textures are PNGs
// loaded as images, once each, shared by every material that uses them. And
// its colour grades (#162): a lookup table per tone mapper and ambient band.

import * as THREE from 'three/webgpu';
import type { EnvironmentDef, GradeBand, MaterialDef, ToneMapper } from '$lib/assets/manifest';
import { assetUrl, loadManifest } from '$lib/assets/load';

/** One surface: its colour and finish, and its texture with how many cells one repeat covers. */
export interface Look {
	color: THREE.Color;
	roughness: number;
	metalness: number;
	map: THREE.Texture | null;
	cells: number;
}

/** 32³ RGBA lookup tables (x red, y green, z blue) by tone mapper and band. */
export type Grades = Record<ToneMapper, Record<GradeBand, Uint8Array>>;

export interface EnvironmentLook {
	surface: Look;
	ground: Look;
	walls: Look;
	table: Look;
	/** Null when the environment has no grade. */
	grades: Grades | null;
}

/** The size of a grade's lookup table, per side. */
export const LUT_SIZE = 32;

/**
 * A grade strip (1024×32: 32 slices of 32×32 side by side, blue choosing the slice, red across,
 * green down) as a 3D table in Data3DTexture order. Black is forced to exactly black: a browser
 * that perturbs canvas reads against fingerprinting must not lift unexplored cells (#161).
 */
async function loadGrade(file: string): Promise<Uint8Array> {
	const blob = await (await fetch(assetUrl(file))).blob();
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

const gradeCache = new Map<string, Promise<Grades | null>>();

/** An environment's grades, loaded once. */
function loadGrades(
	lut: NonNullable<EnvironmentDef['lut']>,
	key: string,
	files: Record<string, { file: string }>
): Promise<Grades | null> {
	let loading = gradeCache.get(key);
	if (!loading) {
		loading = (async () => {
			const entries = await Promise.all(
				Object.entries(lut).map(async ([tm, bands]) => [
					tm,
					Object.fromEntries(
						await Promise.all(
							Object.entries(bands).map(async ([band, id]) => [
								band,
								await loadGrade(files[id].file)
							])
						)
					)
				])
			);
			return Object.fromEntries(entries) as Grades;
		})().catch(() => null);
		gradeCache.set(key, loading);
	}
	return loading;
}

const textures = new Map<string, Promise<THREE.Texture | null>>();

/**
 * Stands in for "no texture": every dressed material always has a map, so changing
 * environments never changes a shader (which would recompile it).
 */
const BLANK = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
BLANK.colorSpace = THREE.SRGBColorSpace;
BLANK.needsUpdate = true;

function loadTexture(id: string, file: string): Promise<THREE.Texture | null> {
	let loading = textures.get(id);
	if (!loading) {
		loading = new THREE.TextureLoader()
			.loadAsync(assetUrl(file))
			.then((t) => {
				t.colorSpace = THREE.SRGBColorSpace;
				t.wrapS = t.wrapT = THREE.RepeatWrapping;
				t.anisotropy = 4;
				return t;
			})
			.catch((err: Error) => {
				console.warn(`[assets] texture "${id}" failed to load:`, err.message);
				return null;
			});
		textures.set(id, loading);
	}
	return loading;
}

async function look(def: MaterialDef, files: Record<string, { file: string }>): Promise<Look> {
	const map = def.map && files[def.map] ? await loadTexture(def.map, files[def.map].file) : null;
	return {
		color: new THREE.Color(def.color),
		roughness: def.roughness,
		metalness: def.metalness,
		map,
		cells: def.cells ?? 1
	};
}

/** An environment's looks, or null if the manifest has no such environment. */
export async function loadEnvironment(id: string): Promise<EnvironmentLook | null> {
	const manifest = await loadManifest();
	const env = manifest.environments[id];
	if (!env) return null;
	const [[surface, ground, walls, table], grades] = await Promise.all([
		Promise.all(
			[env.surface, env.ground, env.walls, env.table].map((m) =>
				look(manifest.materials[m], manifest.textures)
			)
		),
		env.lut ? loadGrades(env.lut, id, manifest.textures) : null
	]);
	return { surface, ground, walls, table, grades };
}

/**
 * Disposes a dressed material and its own map. Never the shared BLANK: every
 * tabletop's materials use it, and disposing it destroys it in every renderer
 * (another tabletop's draws that bind it drop out, #151).
 */
export function undress(material: THREE.MeshStandardMaterial): void {
	if (material.map && material.map !== BLANK) material.map.dispose();
	material.dispose();
}

/**
 * Puts a look on a material: colour and finish, and its texture repeated so
 * one repeat covers `look.cells` cells of a surface `across` × `down` cells.
 * The material gets its own copy of the texture (the image is shared).
 */
export function dress(
	material: THREE.MeshStandardMaterial,
	look: Look | null,
	fallback: THREE.ColorRepresentation,
	across = 1,
	down = 1
): void {
	if (material.map && material.map !== BLANK) material.map.dispose();
	material.map = BLANK;
	if (!look) {
		material.color.set(fallback);
		return;
	}
	material.color.copy(look.color);
	material.roughness = look.roughness;
	material.metalness = look.metalness;
	if (look.map) {
		const map = look.map.clone();
		map.repeat.set(across / look.cells, down / look.cells);
		map.needsUpdate = true;
		material.map = map;
	}
}
