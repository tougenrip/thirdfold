import { describe, expect, it } from 'vitest';
import { canEditScene, canMoveToken } from './permissions';
import type { Token } from './token';

const token = (ownerId: string | null): Token => ({
	id: 't1',
	name: 'Goblin',
	color: '#c0392b',
	pos: { x: 0, y: 0 },
	ownerId
});

describe('canMoveToken', () => {
	it('lets the GM move any token', () => {
		expect(canMoveToken({ id: 'gm', role: 'gm' }, token(null))).toBe(true);
		expect(canMoveToken({ id: 'gm', role: 'gm' }, token('p1'))).toBe(true);
	});

	it('lets a player move only tokens they own', () => {
		const pip = { id: 'p1', role: 'player' as const };
		expect(canMoveToken(pip, token('p1'))).toBe(true);
		expect(canMoveToken(pip, token('p2'))).toBe(false);
		expect(canMoveToken(pip, token(null))).toBe(false);
	});

	it('never lets a spectator move, even a token assigned to their id', () => {
		expect(canMoveToken({ id: 's1', role: 'spectator' }, token('s1'))).toBe(false);
	});
});

describe('canEditScene', () => {
	it('is GM-only', () => {
		expect(canEditScene({ id: 'gm', role: 'gm' })).toBe(true);
		expect(canEditScene({ id: 'p1', role: 'player' })).toBe(false);
		expect(canEditScene({ id: 's1', role: 'spectator' })).toBe(false);
	});
});
