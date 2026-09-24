import path from 'node:path';
import { startGameServer } from './game-server';
import { FileSceneStore, type SceneStore } from './scene-store';
import { SupabaseSceneStore } from './supabase-scene-store';
import { FileRoomStore, SupabaseRoomStore, type RoomStore } from './room-store';
import { FileLibraryStore, type LibraryStore } from './library-store';
import { SupabaseLibraryStore } from './supabase-library-store';

const port = Number(process.env.GAME_SERVER_PORT ?? 8787);
const host = process.env.GAME_SERVER_HOST ?? '0.0.0.0';

// Scenes go to Supabase when it is configured (server-side key only), else to local files.
function sceneStore(): { store: SceneStore; where: string } {
	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_KEY;
	if (url && key)
		return { store: SupabaseSceneStore.connect(url, key), where: `Supabase (${url})` };
	if (url || key) {
		throw new Error('Set both SUPABASE_URL and SUPABASE_SERVICE_KEY to store scenes in Supabase.');
	}
	const dir = path.resolve(process.env.SCENES_DIR ?? 'data/scenes');
	return { store: new FileSceneStore(dir), where: dir };
}

// Live rooms, so a restart doesn't end a game: in Supabase alongside the scenes, else in files.
function roomStore(): { store: RoomStore; where: string } {
	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_KEY;
	if (url && key) return { store: SupabaseRoomStore.connect(url, key), where: 'Supabase' };
	const dir = path.resolve(process.env.ROOMS_DIR ?? 'data/rooms');
	return { store: new FileRoomStore(dir), where: dir };
}

// The adventure library: in Supabase too, else in files.
function libraryStore(): { store: LibraryStore; where: string } {
	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_KEY;
	if (url && key) return { store: SupabaseLibraryStore.connect(url, key), where: 'Supabase' };
	const dir = path.resolve(process.env.LIBRARY_DIR ?? 'data/library');
	return { store: new FileLibraryStore(dir), where: dir };
}

const { store, where } = sceneStore();
const rooms = roomStore();
const library = libraryStore();
const server = await startGameServer({
	port,
	host,
	sceneStore: store,
	roomStore: rooms.store,
	libraryStore: library.store
});
console.info(
	`[game-server] listening on ws://${host}:${server.port}, scenes in ${where}, rooms in ${rooms.where}, library in ${library.where}`
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		server.close().then(() => process.exit(0));
	});
}
