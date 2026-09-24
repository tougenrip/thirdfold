// Wire protocol shared by the game server and the browser client. Everything
// arriving from the network is untrusted: parse it with parseClientMessage /
// parseServerMessage rather than casting.

import type { ChatMessage } from './chat';
import type { GridPos, SquareGrid } from './grid';
import type { SceneObject } from './objects';
import type { SceneFile } from './scene-file';
import { TOKEN_COLOR_PATTERN, type Token } from './token';
import { MAX_VISION, type FogView } from './visibility';

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
	/** Name of the scene on the table (last saved, loaded or imported). */
	sceneName: string;
	grid: SquareGrid;
	players: PublicPlayer[];
	tokens: Token[];
	/** Walls and doors. */
	objects: SceneObject[];
	/** What this client may see. With fog on, tokens and objects above are already filtered to it. */
	fog: FogView;
	/** Most recent room log entries, oldest first. */
	log: ChatMessage[];
}

/** Fields the GM may change on an existing token. Omitted fields stay as they are. */
export interface TokenPatch {
	name?: string;
	color?: string;
	ownerId?: string | null;
	vision?: number;
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
	| { type: 'token_delete'; tokenId: string }
	/** GM: a wall between two corners, or a door on one unit edge (cut into any wall there). */
	| { type: 'object_create'; kind: 'wall' | 'door'; a: GridPos; b: GridPos }
	| { type: 'object_delete'; objectId: string }
	/** Open or close a door: the GM always, a player only with a token beside it. */
	| { type: 'door_toggle'; objectId: string }
	/** GM: turn fog of war on or off for the room. */
	| { type: 'fog_set'; enabled: boolean }
	/** GM: reveal (or hide again) the rectangle of cells between two corner cells. */
	| { type: 'fog_area'; from: GridPos; to: GridPos; reveal: boolean }
	/** GM: save the current table under a name. Replies with scene_saved. */
	| { type: 'scene_save'; name: string }
	/** GM: replace the table with a saved scene. */
	| { type: 'scene_load'; sceneId: string }
	/** GM: get the current table as a scene file (to download). Replies with scene_exported. */
	| { type: 'scene_export'; name: string }
	/** GM: replace the table with an uploaded scene file. The server validates it fully. */
	| { type: 'scene_import'; file: unknown }
	| { type: 'chat_send'; text: string }
	| { type: 'dice_roll'; expression: string };

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
	| 'invalid_object'
	| 'object_not_found'
	| 'edge_occupied'
	| 'no_path'
	| 'scene_not_found'
	| 'invalid_scene'
	| 'persistence_failed'
	| 'invalid_chat'
	| 'invalid_dice'
	| 'rate_limited'
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
	/** Scene objects added/changed and removed, applied together (e.g. a wall split by a door). */
	| { type: 'objects_changed'; upserted: SceneObject[]; removed: string[] }
	/** This client's visibility changed (vision moved, doors, GM reveal, fog toggled). */
	| { type: 'fog_update'; fog: FogView }
	/** To the GM who saved: where the scene is stored. Keep the id to load it again. */
	| { type: 'scene_saved'; sceneId: string; name: string; savedAt: string }
	/** To the GM who asked: the current table as a scene file. */
	| { type: 'scene_exported'; file: SceneFile }
	/** The whole table changed (a scene was loaded): replace local room state with this. */
	| { type: 'room_reset'; room: RoomSnapshot }
	/** A new room log entry: chat, a dice result, or a system notice. */
	| { type: 'chat'; message: ChatMessage }
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
	if ('vision' in value) {
		const v = value.vision;
		if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > MAX_VISION) return null;
		patch.vision = v as number;
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
		case 'object_create': {
			const a = parseGridPos(data.a);
			const b = parseGridPos(data.b);
			if ((data.kind !== 'wall' && data.kind !== 'door') || !a || !b) return null;
			return { type: 'object_create', kind: data.kind, a, b };
		}
		case 'object_delete':
			return isId(data.objectId) ? { type: 'object_delete', objectId: data.objectId } : null;
		case 'door_toggle':
			return isId(data.objectId) ? { type: 'door_toggle', objectId: data.objectId } : null;
		case 'fog_set':
			return typeof data.enabled === 'boolean' ? { type: 'fog_set', enabled: data.enabled } : null;
		case 'fog_area': {
			const from = parseGridPos(data.from);
			const to = parseGridPos(data.to);
			if (!from || !to || typeof data.reveal !== 'boolean') return null;
			return { type: 'fog_area', from, to, reveal: data.reveal };
		}
		case 'scene_save':
			return typeof data.name === 'string' ? { type: 'scene_save', name: data.name } : null;
		case 'scene_export':
			return typeof data.name === 'string' ? { type: 'scene_export', name: data.name } : null;
		case 'scene_load':
			return typeof data.sceneId === 'string' && /^[0-9a-f]{32}$/.test(data.sceneId)
				? { type: 'scene_load', sceneId: data.sceneId }
				: null;
		case 'scene_import':
			return isRecord(data.file) ? { type: 'scene_import', file: data.file } : null;
		case 'chat_send':
			return typeof data.text === 'string' ? { type: 'chat_send', text: data.text } : null;
		case 'dice_roll':
			return typeof data.expression === 'string'
				? { type: 'dice_roll', expression: data.expression }
				: null;
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
		scene_saved: (d) => typeof d.sceneId === 'string' && typeof d.name === 'string',
		scene_exported: (d) => isRecord(d.file),
		room_reset: (d) => isRecord(d.room),
		fog_update: (d) => isRecord(d.fog) && typeof d.fog.enabled === 'boolean',
		objects_changed: (d) => Array.isArray(d.upserted) && Array.isArray(d.removed),
		chat: (d) => isRecord(d.message) && typeof d.message.seq === 'number',
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
