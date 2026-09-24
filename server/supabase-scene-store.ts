// Scenes stored in Supabase Postgres (table `public.scenes`, see
// supabase/migrations). Server-side only: it needs the service/secret key,
// which bypasses row-level security, and so must never reach a browser.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SceneFile } from '../src/lib/game/scene-file';
import { newSceneId, SCENE_ID_PATTERN, type SceneStore } from './scene-store';

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

	async save(scene: SceneFile): Promise<string> {
		const id = newSceneId();
		const { error } = await this.db.from('scenes').insert({ id, name: scene.name, data: scene });
		if (error) throw new Error(`Saving scene failed: ${error.message}`);
		return id;
	}

	async load(id: string): Promise<unknown | null> {
		if (!SCENE_ID_PATTERN.test(id)) return null;
		const { data, error } = await this.db.from('scenes').select('data').eq('id', id).maybeSingle();
		if (error) throw new Error(`Loading scene failed: ${error.message}`);
		return data ? (data as { data: unknown }).data : null;
	}
}
