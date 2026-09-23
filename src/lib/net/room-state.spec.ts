import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID } from '$lib/game/grid';
import type { RoomSnapshot } from '$lib/game/protocol';
import { applyRoomUpdate } from './room-state';

function room(): RoomSnapshot {
	return {
		id: 'ABC234',
		grid: DEFAULT_GRID,
		players: [{ id: 'gm', name: 'Gemma', role: 'gm', connected: true }]
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
});
