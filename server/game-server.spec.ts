import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerMessage } from '../src/lib/game/protocol';
import { CLOSE_SESSION_REPLACED, startGameServer, type GameServer } from './game-server';

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
});
