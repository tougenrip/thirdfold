// Wire protocol shared by the game server and the browser client. Everything
// arriving from the network is untrusted: parse it with parseClientMessage /
// parseServerMessage rather than casting.

import { isObjectState, type AdventureView, type ObjectState } from '../adventure/adventure';
import {
	isCharacterId,
	isStatusId,
	type CharacterId,
	type StatusId
} from '../adventure/characters';
import type { ChatMessage } from './chat';
import type { GridPos, SquareGrid } from './grid';
import { AMBIENTS, MAX_LIGHT_RADIUS, type Ambient, type Light } from './lights';
import type { SceneObject } from './objects';
import { isAssetId, PROP_SCALE, type AssetId, type Prop, type Rotation } from './props';
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
	/** Furniture and scenery (with fog on: ones this client has seen). */
	props: Prop[];
	/** Light sources this client knows of (with fog on: ones it has seen). */
	lights: Light[];
	ambient: Ambient;
	/** What this client may see. With fog on, tokens and objects above are already filtered to it. */
	fog: FogView;
	/** Most recent room log entries, oldest first. */
	log: ChatMessage[];
	/** The adventure being played at this table (as this client may know it), or null for a free table. */
	adventure: AdventureView | null;
}

/** Fields the GM may change on an existing token. Omitted fields stay as they are. */
export interface TokenPatch {
	name?: string;
	color?: string;
	ownerId?: string | null;
	vision?: number;
	light?: number;
}

/** Fields the GM may change on a placed prop: move, rotate, scale. */
export interface PropPatch {
	pos?: GridPos;
	rotation?: Rotation;
	scale?: number;
}

/** Fields the GM may change on an existing light. */
export interface LightPatch {
	radius?: number;
	color?: string;
	on?: boolean;
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
	/** GM: place a prop from the catalog, its footprint starting at `pos`. */
	| { type: 'prop_create'; assetId: AssetId; pos: GridPos; rotation: Rotation }
	| { type: 'prop_update'; propId: string; patch: PropPatch }
	| { type: 'prop_delete'; propId: string }
	/** GM: place a light source on a cell. */
	| { type: 'light_create'; pos: GridPos; radius: number; color: string }
	| { type: 'light_update'; lightId: string; patch: LightPatch }
	| { type: 'light_delete'; lightId: string }
	/** GM: the room's ambient light level. */
	| { type: 'ambient_set'; ambient: Ambient }
	/** GM: save the current table under a name. Replies with scene_saved. */
	| { type: 'scene_save'; name: string }
	/** GM: replace the table with a saved scene. */
	| { type: 'scene_load'; sceneId: string }
	/** GM: get the current table as a scene file (to download). Replies with scene_exported. */
	| { type: 'scene_export'; name: string }
	/** GM: replace the table with an uploaded scene file. The server validates it fully. */
	| { type: 'scene_import'; file: unknown }
	| { type: 'chat_send'; text: string }
	| { type: 'dice_roll'; expression: string }
	/** GM: set up The Hollow Bell on this table (replaces the table). */
	| { type: 'adventure_start' }
	/** Player: play this character (one each). */
	| { type: 'adventure_claim'; characterId: CharacterId }
	/** Player: give back your character, before play begins. */
	| { type: 'adventure_release' }
	/** GM: characters are chosen, start playing. */
	| { type: 'adventure_begin' }
	/** Player: your character does `verb` (or the first thing it can) to something beside it. */
	| { type: 'adventure_interact'; targetId: string; verb: string | null }
	/** GM: put a world object in a state (reveal, hide, open, break, …). */
	| { type: 'adventure_object'; objectId: string; state: ObjectState }
	/** Player: your character uses an action (an attack, a heal, a guard) on a token, or on no one. */
	| { type: 'adventure_act'; actionId: string; targetId: string | null }
	/** Player, in an encounter: your character is done for this round. */
	| { type: 'adventure_end_turn' }
	/** GM: narrate to the table. */
	| { type: 'adventure_narrate'; text: string }
	/** GM: read one of the adventure's prepared passages aloud. */
	| { type: 'adventure_cue'; cueId: string }
	/** GM: end the players' phase now, start the section over, or stop the adventure (the table stays). */
	| { type: 'adventure_control'; op: AdventureControl }
	/** GM: set a character's hit points and statuses, or bring them back from the dead. */
	| { type: 'adventure_override'; characterId: CharacterId; patch: CharacterPatch };

/** What the GM may set on a character. Omitted fields stay as they are. */
export interface CharacterPatch {
	hp?: number;
	/** The full set of statuses, each for one round. */
	statuses?: StatusId[];
	/** Bring a dead character back (at 1 HP if they had none). */
	revive?: true;
}

export type AdventureControl = 'end_round' | 'restart' | 'end';

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
	| 'light_not_found'
	| 'prop_not_found'
	| 'scene_not_found'
	| 'invalid_scene'
	| 'persistence_failed'
	| 'invalid_chat'
	| 'invalid_dice'
	| 'rate_limited'
	| 'no_adventure'
	| 'character_taken'
	| 'not_your_turn'
	| 'out_of_reach'
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
	/** Props added/changed and removed. */
	| { type: 'props_changed'; upserted: Prop[]; removed: string[] }
	/** Light sources added/changed and removed. */
	| { type: 'lights_changed'; upserted: Light[]; removed: string[] }
	| { type: 'ambient_update'; ambient: Ambient }
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
	/** The adventure changed (as this client may know it); null when it ended. */
	| { type: 'adventure_update'; adventure: AdventureView | null }
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
	if ('light' in value) {
		const v = value.light;
		if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > MAX_LIGHT_RADIUS) return null;
		patch.light = v as number;
	}
	if ('ownerId' in value) {
		const owner = parseOwner(value.ownerId);
		if (owner === undefined) return null;
		patch.ownerId = owner;
	}
	return Object.keys(patch).length > 0 ? patch : null;
}

