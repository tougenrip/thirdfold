// Wire protocol shared by the game server and the browser client. Everything
// arriving from the network is untrusted: parse it with parseClientMessage /
// parseServerMessage rather than casting.

import type { SquareGrid } from './grid';

export type Role = 'gm' | 'player' | 'spectator';
/** Roles a client may ask for when joining. GM is only ever the room creator. */
export type JoinRole = Exclude<Role, 'gm'>;

export interface PublicPlayer {
	id: string;
	name: string;
	role: Role;
	connected: boolean;
}

export interface RoomSnapshot {
	id: string;
	grid: SquareGrid;
	players: PublicPlayer[];
}

export type ClientMessage =
	| { type: 'create'; name: string }
	| { type: 'join'; roomId: string; name: string; role: JoinRole }
	| { type: 'resume'; roomId: string; token: string };

export type ErrorCode =
	| 'invalid_message'
	| 'invalid_name'
	| 'room_not_found'
	| 'session_not_found'
	| 'already_joined'
	| 'server_error';

export type ServerMessage =
	/** Sent to a client once it has created, joined or resumed a room. `token` is private to that client. */
	| { type: 'welcome'; playerId: string; token: string; room: RoomSnapshot }
	| { type: 'player_joined'; player: PublicPlayer }
	| { type: 'player_presence'; playerId: string; connected: boolean }
	| { type: 'error'; code: ErrorCode; message: string };

export const NAME_MAX_LENGTH = 32;
export const ROOM_ID_PATTERN = /^[A-Z2-9]{6}$/;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** Trims and strips control characters; null when the result is empty or too long. */
export function normalizeName(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	// eslint-disable-next-line no-control-regex
	const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
	return name.length > 0 && name.length <= NAME_MAX_LENGTH ? name : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates the shape of a client message. Names are passed through as
 * strings; semantic checks (name rules, room existence) belong to the server.
 */
export function parseClientMessage(data: unknown): ClientMessage | null {
	if (!isRecord(data)) return null;
	switch (data.type) {
		case 'create':
			return typeof data.name === 'string' ? { type: 'create', name: data.name } : null;
		case 'join':
			if (typeof data.roomId !== 'string' || !ROOM_ID_PATTERN.test(data.roomId)) return null;
			if (typeof data.name !== 'string') return null;
			if (data.role !== 'player' && data.role !== 'spectator') return null;
			return { type: 'join', roomId: data.roomId, name: data.name, role: data.role };
		case 'resume':
			if (typeof data.roomId !== 'string' || !ROOM_ID_PATTERN.test(data.roomId)) return null;
			if (typeof data.token !== 'string' || !TOKEN_PATTERN.test(data.token)) return null;
			return { type: 'resume', roomId: data.roomId, token: data.token };
		default:
			return null;
	}
}

/**
 * The server is trusted, so this only guards against version skew and
 * corrupted frames by checking the discriminant and top-level fields.
 */
export function parseServerMessage(data: unknown): ServerMessage | null {
	if (!isRecord(data)) return null;
	switch (data.type) {
		case 'welcome':
			return typeof data.playerId === 'string' &&
				typeof data.token === 'string' &&
				isRecord(data.room)
				? (data as unknown as ServerMessage)
				: null;
		case 'player_joined':
			return isRecord(data.player) ? (data as unknown as ServerMessage) : null;
		case 'player_presence':
			return typeof data.playerId === 'string' && typeof data.connected === 'boolean'
				? (data as unknown as ServerMessage)
				: null;
		case 'error':
			return typeof data.code === 'string' && typeof data.message === 'string'
				? (data as unknown as ServerMessage)
				: null;
		default:
			return null;
	}
}
