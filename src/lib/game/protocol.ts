// Wire protocol shared by the game server and the browser client. Everything
// arriving from the network is untrusted: parse it with parseClientMessage /
// parseServerMessage rather than casting.

import type { GridPos, SquareGrid } from './grid';
import { TOKEN_COLOR_PATTERN, type Token } from './token';

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
	tokens: Token[];
}

/** Fields the GM may change on an existing token. Omitted fields stay as they are. */
export interface TokenPatch {
	name?: string;
	color?: string;
	ownerId?: string | null;
}

export type ClientMessage =
	| { type: 'create'; name: string }
	| { type: 'join'; roomId: string; name: string; role: JoinRole }
	| { type: 'resume'; roomId: string; sessionToken: string }
	| {
			type: 'token_create';
			name: string;
			color: string;
			pos: GridPos;
			ownerId: string | null;
	  }
	| { type: 'token_move'; tokenId: string; to: GridPos }
	| { type: 'token_update'; tokenId: string; patch: TokenPatch }
	| { type: 'token_delete'; tokenId: string };

export type ErrorCode =
	| 'invalid_message'
	| 'invalid_name'
	| 'room_not_found'
	| 'session_not_found'
	| 'already_joined'
	| 'not_joined'
	| 'forbidden'
	| 'token_not_found'
	| 'invalid_owner'
	| 'invalid_position'
	| 'cell_occupied'
	| 'limit_reached'
	| 'server_error';

export type ServerMessage =
	/** Sent to a client once it has created, joined or resumed a room. `sessionToken` is private to that client. */
	| { type: 'welcome'; playerId: string; sessionToken: string; room: RoomSnapshot }
	| { type: 'player_joined'; player: PublicPlayer }
	| { type: 'player_presence'; playerId: string; connected: boolean }
	/** A token was created or its properties changed. */
	| { type: 'token_upserted'; token: Token }
	| { type: 'token_moved'; tokenId: string; pos: GridPos; byPlayerId: string }
	| { type: 'token_deleted'; tokenId: string }
	| { type: 'error'; code: ErrorCode; message: string };

export const NAME_MAX_LENGTH = 32;
export const ROOM_ID_PATTERN = /^[A-Z2-9]{6}$/;
const SESSION_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const ID_MAX_LENGTH = 64;

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

function isId(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= ID_MAX_LENGTH;
}

function isRoomId(value: unknown): value is string {
	return typeof value === 'string' && ROOM_ID_PATTERN.test(value);
}

function isColor(value: unknown): value is string {
	return typeof value === 'string' && TOKEN_COLOR_PATTERN.test(value);
}

/** Shape check only (integers); whether the cell is on this room's grid is the server's call. */
function parseGridPos(value: unknown): GridPos | null {
	if (!isRecord(value)) return null;
	const { x, y } = value;
	return Number.isSafeInteger(x) && Number.isSafeInteger(y)
		? { x: x as number, y: y as number }
		: null;
}

function parseOwner(value: unknown): string | null | undefined {
	if (value === null) return null;
	return isId(value) ? value : undefined;
}

function parseTokenPatch(value: unknown): TokenPatch | null {
	if (!isRecord(value)) return null;
	const patch: TokenPatch = {};
	if ('name' in value) {
		if (typeof value.name !== 'string') return null;
		patch.name = value.name;
	}
	if ('color' in value) {
		if (!isColor(value.color)) return null;
		patch.color = value.color;
	}
	if ('ownerId' in value) {
		const owner = parseOwner(value.ownerId);
		if (owner === undefined) return null;
		patch.ownerId = owner;
	}
	return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Validates the shape of a client message and drops unknown fields. Semantic
 * checks (name rules, permissions, room existence, bounds) belong to the server.
 */
export function parseClientMessage(data: unknown): ClientMessage | null {
	if (!isRecord(data)) return null;
	switch (data.type) {
		case 'create':
			return typeof data.name === 'string' ? { type: 'create', name: data.name } : null;
		case 'join':
			if (!isRoomId(data.roomId) || typeof data.name !== 'string') return null;
			if (data.role !== 'player' && data.role !== 'spectator') return null;
			return { type: 'join', roomId: data.roomId, name: data.name, role: data.role };
		case 'resume':
			if (!isRoomId(data.roomId)) return null;
			if (typeof data.sessionToken !== 'string' || !SESSION_TOKEN_PATTERN.test(data.sessionToken))
				return null;
			return { type: 'resume', roomId: data.roomId, sessionToken: data.sessionToken };
		case 'token_create': {
			const pos = parseGridPos(data.pos);
			const ownerId = parseOwner(data.ownerId);
			if (typeof data.name !== 'string' || !isColor(data.color) || !pos || ownerId === undefined)
				return null;
			return { type: 'token_create', name: data.name, color: data.color, pos, ownerId };
		}
		case 'token_move': {
			const to = parseGridPos(data.to);
			return isId(data.tokenId) && to ? { type: 'token_move', tokenId: data.tokenId, to } : null;
		}
		case 'token_update': {
			const patch = parseTokenPatch(data.patch);
			return isId(data.tokenId) && patch
				? { type: 'token_update', tokenId: data.tokenId, patch }
				: null;
		}
		case 'token_delete':
			return isId(data.tokenId) ? { type: 'token_delete', tokenId: data.tokenId } : null;
		default:
			return null;
	}
}

const SERVER_FIELD_CHECKS: Record<ServerMessage['type'], (d: Record<string, unknown>) => boolean> =
	{
		welcome: (d) =>
			typeof d.playerId === 'string' && typeof d.sessionToken === 'string' && isRecord(d.room),
		player_joined: (d) => isRecord(d.player),
		player_presence: (d) => typeof d.playerId === 'string' && typeof d.connected === 'boolean',
		token_upserted: (d) => isRecord(d.token),
		token_moved: (d) => typeof d.tokenId === 'string' && parseGridPos(d.pos) !== null,
		token_deleted: (d) => typeof d.tokenId === 'string',
		error: (d) => typeof d.code === 'string' && typeof d.message === 'string'
	};

/**
 * The server is trusted, so this only guards against version skew and
 * corrupted frames by checking the discriminant and top-level fields.
 */
export function parseServerMessage(data: unknown): ServerMessage | null {
	if (!isRecord(data) || typeof data.type !== 'string') return null;
	if (!Object.hasOwn(SERVER_FIELD_CHECKS, data.type)) return null;
	const check = SERVER_FIELD_CHECKS[data.type as ServerMessage['type']];
	return check?.(data) ? (data as unknown as ServerMessage) : null;
}
