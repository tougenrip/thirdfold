// WebSocket transport around RoomManager: parses and validates client frames,
// applies them to authoritative state, and fans the results out to the room.

import { WebSocketServer, type WebSocket } from 'ws';
import {
	parseClientMessage,
	type ClientMessage,
	type ErrorCode,
	type ServerMessage
} from '../src/lib/game/protocol';
import type { ChatMessage } from '../src/lib/game/chat';
import type { DieRoller } from '../src/lib/game/dice';
import { gridDistance } from '../src/lib/game/grid';
import { postChat, postRoll, postSystem, secureRoller } from './chat';
import { RateLimiter } from './rate-limit';
import { RoomManager, toPublicPlayer, type Player, type Room } from './rooms';
import {
	createObject,
	createToken,
	deleteObject,
	deleteToken,
	moveToken,
	toggleDoor,
	fogArea,
	setFog,
	updateToken
} from './scene';
import {
	canSeeLogEntry,
	diffView,
	sentFrom,
	snapshotFor,
	viewFor,
	viewsFor,
	type SentView
} from './views';

export interface GameServerOptions {
	port: number;
	host?: string;
	/** How long a room survives with nobody connected. */
	emptyRoomTtlMs?: number;
	heartbeatMs?: number;
	/** Die roller for dice_roll; defaults to crypto randomness. Tests inject a fixed one. */
	rollDie?: DieRoller;
}

export interface GameServer {
	port: number;
	rooms: RoomManager;
	close(): Promise<void>;
}

/** Close code sent to a socket whose session was taken over by a newer connection. */
export const CLOSE_SESSION_REPLACED = 4001;

const MAX_PAYLOAD_BYTES = 16 * 1024;
const ROLE_NAMES = { gm: 'GM', player: 'a player', spectator: 'a spectator' } as const;

interface Seat {
	roomId: string;
	playerId: string;
}

