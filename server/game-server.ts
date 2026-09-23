// WebSocket transport around RoomManager: parses and validates client frames,
// applies them to authoritative state, and fans the results out to the room.

import { WebSocketServer, type WebSocket } from 'ws';
import {
	parseClientMessage,
	type ClientMessage,
	type ErrorCode,
	type ServerMessage
} from '../src/lib/game/protocol';
import { RoomManager, snapshot, toPublicPlayer, type Player, type Room } from './rooms';
import { createToken, deleteToken, moveToken, updateToken } from './scene';

export interface GameServerOptions {
	port: number;
	host?: string;
	/** How long a room survives with nobody connected. */
	emptyRoomTtlMs?: number;
	heartbeatMs?: number;
}

export interface GameServer {
	port: number;
	rooms: RoomManager;
	close(): Promise<void>;
}

/** Close code sent to a socket whose session was taken over by a newer connection. */
export const CLOSE_SESSION_REPLACED = 4001;

const MAX_PAYLOAD_BYTES = 16 * 1024;

interface Seat {
	roomId: string;
	playerId: string;
}

export function startGameServer(options: GameServerOptions): Promise<GameServer> {
	const { emptyRoomTtlMs = 10 * 60_000, heartbeatMs = 30_000 } = options;
	const rooms = new RoomManager();
	/** roomId -> playerId -> the socket currently holding that seat. */
	const sockets = new Map<string, Map<string, WebSocket>>();
	const seats = new WeakMap<WebSocket, Seat>();
	const alive = new WeakSet<WebSocket>();

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
		send(ws, {
			type: 'welcome',
			playerId: player.id,
			sessionToken: player.sessionToken,
			room: snapshot(room)
		});
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
				seat(ws, result.room, result.player);
				console.info(`[room ${result.room.id}] created by ${result.player.name}`);
				return;
			}
			case 'join': {
				const result = rooms.join(msg.roomId, msg.name, msg.role);
				if (!result.ok) return sendError(ws, result.code, result.message);
				seat(ws, result.room, result.player);
				broadcast(
					result.room.id,
					{ type: 'player_joined', player: toPublicPlayer(result.player) },
					result.player.id
				);
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

	/** In-room actions: the scene module decides; this only relays the outcome. */
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
				return broadcast(room.id, { type: 'token_upserted', token: result.token });
			}
			case 'token_move': {
				const result = moveToken(room, player, msg.tokenId, msg.to);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return broadcast(room.id, {
					type: 'token_moved',
					tokenId: result.token.id,
					pos: result.token.pos,
					byPlayerId: player.id
				});
			}
			case 'token_update': {
				const result = updateToken(room, player, msg.tokenId, msg.patch);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return broadcast(room.id, { type: 'token_upserted', token: result.token });
			}
			case 'token_delete': {
				const result = deleteToken(room, player, msg.tokenId);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return broadcast(room.id, { type: 'token_deleted', tokenId: msg.tokenId });
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
