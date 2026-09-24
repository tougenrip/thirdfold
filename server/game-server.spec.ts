import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { AdventureView } from '../src/lib/adventure/adventure';
import { decodeLevels } from '../src/lib/game/terrain';
import type { ServerMessage } from '../src/lib/game/protocol';
import { CLOSE_SESSION_REPLACED, startGameServer, type GameServer } from './game-server';
import { FileSceneStore, type SceneStore } from './scene-store';
import { beginAdventure, claimCharacter, postSentries, startAdventure } from './adventure/engine';
import { HOLLOW_SPAWN, hollowScene } from './adventure/hollow';
import { recordOrigins } from './adventure/objects';
import { RoomManager } from './rooms';
import { applyScene, exportScene } from './scene-io';

class Queue {
	private items: ServerMessage[] = [];
	private waiters: ((msg: ServerMessage) => void)[] = [];

	push(msg: ServerMessage): void {
		const waiter = this.waiters.shift();
		if (waiter) waiter(msg);
		else this.items.push(msg);
	}

	next(): Promise<ServerMessage> {
		const queued = this.items.shift();
		if (queued) return Promise.resolve(queued);
		return new Promise((resolve) => this.waiters.push(resolve));
	}
}

/** A test client that buffers every server message so assertions can await them in order. */
class TestClient {
	readonly ws: WebSocket;
	readonly closed: Promise<number>;
	// Room log messages ('chat') are queued apart from state messages, so tests
	// about tokens or presence don't have to step over system notices.
	private queues = { state: new Queue(), chat: new Queue() };