export function startGameServer(options: GameServerOptions): Promise<GameServer> {
	const { emptyRoomTtlMs = 10 * 60_000, heartbeatMs = 30_000, rollDie = secureRoller } = options;
	const rooms = new RoomManager();
	// Chat and dice: bursts of 8, then one every 750 ms per player.
	const chatLimiter = new RateLimiter(8, 4 / 3);
	/** roomId -> playerId -> the socket currently holding that seat. */
	const sockets = new Map<string, Map<string, WebSocket>>();
	const seats = new WeakMap<WebSocket, Seat>();
	const alive = new WeakSet<WebSocket>();
	/** What each socket was last sent of the (fog-filtered) scene, to diff against. */
	const sentViews = new WeakMap<WebSocket, SentView>();

	const wss = new WebSocketServer({
		port: options.port,
		host: options.host,
		maxPayload: MAX_PAYLOAD_BYTES
	});

	function send(ws: WebSocket, msg: ServerMessage): void {
		if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
	}

	function sendError(ws: WebSocket, code: ErrorCode, message: string): void {
		send(ws, { type: 'error', code, message });
	}

	function broadcast(roomId: string, msg: ServerMessage, exceptPlayerId?: string): void {
		const frame = JSON.stringify(msg);
		for (const [playerId, ws] of sockets.get(roomId) ?? []) {
			if (playerId !== exceptPlayerId && ws.readyState === ws.OPEN) ws.send(frame);
		}
	}

	function seat(ws: WebSocket, room: Room, player: Player): void {
		let roomSockets = sockets.get(room.id);
		if (!roomSockets) sockets.set(room.id, (roomSockets = new Map()));
		const previous = roomSockets.get(player.id);
		roomSockets.set(player.id, ws);
		seats.set(ws, { roomId: room.id, playerId: player.id });
		if (previous && previous !== ws) {
			seats.delete(previous);
			previous.close(CLOSE_SESSION_REPLACED, 'Session opened elsewhere');
		}
		const view = viewFor(room, player);
		sentViews.set(ws, sentFrom(view));
		send(ws, {
			type: 'welcome',
			playerId: player.id,
			sessionToken: player.sessionToken,
			room: snapshotFor(room, player, view)
		});
	}

	/**
	 * After any scene change: recompute every connected viewer's view and send
	 * each the difference from what they had. Hidden things never go out.
	 */
	function syncRoom(room: Room, movedBy?: string): void {
		const roomSockets = sockets.get(room.id);
		if (!roomSockets) return;
		const viewers = [...roomSockets.keys()]
			.map((id) => room.players.get(id))
			.filter((p): p is Player => !!p);
		for (const [player, view] of viewsFor(room, viewers)) {
			const ws = roomSockets.get(player.id);
			const prev = ws && sentViews.get(ws);
			if (!ws || !prev) continue;
			for (const msg of diffView(prev, view, movedBy)) send(ws, msg);
			sentViews.set(ws, sentFrom(view));
		}
	}

	function handle(ws: WebSocket, msg: ClientMessage): void {
		const s = seats.get(ws);
		const room = s && rooms.get(s.roomId);
		const player = s && room?.players.get(s.playerId);
		switch (msg.type) {
			case 'create':
			case 'join':
			case 'resume':
				if (s) return sendError(ws, 'already_joined', 'This connection is already in a room.');
				return handleEntry(ws, msg);
			default:
				if (!room || !player) return sendError(ws, 'not_joined', 'Join a room first.');
				return handleInRoom(ws, room, player, msg);
		}
	}

	function handleEntry(
		ws: WebSocket,
		msg: Extract<ClientMessage, { type: 'create' | 'join' | 'resume' }>
	): void {
		switch (msg.type) {
			case 'create': {
				const result = rooms.create(msg.name);
				if (!result.ok) return sendError(ws, result.code, result.message);
				postSystem(result.room, `${result.player.name} opened the table as GM.`);
				seat(ws, result.room, result.player);
				console.info(`[room ${result.room.id}] created by ${result.player.name}`);
				return;
			}
			case 'join': {
				const result = rooms.join(msg.roomId, msg.name, msg.role);
				if (!result.ok) return sendError(ws, result.code, result.message);
				const { room, player } = result;
				// Logged before seating so the joiner's snapshot already contains it.
				const notice = postSystem(room, `${player.name} joined as ${ROLE_NAMES[player.role]}.`);
				seat(ws, room, player);
				broadcast(room.id, { type: 'player_joined', player: toPublicPlayer(player) }, player.id);
				broadcast(room.id, { type: 'chat', message: notice }, player.id);
				return;
			}
			case 'resume': {
				const result = rooms.resume(msg.roomId, msg.sessionToken);
				if (!result.ok) return sendError(ws, result.code, result.message);
				seat(ws, result.room, result.player);
				broadcast(
					result.room.id,
					{ type: 'player_presence', playerId: result.player.id, connected: true },
					result.player.id
				);
				return;
			}
		}
	}

	function announce(room: Room, message: ChatMessage): void {
		const frame = JSON.stringify({ type: 'chat', message } satisfies ServerMessage);
		for (const [playerId, ws] of sockets.get(room.id) ?? []) {
			const viewer = room.players.get(playerId);
			if (viewer && canSeeLogEntry(viewer, message) && ws.readyState === ws.OPEN) ws.send(frame);
		}
	}

	/** Notices naming a GM-only token stay with the GM: it may be hidden from the players. */
	function tokenNotice(room: Room, text: string, ownerId: string | null): void {
		announce(room, postSystem(room, text, ownerId ? undefined : 'gm'));
	}

	function tokenName(room: Room, name: string, ownerId: string | null): string {
		const owner = ownerId && room.players.get(ownerId);
		return owner ? `${name} (${owner.name})` : name;
	}

	/** In-room actions: the scene and chat modules decide; this only relays the outcome. */
	function handleInRoom(
		ws: WebSocket,
		room: Room,
		player: Player,
		msg: Exclude<ClientMessage, { type: 'create' | 'join' | 'resume' }>
	): void {
		switch (msg.type) {
			case 'token_create': {
				const result = createToken(room, player, msg);
				if (!result.ok) return sendError(ws, result.code, result.message);
				const { token } = result;
				syncRoom(room);
				return tokenNotice(
					room,
					`${player.name} placed ${tokenName(room, token.name, token.ownerId)}.`,
					token.ownerId
				);
			}
			case 'token_move': {
				const result = moveToken(room, player, msg.tokenId, msg.to);
				if (!result.ok) return sendError(ws, result.code, result.message);
				const { token, from } = result;
				syncRoom(room, player.id);
				const cells = gridDistance(from, token.pos);
				return tokenNotice(
					room,
					`${player.name} moved ${token.name} ${cells} ${cells === 1 ? 'cell' : 'cells'}.`,
					token.ownerId
				);
			}
			case 'token_update': {
				const result = updateToken(room, player, msg.tokenId, msg.patch);
				if (!result.ok) return sendError(ws, result.code, result.message);
				const { token, previousOwnerId } = result;
				syncRoom(room);
				if (token.ownerId !== previousOwnerId) {
					const owner = token.ownerId && room.players.get(token.ownerId);
					announce(
						room,
						postSystem(
							room,
							owner
								? `${player.name} gave ${token.name} to ${owner.name}.`
								: `${player.name} took back ${token.name}.`
						)
					);
				}
				return;
			}
			case 'token_delete': {
				const result = deleteToken(room, player, msg.tokenId);
				if (!result.ok) return sendError(ws, result.code, result.message);
				syncRoom(room);
				return tokenNotice(
					room,
					`${player.name} removed ${result.token.name}.`,
					result.token.ownerId
				);
			}
			case 'object_create': {
				const result = createObject(room, player, msg.kind, msg.a, msg.b);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return syncRoom(room);
			}
			case 'object_delete': {
				const result = deleteObject(room, player, msg.objectId);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return syncRoom(room);
			}
			case 'door_toggle': {
				const result = toggleDoor(room, player, msg.objectId);
				if (!result.ok) return sendError(ws, result.code, result.message);
				syncRoom(room);
				return announce(
					room,
					postSystem(room, `${player.name} ${result.door.open ? 'opened' : 'closed'} a door.`)
				);
			}
			case 'fog_set': {
				const result = setFog(room, player, msg.enabled);
				if (!result.ok) return sendError(ws, result.code, result.message);
				if (!result.changed) return;
				syncRoom(room);
				return announce(
					room,
					postSystem(room, `${player.name} turned fog of war ${msg.enabled ? 'on' : 'off'}.`)
				);
			}
			case 'fog_area': {
				const result = fogArea(room, player, msg.from, msg.to, msg.reveal);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return syncRoom(room);
			}
			case 'chat_send':
			case 'dice_roll': {
				if (!chatLimiter.take(player.id)) {
					return sendError(ws, 'rate_limited', 'Slow down a little before sending more.');
				}
				const result =
					msg.type === 'chat_send'
						? postChat(room, player, msg.text)
						: postRoll(room, player, msg.expression, rollDie);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return announce(room, result.message);
			}
		}
	}

	function onClose(ws: WebSocket): void {
		const s = seats.get(ws);
		if (!s) return;
		seats.delete(ws);
		const roomSockets = sockets.get(s.roomId);
		// A replaced socket no longer owns the seat; its close must not mark the player offline.
		if (roomSockets?.get(s.playerId) !== ws) return;
		roomSockets.delete(s.playerId);
		if (roomSockets.size === 0) sockets.delete(s.roomId);
		const room = rooms.get(s.roomId);
		const player = room?.players.get(s.playerId);
		if (!room || !player) return;
		rooms.setConnected(room, player, false);
		broadcast(room.id, { type: 'player_presence', playerId: player.id, connected: false });
	}

	wss.on('connection', (ws) => {
		alive.add(ws);
		ws.on('pong', () => alive.add(ws));
		ws.on('message', (data, isBinary) => {
			let parsed: unknown;
			try {
				parsed = isBinary ? undefined : JSON.parse(data.toString());
			} catch {
				parsed = undefined;
			}
			const msg = parseClientMessage(parsed);
			if (!msg) return sendError(ws, 'invalid_message', 'Malformed message.');
			try {
				handle(ws, msg);
			} catch (err) {
				console.error('[game-server] handler failed', err);
				sendError(ws, 'server_error', 'Something went wrong on the server.');
			}
		});
		ws.on('close', () => onClose(ws));
		ws.on('error', (err) => console.warn('[game-server] socket error', err.message));
	});

	const heartbeat = setInterval(() => {
		for (const ws of wss.clients) {
			if (!alive.has(ws)) {
				ws.terminate();
				continue;
			}
			alive.delete(ws);
			ws.ping();
		}
		for (const id of rooms.prune(emptyRoomTtlMs)) console.info(`[room ${id}] closed (empty)`);
	}, heartbeatMs);

	return new Promise((resolve, reject) => {
		wss.once('error', reject);
		wss.once('listening', () => {
			wss.off('error', reject);
			const address = wss.address();
			resolve({
				port: address && typeof address === 'object' ? address.port : options.port,
				rooms,
				close: () =>
					new Promise<void>((done) => {
						clearInterval(heartbeat);
						for (const ws of wss.clients) ws.terminate();
						wss.close(() => done());
					})
			});
		});
	});
}
