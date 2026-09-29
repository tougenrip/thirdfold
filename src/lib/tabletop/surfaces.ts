// An environment's painted surfaces (#187): its walls' surface as the three maps the wall
// material's slots take, and its floors as texture arrays: each surface's KTX2 maps, transcoded
// for this device, laid layer by layer into one CompressedArrayTexture per map, so the terrain
// kind draws every floor of a table in one draw (materials/floors.ts). The cook encodes every
// surface's map alike, so the transcoder gives each the same format; a set that doesn't match
// is refused whole and the floors keep their colours. Its own chunk (environment.ts imports it
// only for an environment with surfaces), so the renderer chunk stays in budget.

import * as THREE from 'three/webgpu';
import { BASE_PX, type EnvironmentDef, type Manifest } from '$lib/assets/manifest';
import { fileAt, sizesOf } from '$lib/assets/detail';
import { fetchAsset, loadManifest } from '$lib/assets/load';
import { loadTexture, releasers, type Look } from './environment';
import { FLOOR_MAPS, SURFACE_CELLS, type FloorMap, type FloorSurfaces } from './materials/floors';
import { followDetail, ktx2Texture, slotTexture } from './models';

const floorCache = new Map<string, Promise<FloorSurfaces | null>>();
// Transcoded for one device: freed with the environment's other KTX2 textures.
releasers.add(() => {
	for (const floors of floorCache.values())
		void floors.then((f) => Object.values(f?.maps ?? {}).forEach((t) => t.dispose()));
	floorCache.clear();
});

/** A surface's maps, each loaded once for the page (per device), or null if one fails. */
export async function loadSurface(
	id: string
): Promise<{ map: THREE.Texture; normal: THREE.Texture; orm: THREE.Texture } | null> {
	const manifest = await loadManifest();
	const s = manifest.surfaces[id];
	if (!s) return null;
	const [map, normal, orm] = await Promise.all(
		[s.albedo, s.normal, s.orm].map((t) => loadTexture(t, manifest.textures[t]))
	);
	return map && normal && orm ? { map, normal, orm } : null;
}

/**
 * An environment's surfaces: its floors as arrays (once per set and device), and what its walls'
 * look takes from the first of its walls' surfaces (all of the colour, on a surface's tile).
 */
export async function surfacesOf(
	surfaces: NonNullable<EnvironmentDef['surfaces']>
): Promise<{ floors: FloorSurfaces | null; walls: Partial<Look> | null }> {
	const manifest = await loadManifest();
	const key = surfaces.floors.join();
	if (key && !floorCache.has(key)) {
		const ids = surfaces.floors;
		const loading = floorArrays(ids, manifest, BASE_PX) as Promise<FloorSurfaces | null>;
		floorCache.set(key, loading);
		// Each map's larger sizes (texture detail): a size every layer of it has.
		for (const map of FLOOR_MAPS) {
			const entries = ids.map((id) => manifest.textures[manifest.surfaces[id][map]]);
			const sizes = sizesOf(entries[0]).filter((s) => entries.every((e) => sizesOf(e).includes(s)));
			const build = (size: number) =>
				floorArrays(ids, manifest, size, [map]).then((f) => f?.maps[map] ?? null);
			void loading.then((f) => f && followDetail((m) => m.trackFloors(f, map, sizes, build)));
		}
	}
	const [floors, maps] = await Promise.all([
		floorCache.get(key) ?? null,
		surfaces.walls[0] ? loadSurface(surfaces.walls[0]) : null
	]);
	return {
		floors,
		walls: maps && { ...maps, cells: SURFACE_CELLS, color: new THREE.Color(0xffffff) }
	};
}

type Layer = THREE.CompressedTexture & {
	mipmaps: { data: Uint8Array; width: number; height: number }[];
};

/** One map's layers as an array texture, or null if they differ in format, size or levels. */
function arrayOf(layers: Layer[], map: FloorMap): THREE.Texture | null {
	const [first] = layers;
	const same = (t: Layer) =>
		t.format === first.format &&
		t.type === first.type &&
		t.mipmaps.length === first.mipmaps.length &&
		t.mipmaps[0].width === first.mipmaps[0].width &&
		t.mipmaps[0].height === first.mipmaps[0].height;
	if (!first?.isCompressedTexture || !layers.every(same)) return null;
	const mipmaps = first.mipmaps.map(({ width, height }, level) => {
		const parts = layers.map((t) => t.mipmaps[level].data);
		const data = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
		parts.reduce((at, p) => (data.set(p, at), at + p.byteLength), 0);
		return { data, width, height };
	});
	const { width, height } = mipmaps[0];
	// Transcoded to RGBA (no compressed format here): three uploads a CompressedArrayTexture with
	// the compressed call, which refuses RGBA, so the layers go up as data and the GPU makes the mips.
	if ((first.format as THREE.PixelFormat) === THREE.RGBAFormat) {
		const array = new THREE.DataArrayTexture(mipmaps[0].data, width, height, layers.length);
		array.type = first.type;
		return slotTexture(array, map);
	}
	const array = new THREE.CompressedArrayTexture(
		mipmaps as unknown as ImageData[],
		width,
		height,
		layers.length,
		first.format as THREE.CompressedPixelFormat,
		first.type
	);
	array.colorSpace = first.colorSpace;
	return slotTexture(array, map);
}

/**
 * The floors `ids` name (in layer order) as arrays of their `size` copies, of `maps`, or null if
 * any fails to load or match.
 */
async function floorArrays(
	ids: string[],
	manifest: Manifest,
	size: number,
	maps: readonly FloorMap[] = FLOOR_MAPS
): Promise<{ maps: Partial<FloorSurfaces['maps']>; layers: FloorSurfaces['layers'] } | null> {
	const layers = await Promise.all(
		maps.map((map) =>
			Promise.all(
				ids.map(async (id) => {
					const { file, sha256 } = fileAt(manifest.textures[manifest.surfaces[id][map]], size);
					return (await ktx2Texture(await fetchAsset(file, sha256, 'low'))) as Layer;
				})
			)
		)
	).catch(
		(err: Error) => void console.warn('[assets] floor surfaces failed to load:', err.message)
	);
	if (!layers) return null;
	const arrays = maps.map((map, i) => arrayOf(layers[i], map));
	for (const t of layers.flat()) t.dispose();
	if (arrays.some((a) => !a)) {
		for (const a of arrays) a?.dispose();
		return null;
	}
	return {
		maps: Object.fromEntries(maps.map((m, i) => [m, arrays[i]])),
		layers: Object.fromEntries(ids.map((id, i) => [id, i]))
	};
}
