import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';
import { SCENE_FILE_VERSION } from '../src/lib/game/scene-file';
import { backupData, supabaseFromEnv, TABLES, type DataDirs } from './data-backup';
import { restoreData } from './data-restore';
import { FileLibraryStore } from './library-store';
import { FileRoomStore, serializeRoom } from './room-store';
import { RoomManager } from './rooms';
import { exportScene } from './scene-io';
import { FileSceneStore } from './scene-store';

const temps: string[] = [];
async function temp(): Promise<string> {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'thirdfold-backup-'));
	temps.push(dir);
	return dir;
}
afterEach(async () => {
	await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const dirsIn = (root: string): DataDirs => ({
	scenes: path.join(root, 'scenes'),
	rooms: path.join(root, 'rooms'),
	library: path.join(root, 'library')
});

/** Every file under a directory, by relative path. */
async function contents(dir: string): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile()) continue;
		const file = path.join(entry.parentPath, entry.name);
		out[path.relative(dir, file)] = await readFile(file, 'utf8');
	}
	return out;
}

/** Tables in memory, answering just the queries backup and restore make. */
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
	const client = {
		from: (table: string) => ({
			select: () => {
				const query = {
					order: () => query,
					range: (from: number, to: number) =>
						Promise.resolve({ data: (tables[table] ?? []).slice(from, to + 1), error: null })
				};
				return query;
			},
			upsert: (rows: Record<string, unknown>[], { onConflict }: { onConflict: string }) => {
				const key = (row: Record<string, unknown>) =>
					onConflict
						.split(',')
						.map((c) => row[c])
						.join('|');
				const kept = (tables[table] ??= []);
				for (const row of rows) {
					const at = kept.findIndex((r) => key(r) === key(row));
					if (at >= 0) kept[at] = row;
					else kept.push(row);
				}
				return Promise.resolve({ error: null });
			}
		})
	};
	return client as unknown as SupabaseClient;
}

describe('data backup and restore', () => {
	it('backs up the file stores and restores them byte for byte', async () => {
		const live = dirsIn(await temp());
		const rooms = new RoomManager();
		const created = rooms.create('Gia');
		if (!created.ok) throw new Error(created.message);
		const scene = exportScene(created.room, 'Crypt');
		await new FileSceneStore(live.scenes).save(scene, { owner: 'a'.repeat(64) });
		await new FileRoomStore(live.rooms).save(serializeRoom(created.room));
		await new FileLibraryStore(live.library).publish({
			owner: 'b'.repeat(64),
			creatorName: 'Mira',
			title: 'The Salt Road',
			about: 'Salt',
			file: { format: 'thirdfold-adventure', title: 'The Salt Road' }
		});
		// A store's half-written file is left behind.
		await writeFile(path.join(live.scenes, 'x.json.1.tmp'), '{');

		const backup = path.join(await temp(), 'b');
		const manifest = await backupData(backup, live, null);
		expect(manifest.files).toEqual({ scenes: 2, rooms: 1, library: 2 });
		expect(manifest.tables).toBeNull();
		expect(manifest.sceneVersions).toEqual({ [SCENE_FILE_VERSION]: 2 });
		await expect(backupData(backup, live, null)).rejects.toThrow('not empty');

		const restored = dirsIn(await temp());
		await restoreData(backup, restored, null);
		for (const store of ['scenes', 'rooms', 'library'] as const) {
			const before = await contents(live[store]);
			delete before['x.json.1.tmp'];
			expect(await contents(restored[store])).toEqual(before);
		}
	});

	it('skips stores that have no directory yet', async () => {
		const backup = path.join(await temp(), 'b');
		const manifest = await backupData(backup, dirsIn(await temp()), null);
		expect(manifest.files).toEqual({ scenes: null, rooms: null, library: null });
		const restored = dirsIn(await temp());
		await restoreData(backup, restored, null);
		await expect(readdir(restored.scenes)).rejects.toThrow();
	});

	it('pages every table out and upserts it back by primary key', async () => {
		const id = () => randomBytes(16).toString('hex');
		const scenes = Array.from({ length: 1203 }, () => ({ id: id(), data: { version: 9 } }));
		const adventure = id();
		const source: Record<string, Record<string, unknown>[]> = {
			scenes,
			live_rooms: [{ id: 'ABCDEF', data: { scene: { version: 10 } } }],
			library_adventures: [{ id: adventure, title: 'T' }],
			library_versions: [{ adventure_id: adventure, version: 1, file: {} }],
			library_ratings: []
		};
		const backup = path.join(await temp(), 'b');
		const manifest = await backupData(backup, dirsIn(await temp()), fakeDb(source));
		expect(manifest.tables).toEqual({
			scenes: 1203,
			live_rooms: 1,
			library_adventures: 1,
			library_versions: 1,
			library_ratings: 0
		});
		expect(manifest.sceneVersions).toEqual({ 9: 1203, 10: 1 });

		// Restoring over a changed database puts every backed-up row back as it was.
		const target = structuredClone(source);
		target.scenes[0] = { ...target.scenes[0], data: { version: 10 } };
		target.library_versions = [];
		await restoreData(backup, dirsIn(await temp()), fakeDb(target));
		expect(target).toEqual(source);

		await expect(restoreData(backup, dirsIn(await temp()), null)).rejects.toThrow('SUPABASE_URL');
	});
});

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

describe.skipIf(!url || !serviceKey)('data backup and restore (live Supabase)', () => {
	it('round-trips every table unchanged', async () => {
		const db = supabaseFromEnv();
		const first = path.join(await temp(), 'first');
		const manifest = await backupData(first, dirsIn(await temp()), db);
		await restoreData(first, dirsIn(await temp()), db);
		const second = path.join(await temp(), 'second');
		await backupData(second, dirsIn(await temp()), db);
		for (const table of TABLES) {
			const file = path.join('tables', `${table.name}.ndjson`);
			expect(await readFile(path.join(second, file), 'utf8')).toBe(
				await readFile(path.join(first, file), 'utf8')
			);
		}
		expect(manifest.tables).not.toBeNull();
	});
});
