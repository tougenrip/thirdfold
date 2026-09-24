import { describe, expect, it } from 'vitest';
import { normalizeName, parseClientMessage, parseServerMessage } from './protocol';

const token = 'a'.repeat(64);

describe('parseClientMessage', () => {
	it('accepts well-formed messages', () => {
		expect(parseClientMessage({ type: 'create', name: 'Ada' })).toEqual({
			type: 'create',
			name: 'Ada'
		});
		expect(
			parseClientMessage({ type: 'join', roomId: 'ABC234', name: 'Bo', role: 'player' })
		).toEqual({ type: 'join', roomId: 'ABC234', name: 'Bo', role: 'player' });
		expect(parseClientMessage({ type: 'resume', roomId: 'ABC234', sessionToken: token })).toEqual({
			type: 'resume',
			roomId: 'ABC234',
			sessionToken: token
		});
	});

	it('drops unknown fields', () => {
		expect(parseClientMessage({ type: 'create', name: 'Ada', role: 'gm' })).toEqual({
			type: 'create',
			name: 'Ada'
		});
	});

	it.each([
		['non-object', 'create'],
		['array', [{ type: 'create', name: 'x' }]],
		['null', null],
		['unknown type', { type: 'nuke' }],
		['missing name', { type: 'create' }],
		['numeric name', { type: 'create', name: 42 }],
		['join as gm', { type: 'join', roomId: 'ABC234', name: 'Bo', role: 'gm' }],
		['bad room id', { type: 'join', roomId: 'abc', name: 'Bo', role: 'player' }],
		['bad token', { type: 'resume', roomId: 'ABC234', sessionToken: 'nope' }]
	])('rejects %s', (_label, input) => {
		expect(parseClientMessage(input)).toBeNull();
	});
});

describe('normalizeName', () => {
	it('trims and strips control characters', () => {
		expect(normalizeName('  Ada\u0000\n ')).toBe('Ada');
	});

	it('rejects empty, oversized and non-string names', () => {
		expect(normalizeName('   ')).toBeNull();
		expect(normalizeName('x'.repeat(33))).toBeNull();
		expect(normalizeName(undefined)).toBeNull();
	});
});

describe('token messages', () => {
	it('accepts well-formed token actions', () => {
		expect(
			parseClientMessage({
				type: 'token_create',
				name: 'Orc',
				color: '#c0392b',
				pos: { x: 1, y: 2 },
				ownerId: null
			})
		).toEqual({
			type: 'token_create',
			name: 'Orc',
			color: '#c0392b',
			pos: { x: 1, y: 2 },
			ownerId: null
		});
		expect(parseClientMessage({ type: 'token_move', tokenId: 't', to: { x: 0, y: 3 } })).toEqual({
			type: 'token_move',
			tokenId: 't',
			to: { x: 0, y: 3 }
		});
		expect(
			parseClientMessage({ type: 'token_update', tokenId: 't', patch: { ownerId: null, hp: 3 } })
		).toEqual({ type: 'token_update', tokenId: 't', patch: { ownerId: null } });
		expect(
			parseClientMessage({ type: 'token_update', tokenId: 't', patch: { hidden: true } })
		).toEqual({ type: 'token_update', tokenId: 't', patch: { hidden: true } });
		expect(
			parseClientMessage({ type: 'prop_update', propId: 'p', patch: { hidden: false } })
		).toEqual({ type: 'prop_update', propId: 'p', patch: { hidden: false } });
		expect(parseClientMessage({ type: 'fog_room', cell: { x: 3, y: 4 }, reveal: true })).toEqual({
			type: 'fog_room',
			cell: { x: 3, y: 4 },
			reveal: true
		});
		expect(parseClientMessage({ type: 'fog_share', shared: false })).toEqual({
			type: 'fog_share',
			shared: false
		});
	});

	it.each([
		['missing owner', { type: 'token_create', name: 'O', color: '#000000', pos: { x: 0, y: 0 } }],
		[
			'uppercase colour',
			{ type: 'token_create', name: 'O', color: '#FFFFFF', pos: { x: 0, y: 0 }, ownerId: null }
		],
		['NaN cell', { type: 'token_move', tokenId: 't', to: { x: NaN, y: 0 } }],
		['huge cell', { type: 'token_move', tokenId: 't', to: { x: 2 ** 60, y: 0 } }],
		['empty token id', { type: 'token_delete', tokenId: '' }],
		['oversized token id', { type: 'token_delete', tokenId: 'x'.repeat(65) }],
		['bad patch colour', { type: 'token_update', tokenId: 't', patch: { color: 'red' } }],
		['non-boolean hidden', { type: 'token_update', tokenId: 't', patch: { hidden: 'yes' } }],
		['fog_room without reveal', { type: 'fog_room', cell: { x: 0, y: 0 } }],
		['fog_room fractional cell', { type: 'fog_room', cell: { x: 0.5, y: 0 }, reveal: true }],
		['fog_share non-boolean', { type: 'fog_share', shared: 1 }]
	])('rejects %s', (_label, input) => {
		expect(parseClientMessage(input)).toBeNull();
	});
});

