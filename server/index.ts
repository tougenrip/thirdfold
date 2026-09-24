import path from 'node:path';
import { startGameServer } from './game-server';
import { FileSceneStore, type SceneStore } from './scene-store';
import { SupabaseSceneStore } from './supabase-scene-store';

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

const { store, where } = sceneStore();
const server = await startGameServer({ port, host, sceneStore: store });
console.info(`[game-server] listening on ws://${host}:${server.port}, scenes in ${where}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		server.close().then(() => process.exit(0));
	});
}
