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
		['bad patch colour', { type: 'token_update', tokenId: 't', patch: { color: 'red' } }]
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