describe('parseServerMessage', () => {
	it('accepts known messages and rejects prototype keys as types', () => {
		expect(parseServerMessage({ type: 'token_deleted', tokenId: 't' })).not.toBeNull();
		expect(parseServerMessage({ type: 'toString' })).toBeNull();
		expect(parseServerMessage({ type: '__proto__' })).toBeNull();
		expect(
			parseServerMessage({ type: 'token_moved', tokenId: 't', pos: { x: 'a', y: 0 } })
		).toBeNull();
	});
});

describe('adventure messages', () => {
	it('accepts well-formed adventure actions and drops extra fields', () => {
		expect(parseClientMessage({ type: 'adventure_start', adventureId: 'x' })).toEqual({
			type: 'adventure_start'
		});
		expect(parseClientMessage({ type: 'adventure_claim', characterId: 'veil' })).toEqual({
			type: 'adventure_claim',
			characterId: 'veil'
		});
		expect(parseClientMessage({ type: 'adventure_act', actionId: 'mend', targetId: 't1' })).toEqual(
			{
				type: 'adventure_act',
				actionId: 'mend',
				targetId: 't1'
			}
		);
		expect(
			parseClientMessage({ type: 'adventure_act', actionId: 'shield-wall', targetId: null })
		).toEqual({ type: 'adventure_act', actionId: 'shield-wall', targetId: null });
		expect(
			parseClientMessage({
				type: 'adventure_override',
				characterId: 'saint',
				patch: { hp: 4, statuses: ['guarded', 'guarded'], revive: true, extra: 1 }
			})
		).toEqual({
			type: 'adventure_override',
			characterId: 'saint',
			patch: { hp: 4, statuses: ['guarded'], revive: true }
		});
		expect(parseClientMessage({ type: 'adventure_control', op: 'restart' })).toEqual({
			type: 'adventure_control',
			op: 'restart'
		});
		expect(parseClientMessage({ type: 'adventure_narrate', text: 'Hush.' })).toEqual({
			type: 'adventure_narrate',
			text: 'Hush.'
		});
	});

	it('rejects unknown characters, controls and malformed targets', () => {
		expect(parseClientMessage({ type: 'adventure_claim', characterId: 'wizard' })).toBeNull();
		expect(parseClientMessage({ type: 'adventure_claim', characterId: 'toString' })).toBeNull();
		expect(parseClientMessage({ type: 'adventure_control', op: 'win' })).toBeNull();
		expect(parseClientMessage({ type: 'adventure_control', op: 'end_turn' })).toEqual({
			type: 'adventure_control',
			op: 'end_turn'
		});
		// The old players'-phase control is gone with turn order.
		expect(parseClientMessage({ type: 'adventure_control', op: 'end_round' })).toBeNull();
		expect(parseClientMessage({ type: 'adventure_interact', targetId: 'chest' })).toEqual({
			type: 'adventure_interact',
			targetId: 'chest',
			verb: null
		});
		expect(
			parseClientMessage({ type: 'adventure_interact', targetId: 'chest', verb: 'open' })
		).toMatchObject({ verb: 'open' });
		expect(
			parseClientMessage({ type: 'adventure_interact', targetId: 'chest', verb: 3 })
		).toBeNull();
		expect(
			parseClientMessage({ type: 'adventure_object', objectId: 'gate', state: 'opened' })
		).toEqual({ type: 'adventure_object', objectId: 'gate', state: 'opened' });
		expect(
			parseClientMessage({ type: 'adventure_object', objectId: 'gate', state: 'melted' })
		).toBeNull();
		expect(parseClientMessage({ type: 'adventure_act', actionId: 'blade' })).toBeNull();
		for (const patch of [
			{},
			{ hp: -1 },
			{ hp: 2.5 },
			{ statuses: ['cursed'] },
			{ revive: false }
		]) {
			expect(
				parseClientMessage({ type: 'adventure_override', characterId: 'veil', patch })
			).toBeNull();
		}
		expect(parseClientMessage({ type: 'adventure_interact', targetId: '' })).toBeNull();
		expect(parseClientMessage({ type: 'adventure_cue', cueId: 7 })).toBeNull();
		expect(parseClientMessage({ type: 'adventure_narrate' })).toBeNull();
	});

	it('parses answers to a choice, and only well-formed ones', () => {
		expect(
			parseClientMessage({ type: 'adventure_decide', decisionId: 'bell', optionId: 'ring' })
		).toEqual({ type: 'adventure_decide', decisionId: 'bell', optionId: 'ring' });
		for (const bad of [
			{ decisionId: 'bell' },
			{ decisionId: 'bell', optionId: 3 },
			{ decisionId: '', optionId: 'ring' },
			{ decisionId: 'bell', optionId: 'x'.repeat(500) }
		]) {
			expect(parseClientMessage({ type: 'adventure_decide', ...bad })).toBeNull();
		}
	});

	it('parses listening, looking around and sharing evidence', () => {
		expect(parseClientMessage({ type: 'adventure_sense', sense: 'listen' })).toEqual({
			type: 'adventure_sense',
			sense: 'listen'
		});
		expect(parseClientMessage({ type: 'adventure_sense', sense: 'observe' })).not.toBeNull();
		expect(parseClientMessage({ type: 'adventure_sense', sense: 'search' })).toBeNull();
		expect(parseClientMessage({ type: 'adventure_share', clueId: 'rope' })).toEqual({
			type: 'adventure_share',
			clueId: 'rope'
		});
		expect(parseClientMessage({ type: 'adventure_share', clueId: '' })).toBeNull();
	});

	it('parses the GM shaping the ground, within the levels there are', () => {
		const from = { x: 1, y: 2 };
		const to = { x: 3, y: 4 };
		expect(parseClientMessage({ type: 'terrain_set', from, to, level: 5 })).toEqual({
			type: 'terrain_set',
			from,
			to,
			level: 5
		});
		for (const level of [-1, 2.5, 41, '5', null]) {
			expect(parseClientMessage({ type: 'terrain_set', from, to, level })).toBeNull();
		}
		expect(parseClientMessage({ type: 'terrain_set', from, level: 1 })).toBeNull();
		expect(parseServerMessage({ type: 'terrain_update', terrain: null })).not.toBeNull();
		expect(parseServerMessage({ type: 'terrain_update', terrain: 5 })).toBeNull();
	});

	it('accepts adventure updates, including the adventure ending', () => {
		expect(parseServerMessage({ type: 'adventure_update', adventure: null })).not.toBeNull();
		expect(parseServerMessage({ type: 'adventure_update', adventure: 'x' })).toBeNull();
	});
});
