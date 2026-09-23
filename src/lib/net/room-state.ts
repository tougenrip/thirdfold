// Client mirror of authoritative room state. The server is the source of
// truth; this only folds its broadcasts into the last snapshot it sent.

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
		default:
			return false;
	}
}
