import { describe, expect, it } from 'vitest';
import { LOG_LIMIT } from '$lib/game/chat';
import { DEFAULT_GRID } from '$lib/game/grid';
import type { RoomSnapshot } from '$lib/game/protocol';
import { applyRoomUpdate } from './room-state';

function room(): RoomSnapshot {
	return {
		id: 'ABC234',
		sceneName: 'Untitled scene',
		grid: DEFAULT_GRID,
		players: [{ id: 'gm', name: 'Gemma', role: 'gm', connected: true }],
		tokens: [],
		objects: [],
		props: [],
		lights: [],
		ambient: 'day',
		fog: { enabled: false, shared: false, visible: '', explored: '' },
		log: [],
		adventure: null,
		terrain: null,
		darkness: null,
		paused: false
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

	it('follows the GM pausing the game and carrying on', () => {
		const r = room();
		expect(applyRoomUpdate(r, { type: 'pause_update', paused: true })).toBe(true);
		expect(r.paused).toBe(true);
		applyRoomUpdate(r, { type: 'pause_update', paused: false });
		expect(r.paused).toBe(false);
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
		const token = {
			id: 't1',
			name: 'Orc',
			color: '#c0392b',
			pos: { x: 0, y: 0 },
			ownerId: null,
			vision: 6,
			light: 0
		};
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

	it('appends log entries in order, skips duplicates and keeps the cap', () => {
		const r = room();
		for (let seq = 1; seq <= LOG_LIMIT + 3; seq++) {
			applyRoomUpdate(r, {
				type: 'chat',
				message: { seq, at: 0, kind: 'system', text: `n${seq}` }
			});
		}
		applyRoomUpdate(r, {
			type: 'chat',
			message: { seq: 5, at: 0, kind: 'system', text: 'late dup' }
		});
		expect(r.log).toHaveLength(LOG_LIMIT);
		expect(r.log[0].seq).toBe(4);
		expect(r.log.at(-1)?.seq).toBe(LOG_LIMIT + 3);
	});

	it('applies object upserts and removals together', () => {
		const r = room();
		const wall = { id: 'w', kind: 'wall' as const, a: { x: 5, y: 0 }, b: { x: 5, y: 10 } };
		applyRoomUpdate(r, { type: 'objects_changed', upserted: [wall], removed: [] });
		applyRoomUpdate(r, {
			type: 'objects_changed',
			upserted: [
				{ ...wall, b: { x: 5, y: 4 } },
				{ id: 'd', kind: 'door', a: { x: 5, y: 4 }, b: { x: 5, y: 5 }, open: false }
			],
			removed: []
		});
		expect(r.objects).toHaveLength(2);
		expect(r.objects.find((o) => o.id === 'w')?.b).toEqual({ x: 5, y: 4 });
		applyRoomUpdate(r, { type: 'objects_changed', upserted: [], removed: ['w', 'unknown'] });
		expect(r.objects.map((o) => o.id)).toEqual(['d']);
	});

	it('replaces the fog view', () => {
		const r = room();
		const fog = { enabled: true, shared: true, visible: 'AQ==', explored: 'Aw==' };
		applyRoomUpdate(r, { type: 'fog_update', fog });
		expect(r.fog).toEqual(fog);
	});

	it('applies light changes and the ambient level', () => {
		const r = room();
		const lamp = { id: 'l1', pos: { x: 1, y: 1 }, radius: 3, color: '#ffa04d', on: true };
		applyRoomUpdate(r, { type: 'lights_changed', upserted: [lamp], removed: [] });
		applyRoomUpdate(r, { type: 'lights_changed', upserted: [{ ...lamp, on: false }], removed: [] });
		expect(r.lights).toEqual([{ ...lamp, on: false }]);
		applyRoomUpdate(r, { type: 'lights_changed', upserted: [], removed: ['l1'] });
		expect(r.lights).toEqual([]);
		applyRoomUpdate(r, { type: 'ambient_update', ambient: 'dark' });
		expect(r.ambient).toBe('dark');
	});

	it('applies prop changes', () => {
		const r = room();
		const crate = {
			id: 'p1',
			assetId: 'crate' as const,
			pos: { x: 1, y: 1 },
			rotation: 0 as const,
			scale: 1
		};
		applyRoomUpdate(r, { type: 'props_changed', upserted: [crate], removed: [] });
		applyRoomUpdate(r, {
			type: 'props_changed',
			upserted: [{ ...crate, rotation: 2 }],
			removed: []
		});
		expect(r.props).toEqual([{ ...crate, rotation: 2 }]);
		applyRoomUpdate(r, { type: 'props_changed', upserted: [], removed: ['p1'] });
		expect(r.props).toEqual([]);
	});

	it('replaces the adventure state, and clears it when the adventure ends', () => {
		const r = room();
		const adventure = {
			id: 'hollow-bell' as const,
			title: 'The Hollow Bell',
			stage: 'playing' as const,
			chapter: { id: 'village' as const, title: 'The quiet village', number: 1, of: 13 },
			location: { id: 'bellweather' as const, name: 'Bellweather' },
			objectives: [],
			clues: [],
			characters: [],
			interactables: [],
			objects: null,
			encounter: null,
			decision: null,
			decisions: [],
			ending: null,
			ledger: null,
			director: null,
			welcome: { title: 'Welcome', text: 'Hello.' },
			firstFind: null,
			begunAt: 1,
			completedAt: null,
			cues: null
		};
		expect(applyRoomUpdate(r, { type: 'adventure_update', adventure })).toBe(true);
		expect(r.adventure).toEqual(adventure);
		applyRoomUpdate(r, { type: 'adventure_update', adventure: null });
		expect(r.adventure).toBeNull();
	});
});
