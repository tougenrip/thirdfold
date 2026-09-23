import { startGameServer } from './game-server';

const port = Number(process.env.GAME_SERVER_PORT ?? 8787);
const host = process.env.GAME_SERVER_HOST ?? '0.0.0.0';

const server = await startGameServer({ port, host });
console.info(`[game-server] listening on ws://${host}:${server.port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		server.close().then(() => process.exit(0));
	});
}
