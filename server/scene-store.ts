// Where saved scenes live. Scenes are stored by an unguessable id. Each save
// belongs to the GM who made it, by the hash of their lasting GM key (see
// gm-keys.ts): that is what lists a GM's saves on any device, and only its
// owner can list, replace or forget a save. Saves from before GM keys have no
// owner and stay loadable by id, as they always were. The file store keeps
// one JSON file per scene plus a small metadata file and is the default;
// the Supabase store keeps them in Postgres.

import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SavedScene } from '../src/lib/game/protocol';
import type { SceneFile } from '../src/lib/game/scene-file';

/** What is kept about a save besides the scene itself. */
export interface SceneMeta {
	/** The owning GM's key hash, or null for a save from before GM keys. */
	owner: string | null;
	/** Saved by the table as the story went on, rather than by the GM. */
	auto?: boolean;
	story?: SavedScene['story'];
}

export interface SceneStore {
	/**
	 * Stores a scene and returns its id. With `id`, replaces that save instead
	 * (an autosave slot); only its owner may, else it throws.
	 */
	save(scene: SceneFile, meta?: SceneMeta, id?: string): Promise<string>;
	/** The raw stored data (still to be validated), or null if there is no such scene. */
	load(id: string): Promise<unknown | null>;
	/** Who owns a save: a key hash, null for an ownerless (old) save, undefined if there is none. */
	ownerOf(id: string): Promise<string | null | undefined>;
	/** An owner's saves, newest first. */
	list(owner: string): Promise<SavedScene[]>;
	/** Forgets a save if `owner` owns it; false otherwise. */
	remove(id: string, owner: string): Promise<boolean>;
}

/** 128 random bits, hex. Checked before any use so an id can never become a path. */
export const SCENE_ID_PATTERN = /^[0-9a-f]{32}$/;

export function newSceneId(): string {
	return randomBytes(16).toString('hex');
}

/** The newest first; the most recent save is what "Continue" continues. */
const newestFirst = (a: SavedScene, b: SavedScene) => b.savedAt.localeCompare(a.savedAt);

interface StoredMeta {
	owner: string | null;
	name: string;
	savedAt: string;
	auto: boolean;
	story: SavedScene['story'];
}

export class FileSceneStore implements SceneStore {
	constructor(private readonly dir: string) {}

	async save(scene: SceneFile, meta: SceneMeta = { owner: null }, id?: string): Promise<string> {
		if (id !== undefined) await this.mustOwn(id, meta.owner);
		const sceneId = id ?? newSceneId();
		await mkdir(this.dir, { recursive: true });
		const stored: StoredMeta = {
			owner: meta.owner,
			name: scene.name,
			savedAt: scene.savedAt,
			auto: meta.auto === true,
			story: meta.story ?? null
		};
		// Write then rename, so a crash mid-write never leaves a truncated scene behind.
		await this.write(this.file(sceneId), JSON.stringify(scene));
		await this.write(this.metaFile(sceneId), JSON.stringify(stored));
		return sceneId;
	}

	async load(id: string): Promise<unknown | null> {
		if (!SCENE_ID_PATTERN.test(id)) return null;
		const text = await this.read(this.file(id));
		return text === null ? null : JSON.parse(text);
	}

	async ownerOf(id: string): Promise<string | null | undefined> {
		if (!SCENE_ID_PATTERN.test(id)) return undefined;
		const meta = await this.read(this.metaFile(id));
		if (meta !== null) return (JSON.parse(meta) as StoredMeta).owner;
		// A save from before GM keys: no metadata, no owner.
		return (await this.read(this.file(id))) === null ? undefined : null;
	}

	async list(owner: string): Promise<SavedScene[]> {
		let names: string[];
		try {
			names = await readdir(this.dir);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
			throw err;
		}
		const scenes: SavedScene[] = [];
		for (const name of names) {
			const id = name.replace(/\.meta\.json$/, '');
			if (!name.endsWith('.meta.json') || !SCENE_ID_PATTERN.test(id)) continue;
			const text = await this.read(this.metaFile(id));
			const meta = text && (JSON.parse(text) as StoredMeta);
			if (!meta || meta.owner !== owner) continue;
			scenes.push({
				id,
				name: meta.name,
				savedAt: meta.savedAt,
				auto: meta.auto,
				story: meta.story
			});
		}
		return scenes.sort(newestFirst);
	}

	async remove(id: string, owner: string): Promise<boolean> {
		if ((await this.ownerOf(id)) !== owner) return false;
		await rm(this.file(id), { force: true });
		await rm(this.metaFile(id), { force: true });
		return true;
	}

	private async mustOwn(id: string, owner: string | null): Promise<void> {
		const current = await this.ownerOf(id);
		if (current !== undefined && (current === null || current !== owner)) {
			throw new Error('That save belongs to someone else.');
		}
	}

	private async write(file: string, text: string): Promise<void> {
		const tmp = `${file}.${process.pid}.tmp`;
		await writeFile(tmp, text, 'utf8');
		await rename(tmp, file);
	}

	private async read(file: string): Promise<string | null> {
		try {
			return await readFile(file, 'utf8');
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
			throw err;
		}
	}

	private file(id: string): string {
		if (!SCENE_ID_PATTERN.test(id)) throw new Error('Invalid scene id');
		return path.join(this.dir, `${id}.json`);
	}

	private metaFile(id: string): string {
		if (!SCENE_ID_PATTERN.test(id)) throw new Error('Invalid scene id');
		return path.join(this.dir, `${id}.meta.json`);
	}
}

/** For tests and throwaway servers. */
export class MemorySceneStore implements SceneStore {
	private scenes = new Map<string, { text: string; meta: StoredMeta }>();

	async save(scene: SceneFile, meta: SceneMeta = { owner: null }, id?: string): Promise<string> {
		if (id !== undefined) {
			const current = this.scenes.get(id);
			if (current && (current.meta.owner === null || current.meta.owner !== meta.owner)) {
				throw new Error('That save belongs to someone else.');
			}
		}
		const sceneId = id ?? newSceneId();
		this.scenes.set(sceneId, {
			text: JSON.stringify(scene),
			meta: {
				owner: meta.owner,
				name: scene.name,
				savedAt: scene.savedAt,
				auto: meta.auto === true,
				story: meta.story ?? null
			}
		});
		return sceneId;
	}

	async load(id: string): Promise<unknown | null> {
		const stored = this.scenes.get(id);
		return stored === undefined ? null : JSON.parse(stored.text);
	}

	async ownerOf(id: string): Promise<string | null | undefined> {
		return this.scenes.get(id)?.meta.owner;
	}

	async list(owner: string): Promise<SavedScene[]> {
		return [...this.scenes]
			.filter(([, s]) => s.meta.owner === owner)
			.map(([id, s]) => ({
				id,
				name: s.meta.name,
				savedAt: s.meta.savedAt,
				auto: s.meta.auto,
				story: s.meta.story
			}))
			.sort(newestFirst);
	}

	async remove(id: string, owner: string): Promise<boolean> {
		if (this.scenes.get(id)?.meta.owner !== owner) return false;
		this.scenes.delete(id);
		return true;
	}
}
