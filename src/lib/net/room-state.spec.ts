import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID } from '$lib/game/grid';
import type { RoomSnapshot } from '$lib/game/protocol';
import { applyRoomUpdate } from './room-state';

function room(): RoomSnapshot {
	return {
		id: 'ABC234',
		grid: DEFAULT_GRID,
		players: [{ id: 'gm', name: 'Gemma', role: 'gm', connected: true }],
		tokens: []
	};
}

describe('applyRoomUpdate', () => {
	it('adds joined players once', () => {
		const r = room();
		const pip = { id: 'p1', name: 'Pip', role: 'player' as const, connected: true };
		applyRoomUpdate(r, { type: 'player_joined', player: pip });
		applyRoomUpdate(r, { type: 'player_joined', player: pip });
		expect(r.players.map((p) => p.id)).toEqual(['gm', 'p1']);
	});

	it('tracks presence', () => {
		const r = room();
		applyRoomUpdate(r, { type: 'player_presence', playerId: 'gm', connected: false });
		expect(r.players[0].connected).toBe(false);
	});

	it('ignores non-room messages', () => {
		const r = room();
		expect(applyRoomUpdate(r, { type: 'error', code: 'server_error', message: 'x' })).toBe(false);
		expect(r).toEqual(room());
	});

	it('adds, replaces, moves and deletes tokens', () => {
		const r = room();
		const token = { id: 't1', name: 'Orc', color: '#c0392b', pos: { x: 0, y: 0 }, ownerId: null };
		applyRoomUpdate(r, { type: 'token_upserted', token });
		applyRoomUpdate(r, { type: 'token_upserted', token: { ...token, name: 'Orc chief' } });
		expect(r.tokens).toHaveLength(1);
		expect(r.tokens[0].name).toBe('Orc chief');

		applyRoomUpdate(r, {
			type: 'token_moved',
			tokenId: 't1',
			pos: { x: 3, y: 4 },
			byPlayerId: 'gm'
		});
		expect(r.tokens[0].pos).toEqual({ x: 3, y: 4 });

		applyRoomUpdate(r, { type: 'token_deleted', tokenId: 't1' });
		expect(r.tokens).toEqual([]);
	});

	it('ignores moves and deletes for unknown tokens', () => {
		const r = room();
		applyRoomUpdate(r, {
			type: 'token_moved',
			tokenId: 'nope',
			pos: { x: 1, y: 1 },
			byPlayerId: 'gm'
		});
		applyRoomUpdate(r, { type: 'token_deleted', tokenId: 'nope' });
		expect(r).toEqual(room());
	});
});
