// How a table looks (an environment asset, see src/lib/assets/manifest.ts):
// the materials of its floor, raised ground, walls and rim, with their
// textures, loaded when the table first needs them. Textures are PNGs
// loaded as images, once each, shared by every material that uses them.

import * as THREE from 'three';
import type { MaterialDef } from '$lib/assets/manifest';
import { assetUrl, loadManifest } from '$lib/assets/load';

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
	const [surface, ground, walls, table] = await Promise.all(
		[env.surface, env.ground, env.walls, env.table].map((m) =>
			look(manifest.materials[m], manifest.textures)
		)
	);
	return { surface, ground, walls, table };
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
