import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { AdventureView } from '../src/lib/adventure/adventure';
import { exampleAdventure } from '../src/lib/adventure/example';
import { decodeFloor, FLOOR_IDS } from '../src/lib/game/floor';
import { decodeLevels } from '../src/lib/game/terrain';
import type { ServerMessage } from '../src/lib/game/protocol';
import { CLOSE_SESSION_REPLACED, startGameServer, type GameServer } from './game-server';
import { FileSceneStore, MemorySceneStore, type SceneStore } from './scene-store';
import { beginAdventure, claimCharacter, postSentries, startAdventure } from './adventure/engine';
import { BESIDE_PIT, BY_TOBIN, HOLLOW_SPAWN, hollowScene } from './adventures/hollow-bell/hollow';
import { HOLLOW_BELL } from './adventures/hollow-bell/index';
import { recordOrigins } from './adventure/world';
import { RoomManager } from './rooms';
import { MemoryRoomStore } from './room-store';
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

	it('keeps a secret roll between the roller and the GM', async () => {
		const { gm, pip, pipId } = await pair();
		await gm.expect('chat'); // join notice
		gm.send({ type: 'dice_roll', expression: '1d20', secret: true });
		expect((await gm.expect('chat')).message).toMatchObject({ kind: 'roll', audience: 'gm' });
		pip.send({ type: 'dice_roll', expression: '1d6', secret: true });
		// Pip's next log entry is its own secret roll: the GM's never reached it.
		expect((await pip.expect('chat')).message).toMatchObject({
			kind: 'roll',
			authorId: pipId,
			audience: { players: [pipId] }
		});
		expect((await gm.expect('chat')).message).toMatchObject({ kind: 'roll', authorId: pipId });
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
	async function gmRoom(target: GameServer, gmKey?: string) {
		const gm = new TestClient(target.port);
		clients.push(gm);
		await gm.opened();
		gm.send({ type: 'create', name: 'Gemma', ...(gmKey ? { gmKey } : {}) });
		const welcome = await gm.expect('welcome');
		return { gm, roomId: welcome.room.id, gmKey: welcome.gmKey! };
	}

	it('saves a table, survives a server restart, and rebuilds it in a new room for everyone', async () => {
		const dir = await mkdtemp(path.join(tmpdir(), 'thirdfold-wire-'));
		const first = await startGameServer({
			port: 0,
			host: '127.0.0.1',
			sceneStore: new FileSceneStore(dir)
		});
		try {
			const { gm, gmKey } = await gmRoom(first);
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
				// The same GM (by their key, on any device) opens a new table on their save.
				const { gm: gm2, roomId } = await gmRoom(second, gmKey);
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
		expect(file).toMatchObject({ format: 'thirdfold-scene', version: 9, name: 'Backup' });

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
			load: () => Promise.reject(new Error('disk gone')),
			ownerOf: () => Promise.reject(new Error('disk gone')),
			list: () => Promise.reject(new Error('disk gone')),
			remove: () => Promise.reject(new Error('disk gone'))
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

	it('lets the GM set how the table looks and what a token is drawn as, by asset id only', async () => {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room } = await gm.expect('welcome');
		expect(room.environment).toBeNull();
		const pip = await connect();
		pip.send({ type: 'join', roomId: room.id, name: 'Pip', role: 'player' });
		await pip.expect('welcome');
		await gm.expect('player_joined');

		gm.send({ type: 'environment_set', environment: 'village' });
		expect(await pip.expect('environment_update')).toEqual({
			type: 'environment_update',
			environment: 'village'
		});
		pip.send({ type: 'environment_set', environment: 'cavern' });
		expect(await pip.expect('error')).toMatchObject({ code: 'forbidden' });

		gm.send({
			type: 'token_create',
			name: 'Hero',
			color: '#2e86c1',
			pos: { x: 3, y: 3 },
			ownerId: null
		});
		const { token } = await pip.until('token_upserted');
		gm.send({ type: 'token_update', tokenId: token.id, patch: { model: 'warden' } });
		expect((await pip.until('token_upserted')).token).toMatchObject({
			id: token.id,
			model: 'warden'
		});

		// Both come back with the table.
		gm.send({ type: 'scene_export', name: 'Dressed' });
		const { file } = await gm.until('scene_exported');
		expect(file).toMatchObject({ version: 9, environment: 'village' });
		expect(file.tokens[0]).toMatchObject({ model: 'warden' });
		gm.send({ type: 'token_update', tokenId: token.id, patch: { model: null } });
		expect((await pip.until('token_upserted')).token.model).toBeUndefined();
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

describe('custom tables over the wire', () => {
	async function tableWithPip() {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const welcome = await gm.expect('welcome');
		const pip = await connect();
		pip.send({ type: 'join', roomId: welcome.room.id, name: 'Pip', role: 'player' });
		const { playerId } = await pip.expect('welcome');
		await gm.expect('player_joined');
		return { gm, pip, playerId, welcome };
	}

	it('lets only the GM paint floors; everyone gets them, and off the map nobody walks', async () => {
		const { gm, pip, playerId, welcome } = await tableWithPip();
		expect(welcome.room.floor).toBeNull();
		gm.send({
			type: 'token_create',
			name: 'Pip',
			color: '#2e86c1',
			pos: { x: 2, y: 5 },
			ownerId: playerId
		});
		const { token } = await pip.until('token_upserted');
		const size = welcome.room.grid.width * welcome.room.grid.height;
		const at = (x: number, y: number) => y * welcome.room.grid.width + x;

		const stone = {
			type: 'floor_set' as const,
			from: { x: 0, y: 0 },
			to: { x: 3, y: 3 },
			floor: 'stone' as const
		};
		pip.send(stone);
		expect(await pip.until('error')).toMatchObject({ code: 'forbidden' });
		gm.send(stone);
		const painted = decodeFloor((await pip.until('floor_update')).floor!, size)!;
		expect(painted[at(1, 1)]).toBe(FLOOR_IDS.indexOf('stone'));
		expect(painted[at(5, 5)]).toBe(0);

		// A wall of cells off the map: not under a token, and nobody walks across it.
		gm.send({ type: 'floor_set', from: { x: 2, y: 0 }, to: { x: 2, y: 19 }, floor: 'void' });
		expect(await gm.until('error')).toMatchObject({ code: 'cell_occupied' });
		gm.send({ type: 'floor_set', from: { x: 4, y: 0 }, to: { x: 4, y: 19 }, floor: 'void' });
		await pip.until('floor_update');
		pip.send({ type: 'token_move', tokenId: token.id, to: { x: 6, y: 5 } });
		expect(await pip.until('error')).toMatchObject({ code: 'no_path' });

		// All plain again: no map at all.
		gm.send({ type: 'floor_set', from: { x: 0, y: 0 }, to: { x: 19, y: 19 }, floor: 'plain' });
		expect((await pip.until('floor_update')).floor).toBeNull();
		pip.send({ type: 'token_move', tokenId: token.id, to: { x: 6, y: 5 } });
		expect(await gm.until('token_moved')).toMatchObject({ pos: { x: 6, y: 5 } });
	});

	it('shows players only the floors they have explored under fog', async () => {
		const { gm, pip, playerId, welcome } = await tableWithPip();
		gm.send({ type: 'fog_set', enabled: true });
		gm.send({
			type: 'token_create',
			name: 'Pip',
			color: '#2e86c1',
			pos: { x: 1, y: 1 },
			ownerId: playerId
		});
		await pip.until('token_upserted');
		gm.send({ type: 'floor_set', from: { x: 0, y: 0 }, to: { x: 19, y: 19 }, floor: 'wood' });
		const size = welcome.room.grid.width * welcome.room.grid.height;
		const seen = decodeFloor((await pip.until('floor_update')).floor!, size)!;
		const wood = FLOOR_IDS.indexOf('wood');
		expect(seen[1 * welcome.room.grid.width + 1]).toBe(wood);
		expect(seen[19 * welcome.room.grid.width + 19]).toBe(0);
	});

	it('starts a new, empty table of the size the GM chose', async () => {
		const { gm, pip } = await tableWithPip();
		const table = {
			type: 'scene_new' as const,
			name: 'The crossroads',
			width: 12,
			height: 8,
			environment: 'village'
		};
		pip.send(table);
		expect(await pip.until('error')).toMatchObject({ code: 'forbidden' });
		gm.send({
			type: 'token_create',
			name: 'Old',
			color: '#2e86c1',
			pos: { x: 1, y: 1 },
			ownerId: null
		});
		await pip.until('token_upserted');
		gm.send(table);
		const { room } = await pip.until('room_reset');
		expect(room).toMatchObject({
			sceneName: 'The crossroads',
			grid: { width: 12, height: 8 },
			environment: 'village',
			tokens: [],
			floor: null
		});
		await gm.untilNotice('Gemma created the scene “The crossroads”.');
	});

	it('shares a table as a code another GM opens: the world, not the story or the players', async () => {
		const store = new MemorySceneStore();
		await server.close();
		server = await startGameServer({ port: 0, host: '127.0.0.1', patrolMs: 0, sceneStore: store });
		const { gm, pip, playerId } = await tableWithPip();
		gm.send({ type: 'scene_new', name: 'Mill', width: 10, height: 10, environment: null });
		await gm.until('room_reset');
		gm.send({ type: 'floor_set', from: { x: 0, y: 0 }, to: { x: 9, y: 0 }, floor: 'water' });
		gm.send({
			type: 'token_create',
			name: 'Pip',
			color: '#2e86c1',
			pos: { x: 5, y: 5 },
			ownerId: playerId
		});
		await pip.until('token_upserted');
		gm.send({ type: 'scene_share', name: 'The mill' });
		const { code, name } = await gm.until('scene_shared');
		expect(code).toMatch(/^[0-9a-f]{32}$/);
		expect(name).toBe('The mill');
		expect(await store.ownerOf(code)).toBeNull();

		// Another GM, with their own key, opens it straight from the link.
		const other = await connect();
		other.send({ type: 'create', name: 'Otto', continueFrom: code });
		const { room } = await other.expect('welcome');
		expect(room).toMatchObject({ sceneName: 'The mill', grid: { width: 10, height: 10 } });
		expect(decodeFloor(room.floor!, 100)![3]).toBe(FLOOR_IDS.indexOf('water'));
		expect(room.tokens).toEqual([expect.objectContaining({ name: 'Pip', ownerId: null })]);
		expect(room.adventure).toBeNull();

		// Nobody's own saves list it, and a GM can't delete what isn't theirs.
		other.send({ type: 'scene_delete', sceneId: code });
		expect(await other.until('error')).toMatchObject({ code: 'scene_not_found' });
		expect(await store.ownerOf(code)).toBeNull();
	});

	it('keeps the floors through a save and load', async () => {
		const { gm } = await tableWithPip();
		gm.send({ type: 'floor_set', from: { x: 2, y: 2 }, to: { x: 4, y: 4 }, floor: 'grass' });
		await gm.until('floor_update');
		gm.send({ type: 'scene_save', name: 'Meadow' });
		const { sceneId } = await gm.until('scene_saved');
		gm.send({ type: 'floor_set', from: { x: 0, y: 0 }, to: { x: 19, y: 19 }, floor: 'plain' });
		expect((await gm.until('floor_update')).floor).toBeNull();
		gm.send({ type: 'scene_load', sceneId });
		const { room } = await gm.until('room_reset');
		expect(decodeFloor(room.floor!, 400)![3 * 20 + 3]).toBe(FLOOR_IDS.indexOf('grass'));
	});
});

describe("creators' adventures over the wire", () => {
	it('lets the GM start an adventure file; players play it as any other', async () => {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room } = await gm.expect('welcome');
		const pip = await connect();
		pip.send({ type: 'join', roomId: room.id, name: 'Pip', role: 'player' });
		await pip.expect('welcome');
		const file = JSON.parse(JSON.stringify(exampleAdventure()));

		pip.send({ type: 'adventure_start', file });
		expect(await pip.until('error')).toMatchObject({ code: 'forbidden' });
		gm.send({ type: 'adventure_start', file: { ...file, start: { ...file.start, chapter: 'x' } } });
		expect(await gm.until('error')).toMatchObject({
			code: 'invalid_message',
			message: expect.stringContaining('no chapter "x"')
		});

		gm.send({ type: 'adventure_start', file });
		const reset = await pip.until('room_reset');
		expect(reset.room).toMatchObject({ sceneName: 'The mill yard', grid: { width: 14 } });
		expect(reset.room.adventure).toMatchObject({
			id: expect.stringMatching(/^custom-/),
			title: 'The Miller’s Key',
			stage: 'choosing',
			chapter: { id: 'the_mill', number: 1, of: 3 }
		});
		pip.send({ type: 'adventure_claim', characterId: 'saint' });
		const saint = await pip.until('token_upserted', (m) => m.token.name === 'The Saint');
		gm.send({ type: 'adventure_begin' });
		await pip.until('adventure_update', (m) => m.adventure?.stage === 'playing');
		pip.send({ type: 'token_move', tokenId: saint.token.id, to: { x: 6, y: 9 } });
		await pip.until('token_moved');
		pip.send({ type: 'adventure_interact', targetId: 'miller', verb: null });
		const told = await pip.until('adventure_update', (m) => m.adventure?.chapter.id === 'the_key');
		expect(told.adventure!.objectives.map((o) => [o.id, o.done])).toEqual([
			['ask', true],
			['find', false]
		]);
	});

	it('lists the adventures on this server, and starts one by id', async () => {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room } = await gm.expect('welcome');
		expect(room.adventures.map((a) => a.id)).toEqual(['hollow-bell', 'blackwater']);
		expect(room.adventures[1]).toMatchObject({
			title: 'The Last Train to Blackwater',
			about: expect.stringContaining('1889')
		});

		gm.send({ type: 'adventure_start', adventureId: 'custom-0123' });
		expect(await gm.until('error')).toMatchObject({
			message: 'There is no such adventure on this server.'
		});
		gm.send({ type: 'adventure_start', adventureId: 'blackwater' });
		const reset = await gm.until('room_reset');
		expect(reset.room).toMatchObject({ sceneName: 'The last train', environment: 'railcar' });
		expect(reset.room.adventure).toMatchObject({
			id: 'blackwater',
			title: 'The Last Train to Blackwater',
			chapter: { id: 'all_aboard', number: 1, of: 7 }
		});
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
			chapter: { id: 'village', number: 1, of: 13 },
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

		// Tobin (after a breath: talking shares the chat rate limit), and the finale's four phases.
		await new Promise((resolve) => setTimeout(resolve, 800));
		move(BY_TOBIN);
		use('tobin');
		await untilAdventure(pip, (a) => a.chapter.id === 'the_pit');
		// Phase 1: look into the pit. Phase 2: the Hollow wakes, and its tendrils come up.
		move(BESIDE_PIT);
		use('pit');
		const waking = await untilAdventure(gm, (a) => a.chapter.id === 'the_waking' && !!a.encounter);
		expect(waking.encounter!.enemies.map((e) => e.name)).toEqual([
			'Hollow Tendril',
			'Hollow Tendril',
			'Hollow Tendril'
		]);
		// The GM clears them away, and brings the Warden to the rope: phase 3, the Bell rings itself.
		for (const e of waking.encounter!.enemies)
			gm.send({ type: 'token_delete', tokenId: e.tokenId });
		await untilAdventure(pip, (a) => a.chapter.id === 'the_ringing');
		gm.send({ type: 'token_move', tokenId: warden.id, to: BY_TOBIN });
		// Three pulls on the rope, one a turn, hold it (after a breath: they share the rate limit too).
		await new Promise((resolve) => setTimeout(resolve, 2000));
		for (let pulls = 1; pulls <= 3; pulls++) {
			pip.send({ type: 'adventure_interact', targetId: 'bell-rope', verb: 'pull' });
			if (pulls === 3) break;
			await untilAdventure(pip, (a) => a.encounter?.counter?.count === pulls);
			gm.send({ type: 'adventure_control', op: 'end_turn' });
		}
		// Phase 4: the choice.
		await untilAdventure(pip, (a) => a.decision?.id === 'bell');
		await new Promise((resolve) => setTimeout(resolve, 1500));
		pip.send({ type: 'adventure_decide', decisionId: 'bell', optionId: 'silence' });
		const done = await untilAdventure(gm, (a) => a.stage === 'complete');
		expect(done.ending).toMatchObject({
			id: 'silence',
			title: 'Silence',
			subtitle: 'The Bell Silenced'
		});
		expect(done.objectives.every((o) => o.done)).toBe(true);
		expect(done.ledger?.events).toHaveLength(18);
		const ended = await untilAdventure(pip, (a) => a.stage === 'complete');
		expect(ended.completedAt).toBeGreaterThan(0);
		// The session's end screen: its headline and the tally, for everyone.
		expect(ended.ending?.headline).toBe('The Bell is silent');
		expect(ended.summary).toMatchObject({ chapters: 12, again: [] });
		expect(ended.summary!.fightsWon).toBeGreaterThan(0);

		// Pip asks to play again (once), and the GM replays with the same party.
		pip.send({ type: 'adventure_again' });
		for (;;) {
			const { message } = await gm.expect('chat');
			if (message.kind === 'system' && message.text === 'Pip would like to play again.') break;
		}
		expect((await untilAdventure(gm, (a) => a.summary?.again.length === 1)).summary?.again).toEqual(
			[pipId]
		);
		gm.send({ type: 'adventure_control', op: 'restart' });
		const again = (await pip.until('room_reset')).room.adventure!;
		expect(again).toMatchObject({ stage: 'playing', summary: null, completedAt: null });
		expect(again.characters.find((c) => c.id === 'warden')?.playerId).toBe(pipId);
	}, 15_000);

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
		story.origins = recordOrigins(HOLLOW_BELL, made.room);
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
		pip.send({ type: 'token_move', tokenId: me.id, to: BY_TOBIN });
		const spotted = await untilAdventure(gm, (a) => a.encounter !== null);
		expect(spotted.encounter!.order.map((t) => t.name).sort()).toEqual([
			'Bell Cultist',
			'Bell Cultist',
			'Bell Keeper',
			'The Warden'
		]);
		// Pip gets the same order, though not the tokens of cultists far off in the dark.
		const seen = (await untilAdventure(pip, (a) => a.encounter !== null)).encounter!.order;
		expect(seen.map((t) => [t.name, t.initiative])).toEqual(
			spotted.encounter!.order.map((t) => [t.name, t.initiative])
		);
		expect(seen.find((t) => t.name === 'Bell Keeper')?.tokenId).not.toBeNull();
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
	it('lets the GM pause the game, skip ahead, and bring on and take back an enemy', async () => {
		const { gm, pip } = await table();
		pip.send({ type: 'pause_set', paused: true });
		expect(await pip.until('error')).toMatchObject({ code: 'forbidden' });
		gm.send({ type: 'adventure_start' });
		await pip.until('room_reset');
		pip.send({ type: 'adventure_claim', characterId: 'warden' });
		const warden = await tokenNamed(pip, 'The Warden');
		gm.send({ type: 'adventure_begin' });
		await untilAdventure(pip, (a) => a.stage === 'playing');
		const director = await untilAdventure(gm, (a) => a.stage === 'playing');
		expect(director.director?.skip).toBe('What the bell woke');

		// Paused: the players can't move or act, and everyone is told.
		gm.send({ type: 'pause_set', paused: true });
		expect(await pip.until('pause_update')).toEqual({ type: 'pause_update', paused: true });
		const step = { x: warden.pos.x, y: warden.pos.y - 1 };
		pip.send({ type: 'token_move', tokenId: warden.id, to: step });
		expect(await pip.until('error')).toMatchObject({ code: 'paused' });
		pip.send({ type: 'adventure_sense', sense: 'listen' });
		expect(await pip.until('error')).toMatchObject({ code: 'paused' });

		// While paused, an enemy the GM brings on waits where it was put.
		const pos = { x: warden.pos.x + 3, y: warden.pos.y };
		gm.send({ type: 'adventure_direct', direction: { op: 'spawn', kind: 'cultist', pos } });
		const watching = await untilAdventure(gm, (a) => (a.director?.foes.length ?? 0) > 0);
		expect(watching.encounter).toBeNull();
		const [cultist] = watching.director!.foes;
		gm.send({ type: 'token_delete', tokenId: cultist.tokenId });
		await untilAdventure(gm, (a) => a.director?.foes.length === 0);

		gm.send({ type: 'pause_set', paused: false });
		expect(await pip.until('pause_update')).toEqual({ type: 'pause_update', paused: false });
		pip.send({ type: 'token_move', tokenId: warden.id, to: step });
		expect(await pip.until('token_moved')).toMatchObject({ tokenId: warden.id, pos: step });

		// Skipping: the well's fight starts, then is won, and the players see it.
		gm.send({ type: 'adventure_direct', direction: { op: 'skip' } });
		await untilChapter(pip, 'discover_bell');
		gm.send({ type: 'adventure_direct', direction: { op: 'skip' } });
		const won = await untilAdventure(pip, (a) => a.encounter === null);
		expect(won.chapter.id).toBe('discover_bell');
		expect(won.director).toBeNull();

		// Players can't direct.
		pip.send({ type: 'adventure_direct', direction: { op: 'skip' } });
		expect(await pip.until('error')).toMatchObject({ code: 'forbidden' });
	});
	it('brings a new player from the join link to play: a character, then a welcome to Bellweather', async () => {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const { room } = await gm.expect('welcome');
		gm.send({ type: 'adventure_start' });
		await gm.until('room_reset');

		const pip = await connect();
		pip.send({ type: 'join', roomId: room.id, name: 'Pip', role: 'player' });
		const joined = await pip.expect('welcome');
		expect(joined.room.adventure).toMatchObject({ stage: 'choosing' });
		pip.send({ type: 'adventure_claim', characterId: 'veil' });
		const veil = await tokenNamed(pip, 'The Veil');
		gm.send({ type: 'adventure_begin' });
		const playing = await untilAdventure(pip, (a) => a.stage === 'playing');
		expect(playing.welcome.title).toBe('Welcome to Bellweather');
		// The first bell: the arrival calls for the camera to look up the mountain path.
		for (;;) {
			const { message } = await pip.expect('chat');
			if (message.kind !== 'narration' || !message.shot) continue;
			expect(message.shot).toEqual({ focus: { x: 11, y: 2 }, frame: 'wide' });
			break;
		}
		expect(playing.welcome.text).toMatch(/^Dusk settles over Bellweather/);
		expect(playing.objectives.find((o) => !o.done && !o.optional)?.id).toBe('innkeeper');

		// Onboarding: something glows in the road; walk up to it and inspect it.
		const find = playing.firstFind!;
		expect(find).toMatchObject({ objectId: 'charm', clueId: 'tinbell' });
		const [at] = find.cells;
		pip.send({ type: 'token_move', tokenId: veil.id, to: { x: at.x, y: at.y + 1 } });
		await pip.until('token_moved');
		pip.send({ type: 'adventure_interact', targetId: find.objectId, verb: null });
		const found = await untilAdventure(pip, (a) => a.clues.length > 0);
		expect(found.clues[0]).toMatchObject({ id: 'tinbell', mine: true, shared: false });
	});
});

describe('session recovery over the wire', () => {
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

	async function restart(options: Parameters<typeof startGameServer>[0]) {
		await server.close();
		server = await startGameServer(options);
	}

	/** A GM and a player at a table; returns their seats' secret tokens too. */
	async function seated() {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma' });
		const gmWelcome = await gm.expect('welcome');
		const pip = await connect();
		pip.send({ type: 'join', roomId: gmWelcome.room.id, name: 'Pip', role: 'player' });
		const pipWelcome = await pip.expect('welcome');
		await gm.expect('player_joined');
		return { gm, pip, roomId: gmWelcome.room.id, gmWelcome, pipWelcome };
	}

	async function resume(roomId: string, sessionToken: string) {
		const c = await connect();
		c.send({ type: 'resume', roomId, sessionToken });
		return { c, welcome: await c.expect('welcome') };
	}

	it('keeps a game going across a server restart: same seats, owned tokens, log and scene', async () => {
		const store = new MemoryRoomStore();
		await restart({ port: 0, host: '127.0.0.1', roomStore: store, roomSaveMs: 0 });
		const { gm, pip, roomId, gmWelcome, pipWelcome } = await seated();
		gm.send({
			type: 'token_create',
			name: 'Scout',
			color: '#2e86de',
			pos: { x: 2, y: 2 },
			ownerId: pipWelcome.playerId
		});
		const { token } = await pip.until('token_upserted');
		pip.send({ type: 'token_move', tokenId: token.id, to: { x: 4, y: 2 } });
		await gm.until('token_moved');
		pip.send({ type: 'chat_send', text: 'Still here?' });
		await gm.until('chat', (m) => m.message.kind === 'chat');
		gm.send({ type: 'object_create', kind: 'wall', a: { x: 0, y: 6 }, b: { x: 4, y: 6 } });
		await pip.until('objects_changed');

		// The server goes down (a deploy) and comes back with the rooms it kept.
		await restart({ port: 0, host: '127.0.0.1', roomStore: store, roomSaveMs: 0 });
		expect(server.rooms.get(roomId)).toBeDefined();

		const back = await resume(roomId, gmWelcome.sessionToken);
		expect(back.welcome.playerId).toBe(gmWelcome.playerId);
		const pipBack = await resume(roomId, pipWelcome.sessionToken);
		expect(pipBack.welcome.playerId).toBe(pipWelcome.playerId);
		const snapshot = pipBack.welcome.room;
		expect(snapshot.tokens.find((t) => t.id === token.id)).toMatchObject({
			pos: { x: 4, y: 2 },
			ownerId: pipWelcome.playerId
		});
		expect(snapshot.objects).toHaveLength(1);
		expect(snapshot.log.some((m) => m.kind === 'chat' && m.text === 'Still here?')).toBe(true);
		// The seat still owns its token: it can move it.
		pipBack.c.send({ type: 'token_move', tokenId: token.id, to: { x: 5, y: 2 } });
		expect(await back.c.until('token_moved')).toMatchObject({ pos: { x: 5, y: 2 } });
		// And a session token never goes out to anyone else.
		expect(JSON.stringify(snapshot)).not.toContain(gmWelcome.sessionToken);
	});

	it('still closes a kept room once nobody has come back to it', async () => {
		const store = new MemoryRoomStore();
		await restart({ port: 0, host: '127.0.0.1', roomStore: store, roomSaveMs: 0 });
		const { roomId } = await seated();
		await restart({
			port: 0,
			host: '127.0.0.1',
			roomStore: store,
			roomSaveMs: 0,
			emptyRoomTtlMs: 60,
			heartbeatMs: 20
		});
		expect(server.rooms.get(roomId)).toBeDefined();
		await sleep(250);
		expect(server.rooms.get(roomId)).toBeUndefined();
		expect(store.rooms.has(roomId)).toBe(false);
	});

	it('waits for a GM whose connection dropped mid-story, and carries on when they are back', async () => {
		const { gm, pip, roomId, gmWelcome } = await seated();
		gm.send({ type: 'adventure_start' });
		await pip.until('room_reset');
		pip.send({ type: 'adventure_claim', characterId: 'warden' });
		const warden = await pip.until('token_upserted', (m) => m.token.name === 'The Warden');
		gm.send({ type: 'adventure_begin' });
		await pip.until('adventure_update', (m) => m.adventure?.stage === 'playing');

		gm.ws.terminate();
		expect(await pip.until('pause_update')).toEqual({ type: 'pause_update', paused: true });
		await pip.untilNotice('The GM lost their connection. The game waits for them.');
		pip.send({ type: 'token_move', tokenId: warden.token.id, to: { x: 11, y: 24 } });
		expect(await pip.until('error')).toMatchObject({ code: 'paused' });

		await resume(roomId, gmWelcome.sessionToken);
		expect(await pip.until('pause_update')).toEqual({ type: 'pause_update', paused: false });
		await pip.untilNotice('The GM is back.');
	});

	it('passes the turn of a character whose player has gone, after a while', async () => {
		await restart({
			port: 0,
			host: '127.0.0.1',
			rollDie: (sides) => sides,
			enemyTurnDelayMs: 0,
			patrolMs: 0,
			awayTurnMs: 80
		});
		const { gm, pip } = await seated();
		gm.send({ type: 'adventure_start' });
		await pip.until('room_reset');
		pip.send({ type: 'adventure_claim', characterId: 'warden' });
		await pip.until('token_upserted', (m) => m.token.name === 'The Warden');
		gm.send({ type: 'adventure_begin' });
		await gm.until('adventure_update', (m) => m.adventure?.stage === 'playing');
		gm.send({
			type: 'adventure_direct',
			direction: { op: 'encounter_start', encounter: 'well' }
		});
		// The Hound (d20 + 3) goes first; then it is the Warden's turn.
		await gm.until('adventure_update', (m) => {
			const e = m.adventure?.encounter;
			return !!e && e.order[e.current]?.characterId === 'warden';
		});
		pip.ws.terminate();
		await gm.untilNotice("The Warden's player is away; their turn passes.");
	});

	it('catches a late joiner up on the ground the party has explored', async () => {
		const { gm, pip, roomId, pipWelcome } = await seated();
		gm.send({ type: 'adventure_start' });
		await pip.until('room_reset');
		pip.send({ type: 'adventure_claim', characterId: 'warden' });
		await pip.until('token_upserted', (m) => m.token.name === 'The Warden');
		gm.send({ type: 'adventure_begin' });
		await pip.until('adventure_update', (m) => m.adventure?.stage === 'playing');
		const room = server.rooms.get(roomId)!;
		const pipSeat = room.players.get(pipWelcome.playerId)!;
		pipSeat.explored[7] = 1;

		const late = await connect();
		late.send({ type: 'join', roomId, name: 'Lou', role: 'player' });
		const welcome = await late.expect('welcome');
		const lou = room.players.get(welcome.playerId)!;
		expect(lou.explored[7]).toBe(1);
		expect(welcome.room.adventure?.stage).toBe('playing');
	});
});

describe('save and resume over the wire', () => {
	async function restartWith(options: Partial<Parameters<typeof startGameServer>[0]>) {
		await server.close();
		server = await startGameServer({ port: 0, host: '127.0.0.1', patrolMs: 0, ...options });
	}

	async function openTable(extra: Record<string, unknown> = {}) {
		const gm = await connect();
		gm.send({ type: 'create', name: 'Gemma', ...extra });
		return { gm, welcome: await gm.expect('welcome') };
	}

	async function joinAs(roomId: string, name: string) {
		const c = await connect();
		const frames: string[] = [];
		c.ws.on('message', (d) => frames.push(d.toString()));
		c.send({ type: 'join', roomId, name, role: 'player' });
		return { c, frames, welcome: await c.expect('welcome') };
	}

	/** Lists a GM's saves from outside any table, as the landing page does. */
	async function savesOf(gmKey: string) {
		const c = await connect();
		c.send({ type: 'scene_list', gmKey });
		return (await c.expect('scene_list')).scenes;
	}

	it('issues a GM a lasting key of their own, and never shows it to anyone else', async () => {
		const { welcome } = await openTable();
		expect(welcome.gmKey).toMatch(/^[0-9a-f]{64}$/);
		const pip = await joinAs(welcome.room.id, 'Pip');
		expect(pip.welcome.gmKey).toBeUndefined();
		const again = await openTable({ gmKey: welcome.gmKey });
		expect(again.welcome.gmKey).toBe(welcome.gmKey);
		expect(pip.frames.join('')).not.toContain(welcome.gmKey!);
	});

	it('continues a story from the last save: the chapter, the characters and what they found', async () => {
		const store = new MemorySceneStore();
		await restartWith({ sceneStore: store, autosaveMs: 0 });
		const { gm, welcome } = await openTable();
		const gmKey = welcome.gmKey!;
		gm.send({ type: 'adventure_start' });
		await gm.until('room_reset');
		const pip = await joinAs(welcome.room.id, 'Pip');
		pip.c.send({ type: 'adventure_claim', characterId: 'warden' });
		const warden = await pip.c.until('token_upserted', (m) => m.token.name === 'The Warden');
		gm.send({ type: 'adventure_begin' });
		await pip.c.until('adventure_update', (m) => m.adventure?.stage === 'playing');
		// The Warden finds the glint in the road: evidence only they know.
		pip.c.send({ type: 'token_move', tokenId: warden.token.id, to: { x: 12, y: 21 } });
		await pip.c.until('token_moved');
		pip.c.send({ type: 'adventure_interact', targetId: 'charm', verb: null });
		await pip.c.until('adventure_update', (m) => (m.adventure?.clues.length ?? 0) > 0);
		gm.send({ type: 'adventure_direct', direction: { op: 'event', event: 'talked_maren' } });
		await gm.until(
			'adventure_update',
			(m) => !!m.adventure?.objectives.find((o) => o.id === 'innkeeper')?.done
		);

		// The table saved itself as the story went on.
		let saves = await savesOf(gmKey);
		for (let i = 0; i < 20 && !saves[0]?.story?.party.length; i++) {
			await new Promise((r) => setTimeout(r, 50));
			saves = await savesOf(gmKey);
		}
		expect(saves).toHaveLength(1);
		expect(saves[0]).toMatchObject({
			auto: true,
			story: {
				title: 'The Hollow Bell',
				chapter: 'The quiet village',
				location: 'Bellweather',
				party: ['The Warden (Pip)']
			}
		});

		// Everyone leaves. Another day, on another device with the GM's key: Continue.
		gm.ws.terminate();
		pip.c.ws.terminate();
		const next = await openTable({ gmKey, continueFrom: saves[0].id });
		const story = next.welcome.room.adventure!;
		expect(story).toMatchObject({ stage: 'playing', chapter: { id: 'village' } });
		expect(story.objectives.find((o) => o.id === 'innkeeper')?.done).toBe(true);
		expect(story.characters.find((c) => c.id === 'warden')).toMatchObject({ inPlay: true });
		// Pip comes back under the same name: the Warden, and what the Warden found, are theirs again.
		const back = await joinAs(next.welcome.room.id, 'Pip');
		const view = back.welcome.room.adventure!;
		expect(view.characters.find((c) => c.id === 'warden')?.playerId).toBe(back.welcome.playerId);
		expect(view.clues).toEqual([expect.objectContaining({ id: 'tinbell', mine: true })]);
		// Continuing keeps saving into the same save.
		next.gm.send({ type: 'adventure_direct', direction: { op: 'event', event: 'well_clue' } });
		await next.gm.until('adventure_update', (m) => m.adventure?.chapter.id === 'discover_bell');
		let after = await savesOf(gmKey);
		for (let i = 0; i < 20 && after[0]?.story?.chapter !== 'What the bell woke'; i++) {
			await new Promise((r) => setTimeout(r, 50));
			after = await savesOf(gmKey);
		}
		expect(after.map((x) => x.id)).toEqual([saves[0].id]);
		expect(after[0].story?.chapter).toBe('What the bell woke');
	});

	it('keeps a GM’s saves to that GM: no one else lists, loads, continues or deletes them', async () => {
		const store = new MemorySceneStore();
		await restartWith({ sceneStore: store });
		const alice = await openTable();
		alice.gm.send({ type: 'scene_save', name: 'Crypt' });
		const { sceneId } = await alice.gm.expect('scene_saved');
		alice.gm.send({ type: 'scene_list' });
		expect((await alice.gm.until('scene_list')).scenes.map((x) => x.id)).toEqual([sceneId]);

		const bob = await openTable();
		expect(await savesOf(bob.welcome.gmKey!)).toEqual([]);
		bob.gm.send({ type: 'scene_load', sceneId });
		expect(await bob.gm.until('error')).toMatchObject({ code: 'scene_not_found' });
		bob.gm.send({ type: 'scene_delete', sceneId });
		expect(await bob.gm.until('error')).toMatchObject({ code: 'scene_not_found' });
		const sneak = await connect();
		sneak.send({
			type: 'create',
			name: 'Mallory',
			gmKey: bob.welcome.gmKey,
			continueFrom: sceneId
		});
		expect(await sneak.expect('error')).toMatchObject({ code: 'scene_not_found' });

		// Its owner can.
		alice.gm.send({ type: 'scene_delete', sceneId });
		expect((await alice.gm.until('scene_list')).scenes).toEqual([]);
	});

	it('still loads saves from before GM keys, by their id', async () => {
		const store = new MemorySceneStore();
		await restartWith({ sceneStore: store });
		const { gm } = await openTable();
		const file = exportScene(makeOldTable(), 'Old');
		const id = await store.save(file, { owner: null });
		gm.send({ type: 'scene_load', sceneId: id });
		expect((await gm.until('room_reset')).room.sceneName).toBe('Old');
	});
});

/** A table saved by an older server: no owner. */
function makeOldTable() {
	const created = new RoomManager().create('Old');
	if (!created.ok) throw new Error(created.message);
	return created.room;
}