function isRotation(value: unknown): value is Rotation {
	return value === 0 || value === 1 || value === 2 || value === 3;
}

function parsePropPatch(value: unknown): PropPatch | null {
	if (!isRecord(value)) return null;
	const patch: PropPatch = {};
	if ('pos' in value) {
		const pos = parseGridPos(value.pos);
		if (!pos) return null;
		patch.pos = pos;
	}
	if ('rotation' in value) {
		if (!isRotation(value.rotation)) return null;
		patch.rotation = value.rotation;
	}
	if ('scale' in value) {
		const s = value.scale;
		if (typeof s !== 'number' || !(s >= PROP_SCALE.min && s <= PROP_SCALE.max)) return null;
		patch.scale = s;
	}
	return Object.keys(patch).length > 0 ? patch : null;
}

function isLightRadius(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_LIGHT_RADIUS;
}

function parseLightPatch(value: unknown): LightPatch | null {
	if (!isRecord(value)) return null;
	const patch: LightPatch = {};
	if ('radius' in value) {
		if (!isLightRadius(value.radius)) return null;
		patch.radius = value.radius;
	}
	if ('color' in value) {
		if (!isColor(value.color)) return null;
		patch.color = value.color;
	}
	if ('on' in value) {
		if (typeof value.on !== 'boolean') return null;
		patch.on = value.on;
	}
	return Object.keys(patch).length > 0 ? patch : null;
}

function parseCharacterPatch(value: unknown): CharacterPatch | null {
	if (!isRecord(value)) return null;
	const patch: CharacterPatch = {};
	if ('hp' in value) {
		if (!Number.isInteger(value.hp) || (value.hp as number) < 0 || (value.hp as number) > 999)
			return null;
		patch.hp = value.hp as number;
	}
	if ('statuses' in value) {
		const list = value.statuses;
		if (!Array.isArray(list) || list.length > 10 || !list.every(isStatusId)) return null;
		patch.statuses = [...new Set(list)];
	}
	if ('revive' in value) {
		if (value.revive !== true) return null;
		patch.revive = true;
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
		case 'prop_create': {
			const pos = parseGridPos(data.pos);
			if (!isAssetId(data.assetId) || !pos || !isRotation(data.rotation)) return null;
			return { type: 'prop_create', assetId: data.assetId, pos, rotation: data.rotation };
		}
		case 'prop_update': {
			const patch = parsePropPatch(data.patch);
			return isId(data.propId) && patch
				? { type: 'prop_update', propId: data.propId, patch }
				: null;
		}
		case 'prop_delete':
			return isId(data.propId) ? { type: 'prop_delete', propId: data.propId } : null;
		case 'light_create': {
			const pos = parseGridPos(data.pos);
			if (!pos || !isLightRadius(data.radius) || !isColor(data.color)) return null;
			return { type: 'light_create', pos, radius: data.radius, color: data.color };
		}
		case 'light_update': {
			const patch = parseLightPatch(data.patch);
			return isId(data.lightId) && patch
				? { type: 'light_update', lightId: data.lightId, patch }
				: null;
		}
		case 'light_delete':
			return isId(data.lightId) ? { type: 'light_delete', lightId: data.lightId } : null;
		case 'ambient_set':
			return AMBIENTS.includes(data.ambient as Ambient)
				? { type: 'ambient_set', ambient: data.ambient as Ambient }
				: null;
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
		case 'adventure_start':
		case 'adventure_release':
		case 'adventure_begin':
		case 'adventure_end_turn':
			return { type: data.type };
		case 'adventure_claim':
			return isCharacterId(data.characterId)
				? { type: 'adventure_claim', characterId: data.characterId }
				: null;
		case 'adventure_interact': {
			if (!isId(data.targetId)) return null;
			const verb = data.verb ?? null;
			if (verb !== null && !isId(verb)) return null;
			return { type: 'adventure_interact', targetId: data.targetId, verb };
		}
		case 'adventure_object':
			return isId(data.objectId) && isObjectState(data.state)
				? { type: 'adventure_object', objectId: data.objectId, state: data.state }
				: null;
		case 'adventure_act': {
			if (!isId(data.actionId)) return null;
			if (data.targetId !== null && !isId(data.targetId)) return null;
			return { type: 'adventure_act', actionId: data.actionId, targetId: data.targetId };
		}
		case 'adventure_override': {
			const patch = parseCharacterPatch(data.patch);
			return isCharacterId(data.characterId) && patch
				? { type: 'adventure_override', characterId: data.characterId, patch }
				: null;
		}
		case 'adventure_narrate':
			return typeof data.text === 'string' ? { type: 'adventure_narrate', text: data.text } : null;
		case 'adventure_cue':
			return isId(data.cueId) ? { type: 'adventure_cue', cueId: data.cueId } : null;
		case 'adventure_control':
			return data.op === 'end_round' || data.op === 'restart' || data.op === 'end'
				? { type: 'adventure_control', op: data.op }
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
		props_changed: (d) => Array.isArray(d.upserted) && Array.isArray(d.removed),
		lights_changed: (d) => Array.isArray(d.upserted) && Array.isArray(d.removed),
		ambient_update: (d) => typeof d.ambient === 'string',
		fog_update: (d) => isRecord(d.fog) && typeof d.fog.enabled === 'boolean',
		objects_changed: (d) => Array.isArray(d.upserted) && Array.isArray(d.removed),
		chat: (d) => isRecord(d.message) && typeof d.message.seq === 'number',
		adventure_update: (d) => d.adventure === null || isRecord(d.adventure),
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