	constructor(port: number) {
		this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
		this.ws.on('message', (data) => {
			const msg = JSON.parse(data.toString()) as ServerMessage;
			this.queues[msg.type === 'chat' ? 'chat' : 'state'].push(msg);
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

	/** Skips state messages until one of `type` arrives (for when earlier traffic doesn't matter). */
	async until<T extends ServerMessage['type']>(
		type: T,
		match: (msg: Extract<ServerMessage, { type: T }>) => boolean = () => true
	): Promise<Extract<ServerMessage, { type: T }>> {
		for (;;) {
			const msg = await this.queues[type === 'chat' ? 'chat' : 'state'].next();
			if (msg.type === type && match(msg as Extract<ServerMessage, { type: T }>))
				return msg as Extract<ServerMessage, { type: T }>;
		}
	}

	/** Reads the log stream forward until a system notice with this text, skipping earlier entries. */
	async untilNotice(text: string): Promise<void> {
		for (;;) {
			const { message } = await this.expect('chat');
			if (message.kind === 'system' && message.text === text) return;
		}
	}

	async expect<T extends ServerMessage['type']>(
		type: T
	): Promise<Extract<ServerMessage, { type: T }>> {
		const msg = await this.queues[type === 'chat' ? 'chat' : 'state'].next();
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
		expect(JSON.stringify(playerWelcome)).not.toContain(gmWelcome.sessionToken);
		expect(JSON.stringify(await gm.expect('player_joined'))).not.toContain(
			playerWelcome.sessionToken
		);
	});

	it('broadcasts disconnects and restores identity on resume', async () => {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room } = await gm.expect('welcome');
		const player = await connect();
		player.send({ type: 'join', roomId: room.id, name: 'Pip', role: 'player' });
		const { playerId, sessionToken } = await player.expect('welcome');
		await gm.expect('player_joined');

		player.ws.close();
		expect(await gm.expect('player_presence')).toEqual({
			type: 'player_presence',
			playerId,
			connected: false
		});

		const again = await connect();
		again.send({ type: 'resume', roomId: room.id, sessionToken });
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
		const { room, sessionToken, playerId } = await gm.expect('welcome');

		const second = await connect();
		second.send({ type: 'resume', roomId: room.id, sessionToken });
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
		client.send({ type: 'resume', roomId: room.id, sessionToken: '0'.repeat(64) });
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

describe('tokens over the wire', () => {
	/** A room with a GM, two players and a spectator, all seated and drained of join broadcasts. */
	async function table() {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room } = await gm.expect('welcome');
		const seat = async (name: string, role: 'player' | 'spectator') => {
			const c = await connect();
			c.send({ type: 'join', roomId: room.id, name, role });
			const { playerId } = await c.expect('welcome');
			return { c, id: playerId };
		};
		const pip = await seat('Pip', 'player');
		const ivy = await seat('Ivy', 'player');
		const sam = await seat('Sam', 'spectator');
		// Drain player_joined broadcasts: GM saw 3, Pip 2, Ivy 1.
		for (let i = 0; i < 3; i++) await gm.expect('player_joined');
		for (let i = 0; i < 2; i++) await pip.c.expect('player_joined');
		await ivy.c.expect('player_joined');
		return { roomId: room.id, gm, pip, ivy, sam };
	}

	async function placeToken(
		gm: TestClient,
		others: TestClient[],
		pos: { x: number; y: number },
		ownerId: string | null
	) {
		gm.send({ type: 'token_create', name: 'Mini', color: '#2e86c1', pos, ownerId });
		const { token } = await gm.expect('token_upserted');
		for (const c of others) expect((await c.expect('token_upserted')).token).toEqual(token);
		return token;
	}

	it('syncs a player moving their own token to everyone', async () => {
		const { gm, pip, ivy, sam } = await table();
		const token = await placeToken(gm, [pip.c, ivy.c, sam.c], { x: 0, y: 0 }, pip.id);

		pip.c.send({ type: 'token_move', tokenId: token.id, to: { x: 4, y: 2 } });
		for (const c of [gm, pip.c, ivy.c, sam.c]) {
			expect(await c.expect('token_moved')).toEqual({
				type: 'token_moved',
				tokenId: token.id,
				pos: { x: 4, y: 2 },
				byPlayerId: pip.id
			});
		}
	});

	it('rejects a player moving a token they do not control, and nobody sees a move', async () => {
		const { roomId, gm, pip, ivy, sam } = await table();
		const pipsToken = await placeToken(gm, [pip.c, ivy.c, sam.c], { x: 0, y: 0 }, pip.id);
		const npc = await placeToken(gm, [pip.c, ivy.c, sam.c], { x: 1, y: 0 }, null);

		ivy.c.send({ type: 'token_move', tokenId: pipsToken.id, to: { x: 5, y: 5 } });
		expect(await ivy.c.expect('error')).toMatchObject({ code: 'forbidden' });
		pip.c.send({ type: 'token_move', tokenId: npc.id, to: { x: 5, y: 5 } });
		expect(await pip.c.expect('error')).toMatchObject({ code: 'forbidden' });
		sam.c.send({ type: 'token_move', tokenId: npc.id, to: { x: 5, y: 5 } });
		expect(await sam.c.expect('error')).toMatchObject({ code: 'forbidden' });

		const tokens = server.rooms.get(roomId)!.tokens;
		expect(tokens.get(pipsToken.id)?.pos).toEqual({ x: 0, y: 0 });
		expect(tokens.get(npc.id)?.pos).toEqual({ x: 1, y: 0 });

		// The next thing the GM hears is a legitimate move, proving no rejected move was broadcast.
		gm.send({ type: 'token_move', tokenId: npc.id, to: { x: 2, y: 0 } });
		expect(await gm.expect('token_moved')).toMatchObject({ tokenId: npc.id, pos: { x: 2, y: 0 } });
		expect(await ivy.c.expect('token_moved')).toMatchObject({ tokenId: npc.id });
	});

	it('keeps scene edits GM-only', async () => {
		const { gm, pip, ivy, sam } = await table();
		const token = await placeToken(gm, [pip.c, ivy.c, sam.c], { x: 0, y: 0 }, null);

		pip.c.send({
			type: 'token_create',
			name: 'Mine',
			color: '#000000',
			pos: { x: 3, y: 3 },
			ownerId: pip.id
		});
		expect(await pip.c.expect('error')).toMatchObject({ code: 'forbidden' });
		pip.c.send({ type: 'token_update', tokenId: token.id, patch: { ownerId: pip.id } });
		expect(await pip.c.expect('error')).toMatchObject({ code: 'forbidden' });
		pip.c.send({ type: 'token_delete', tokenId: token.id });
		expect(await pip.c.expect('error')).toMatchObject({ code: 'forbidden' });

		gm.send({ type: 'token_update', tokenId: token.id, patch: { ownerId: pip.id, name: 'Pip' } });
		for (const c of [gm, pip.c, ivy.c, sam.c]) {
			expect((await c.expect('token_upserted')).token).toMatchObject({
				ownerId: pip.id,
				name: 'Pip'
			});
		}
		gm.send({ type: 'token_delete', tokenId: token.id });
		for (const c of [gm, pip.c, ivy.c, sam.c]) {
			expect(await c.expect('token_deleted')).toMatchObject({ tokenId: token.id });
		}
	});

	it('includes tokens in the snapshot for late joiners', async () => {
		const { roomId, gm, pip, ivy, sam } = await table();
		const token = await placeToken(gm, [pip.c, ivy.c, sam.c], { x: 7, y: 8 }, pip.id);

		const late = await connect();
		late.send({ type: 'join', roomId, name: 'Late', role: 'spectator' });
		expect((await late.expect('welcome')).room.tokens).toEqual([token]);
	});

	it('restores token control after the owner reconnects', async () => {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room } = await gm.expect('welcome');
		const pip = await connect();
		pip.send({ type: 'join', roomId: room.id, name: 'Pip', role: 'player' });
		const { playerId, sessionToken } = await pip.expect('welcome');
		await gm.expect('player_joined');
		gm.send({
			type: 'token_create',
			name: 'Pip',
			color: '#27ae60',
			pos: { x: 0, y: 0 },
			ownerId: playerId
		});
		const { token } = await gm.expect('token_upserted');
		await pip.expect('token_upserted');

		pip.ws.close();
		await gm.expect('player_presence');
		const back = await connect();
		back.send({ type: 'resume', roomId: room.id, sessionToken });
		await back.expect('welcome');
		back.send({ type: 'token_move', tokenId: token.id, to: { x: 1, y: 1 } });
		expect(await back.expect('token_moved')).toMatchObject({ byPlayerId: playerId });
	});

	it('requires joining before any in-room action', async () => {
		const client = await connect();
		client.send({ type: 'token_move', tokenId: 'x', to: { x: 0, y: 0 } });
		expect(await client.expect('error')).toMatchObject({ code: 'not_joined' });
	});

	it.each([
		['fractional cell', { type: 'token_move', tokenId: 'x', to: { x: 1.5, y: 0 } }],
		['string cell', { type: 'token_move', tokenId: 'x', to: { x: '1', y: 0 } }],
		[
			'bad colour',
			{ type: 'token_create', name: 'A', color: 'red', pos: { x: 0, y: 0 }, ownerId: null }
		],
		['empty patch', { type: 'token_update', tokenId: 'x', patch: {} }]
	])('rejects malformed token payload: %s', async (_label, payload) => {
		const { gm } = await table();
		gm.send(payload);
		expect(await gm.expect('error')).toMatchObject({ code: 'invalid_message' });
	});
});

describe('chat and dice over the wire', () => {
	async function pair() {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room } = await gm.expect('welcome');
		const pip = await connect();
		pip.send({ type: 'join', roomId: room.id, name: 'Pip', role: 'player' });
		const welcome = await pip.expect('welcome');
		await gm.expect('player_joined');
		return { roomId: room.id, gm, pip, pipId: welcome.playerId, pipLog: welcome.room.log };
	}

	it('logs joins as system messages, including in the joiner’s own snapshot', async () => {
		const { gm, pipLog } = await pair();
		expect(pipLog.map((m) => m.kind === 'system' && m.text)).toEqual([
			'Gemma opened the table as GM.',
			'Pip joined as a player.'
		]);
		expect((await gm.expect('chat')).message).toMatchObject({
			kind: 'system',
			text: 'Pip joined as a player.'
		});
	});

	it('delivers chat to everyone with the server-known author', async () => {
		const { gm, pip, pipId } = await pair();
		await gm.expect('chat'); // join notice
		pip.send({ type: 'chat_send', text: 'Hello <b>table</b>', authorName: 'The GM' });
		for (const c of [gm, pip]) {
			expect((await c.expect('chat')).message).toMatchObject({
				kind: 'chat',
				authorId: pipId,
				authorName: 'Pip',
				text: 'Hello <b>table</b>'
			});
		}
	});

	it('rolls on the server and shows everyone the same result, ignoring client-sent results', async () => {
		const { gm, pip, pipId } = await pair();
		await gm.expect('chat');
		pip.send({ type: 'dice_roll', expression: '1d20+5', total: 25, roll: { total: 25 } });
		const seen = await Promise.all([gm.expect('chat'), pip.expect('chat')]);
		expect(seen[0].message).toEqual(seen[1].message);
		const message = seen[0].message;
		expect(message).toMatchObject({ kind: 'roll', authorId: pipId });
		if (message.kind !== 'roll') throw new Error('expected a roll');
		expect(message.roll.expression).toBe('1d20+5');
		const [d20] = message.roll.terms;
		expect(d20.kind === 'dice' && d20.rolls[0]).toBeGreaterThanOrEqual(1);
		expect(message.roll.total).toBe((d20.kind === 'dice' ? d20.rolls[0] : 0) + 5);
		expect(message.roll.total).toBeLessThanOrEqual(25);
	});

	it('lets spectators chat and roll', async () => {
		const { roomId, gm } = await pair();
		await gm.expect('chat');
		const sam = await connect();
		sam.send({ type: 'join', roomId, name: 'Sam', role: 'spectator' });
		await sam.expect('welcome');
		await gm.expect('chat'); // Sam's join notice
		sam.send({ type: 'dice_roll', expression: 'd6' });
		expect((await gm.expect('chat')).message).toMatchObject({ kind: 'roll', authorName: 'Sam' });
		sam.send({ type: 'chat_send', text: 'watching' });
		expect((await gm.expect('chat')).message).toMatchObject({ kind: 'chat', text: 'watching' });
	});

	it('rejects bad dice and empty chat only to the sender', async () => {
		const { gm, pip } = await pair();
		await gm.expect('chat');
		pip.send({ type: 'dice_roll', expression: '1d20; process.exit()' });
		expect(await pip.expect('error')).toMatchObject({ code: 'invalid_dice' });
		pip.send({ type: 'chat_send', text: '   ' });
		expect(await pip.expect('error')).toMatchObject({ code: 'invalid_chat' });
		pip.send({ type: 'chat_send', text: 'ok' });
		expect((await gm.expect('chat')).message).toMatchObject({ text: 'ok' });
	});

	it('rate-limits chat floods per player', async () => {
		const { pip } = await pair();
		for (let i = 0; i < 9; i++) pip.send({ type: 'chat_send', text: `spam ${i}` });
		expect(await pip.expect('error')).toMatchObject({ code: 'rate_limited' });
	});

	it('announces token actions and gives late joiners the log', async () => {
		const { roomId, gm, pip, pipId } = await pair();
		await gm.expect('chat');
		gm.send({
			type: 'token_create',
			name: 'Hero',
			color: '#2e86c1',
			pos: { x: 0, y: 0 },
			ownerId: pipId
		});
		const { token } = await gm.expect('token_upserted');
		expect((await gm.expect('chat')).message).toMatchObject({ text: 'Gemma placed Hero (Pip).' });
		pip.send({ type: 'token_move', tokenId: token.id, to: { x: 3, y: 1 } });
		expect((await gm.expect('chat')).message).toMatchObject({ text: 'Pip moved Hero 3 cells.' });
		gm.send({ type: 'token_update', tokenId: token.id, patch: { ownerId: null } });
		expect((await gm.expect('chat')).message).toMatchObject({ text: 'Gemma took back Hero.' });

		const late = await connect();
		late.send({ type: 'join', roomId, name: 'Late', role: 'spectator' });
		const texts = (await late.expect('welcome')).room.log.map((m) =>
			m.kind === 'system' ? m.text : m.kind
		);
		expect(texts.slice(-4)).toEqual([
			'Gemma placed Hero (Pip).',
			'Pip moved Hero 3 cells.',
			'Gemma took back Hero.',
			'Late joined as a spectator.'
		]);
	});
});

describe('walls and doors over the wire', () => {
	it('syncs walls and doors, blocks a player at a closed door, and lets them open it', async () => {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room } = await gm.expect('welcome');
		const pip = await connect();
		pip.send({ type: 'join', roomId: room.id, name: 'Pip', role: 'player' });
		const { playerId } = await pip.expect('welcome');
		await gm.expect('player_joined');

		gm.send({ type: 'object_create', kind: 'wall', a: { x: 5, y: 0 }, b: { x: 5, y: 20 } });
		for (const c of [gm, pip]) expect((await c.expect('objects_changed')).upserted).toHaveLength(1);
		gm.send({ type: 'object_create', kind: 'door', a: { x: 5, y: 4 }, b: { x: 5, y: 5 } });
		const cut = await pip.expect('objects_changed');
		await gm.expect('objects_changed');
		expect(cut.upserted.map((o) => o.kind)).toEqual(['wall', 'wall', 'door']);
		const door = cut.upserted[2];

		gm.send({
			type: 'token_create',
			name: 'Hero',
			color: '#2e86c1',
			pos: { x: 4, y: 4 },
			ownerId: playerId
		});
		const { token } = await pip.expect('token_upserted');
		await gm.expect('token_upserted');

		pip.send({ type: 'token_move', tokenId: token.id, to: { x: 8, y: 4 } });
		expect(await pip.expect('error')).toMatchObject({ code: 'no_path' });
		pip.send({ type: 'object_create', kind: 'wall', a: { x: 0, y: 1 }, b: { x: 2, y: 1 } });
		expect(await pip.expect('error')).toMatchObject({ code: 'forbidden' });

		pip.send({ type: 'door_toggle', objectId: door.id });
		for (const c of [gm, pip]) {
			expect((await c.expect('objects_changed')).upserted).toEqual([{ ...door, open: true }]);
		}
		await gm.untilNotice('Pip opened a door.');

		pip.send({ type: 'token_move', tokenId: token.id, to: { x: 8, y: 4 } });
		expect(await gm.expect('token_moved')).toMatchObject({ pos: { x: 8, y: 4 } });

		const late = await connect();
		late.send({ type: 'join', roomId: room.id, name: 'Late', role: 'spectator' });
		const { room: snap } = await late.expect('welcome');
		expect(snap.objects).toHaveLength(3);
		expect(snap.objects.find((o) => o.id === door.id)).toMatchObject({ open: true });
	});

	it('rejects malformed object payloads', async () => {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		await gm.expect('welcome');
		gm.send({ type: 'object_create', kind: 'portal', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } });
		expect(await gm.expect('error')).toMatchObject({ code: 'invalid_message' });
		gm.send({ type: 'object_create', kind: 'wall', a: { x: 0, y: 0 } });
		expect(await gm.expect('error')).toMatchObject({ code: 'invalid_message' });
	});
});

