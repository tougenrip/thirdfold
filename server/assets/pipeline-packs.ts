// Packs (#192): what downloads together. Pack ids describe looks, never a
// story's places or roles (the manifest is public): a texture only one
// environment wears is in that environment's pack, anything shared is in
// `core`, and a model is in `core` unless its meta.json names a pack
// (pipeline-models.ts). The manifest lists each pack's bytes and GPU bytes.

import type { Manifest, PackInfo } from '../../src/lib/assets/manifest';
import { CORE_PACK } from './pipeline-models';

/** Gives every texture and sound its pack, and fills the manifest's `packs`. */
export function assignPacks(manifest: Manifest): void {
	const wornBy = new Map<string, Set<string>>();
	const wear = (texture: string | undefined, pack: string) => {
		if (!texture) return;
		if (!wornBy.has(texture)) wornBy.set(texture, new Set());
		wornBy.get(texture)!.add(pack);
	};
	const materialTextures = (id: string) => {
		const m = manifest.materials[id];
		return [m?.map, m?.normal, m?.orm];
	};
	for (const [id, env] of Object.entries(manifest.environments)) {
		for (const m of [env.surface, env.ground, env.walls])
			for (const t of materialTextures(m)) wear(t, id);
		for (const bands of Object.values(env.lut ?? {}))
			for (const t of Object.values(bands)) wear(t, id);
		for (const s of [...(env.surfaces?.floors ?? []), ...(env.surfaces?.walls ?? [])]) {
			const surface = manifest.surfaces[s];
			for (const t of [surface?.albedo, surface?.normal, surface?.orm]) wear(t, id);
		}
	}
	// A texture models wear is in core: a model may be in any pack.
	for (const model of Object.values(manifest.models))
		for (const m of model.materials ?? []) for (const t of materialTextures(m)) wear(t, CORE_PACK);

	const packs: Record<string, PackInfo> = {};
	const add = (pack: string, bytes: number, gpuBytes: number) => {
		const p = (packs[pack] ??= { bytes: 0, gpuBytes: 0 });
		p.bytes += bytes;
		p.gpuBytes += gpuBytes;
	};
	for (const [id, t] of Object.entries(manifest.textures)) {
		const by = wornBy.get(id);
		t.pack = by?.size === 1 ? [...by][0] : CORE_PACK;
		add(t.pack, t.bytes, t.gpuBytes);
	}
	for (const m of Object.values(manifest.models)) {
		m.pack ??= CORE_PACK;
		add(m.pack, m.bytes + (m.preview?.bytes ?? 0), m.gpuBytes);
	}
	for (const a of Object.values(manifest.audio)) {
		a.pack = CORE_PACK;
		add(a.pack, a.bytes, 0);
	}
	manifest.packs = Object.fromEntries(Object.entries(packs).sort(([a], [b]) => (a < b ? -1 : 1)));
}
