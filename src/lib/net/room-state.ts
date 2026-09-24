// Client mirror of authoritative room state. The server is the source of
// truth; this only folds its broadcasts into the last snapshot it sent.

import { LOG_LIMIT } from '$lib/game/chat';
import type { RoomSnapshot, ServerMessage } from '$lib/game/protocol';

/** Applies a room broadcast in place. Returns false for messages that are not room updates. */
export function applyRoomUpdate(room: RoomSnapshot, msg: ServerMessage): boolean {
	switch (msg.type) {
		case 'player_joined': {
			const i = room.players.findIndex((p) => p.id === msg.player.id);
			if (i === -1) room.players.push(msg.player);
			else room.players[i] = msg.player;
			return true;
		}
		case 'player_presence': {
			const player = room.players.find((p) => p.id === msg.playerId);
			if (player) player.connected = msg.connected;
			return true;
		}
		case 'token_upserted': {
			const i = room.tokens.findIndex((t) => t.id === msg.token.id);
			if (i === -1) room.tokens.push(msg.token);
			else room.tokens[i] = msg.token;
			return true;
		}
		case 'token_moved': {
			const token = room.tokens.find((t) => t.id === msg.tokenId);
			if (token) token.pos = msg.pos;
			return true;
		}
		case 'token_deleted': {
			const i = room.tokens.findIndex((t) => t.id === msg.tokenId);
			if (i !== -1) room.tokens.splice(i, 1);
			return true;
		}
		case 'objects_changed': {
			const removed = new Set(msg.removed);
			const upserted = new Map(msg.upserted.map((o) => [o.id, o]));
			const next = room.objects.filter((o) => !removed.has(o.id) && !upserted.has(o.id));
			room.objects = [...next, ...msg.upserted];
			return true;
		}
		case 'props_changed': {
			const removed = new Set(msg.removed);
			const upserted = new Set(msg.upserted.map((p) => p.id));
			const kept = room.props.filter((p) => !removed.has(p.id) && !upserted.has(p.id));
			room.props = [...kept, ...msg.upserted];
			return true;
		}
		case 'lights_changed': {
			const removed = new Set(msg.removed);
			const upserted = new Set(msg.upserted.map((l) => l.id));
			const kept = room.lights.filter((l) => !removed.has(l.id) && !upserted.has(l.id));
			room.lights = [...kept, ...msg.upserted];
			return true;
		}
		case 'ambient_update':
			room.ambient = msg.ambient;
			return true;
		case 'fog_update':
			room.fog = msg.fog;
			return true;
		case 'darkness_update':
			room.darkness = msg.darkness;
			return true;
		case 'terrain_update':
			room.terrain = msg.terrain;
			return true;
		case 'adventure_update':
			room.adventure = msg.adventure;
			return true;
		case 'chat': {
			const last = room.log.at(-1);
			if (last && last.seq >= msg.message.seq) return true; // already have it
			room.log.push(msg.message);
			if (room.log.length > LOG_LIMIT) room.log.splice(0, room.log.length - LOG_LIMIT);
			return true;
		}
		default:
			return false;
	}
}