describe('fog of war over the wire', () => {
	it('never sends a player hidden tokens or notices about them, and reveals them when seen', async () => {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room } = await gm.expect('welcome');
		const pip = await connect();
		const pipFrames: string[] = [];
		pip.ws.on('message', (data) => pipFrames.push(data.toString()));
		pip.send({ type: 'join', roomId: room.id, name: 'Pip', role: 'player' });
		const { playerId } = await pip.expect('welcome');
		await gm.expect('player_joined');

		gm.send({ type: 'fog_set', enabled: true });
		expect((await pip.expect('fog_update')).fog.enabled).toBe(true);
		expect((await gm.expect('fog_update')).fog.enabled).toBe(true);

		gm.send({
			type: 'token_create',
			name: 'Hero',
			color: '#2e86c1',
			pos: { x: 2, y: 2 },
			ownerId: playerId
		});
		expect((await pip.expect('fog_update')).fog.enabled).toBe(true);
		const { token: hero } = await pip.expect('token_upserted');
		await gm.expect('fog_update');
		await gm.expect('token_upserted');

		// A secret NPC far outside Pip's vision.
		gm.send({
			type: 'token_create',
			name: 'Lurking Dragon',
			color: '#8e44ad',
			pos: { x: 17, y: 17 },
			ownerId: null
		});
		const { token: dragon } = await gm.expect('token_upserted');
		await gm.untilNotice('Gemma placed Lurking Dragon.');

		// Pip walks toward it; still out of range.
		pip.send({ type: 'token_move', tokenId: hero.id, to: { x: 6, y: 6 } });
		await pip.expect('fog_update');
		await pip.expect('token_moved');
		expect(pipFrames.join('\n')).not.toContain('Lurking Dragon');
		expect(pipFrames.join('\n')).not.toContain(dragon.id);

		// Within range: the dragon appears for Pip.
		pip.send({ type: 'token_move', tokenId: hero.id, to: { x: 13, y: 13 } });
		await pip.expect('fog_update');
		await pip.expect('token_moved');
		expect((await pip.expect('token_upserted')).token).toMatchObject({
			id: dragon.id,
			name: 'Lurking Dragon'
		});

		// When the GM moves the dragon back out of sight, it vanishes for Pip.
		gm.send({ type: 'token_move', tokenId: dragon.id, to: { x: 19, y: 0 } });
		expect(await pip.expect('token_deleted')).toEqual({
			type: 'token_deleted',
			tokenId: dragon.id
		});
	});

	it('reveals an area the GM uncovers, and hides it again', async () => {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room } = await gm.expect('welcome');
		gm.send({ type: 'fog_set', enabled: true });
		await gm.expect('fog_update');
		gm.send({
			type: 'token_create',
			name: 'Chest',
			color: '#d4ac0d',
			pos: { x: 5, y: 5 },
			ownerId: null
		});
		await gm.expect('token_upserted');

		const sam = await connect();
		sam.send({ type: 'join', roomId: room.id, name: 'Sam', role: 'spectator' });
		expect((await sam.expect('welcome')).room.tokens).toEqual([]);

		gm.send({ type: 'fog_area', from: { x: 4, y: 4 }, to: { x: 6, y: 6 }, reveal: true });
		await sam.expect('fog_update');
		expect((await sam.expect('token_upserted')).token.name).toBe('Chest');

		gm.send({ type: 'fog_area', from: { x: 0, y: 0 }, to: { x: 19, y: 19 }, reveal: false });
		await sam.expect('fog_update');
		expect(await sam.expect('token_deleted')).toMatchObject({ type: 'token_deleted' });

		sam.send({ type: 'fog_area', from: { x: 0, y: 0 }, to: { x: 19, y: 19 }, reveal: true });
		expect(await sam.expect('error')).toMatchObject({ code: 'forbidden' });
	});

	it('shares the party’s sight, reveals whole rooms and keeps hidden tokens out of players’ frames', async () => {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room } = await gm.expect('welcome');
		const pip = await connect();
		const pipFrames: string[] = [];
		pip.ws.on('message', (data) => pipFrames.push(data.toString()));
		pip.send({ type: 'join', roomId: room.id, name: 'Pip', role: 'player' });
		const { playerId: pipId } = await pip.expect('welcome');
		const ivy = await connect();
		ivy.send({ type: 'join', roomId: room.id, name: 'Ivy', role: 'player' });
		const { playerId: ivyId } = await ivy.expect('welcome');
		gm.send({ type: 'fog_set', enabled: true });
		await pip.until('fog_update');

		const place = async (name: string, x: number, y: number, ownerId: string | null) => {
			gm.send({ type: 'token_create', name, color: '#2e86c1', pos: { x, y }, ownerId });
			return (await gm.until('token_upserted', (m) => m.token.name === name)).token;
		};
		await place('Hero', 1, 1, pipId);
		await place('Scout', 18, 18, ivyId);
		// A walled 3×3 room around (9..11, 9..11), and a hidden spy in it.
		for (const [a, b] of [
			[
				{ x: 9, y: 9 },
				{ x: 12, y: 9 }
			],
			[
				{ x: 9, y: 12 },
				{ x: 12, y: 12 }
			],
			[
				{ x: 9, y: 9 },
				{ x: 9, y: 12 }
			],
			[
				{ x: 12, y: 9 },
				{ x: 12, y: 12 }
			]
		]) {
			gm.send({ type: 'object_create', kind: 'wall', a, b });
			await gm.until('objects_changed');
		}
		const spy = await place('Secret Spy', 10, 10, null);
		gm.send({ type: 'token_update', tokenId: spy.id, patch: { hidden: true } });
		await gm.until('token_upserted', (m) => m.token.id === spy.id && m.token.hidden === true);
		const guard = await place('Guard', 11, 11, null);

		// Sharing the party's sight: Pip now has Ivy's Scout.
		gm.send({ type: 'fog_share', shared: true });
		await gm.untilNotice('Gemma let the party share what it sees.');
		await pip.until('token_upserted', (m) => m.token.name === 'Scout');

		// Revealing the room shows the guard, never the hidden spy.
		gm.send({ type: 'fog_room', cell: { x: 10, y: 10 }, reveal: true });
		await pip.until('token_upserted', (m) => m.token.id === guard.id);
		gm.send({ type: 'fog_room', cell: { x: 3, y: 3 }, reveal: true });
		expect(await gm.until('error')).toMatchObject({ code: 'invalid_position' });
		pip.send({ type: 'fog_share', shared: false });
		expect(await pip.until('error')).toMatchObject({ code: 'forbidden' });
		expect(pipFrames.join('\n')).not.toContain('Secret Spy');
		expect(pipFrames.join('\n')).not.toContain(spy.id);

		// Unhidden, it appears.
		gm.send({ type: 'token_update', tokenId: spy.id, patch: { hidden: false } });
		await pip.until('token_upserted', (m) => m.token.id === spy.id);
	});
});

