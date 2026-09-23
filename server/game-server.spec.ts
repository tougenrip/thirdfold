import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerMessage } from '../src/lib/game/protocol';
import { CLOSE_SESSION_REPLACED, startGameServer, type GameServer } from './game-server';

/** A test client that buffers every server message so assertions can await them in order. */
class TestClient {
	readonly ws: WebSocket;
	private inbox: ServerMessage[] = [];
	private waiters: ((msg: ServerMessage) => void)[] = [];
	readonly closed: Promise<number>;

	constructor(port: number) {
		this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
		this.ws.on('message', (data) => {
			const msg = JSON.parse(data.toString()) as ServerMessage;
			const waiter = this.waiters.shift();
			if (waiter) waiter(msg);
			else this.inbox.push(msg);
		});
		this.closed = new Promise((resolve) => this.ws.on('close', (code) => resolve(code)));
	}

	opened(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.ws.once('open', () => resolve());
			this.ws.once('error', reject);
		});
	}

	send(msg: unknown): void {
		this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
	}

	next(): Promise<ServerMessage> {
		const queued = this.inbox.shift();
		if (queued) return Promise.resolve(queued);
		return new Promise((resolve) => this.waiters.push(resolve));
	}

	async expect<T extends ServerMessage['type']>(
		type: T
	): Promise<Extract<ServerMessage, { type: T }>> {
		const msg = await this.next();
		expect(msg.type).toBe(type);
		return msg as Extract<ServerMessage, { type: T }>;
	}
}

let server: GameServer;
const clients: TestClient[] = [];

async function connect(): Promise<TestClient> {
	const client = new TestClient(server.port);
	clients.push(client);
	await client.opened();
	return client;
}

beforeEach(async () => {
	server = await startGameServer({ port: 0, host: '127.0.0.1' });
});

afterEach(async () => {
	for (const c of clients.splice(0)) c.ws.terminate();
	await server.close();
});

describe('game server', () => {
	it('lets a GM create a room and a player join, and both see each other', async () => {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const gmWelcome = await gm.expect('welcome');
		expect(gmWelcome.room.players).toEqual([
			{ id: gmWelcome.playerId, name: 'Gemma', role: 'gm', connected: true }
		]);

		const player = await connect();
		player.send({ type: 'join', roomId: gmWelcome.room.id, name: 'Pip', role: 'player' });
		const playerWelcome = await player.expect('welcome');
		expect(playerWelcome.room.players.map((p) => [p.name, p.role])).toEqual([
			['Gemma', 'gm'],
			['Pip', 'player']
		]);

		const joined = await gm.expect('player_joined');
		expect(joined.player).toEqual({
			id: playerWelcome.playerId,
			name: 'Pip',
			role: 'player',
			connected: true
		});
	});

	it('never leaks another player’s session token', async () => {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const gmWelcome = await gm.expect('welcome');
		const player = await connect();
		player.send({ type: 'join', roomId: gmWelcome.room.id, name: 'Pip', role: 'player' });
		const playerWelcome = await player.expect('welcome');
		expect(JSON.stringify(playerWelcome)).not.toContain(gmWelcome.token);
		expect(JSON.stringify(await gm.expect('player_joined'))).not.toContain(playerWelcome.token);
	});

	it('broadcasts disconnects and restores identity on resume', async () => {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room } = await gm.expect('welcome');
		const player = await connect();
		player.send({ type: 'join', roomId: room.id, name: 'Pip', role: 'player' });
		const { playerId, token } = await player.expect('welcome');
		await gm.expect('player_joined');

		player.ws.close();
		expect(await gm.expect('player_presence')).toEqual({
			type: 'player_presence',
			playerId,
			connected: false
		});

		const again = await connect();
		again.send({ type: 'resume', roomId: room.id, token });
		const resumed = await again.expect('welcome');
		expect(resumed.playerId).toBe(playerId);
		expect(resumed.room.players.find((p) => p.id === playerId)).toMatchObject({
			role: 'player',
			connected: true
		});
		expect(await gm.expect('player_presence')).toMatchObject({ playerId, connected: true });
	});

	it('closes the older socket when a session is resumed elsewhere without marking it offline', async () => {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room, token, playerId } = await gm.expect('welcome');

		const second = await connect();
		second.send({ type: 'resume', roomId: room.id, token });
		await second.expect('welcome');
		expect(await gm.closed).toBe(CLOSE_SESSION_REPLACED);
		expect(server.rooms.get(room.id)?.players.get(playerId)?.connected).toBe(true);
	});

	it('refuses to seat a client as GM through join', async () => {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room } = await gm.expect('welcome');
		const mallory = await connect();
		mallory.send({ type: 'join', roomId: room.id, name: 'Mallory', role: 'gm' });
		expect(await mallory.expect('error')).toMatchObject({ code: 'invalid_message' });
		expect(server.rooms.get(room.id)?.players.size).toBe(1);
	});

	it.each([
		['invalid JSON', '{not json'],
		['unknown type', { type: 'take_over' }],
		['wrong field types', { type: 'create', name: ['x'] }]
	])('rejects %s without dropping the connection', async (_label, payload) => {
		const client = await connect();
		client.send(payload);
		expect(await client.expect('error')).toMatchObject({ code: 'invalid_message' });
		client.send({ type: 'create', name: 'Still here' });
		await client.expect('welcome');
	});

	it('reports unknown rooms and stale sessions', async () => {
		const client = await connect();
		client.send({ type: 'join', roomId: 'ZZZZZZ', name: 'Pip', role: 'player' });
		expect(await client.expect('error')).toMatchObject({ code: 'room_not_found' });

		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room } = await gm.expect('welcome');
		client.send({ type: 'resume', roomId: room.id, token: '0'.repeat(64) });
		expect(await client.expect('error')).toMatchObject({ code: 'session_not_found' });
	});

	it('rejects a second join on the same connection', async () => {
		const client = await connect();
		client.send({ type: 'create', name: 'Gemma' });
		const { room } = await client.expect('welcome');
		client.send({ type: 'join', roomId: room.id, name: 'Twin', role: 'player' });
		expect(await client.expect('error')).toMatchObject({ code: 'already_joined' });
		expect(server.rooms.get(room.id)?.players.size).toBe(1);
	});
});
