import path from 'node:path';
import { startGameServer } from './game-server';
import { FileSceneStore } from './scene-store';

const port = Number(process.env.GAME_SERVER_PORT ?? 8787);
const host = process.env.GAME_SERVER_HOST ?? '0.0.0.0';
const scenesDir = path.resolve(process.env.SCENES_DIR ?? 'data/scenes');

const server = await startGameServer({ port, host, sceneStore: new FileSceneStore(scenesDir) });
console.info(`[game-server] listening on ws://${host}:${server.port}, scenes in ${scenesDir}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		server.close().then(() => process.exit(0));
	});
}
