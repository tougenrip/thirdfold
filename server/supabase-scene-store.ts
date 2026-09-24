// Scenes stored in Supabase Postgres (table `public.scenes`, see
// supabase/migrations). Server-side only: it needs the service/secret key,
// which bypasses row-level security, and so must never reach a browser.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SavedScene } from '../src/lib/game/protocol';
import type { SceneFile } from '../src/lib/game/scene-file';
import { newSceneId, SCENE_ID_PATTERN, type SceneMeta, type SceneStore } from './scene-store';

interface Row {
	id: string;
	name: string;
	saved_at: string;
	auto: boolean;
	summary: SavedScene['story'];
}

export class SupabaseSceneStore implements SceneStore {
	constructor(private readonly db: SupabaseClient) {}

	/** A store for a Supabase project URL and its service_role / secret key. */
	static connect(url: string, serviceKey: string): SupabaseSceneStore {
		return new SupabaseSceneStore(
			createClient(url, serviceKey, {
				auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
			})
		);
	}

	async save(scene: SceneFile, meta: SceneMeta = { owner: null }, id?: string): Promise<string> {
		const row = {
			name: scene.name,
			data: scene,
			owner: meta.owner,
			auto: meta.auto === true,
			summary: meta.story ?? null,
			saved_at: scene.savedAt
		};
		if (id === undefined) {
			const fresh = newSceneId();
			const { error } = await this.db.from('scenes').insert({ id: fresh, ...row });
			if (error) throw new Error(`Saving scene failed: ${error.message}`);
			return fresh;
		}
		const current = await this.ownerOf(id);
		if (current !== undefined && (current === null || current !== meta.owner)) {
			throw new Error('That save belongs to someone else.');
		}
		const { error } = await this.db.from('scenes').upsert({ id, ...row });
		if (error) throw new Error(`Saving scene failed: ${error.message}`);
		return id;
	}

	async load(id: string): Promise<unknown | null> {
		if (!SCENE_ID_PATTERN.test(id)) return null;
		const { data, error } = await this.db.from('scenes').select('data').eq('id', id).maybeSingle();
		if (error) throw new Error(`Loading scene failed: ${error.message}`);
		return data ? (data as { data: unknown }).data : null;
	}

	async ownerOf(id: string): Promise<string | null | undefined> {
		if (!SCENE_ID_PATTERN.test(id)) return undefined;
		const { data, error } = await this.db.from('scenes').select('owner').eq('id', id).maybeSingle();
		if (error) throw new Error(`Loading scene failed: ${error.message}`);
		return data ? ((data as { owner: string | null }).owner ?? null) : undefined;
	}

	async list(owner: string): Promise<SavedScene[]> {
		const { data, error } = await this.db
			.from('scenes')
			.select('id, name, saved_at, auto, summary')
			.eq('owner', owner)
			.order('saved_at', { ascending: false })
			.limit(100);
		if (error) throw new Error(`Listing scenes failed: ${error.message}`);
		return ((data ?? []) as Row[]).map((r) => ({
			id: r.id,
			name: r.name,
			savedAt: new Date(r.saved_at).toISOString(),
			auto: r.auto,
			story: r.summary ?? null
		}));
	}

	async remove(id: string, owner: string): Promise<boolean> {
		if ((await this.ownerOf(id)) !== owner) return false;
		const { error } = await this.db.from('scenes').delete().eq('id', id).eq('owner', owner);
		if (error) throw new Error(`Removing scene failed: ${error.message}`);
		return true;
	}
}
