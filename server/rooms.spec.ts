import { describe, expect, it } from 'vitest';
import { ROOM_ID_PATTERN } from '../src/lib/game/protocol';
import { RoomManager } from './rooms';
import { snapshotFor, viewFor } from './views';

function createRoom(rooms = new RoomManager()) {
	const created = rooms.create('Game Master');
	if (!created.ok) throw new Error(created.message);
	return { rooms, ...created };
}

describe('RoomManager', () => {
	it('makes the room creator its GM', () => {
		const { room, player } = createRoom();
		expect(room.id).toMatch(ROOM_ID_PATTERN);
		expect(player.role).toBe('gm');
		expect(player.connected).toBe(true);
	});

	it('joins players with the requested non-GM role', () => {
		const { rooms, room } = createRoom();
		const joined = rooms.join(room.id, 'Pat', 'player');
		const watcher = rooms.join(room.id, 'Sam', 'spectator');
		expect(joined.ok && joined.player.role).toBe('player');
		expect(watcher.ok && watcher.player.role).toBe('spectator');
		expect(room.players.size).toBe(3);
	});

	it('never grants the GM seat on join', () => {
		const { rooms, room } = createRoom();
		// Bypass the type system the way a hostile payload would.
		const result = rooms.join(room.id, 'Mallory', 'gm' as never);
		expect(result.ok).toBe(false);
	});

	it('rejects unknown rooms and bad names', () => {
		const { rooms, room } = createRoom();
		expect(rooms.join('ZZZZZZ', 'Pat', 'player')).toMatchObject({
			ok: false,
			code: 'room_not_found'
		});
		expect(rooms.join(room.id, '  ', 'player')).toMatchObject({ ok: false, code: 'invalid_name' });
		expect(rooms.create('')).toMatchObject({ ok: false, code: 'invalid_name' });
	});

	it('resumes a session by token and restores its identity and role', () => {
		const { rooms, room, player } = createRoom();
		rooms.setConnected(room, player, false);
		const resumed = rooms.resume(room.id, player.sessionToken);
		expect(resumed.ok && resumed.player.id).toBe(player.id);
		expect(resumed.ok && resumed.player.role).toBe('gm');
		expect(player.connected).toBe(true);
		expect(rooms.resume(room.id, 'f'.repeat(64))).toMatchObject({
			ok: false,
			code: 'session_not_found'
		});
	});

	it('keeps session tokens out of snapshots', () => {
		const { room, player } = createRoom();
		const json = JSON.stringify(snapshotFor(room, player, viewFor(room, player)));
		expect(json).not.toContain(player.sessionToken);
		expect(json).not.toContain('sessionToken');
	});

	it('prunes rooms only after they have been empty for the TTL', () => {
		const { rooms, room, player } = createRoom();
		rooms.setConnected(room, player, false, 1_000);
		expect(rooms.prune(500, 1_400)).toEqual([]);
		expect(rooms.prune(500, 1_500)).toEqual([room.id]);
		expect(rooms.get(room.id)).toBeUndefined();
	});

	it('does not prune a room someone reconnected to', () => {
		const { rooms, room, player } = createRoom();
		rooms.setConnected(room, player, false, 0);
		rooms.resume(room.id, player.sessionToken);
		expect(rooms.prune(1, 10_000)).toEqual([]);
	});
});
