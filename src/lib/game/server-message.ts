// The browser's check on what the game server sends, apart from protocol.ts's
// client-message parser so a page that only talks to the server (the landing
// page, the library) loads none of the game's parsers. Types only from protocol.

import type { ServerMessage } from './protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isInt = (v: unknown) => Number.isSafeInteger(v);

const SERVER_FIELD_CHECKS: Record<ServerMessage['type'], (d: Record<string, unknown>) => boolean> =
	{
		welcome: (d) =>
			typeof d.playerId === 'string' && typeof d.sessionToken === 'string' && isRecord(d.room),
		player_joined: (d) => isRecord(d.player),
		player_presence: (d) => typeof d.playerId === 'string' && typeof d.connected === 'boolean',
		token_upserted: (d) => isRecord(d.token),
		token_moved: (d) =>
			typeof d.tokenId === 'string' && isRecord(d.pos) && isInt(d.pos.x) && isInt(d.pos.y),
		token_deleted: (d) => typeof d.tokenId === 'string',
		scene_saved: (d) => typeof d.sceneId === 'string' && typeof d.name === 'string',
		scene_list: (d) => Array.isArray(d.scenes),
		scene_exported: (d) => isRecord(d.file),
		scene_shared: (d) => typeof d.code === 'string' && typeof d.name === 'string',
		room_reset: (d) => isRecord(d.room),
		props_changed: (d) => Array.isArray(d.upserted) && Array.isArray(d.removed),
		lights_changed: (d) => Array.isArray(d.upserted) && Array.isArray(d.removed),
		ambient_update: (d) => typeof d.ambient === 'string',
		environment_update: (d) => d.environment === null || typeof d.environment === 'string',
		world_update: (d) => isRecord(d.world) && typeof d.world.time === 'number',
		fog_update: (d) => isRecord(d.fog) && typeof d.fog.enabled === 'boolean',
		terrain_update: (d) => d.terrain === null || typeof d.terrain === 'string',
		floor_update: (d) => d.floor === null || typeof d.floor === 'string',
		darkness_update: (d) => d.darkness === null || typeof d.darkness === 'string',
		interior_update: (d) => d.interior === null || typeof d.interior === 'string',
		pause_update: (d) => typeof d.paused === 'boolean',
		objects_changed: (d) => Array.isArray(d.upserted) && Array.isArray(d.removed),
		chat: (d) => isRecord(d.message) && typeof d.message.seq === 'number',
		adventure_update: (d) => d.adventure === null || isRecord(d.adventure),
		motion: (d) => Array.isArray(d.motions),
		listing_update: (d) => typeof d.listed === 'boolean',
		library_list: (d) => Array.isArray(d.adventures),
		library_story: (d) => d.story === null || isRecord(d.story),
		collection_report: (d) => d.report === null || isRecord(d.report),
		library_mine: (d) =>
			Array.isArray(d.adventures) && Array.isArray(d.shared) && typeof d.creatorId === 'string',
		library_published: (d) => typeof d.adventureId === 'string' && typeof d.version === 'number',
		games_list: (d) => Array.isArray(d.games),
		character_sheet: (d) =>
			typeof d.characterId === 'string' && typeof d.rules === 'string' && isRecord(d.details),
		character_options: (d) => typeof d.rules === 'string' && isRecord(d.options),
		monster_search: (d) => typeof d.query === 'string' && Array.isArray(d.monsters),
		campaigns: (d) => Array.isArray(d.campaigns) && (d.current === null || isRecord(d.current)),
		campaign: (d) => d.campaign === null || isRecord(d.campaign),
		content_sources: (d) => Array.isArray(d.sources),
		upgrade_review: (d) => isRecord(d.review) && typeof d.applied === 'boolean',
		character_preview: (d) => isRecord(d.preview) && typeof d.preview.ok === 'boolean',
		validation: (d) =>
			isRecord(d.validation) &&
			typeof d.validation.ok === 'boolean' &&
			Array.isArray(d.validation.diagnostics),
		error: (d) =>
			typeof d.code === 'string' &&
			typeof d.message === 'string' &&
			(d.diagnostics === undefined || Array.isArray(d.diagnostics))
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