describe('saving and loading scenes over the wire', () => {
	async function gmRoom(target: GameServer) {
		const gm = new TestClient(target.port);
		clients.push(gm);
		await gm.opened();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room } = await gm.expect('welcome');
		return { gm, roomId: room.id };
	}

	it('saves a table, survives a server restart, and rebuilds it in a new room for everyone', async () => {
		const dir = await mkdtemp(path.join(tmpdir(), 'thirdfold-wire-'));
		const first = await startGameServer({
			port: 0,
			host: '127.0.0.1',
			sceneStore: new FileSceneStore(dir)
		});
		try {
			const { gm } = await gmRoom(first);
			gm.send({ type: 'object_create', kind: 'wall', a: { x: 5, y: 0 }, b: { x: 5, y: 10 } });
			await gm.expect('objects_changed');
			gm.send({ type: 'object_create', kind: 'door', a: { x: 5, y: 4 }, b: { x: 5, y: 5 } });
			await gm.expect('objects_changed');
			gm.send({
				type: 'token_create',
				name: 'Orc',
				color: '#c0392b',
				pos: { x: 8, y: 4 },
				ownerId: null
			});
			await gm.expect('token_upserted');

			gm.send({ type: 'scene_save', name: 'Crypt' });
			const saved = await gm.expect('scene_saved');
			expect(saved).toMatchObject({
				name: 'Crypt',
				sceneId: expect.stringMatching(/^[0-9a-f]{32}$/)
			});
			await gm.untilNotice('Gemma saved the scene “Crypt”.');
			gm.ws.terminate();
			await first.close();

			// A brand-new server process: only the files on disk carry over.
			const second = await startGameServer({
				port: 0,
				host: '127.0.0.1',
				sceneStore: new FileSceneStore(dir)
			});
			try {
				const { gm: gm2, roomId } = await gmRoom(second);
				const pip = new TestClient(second.port);
				clients.push(pip);
				await pip.opened();
				pip.send({ type: 'join', roomId, name: 'Pip', role: 'player' });
				await pip.expect('welcome');
				await gm2.expect('player_joined');

				gm2.send({ type: 'scene_load', sceneId: saved.sceneId });
				for (const c of [gm2, pip]) {
					const { room } = await c.expect('room_reset');
					expect(room.objects.map((o) => o.kind).sort()).toEqual(['door', 'wall', 'wall']);
					expect(room.tokens.map((t) => t.name)).toEqual(['Orc']);
					expect(room.players.map((p) => p.name)).toEqual(['Gemma', 'Pip']);
				}
				await pip.untilNotice('Gemma loaded the scene “Crypt”.');

				// The loaded table is live: normal actions keep working on it.
				const orc = second.rooms.get(roomId)!.tokens.values().next().value!;
				gm2.send({ type: 'token_move', tokenId: orc.id, to: { x: 9, y: 4 } });
				expect(await pip.expect('token_moved')).toMatchObject({ pos: { x: 9, y: 4 } });
			} finally {
				await second.close();
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('keeps scene management GM-only', async () => {
		const { gm, roomId } = await gmRoom(server);
		const pip = await connect();
		pip.send({ type: 'join', roomId, name: 'Pip', role: 'player' });
		await pip.expect('welcome');
		await gm.expect('player_joined');
		for (const msg of [
			{ type: 'scene_save', name: 'Mine' },
			{ type: 'scene_export', name: 'Mine' },
			{ type: 'scene_load', sceneId: '0'.repeat(32) }
		]) {
			pip.send(msg);
			expect(await pip.expect('error')).toMatchObject({ code: 'forbidden' });
		}
	});

	it('exports the table to the GM and imports it back, rejecting bad files', async () => {
		const { gm } = await gmRoom(server);
		gm.send({
			type: 'token_create',
			name: 'Orc',
			color: '#c0392b',
			pos: { x: 8, y: 4 },
			ownerId: null
		});
		await gm.expect('token_upserted');
		gm.send({ type: 'scene_export', name: 'Backup' });
		const { file } = await gm.expect('scene_exported');
		expect(file).toMatchObject({ format: 'thirdfold-scene', version: 7, name: 'Backup' });

		gm.send({
			type: 'scene_import',
			file: { ...file, tokens: [{ ...file.tokens[0], pos: { x: 99, y: 0 } }] }
		});
		expect(await gm.expect('error')).toMatchObject({
			code: 'invalid_scene',
			message: expect.stringMatching(/off the table/)
		});
		gm.send({ type: 'scene_load', sceneId: 'f'.repeat(32) });
		expect(await gm.expect('error')).toMatchObject({ code: 'scene_not_found' });

		gm.send({ type: 'token_delete', tokenId: file.tokens[0].id });
		await gm.expect('token_deleted');
		gm.send({ type: 'scene_import', file });
		expect((await gm.expect('room_reset')).room.tokens.map((t) => t.name)).toEqual(['Orc']);
	});

	it('reports storage failures instead of hanging', async () => {
		const broken: SceneStore = {
			save: () => Promise.reject(new Error('disk full')),
			load: () => Promise.reject(new Error('disk gone'))
		};
		const failing = await startGameServer({ port: 0, host: '127.0.0.1', sceneStore: broken });
		const errorLog = console.error;
		console.error = () => {};
		try {
			const { gm } = await gmRoom(failing);
			gm.send({ type: 'scene_save', name: 'Crypt' });
			expect(await gm.expect('error')).toMatchObject({ code: 'persistence_failed' });
			gm.send({ type: 'scene_load', sceneId: 'a'.repeat(32) });
			expect(await gm.expect('error')).toMatchObject({ code: 'persistence_failed' });
		} finally {
			console.error = errorLog;
			await failing.close();
		}
	});
});

describe('lighting over the wire', () => {
	it('syncs the ambient level and reveals a dark area only when the GM lights it', async () => {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room } = await gm.expect('welcome');
		const pip = await connect();
		const pipFrames: string[] = [];
		pip.ws.on('message', (data) => pipFrames.push(data.toString()));
		pip.send({ type: 'join', roomId: room.id, name: 'Pip', role: 'player' });
		const { playerId } = await pip.expect('welcome');
		await gm.expect('player_joined');

		gm.send({ type: 'fog_set', enabled: true });
		await pip.expect('fog_update');
		gm.send({ type: 'ambient_set', ambient: 'dark' });
		expect(await pip.expect('ambient_update')).toEqual({ type: 'ambient_update', ambient: 'dark' });
		await pip.untilNotice('Gemma changed the lighting to darkness.');

		gm.send({
			type: 'token_create',
			name: 'Hero',
			color: '#2e86c1',
			pos: { x: 3, y: 3 },
			ownerId: playerId
		});
		await pip.expect('fog_update');
		await pip.expect('token_upserted');
		gm.send({
			type: 'token_create',
			name: 'Shade',
			color: '#8e44ad',
			pos: { x: 6, y: 3 },
			ownerId: null
		});
		// A far-away fixture Pip has never seen: must not be sent.
		gm.send({ type: 'light_create', pos: { x: 18, y: 18 }, radius: 2, color: '#8f7bff' });
		// Wait until the GM has seen both land, i.e. the server has processed them.
		for (;;) if ((await gm.until('token_upserted')).token.name === 'Shade') break;
		await gm.until('lights_changed');
		expect(pipFrames.join('\n')).not.toContain('Shade');
		expect(pipFrames.join('\n')).not.toContain('#8f7bff');

		gm.send({ type: 'light_create', pos: { x: 5, y: 4 }, radius: 3, color: '#ffa04d' });
		expect((await pip.expect('lights_changed')).upserted[0]).toMatchObject({ pos: { x: 5, y: 4 } });
		await pip.expect('fog_update');
		expect((await pip.expect('token_upserted')).token.name).toBe('Shade');

		pip.send({ type: 'light_create', pos: { x: 1, y: 1 }, radius: 3, color: '#ffa04d' });
		expect(await pip.expect('error')).toMatchObject({ code: 'forbidden' });
		pip.send({ type: 'ambient_set', ambient: 'day' });
		expect(await pip.expect('error')).toMatchObject({ code: 'forbidden' });
	});

	it('hides what stands in a dark area by day, and a flash shows it for a moment', async () => {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room } = await gm.expect('welcome');
		const pip = await connect();
		pip.send({ type: 'join', roomId: room.id, name: 'Pip', role: 'player' });
		const { playerId } = await pip.expect('welcome');
		gm.send({ type: 'fog_set', enabled: true });
		await pip.until('fog_update');
		gm.send({
			type: 'token_create',
			name: 'Hero',
			color: '#2e86c1',
			pos: { x: 3, y: 3 },
			ownerId: playerId
		});
		await pip.until('token_upserted', (m) => m.token.name === 'Hero');
		gm.send({
			type: 'token_create',
			name: 'Shade',
			color: '#8e44ad',
			pos: { x: 6, y: 3 },
			ownerId: null
		});
		const { token: shade } = await pip.until('token_upserted', (m) => m.token.name === 'Shade');

		// A cellar in broad daylight: Pip no longer sees into it, and learns where the dark is.
		gm.send({ type: 'darkness_set', from: { x: 5, y: 0 }, to: { x: 9, y: 9 }, dark: true });
		const dark = await pip.until('darkness_update');
		expect(dark.darkness).not.toBeNull();
		expect(await pip.until('token_deleted')).toEqual({ type: 'token_deleted', tokenId: shade.id });
		pip.send({ type: 'darkness_set', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, dark: true });
		expect(await pip.until('error')).toMatchObject({ code: 'forbidden' });

		// A flash lights everything; when it fades, the next sync hides the Shade again by itself.
		server.rooms.get(room.id)!.flashUntil = Date.now() + 150;
		gm.send({ type: 'darkness_set', from: { x: 5, y: 0 }, to: { x: 5, y: 0 }, dark: true });
		await pip.until('token_upserted', (m) => m.token.id === shade.id);
		expect(await pip.until('token_deleted')).toEqual({ type: 'token_deleted', tokenId: shade.id });

		// Lifted, the cellar is plain to see again.
		gm.send({ type: 'darkness_set', from: { x: 0, y: 0 }, to: { x: 19, y: 19 }, dark: false });
		expect(await pip.until('darkness_update')).toEqual({ type: 'darkness_update', darkness: null });
		await pip.until('token_upserted', (m) => m.token.id === shade.id);
	});
});

describe('elevation over the wire', () => {
	it('lets only the GM shape the ground; everyone gets the heights, and stairs are climbed', async () => {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room } = await gm.expect('welcome');
		expect(room.terrain).toBeNull();
		const pip = await connect();
		pip.send({ type: 'join', roomId: room.id, name: 'Pip', role: 'player' });
		const { playerId } = await pip.expect('welcome');
		await gm.expect('player_joined');
		gm.send({
			type: 'token_create',
			name: 'Pip',
			color: '#2e86c1',
			pos: { x: 2, y: 5 },
			ownerId: playerId
		});
		const { token } = await pip.until('token_upserted');

		const raise = {
			type: 'terrain_set' as const,
			from: { x: 6, y: 0 },
			to: { x: 9, y: 9 },
			level: 3
		};
		pip.send(raise);
		expect(await pip.expect('error')).toMatchObject({ code: 'forbidden' });
		gm.send(raise);
		const { terrain } = await pip.until('terrain_update');
		const levels = decodeLevels(terrain!, room.grid.width * room.grid.height)!;
		expect(levels[5 * room.grid.width + 7]).toBe(3);

		// Three levels is too high a step; a stair of 1, 2 makes it climbable.
		pip.send({ type: 'token_move', tokenId: token.id, to: { x: 7, y: 5 } });
		expect(await pip.expect('error')).toMatchObject({ code: 'no_path' });
		gm.send({ type: 'terrain_set', from: { x: 4, y: 5 }, to: { x: 4, y: 5 }, level: 1 });
		gm.send({ type: 'terrain_set', from: { x: 5, y: 5 }, to: { x: 5, y: 5 }, level: 2 });
		await pip.until('terrain_update');
		await pip.until('terrain_update');
		pip.send({ type: 'token_move', tokenId: token.id, to: { x: 7, y: 5 } });
		expect(await gm.until('token_moved')).toMatchObject({ pos: { x: 7, y: 5 } });

		// Flat again: no map at all.
		gm.send({ type: 'terrain_set', from: { x: 0, y: 0 }, to: { x: 19, y: 19 }, level: 0 });
		expect((await pip.until('terrain_update')).terrain).toBeNull();
	});
});

