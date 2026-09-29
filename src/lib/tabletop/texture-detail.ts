// Texture detail at the table (docs/ASSETS.md "Texture detail"; the rules are $lib/assets/detail.ts):
// every texture loads at its 512 px base, and what has 1K or 2K variants is then swapped to the
// size the Graphics menu's Texture detail wants, and again whenever it changes. A swap puts the
// new pixels into the same texture object (disposed, so the renderer makes its GPU texture again
// at the new size): no material, slot or program changes, on WebGPU and WebGL2 alike. A copy that
// fails to load falls back to the base. Its own chunk, loaded only when an asset host serves
// variants, so the renderer chunk stays in its budget.

import type * as THREE from 'three/webgpu';
import { Retargeter } from '$lib/assets/retarget';
import {
	fileAt,
	onTextureDetail,
	sizesOf,
	textureDetail,
	textureSwapped
} from '$lib/assets/detail';
import { fetchAsset } from '$lib/assets/load';
import { BASE_PX, type TextureEntry } from '$lib/assets/manifest';
import { imageTexture } from './image-texture';
import type { SlotName } from './materials';
import type { FloorMap, FloorSurfaces } from './materials/floors';
import { ktx2Texture, parseModel, slotTexture, type LoadedModel } from './models';

const retargeter = new Retargeter(textureDetail());
onTextureDetail((d) => void retargeter.set(d));

/** Bumped when the tables' device-bound textures are freed: loads begun before are dropped. */
let generation = 0;
/** What is tracked for one device (KTX2 and model textures), forgotten when they are freed. */
const perDevice = new Set<Parameters<Retargeter['track']>[0]>();

/**
 * Moves `source`'s pixels into `target`, which the renderer then uploads afresh at their size.
 * `source` must never have been drawn, or be disposed after (its own GPU copy). A bitmap moved in
 * is closed when `target` is next disposed or refilled.
 */
export function refill(target: THREE.Texture, source: THREE.Texture): void {
	target.dispose();
	target.image = source.image;
	target.mipmaps = source.mipmaps;
	target.format = source.format;
	target.type = source.type;
	target.needsUpdate = true;
	const bitmap = source.image as unknown;
	if (typeof ImageBitmap !== 'undefined' && bitmap instanceof ImageBitmap) {
		const close = () => {
			target.removeEventListener('dispose', close);
			bitmap.close();
		};
		target.addEventListener('dispose', close);
	}
}

/** Tracks something drawn at the base whose `load(size)` swaps in another size. */
function track(sizes: number[], device: boolean, swap: (size: number) => Promise<void>): void {
	if (sizes.length < 2) return;
	const at = generation;
	const item = {
		sizes,
		current: BASE_PX,
		load: async (size: number) => {
			await swap(size);
			if (at === generation) textureSwapped();
		}
	};
	if (device) perDevice.add(item);
	void retargeter.track(item);
}

/** Throws if the tables were freed while a copy loaded (its texture is gone). */
function live(at: number): void {
	if (at !== generation) throw new Error('the table was freed');
}

/** An environment's texture (environment.ts `loadTexture`), in its slot. */
export function trackTexture(entry: TextureEntry, target: THREE.Texture, slot: SlotName): void {
	const at = generation;
	track(sizesOf(entry), entry.format === 'ktx2', async (size) => {
		const { file, sha256 } = fileAt(entry, size);
		const bytes = await fetchAsset(file, sha256, 'low');
		const source = entry.format === 'ktx2' ? await ktx2Texture(bytes) : await imageTexture(bytes);
		live(at);
		refill(target, source);
		slotTexture(target, slot);
	});
}

/**
 * A cooked model: a variant is the same model with larger textures, so its parts' maps go into
 * the loaded model's, part by part and slot by slot, and the rest of it is freed.
 */
export function trackModel(model: LoadedModel): void {
	const at = generation;
	track(sizesOf(model.entry), true, async (size) => {
		const { file, sha256 } = fileAt(model.entry, size);
		const copy = await parseModel(model.entry, await fetchAsset(file, sha256, 'low'));
		try {
			live(at);
			const same =
				copy.parts.length === model.parts.length &&
				copy.parts.every(
					(p, i) =>
						p.role === model.parts[i].role &&
						p.lod === model.parts[i].lod &&
						Object.keys(p.maps ?? {}).join() === Object.keys(model.parts[i].maps ?? {}).join()
				);
			if (!same) throw new Error(`its ${size} px copy has other parts`);
			const done = new Set<THREE.Texture>();
			model.parts.forEach((part, i) => {
				for (const [slot, t] of Object.entries(part.maps ?? {}) as [SlotName, THREE.Texture][]) {
					if (done.has(t)) continue;
					done.add(t);
					refill(t, copy.parts[i].maps![slot]!);
					slotTexture(t, slot);
				}
			});
		} finally {
			// The copy's own GPU textures (parseModel uploads them) and geometry; its pixels are moved.
			const textures = new Set(copy.parts.flatMap((p) => Object.values(p.maps ?? {})));
			for (const p of copy.parts) p.geometry.dispose();
			for (const t of textures) t.dispose();
		}
	});
}

/** One map of a table's floor arrays (surfaces.ts): the sizes every layer has, and its array at one. */
export function trackFloors(
	floors: FloorSurfaces,
	map: FloorMap,
	sizes: number[],
	build: (size: number) => Promise<THREE.Texture | null>
): void {
	const at = generation;
	track(sizes, true, async (size) => {
		const next = await build(size);
		if (!next) throw new Error(`the floors' ${size} px ${map} array did not load`);
		try {
			live(at);
			refill(floors.maps[map], next);
			slotTexture(floors.maps[map], map);
		} finally {
			next.dispose();
		}
	});
}

/** The device-bound textures are freed (models.ts `freeAll`): stop following them. */
export function forgetDevice(): void {
	generation++;
	for (const item of perDevice) retargeter.forget(item);
	perDevice.clear();
}
