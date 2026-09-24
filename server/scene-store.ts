// Where saved scenes live. Scenes are stored by an unguessable id: knowing
// the id is what lets a GM load a scene again (the GM's browser remembers
// the ids it saved). The file store keeps one JSON file per scene and is
// the default; the interface keeps a database-backed store a drop-in swap.

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SceneFile } from '../src/lib/game/scene-file';

export interface SceneStore {
	/** Stores a new scene and returns its id. */
	save(scene: SceneFile): Promise<string>;
	/** The raw stored data (still to be validated), or null if there is no such scene. */
	load(id: string): Promise<unknown | null>;
}

/** 128 random bits, hex. Checked before any use so an id can never become a path. */
export const SCENE_ID_PATTERN = /^[0-9a-f]{32}$/;

export function newSceneId(): string {
	return randomBytes(16).toString('hex');
}

export class FileSceneStore implements SceneStore {
	constructor(private readonly dir: string) {}

	async save(scene: SceneFile): Promise<string> {
		const id = newSceneId();
		await mkdir(this.dir, { recursive: true });
		const file = this.file(id);
		// Write then rename, so a crash mid-write never leaves a truncated scene behind.
		const tmp = `${file}.${process.pid}.tmp`;
		await writeFile(tmp, JSON.stringify(scene), 'utf8');
		await rename(tmp, file);
		return id;
	}

	async load(id: string): Promise<unknown | null> {
		if (!SCENE_ID_PATTERN.test(id)) return null;
		let text: string;
		try {
			text = await readFile(this.file(id), 'utf8');
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
			throw err;
		}
		return JSON.parse(text);
	}

	private file(id: string): string {
		if (!SCENE_ID_PATTERN.test(id)) throw new Error('Invalid scene id');
		return path.join(this.dir, `${id}.json`);
	}
}

/** For tests and throwaway servers. */
export class MemorySceneStore implements SceneStore {
	private scenes = new Map<string, string>();

	async save(scene: SceneFile): Promise<string> {
		const id = newSceneId();
		this.scenes.set(id, JSON.stringify(scene));
		return id;
	}

	async load(id: string): Promise<unknown | null> {
		const text = this.scenes.get(id);
		return text === undefined ? null : JSON.parse(text);
	}
}