describe('props over the wire', () => {
	it('syncs prop edits, keeps them GM-only, and blocks movement', async () => {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room } = await gm.expect('welcome');
		const pip = await connect();
		pip.send({ type: 'join', roomId: room.id, name: 'Pip', role: 'player' });
		const { playerId } = await pip.expect('welcome');
		await gm.expect('player_joined');

		gm.send({ type: 'prop_create', assetId: 'table', pos: { x: 4, y: 4 }, rotation: 1 });
		const { upserted } = await pip.until('props_changed');
		expect(upserted[0]).toMatchObject({
			assetId: 'table',
			pos: { x: 4, y: 4 },
			rotation: 1,
			scale: 1
		});
		const table = upserted[0];

		gm.send({ type: 'prop_update', propId: table.id, patch: { rotation: 0, scale: 1.5 } });
		expect((await pip.until('props_changed')).upserted[0]).toMatchObject({
			rotation: 0,
			scale: 1.5
		});

		gm.send({
			type: 'token_create',
			name: 'Hero',
			color: '#2e86c1',
			pos: { x: 4, y: 3 },
			ownerId: playerId
		});
		const { token } = await pip.until('token_upserted');
		pip.send({ type: 'token_move', tokenId: token.id, to: { x: 5, y: 4 } });
		expect(await pip.expect('error')).toMatchObject({ code: 'cell_occupied' });

		pip.send({ type: 'prop_update', propId: table.id, patch: { pos: { x: 0, y: 0 } } });
		expect(await pip.expect('error')).toMatchObject({ code: 'forbidden' });
		pip.send({ type: 'prop_create', assetId: 'dragon', pos: { x: 0, y: 0 }, rotation: 0 });
		expect(await pip.expect('error')).toMatchObject({ code: 'invalid_message' });

		gm.send({ type: 'prop_delete', propId: table.id });
		expect(await pip.until('props_changed')).toMatchObject({ upserted: [], removed: [table.id] });
	});
});

