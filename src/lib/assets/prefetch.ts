// Prefetching a table's assets (#192): what to download, in what order, as
// soon as the table is known. Pure; the renderer runs the plan (models.ts
// `prefetch`) on every update of its tokens and props.
//
// Secrecy: a plan is made only from what this viewer was sent (the table's
// environment, its tokens' models and its props' assets), the public
// manifest and where the camera looks. Never the story, the next table or
// the server's content: a GM-hidden prop a player was never sent can't be in
// that player's plan, and looking ahead would tell where the story goes.

import { gridDistance, type GridPos } from '../game/grid';
import type { Priority } from './load';
import type { Manifest } from './manifest';

/** What a viewer was sent of the table: nothing else can be planned from. */
export interface PlanView {
	environment: string | null;
	tokens: readonly { model?: string; pos: GridPos }[];
	props: readonly { assetId: string; pos: GridPos }[];
}

/**
 * One load: the KTX2 transcoder, an environment's looks, a model's preview (and with it the full
 * model, queued behind every preview) or a model.
 */
export interface Planned {
	kind: 'decoders' | 'environment' | 'preview' | 'model';
	id: string;
	priority: Priority;
}

/** Model ids by distance to `focus` (the nearest of each id counts), known to the manifest. */
function nearest(
	placed: readonly { id: string | undefined; pos: GridPos }[],
	manifest: Manifest,
	focus: GridPos | null
): string[] {
	const best = new Map<string, number>();
	for (const { id, pos } of placed) {
		if (!id || !Object.hasOwn(manifest.models, id)) continue;
		const d = focus ? gridDistance(pos, focus) : 0;
		if (d < (best.get(id) ?? Infinity)) best.set(id, d);
	}
	return [...best].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

/**
 * The loads a table needs, in order: the transcoder if anything planned is KTX2, the environment,
 * every preview, then the models (tokens' first, then props'), each nearest `focus` first.
 */
export function plan(view: PlanView, manifest: Manifest, focus: GridPos | null): Planned[] {
	const tokens = nearest(
		view.tokens.map((t) => ({ id: t.model, pos: t.pos })),
		manifest,
		focus
	);
	const props = nearest(
		view.props.map((p) => ({ id: p.assetId, pos: p.pos })),
		manifest,
		focus
	);
	const models = [...new Set([...tokens, ...props])];
	const env = view.environment ? manifest.environments[view.environment] : undefined;
	const out: Planned[] = [];
	const textures = env
		? [env.surface, env.ground, env.walls, env.table]
				.flatMap((m) => (m ? [manifest.materials[m]?.map] : []))
				.concat(Object.values(env.lut ?? {}).flatMap((bands) => Object.values(bands)))
				.concat(
					[...(env.surfaces?.floors ?? []), ...(env.surfaces?.walls ?? [])].flatMap((id) => {
						const s = manifest.surfaces[id];
						return s ? [s.albedo, s.normal, s.orm] : [];
					})
				)
		: [];
	const ktx2 = textures.some((t) => t && manifest.textures[t]?.format === 'ktx2');
	if (manifest.decoders && (ktx2 || models.some((id) => manifest.models[id].cooked))) {
		out.push({ kind: 'decoders', id: manifest.decoders.basis.dir, priority: 'high' });
	}
	if (env) out.push({ kind: 'environment', id: view.environment!, priority: 'high' });
	for (const id of models)
		if (manifest.models[id].preview) out.push({ kind: 'preview', id, priority: 'high' });
	for (const id of models) out.push({ kind: 'model', id, priority: 'low' });
	return out;
}
