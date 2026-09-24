import { describe, expect, it } from 'vitest';
import { canEditScene, canMoveToken, canUseDoor } from './permissions';
import type { Token } from './token';

const token = (ownerId: string | null): Token => ({
	id: 't1',
	name: 'Goblin',
	color: '#c0392b',
	pos: { x: 0, y: 0 },
	ownerId,
	vision: 6,
	light: 0
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

describe('canUseDoor', () => {
	const grid = { kind: 'square' as const, cellSize: 1, width: 10, height: 10 };
	const door = {
		id: 'd',
		kind: 'door' as const,
		a: { x: 5, y: 4 },
		b: { x: 5, y: 5 },
		open: false
	};
	const at = (x: number, y: number, ownerId: string | null): Token => ({
		...token(ownerId),
		pos: { x, y }
	});

	it('needs an owned token on either side of the door', () => {
		const pip = { id: 'p1', role: 'player' as const };
		expect(canUseDoor(pip, door, [at(4, 4, 'p1')], grid)).toBe(true);
		expect(canUseDoor(pip, door, [at(5, 4, 'p1')], grid)).toBe(true);
		expect(canUseDoor(pip, door, [at(4, 5, 'p1')], grid)).toBe(false);
		expect(canUseDoor(pip, door, [at(4, 4, 'p2')], grid)).toBe(false);
	});

	it('always allows the GM and never a spectator', () => {
		expect(canUseDoor({ id: 'gm', role: 'gm' }, door, [], grid)).toBe(true);
		expect(canUseDoor({ id: 's', role: 'spectator' }, door, [at(4, 4, 's')], grid)).toBe(false);
	});
});