describe('The Hollow Bell over the wire', () => {
	beforeEach(async () => {
		// Every die rolls its highest face, and the enemies act without a pause.
		await server.close();
		server = await startGameServer({
			port: 0,
			host: '127.0.0.1',
			rollDie: (sides) => sides,
			enemyTurnDelayMs: 0,
			mechanismDelayScale: 0,
			patrolMs: 0
		});
	});

	async function table() {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room } = await gm.expect('welcome');
		const pip = await connect();
		pip.send({ type: 'join', roomId: room.id, name: 'Pip', role: 'player' });
		const { playerId: pipId } = await pip.expect('welcome');
		await gm.expect('player_joined');
		return { gm, pip, pipId };
	}

	async function untilAdventure(client: TestClient, pass: (a: AdventureView) => boolean) {
		for (;;) {
			const msg = await client.until('adventure_update');
			if (msg.adventure && pass(msg.adventure)) return msg.adventure;
		}
	}
	/** A character's token as it arrives; villagers it can see may arrive first. */
	async function tokenNamed(client: TestClient, name: string) {
		for (;;) {
			const { token } = await client.until('token_upserted');
			if (token.name === name) return token;
		}
	}
	const untilChapter = (client: TestClient, chapter: string) =>
		untilAdventure(client, (a) => a.chapter.id === chapter);

	it('plays the whole story from the village to an ending, with both sides seeing the same story', async () => {
		// Enemies wait a moment before their turns, so the GM can clear the later fights first.
		await server.close();
		server = await startGameServer({
			port: 0,
			host: '127.0.0.1',
			rollDie: (sides) => sides,
			enemyTurnDelayMs: 150,
			mechanismDelayScale: 0,
			patrolMs: 0
		});
		const { gm, pip, pipId } = await table();

		pip.send({ type: 'adventure_start' });
		expect(await pip.expect('error')).toMatchObject({ code: 'forbidden' });
		gm.send({ type: 'adventure_start' });
		const reset = await pip.until('room_reset');
		expect(reset.room.adventure).toMatchObject({
			title: 'The Hollow Bell',
			stage: 'choosing',
			chapter: { id: 'village', number: 1, of: 9 },
			location: { name: 'Bellweather' },
			ledger: null
		});
		expect(reset.room.adventure?.cues).toBeNull();
		expect((await gm.until('room_reset')).room.adventure?.cues?.length).toBeGreaterThan(0);

		pip.send({ type: 'adventure_claim', characterId: 'warden' });
		const claimed = await gm.until('adventure_update');
		expect(claimed.adventure?.characters.find((c) => c.id === 'warden')).toMatchObject({
			inPlay: true,
			playerId: pipId
		});
		const warden = await tokenNamed(pip, 'The Warden');
		expect(warden).toMatchObject({ name: 'The Warden', ownerId: pipId });

		gm.send({ type: 'adventure_begin' });
		await untilAdventure(pip, (a) => a.stage === 'playing');

		// Into the inn to talk to Maren: open the door, walk in, talk.
		const move = (to: { x: number; y: number }) =>
			pip.send({ type: 'token_move', tokenId: warden.id, to });
		const door = (objectId: string) => pip.send({ type: 'door_toggle', objectId });
		const use = (targetId: string) => pip.send({ type: 'adventure_interact', targetId });
		move({ x: 9, y: 10 });
		door('hb-inn-door');
		move({ x: 7, y: 10 });
		use('maren');
		const told = await untilAdventure(
			gm,
			(a) => !!a.objectives.find((o) => o.id === 'innkeeper')?.done
		);
		expect(told.objectives.find((o) => o.id === 'innkeeper')?.done).toBe(true);

		// The gate is chained until the Hound is dealt with.
		door('hb-gate');
		expect(await pip.until('error')).toMatchObject({ message: 'The gate is chained shut.' });

		// The well: a clue, and the Hound climbs out beside the Warden.
		move({ x: 11, y: 12 });
		use('well');
		const fight = await untilChapter(pip, 'discover_bell');
		expect(fight.clues.map((c) => c.id)).toEqual(['scratches']);
		const [hound] = fight.encounter!.enemies;
		expect(hound).toMatchObject({ name: 'Hollow Hound', hp: 16, maxHp: 16 });
		// Initiative, rolled on the server: the Hound (d20 + 3) goes before the Warden (d20 + 0),
		// and both sides see the same order.
		const order = (a: AdventureView) => a.encounter!.order.map((t) => `${t.name} ${t.initiative}`);
		expect(order(fight)).toEqual(['Hollow Hound 23', 'The Warden 20']);
		const wardenUp = (a: AdventureView) =>
			a.encounter?.order[a.encounter.current]?.characterId === 'warden';
		expect(order(await untilAdventure(gm, wardenUp))).toEqual(order(fight));
		await untilAdventure(pip, wardenUp);

		// The Hound bit for 8; 1d20+5 hits it for 1d8+3 = 11. The Warden ends its turn, the
		// Hound bites again, and the Warden's second blow kills it.
		pip.send({ type: 'adventure_act', actionId: 'blade', targetId: hound.tokenId });
		pip.send({ type: 'adventure_end_turn' });
		for (;;) {
			const { message } = await gm.expect('chat');
			if (message.kind === 'system' && message.text === 'Round 2.') break;
		}
		await untilAdventure(pip, (a) => wardenUp(a) && a.encounter!.round === 2);
		pip.send({ type: 'adventure_act', actionId: 'blade', targetId: hound.tokenId });
		const after = await untilAdventure(gm, (a) => !a.encounter);
		expect(after.characters.find((c) => c.id === 'warden')?.hp).toBe(14);
		expect(after.ledger?.encounters).toEqual([{ id: 'well', state: 'won' }]);

		// Up through the open gate to the mountain path, and on to a new table.
		move({ x: 11, y: 1 });
		const arrived = (await pip.until('room_reset')).room;
		expect(arrived).toMatchObject({ sceneName: 'The Monastery' });
		expect(arrived.adventure).toMatchObject({
			chapter: { id: 'investigate_monastery', number: 3 },
			location: { id: 'monastery' }
		});
		expect(arrived.tokens.find((t) => t.id === warden.id)).toMatchObject({ ownerId: pipId });
		await gm.until('room_reset');

		// Brother Oswin, in the gatehouse, asks what the party is here for.
		move({ x: 6, y: 15 });
		door('mn-gatehouse-door');
		move({ x: 4, y: 15 });
		use('oswin');
		const asked = await untilAdventure(pip, (a) => a.decision !== null);
		expect(asked.decision).toMatchObject({ id: 'promise' });
		expect((await untilAdventure(gm, (a) => a.decision !== null)).decision?.id).toBe('promise');
		pip.send({ type: 'adventure_decide', decisionId: 'promise', optionId: 'boy' });
		const promised = await untilAdventure(gm, (a) => a.decisions.length === 1);
		expect(promised.decisions[0]).toMatchObject({ choice: 'Bring Tobin home', by: 'The Warden' });
		expect(promised.ledger?.npcs).toContainEqual(
			expect.objectContaining({ id: 'oswin', name: 'Brother Oswin', state: 'trusting' })
		);

		// Round to the ringers' door, now unlocked, and into the nave.
		move({ x: 22, y: 6 });
		door('mn-side-door');
		move({ x: 21, y: 6 });
		await untilChapter(gm, 'enter_monastery');
		// The bell tolls as the party comes in: the cue reaches the player who walked in,
		// with the log in order (clients drop an entry older than one they already have).
		const seqs: number[] = [];
		for (;;) {
			const { message } = await pip.expect('chat');
			seqs.push(message.seq);
			if (message.kind === 'narration' && message.cue === 'toll') break;
		}
		expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

		// Saint Agna shows the hidden door; through it, the bell rings.
		move({ x: 9, y: 4 });
		use('agna');
		await untilChapter(pip, 'discover_hidden_chamber');
		move({ x: 8, y: 5 });
		door('mn-secret-door');
		move({ x: 7, y: 5 });
		const rung = await untilChapter(gm, 'bell_rings');
		expect(rung.encounter?.enemies.map((e) => e.name)).toEqual([
			'Hollow Hound',
			'Hollow Hound',
			'Bell Cultist'
		]);
		for (const e of rung.encounter!.enemies) {
			gm.send({ type: 'token_delete', tokenId: e.tokenId });
		}
		await untilChapter(pip, 'descend');

		// The grate slams shut as the last hound falls .
		const motionsOf = async (client: TestClient, count: number) => {
			const seen: string[] = [];
			while (seen.length < count) {
				const { motions } = await client.until('motion');
				seen.push(...motions.map((m) => `${m.propId}:${m.kind}:${m.sound}`));
			}
			return seen;
		};
		expect(await motionsOf(pip, 1)).toEqual(['mn-grate:shake:clank']);
		expect(await motionsOf(gm, 1)).toEqual(['mn-grate:shake:clank']);

		// The lever by the door lifts it, step by step on the server, and both sides
		// see the same chain: the lever, the chain, the grate.
		move({ x: 6, y: 7 });
		use('lever');
		const chain = [
			'mn-lever:swing:clank',
			'mn-chamber-chains:shake:rattle',
			'mn-grate:shake:grind'
		];
		expect(await motionsOf(pip, 3)).toEqual(chain);
		expect(await motionsOf(gm, 3)).toEqual(chain);

		// Down the stair to the Hollow.
		move({ x: 3, y: 8 });
		const hollow = (await pip.until('room_reset')).room;
		expect(hollow.adventure).toMatchObject({ chapter: { id: 'the_hollow' } });
		// The Bell Keeper stands watch and its cultists walk their rounds: the GM clears them away.
		const below = (await gm.until('room_reset')).room;
		expect(below.adventure!.encounter).toBeNull();
		const watch = below.tokens.filter((t) => t.name.startsWith('Bell '));
		expect(watch.map((t) => t.name).sort()).toEqual([
			'Bell Cultist',
			'Bell Cultist',
			'Bell Keeper'
		]);
		for (const t of watch) gm.send({ type: 'token_delete', tokenId: t.id });
		await untilAdventure(pip, (a) => !!a.objectives.find((o) => o.id === 'keeper')?.done);

		// Tobin, and the final choice (after a breath: talking shares the chat rate limit).
		await new Promise((resolve) => setTimeout(resolve, 800));
		move({ x: 9, y: 5 });
		use('tobin');
		await untilAdventure(pip, (a) => a.decision?.id === 'bell');
		pip.send({ type: 'adventure_decide', decisionId: 'bell', optionId: 'leave' });
		const done = await untilAdventure(gm, (a) => a.stage === 'complete');
		expect(done.ending).toMatchObject({ id: 'silent', title: 'The Long Silence' });
		expect(done.objectives.every((o) => o.done)).toBe(true);
		expect(done.ledger?.events).toHaveLength(15);
		expect((await untilAdventure(pip, (a) => a.stage === 'complete')).completedAt).toBeGreaterThan(
			0
		);
	});

	it('walks the Hollow’s sentries on the server, and starts the fight when one spots a character', async () => {
		// A table in the Hollow, dark, with Pip's Warden at the foot of the stair and the watch posted.
		const staged = new RoomManager();
		const made = staged.create('Gemma');
		if (!made.ok) throw new Error(made.message);
		const joined = staged.join(made.room.id, 'Pip', 'player');
		if (!joined.ok) throw new Error(joined.message);
		startAdventure(made.room, made.player);
		claimCharacter(made.room, joined.player, 'warden');
		beginAdventure(made.room, made.player);
		const story = made.room.adventure!;
		const warden = [...made.room.tokens.values()].find((t) => t.name === 'The Warden')!;
		applyScene(made.room, hollowScene());
		warden.pos = { ...HOLLOW_SPAWN[0] };
		made.room.tokens.set(warden.id, warden);
		story.location = 'hollow';
		story.chapter = 'the_hollow';
		story.origins = recordOrigins(made.room);
		postSentries(made.room, story, 'hollow');
		const file = exportScene(made.room, 'The Hollow');

		await server.close();
		server = await startGameServer({
			port: 0,
			host: '127.0.0.1',
			rollDie: (sides) => sides,
			enemyTurnDelayMs: 0,
			patrolMs: 20
		});
		const { gm, pip } = await table();
		gm.send({ type: 'scene_import', file });
		const { room } = await gm.until('room_reset');
		await pip.until('room_reset');
		expect(room.ambient).toBe('dark');
		expect(room.adventure!.encounter).toBeNull();
		const cultist = room.tokens.find((t) => t.name === 'Bell Cultist')!;

		// Nobody acts, and the cultists walk their rounds on the server.
		for (;;) {
			const moved = await gm.until('token_moved');
			if (moved.tokenId === cultist.id) {
				expect(moved.pos).not.toEqual(cultist.pos);
				break;
			}
		}

		// Up to the boy: the Keeper beside him sees the Warden, and the fight begins for both.
		const me = room.tokens.find((t) => t.name === 'The Warden')!;
		pip.send({ type: 'token_move', tokenId: me.id, to: { x: 9, y: 5 } });
		const spotted = await untilAdventure(gm, (a) => a.encounter !== null);
		expect(spotted.encounter!.order.map((t) => t.name).sort()).toEqual([
			'Bell Cultist',
			'Bell Cultist',
			'Bell Keeper',
			'The Warden'
		]);
		expect((await untilAdventure(pip, (a) => a.encounter !== null)).encounter!.order).toEqual(
			spotted.encounter!.order.map((t) => ({ ...t, tokenId: expect.anything() }))
		);
		for (;;) {
			const { message } = await pip.expect('chat');
			if (message.kind === 'narration' && message.text.startsWith('The Bell Keeper spots')) break;
		}
	});

	it('saves the story with the table and picks it up again on load', async () => {
		const { gm, pip } = await table();
		gm.send({ type: 'adventure_start' });
		await pip.until('room_reset');
		pip.send({ type: 'adventure_claim', characterId: 'veil' });
		const veil = await tokenNamed(pip, 'The Veil');
		gm.send({ type: 'adventure_begin' });
		pip.send({ type: 'token_move', tokenId: veil.id, to: { x: 9, y: 10 } });
		pip.send({ type: 'door_toggle', objectId: 'hb-inn-door' });
		pip.send({ type: 'token_move', tokenId: veil.id, to: { x: 7, y: 10 } });
		pip.send({ type: 'adventure_interact', targetId: 'maren' });
		await untilAdventure(gm, (a) => !!a.objectives.find((o) => o.id === 'innkeeper')?.done);

		gm.send({ type: 'scene_export', name: 'Mid-story' });
		const { file } = await gm.until('scene_exported');
		expect(file.adventure).toMatchObject({
			id: 'hollow-bell',
			state: { chapter: 'village', events: ['talked_maren'] }
		});
		gm.send({ type: 'scene_save', name: 'Mid-story' });
		const { sceneId } = await gm.until('scene_saved');

		// The story moves on, then the GM loads the save: back to where it was.
		gm.send({ type: 'adventure_control', op: 'restart' });
		await pip.until('room_reset');
		gm.send({ type: 'scene_load', sceneId });
		const loaded = (await pip.until('room_reset')).room;
		expect(loaded.adventure).toMatchObject({ stage: 'playing', chapter: { id: 'village' } });
		expect(loaded.adventure?.objectives.map((o) => o.done)).toEqual([true, false, false]);
		expect(loaded.adventure?.characters.find((c) => c.id === 'veil')?.inPlay).toBe(true);
		for (;;) {
			const { message } = await pip.expect('chat');
			if (message.kind === 'system' && message.text.startsWith('The Hollow Bell continues')) break;
		}

		// A tampered story is refused and the table stays as it was.
		const bad = structuredClone(file);
		(bad.adventure!.state as Record<string, unknown>).chapter = 'epilogue';
		gm.send({ type: 'scene_import', file: bad });
		expect(await gm.until('error')).toMatchObject({ code: 'invalid_scene' });
	});

	it('lets the party question villagers, with every clue reaching both sides', async () => {
		const { gm, pip } = await table();
		gm.send({ type: 'adventure_start' });
		await pip.until('room_reset');
		pip.send({ type: 'adventure_claim', characterId: 'veil' });
		const veil = await tokenNamed(pip, 'The Veil');
		gm.send({ type: 'adventure_begin' });
		await untilAdventure(pip, (a) => a.stage === 'playing');

		// Widow Crane is in her cottage by the south road: open her door and ask.
		pip.send({ type: 'token_move', tokenId: veil.id, to: { x: 8, y: 21 } });
		pip.send({ type: 'door_toggle', objectId: 'hb-crane-door' });
		pip.send({ type: 'token_move', tokenId: veil.id, to: { x: 7, y: 21 } });
		pip.send({ type: 'adventure_interact', targetId: 'crane' });
		for (;;) {
			const { message } = await gm.expect('chat');
			if (message.kind === 'narration' && message.speaker === 'Widow Crane') break;
		}
		const seen = await untilAdventure(pip, (a) => a.clues.length === 1);
		expect(seen.clues[0]).toMatchObject({ id: 'lights', title: 'Lights on the mountain' });
		const gms = await untilAdventure(gm, (a) => a.clues.length === 1);
		expect(gms.ledger?.npcs).toContainEqual(
			expect.objectContaining({ id: 'crane', state: 'frightened' })
		);
		// Players are never sent the GM's list of who's who.
		expect(seen.ledger).toBeNull();
	});

	it('keeps evidence to the character who found it until they share it', async () => {
		const { gm, pip } = await table();
		const bo = await connect();
		gm.send({ type: 'adventure_start' });
		const { room: snapshot } = await pip.until('room_reset');
		bo.send({ type: 'join', roomId: snapshot.id, name: 'Bo', role: 'player' });
		await bo.expect('welcome');
		const boFrames: string[] = [];
		bo.ws.on('message', (data) => boFrames.push(data.toString()));
		pip.send({ type: 'adventure_claim', characterId: 'veil' });
		const veil = await tokenNamed(pip, 'The Veil');
		bo.send({ type: 'adventure_claim', characterId: 'warden' });
		await tokenNamed(bo, 'The Warden');
		gm.send({ type: 'adventure_begin' });
		await untilAdventure(pip, (a) => a.stage === 'playing');

		// The Veil looks around by the north gate: small footprints (every die rolls high).
		pip.send({ type: 'token_move', tokenId: veil.id, to: { x: 11, y: 7 } });
		pip.send({ type: 'adventure_sense', sense: 'observe' });
		const mine = await untilAdventure(pip, (a) => a.clues.length === 1);
		expect(mine.clues[0]).toMatchObject({ id: 'footprints', mine: true, shared: false });
		const gms = await untilAdventure(gm, (a) => a.clues.length === 1);
		expect(gms.clues[0]).toMatchObject({ foundBy: ['The Veil'], shared: false });
		for (;;) {
			const { message } = await bo.expect('chat');
			if (message.kind === 'system' && message.text.startsWith('The Veil found something')) break;
		}
		expect(boFrames.some((f) => f.includes('boot prints'))).toBe(false);

		// Bo can't share what the Veil found; Pip can, and then everyone knows.
		bo.send({ type: 'adventure_share', clueId: 'footprints' });
		expect(await bo.until('error')).toMatchObject({ code: 'forbidden' });
		pip.send({ type: 'adventure_share', clueId: 'footprints' });
		const shared = await untilAdventure(bo, (a) => a.clues.length === 1);
		expect(shared.clues[0]).toMatchObject({ id: 'footprints', shared: true, mine: false });
		expect(shared.objectives.find((o) => o.id === 'tobin')?.done).toBe(true);
		expect(boFrames.some((f) => f.includes('boot prints'))).toBe(true);
	});

	it('shows a motion to those who can see the prop, and only the sound to the rest', async () => {
		const { gm, pip } = await table();
		const bo = await connect();
		gm.send({ type: 'adventure_start' });
		const { room: snapshot } = await pip.until('room_reset');
		bo.send({ type: 'join', roomId: snapshot.id, name: 'Bo', role: 'player' });
		await bo.expect('welcome');
		const boFrames: string[] = [];
		bo.ws.on('message', (data) => boFrames.push(data.toString()));
		pip.send({ type: 'adventure_claim', characterId: 'warden' });
		const warden = await tokenNamed(pip, 'The Warden');
		bo.send({ type: 'adventure_claim', characterId: 'veil' });
		await tokenNamed(bo, 'The Veil');
		gm.send({ type: 'adventure_begin' });
		await untilAdventure(pip, (a) => a.stage === 'playing');

		// The Warden smashes the old crate in the square; the Veil, back on the road, only hears it.
		pip.send({ type: 'token_move', tokenId: warden.id, to: { x: 10, y: 12 } });
		pip.send({ type: 'adventure_interact', targetId: 'crate', verb: 'break' });
		const smashed = { propId: 'hb-crate1', kind: 'shake', sound: 'crack' };
		expect((await pip.until('motion')).motions).toEqual([smashed]);
		expect((await gm.until('motion')).motions).toEqual([smashed]);
		expect((await bo.until('motion')).motions).toEqual([
			{ propId: null, kind: null, sound: 'crack' }
		]);
		expect(boFrames.some((f) => f.includes('hb-crate1'))).toBe(false);
	});

	it('lets only the GM adjust a character, and everyone sees the change', async () => {
		const { gm, pip } = await table();
		gm.send({ type: 'adventure_start' });
		await pip.until('room_reset');
		pip.send({ type: 'adventure_claim', characterId: 'saint' });
		await gm.until('adventure_update');

		const patch = { hp: 7, statuses: ['guarded'] };
		pip.send({ type: 'adventure_override', characterId: 'saint', patch });
		expect(await pip.until('error')).toMatchObject({ code: 'forbidden' });
		gm.send({ type: 'adventure_override', characterId: 'saint', patch });
		for (;;) {
			const { adventure } = await pip.until('adventure_update');
			const saint = adventure?.characters.find((c) => c.id === 'saint');
			if (saint?.hp !== 7) continue;
			expect(saint.statuses).toEqual([{ id: 'guarded', rounds: 1 }]);
			break;
		}
	});

	it('never sends players a hidden object until it is revealed, fog or no fog', async () => {
		const { gm, pip } = await table();
		const frames: string[] = [];
		pip.ws.on('message', (data) => frames.push(data.toString()));
		gm.send({ type: 'adventure_start' });
		const { room } = await pip.until('room_reset');
		expect(room.props.some((p) => p.id === 'hb-hatch')).toBe(false);
		expect((await gm.until('room_reset')).room.props.some((p) => p.id === 'hb-hatch')).toBe(true);

		gm.send({ type: 'fog_set', enabled: false });
		await pip.until('fog_update');
		expect(frames.some((f) => f.includes('hb-hatch'))).toBe(false);

		pip.send({ type: 'adventure_object', objectId: 'hatch', state: 'closed' });
		expect(await pip.until('error')).toMatchObject({ code: 'forbidden' });
		gm.send({ type: 'adventure_object', objectId: 'hatch', state: 'closed' });
		const revealed = await pip.until('props_changed');
		expect(revealed.upserted.map((p) => p.id)).toContain('hb-hatch');
	});

	it('keeps each character to one player and rejects actions that make no sense yet', async () => {
		const { gm, pip } = await table();
		const bo = await connect();
		gm.send({ type: 'adventure_start' });
		const { room: snapshot } = await pip.until('room_reset');
		bo.send({ type: 'join', roomId: snapshot.id, name: 'Bo', role: 'player' });
		await bo.expect('welcome');

		pip.send({ type: 'adventure_claim', characterId: 'veil' });
		await pip.until('token_upserted');
		bo.send({ type: 'adventure_claim', characterId: 'veil' });
		expect(await bo.until('error')).toMatchObject({ code: 'character_taken' });
		pip.send({ type: 'adventure_act', actionId: 'daggers', targetId: 'nobody' });
		expect(await pip.until('error')).toMatchObject({ code: 'forbidden' });
		pip.send({ type: 'adventure_claim', characterId: 'wizard' });
		expect(await pip.until('error')).toMatchObject({ code: 'invalid_message' });
	});
});
