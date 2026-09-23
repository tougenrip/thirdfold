import { describe, expect, it } from 'vitest';
import { normalizeName, parseClientMessage } from './protocol';

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
		expect(parseClientMessage({ type: 'resume', roomId: 'ABC234', token })).toEqual({
			type: 'resume',
			roomId: 'ABC234',
			token
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
		['bad token', { type: 'resume', roomId: 'ABC234', token: 'nope' }]
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
