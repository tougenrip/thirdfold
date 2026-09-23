import { describe, expect, it } from 'vitest';
import { MAX_TOKENS_PER_ROOM } from '../src/lib/game/token';
import { RoomManager, type Player, type Room } from './rooms';
import { createToken, deleteToken, moveToken, updateToken } from './scene';

function setup() {
	const rooms = new RoomManager();
	const created = rooms.create('Gemma');
	if (!created.ok) throw new Error(created.message);
	const { room, player: gm } = created;
	const seat = (name: string, role: 'player' | 'spectator'): Player => {
		const r = rooms.join(room.id, name, role);
		if (!r.ok) throw new Error(r.message);
		return r.player;
	};
	return {
		room,
		gm,
		pip: seat('Pip', 'player'),
		ivy: seat('Ivy', 'player'),
		sam: seat('Sam', 'spectator')
	};
}

function place(room: Room, gm: Player, x: number, y: number, ownerId: string | null = null) {
	const r = createToken(room, gm, { name: `T${x}${y}`, color: '#2e86c1', pos: { x, y }, ownerId });
	if (!r.ok) throw new Error(r.message);
	return r.token;
}

describe('createToken', () => {
	it('lets the GM place a token and assign it to a player', () => {
		const { room, gm, pip } = setup();
		const token = place(room, gm, 2, 3, pip.id);
		expect(room.tokens.get(token.id)).toMatchObject({ pos: { x: 2, y: 3 }, ownerId: pip.id });
	});

	it('refuses non-GMs', () => {
		const { room, pip, sam } = setup();
		for (const actor of [pip, sam]) {
			expect(
				createToken(room, actor, {
					name: 'X',
					color: '#000000',
					pos: { x: 0, y: 0 },
					ownerId: null
				})
			).toMatchObject({ ok: false, code: 'forbidden' });
		}
		expect(room.tokens.size).toBe(0);
	});

	it('validates cell, name and owner', () => {
		const { room, gm, sam } = setup();
		place(room, gm, 0, 0);
		const base = { name: 'X', color: '#000000', pos: { x: 1, y: 1 }, ownerId: null };
		expect(createToken(room, gm, { ...base, pos: { x: 0, y: 0 } })).toMatchObject({
			code: 'cell_occupied'
		});
		expect(createToken(room, gm, { ...base, pos: { x: 20, y: 0 } })).toMatchObject({
			code: 'invalid_position'
		});
		expect(createToken(room, gm, { ...base, name: ' ' })).toMatchObject({ code: 'invalid_name' });
		expect(createToken(room, gm, { ...base, ownerId: sam.id })).toMatchObject({
			code: 'invalid_owner'
		});
		expect(createToken(room, gm, { ...base, ownerId: 'nobody' })).toMatchObject({
			code: 'invalid_owner'
		});
		expect(room.tokens.size).toBe(1);
	});

	it('caps tokens per room', () => {
		const { room, gm } = setup();
		for (let i = 0; i < MAX_TOKENS_PER_ROOM; i++) place(room, gm, i % 20, Math.floor(i / 20));
		expect(
			createToken(room, gm, {
				name: 'One more',
				color: '#000000',
				pos: { x: 19, y: 19 },
				ownerId: null
			})
		).toMatchObject({ ok: false, code: 'limit_reached' });
	});
});

describe('moveToken', () => {
	it('lets an owner move their token', () => {
		const { room, gm, pip } = setup();
		const token = place(room, gm, 0, 0, pip.id);
		expect(moveToken(room, pip, token.id, { x: 5, y: 5 })).toMatchObject({ ok: true });
		expect(token.pos).toEqual({ x: 5, y: 5 });
	});

	it('refuses a player moving a token they do not own, leaving it in place', () => {
		const { room, gm, pip, ivy } = setup();
		const pipsToken = place(room, gm, 0, 0, pip.id);
		const npc = place(room, gm, 1, 0);
		expect(moveToken(room, ivy, pipsToken.id, { x: 5, y: 5 })).toMatchObject({
			ok: false,
			code: 'forbidden'
		});
		expect(moveToken(room, pip, npc.id, { x: 5, y: 5 })).toMatchObject({
			ok: false,
			code: 'forbidden'
		});
		expect(pipsToken.pos).toEqual({ x: 0, y: 0 });
		expect(npc.pos).toEqual({ x: 1, y: 0 });
	});

	it('refuses spectators', () => {
		const { room, gm, sam } = setup();
		const token = place(room, gm, 0, 0);
		expect(moveToken(room, sam, token.id, { x: 1, y: 1 })).toMatchObject({ code: 'forbidden' });
	});

	it('lets the GM move any token but not off the grid or onto another token', () => {
		const { room, gm, pip } = setup();
		const a = place(room, gm, 0, 0, pip.id);
		place(room, gm, 1, 1);
		expect(moveToken(room, gm, a.id, { x: 3, y: 3 })).toMatchObject({ ok: true });
		expect(moveToken(room, gm, a.id, { x: 1, y: 1 })).toMatchObject({ code: 'cell_occupied' });
		expect(moveToken(room, gm, a.id, { x: -1, y: 0 })).toMatchObject({ code: 'invalid_position' });
		expect(moveToken(room, gm, a.id, { x: 3, y: 3 })).toMatchObject({ ok: true });
		expect(moveToken(room, gm, 'missing', { x: 0, y: 0 })).toMatchObject({
			code: 'token_not_found'
		});
	});
});

describe('updateToken / deleteToken', () => {
	it('reassigns ownership, which changes who may move it', () => {
		const { room, gm, pip, ivy } = setup();
		const token = place(room, gm, 0, 0, pip.id);
		expect(updateToken(room, gm, token.id, { ownerId: ivy.id })).toMatchObject({ ok: true });
		expect(moveToken(room, pip, token.id, { x: 1, y: 0 })).toMatchObject({ code: 'forbidden' });
		expect(moveToken(room, ivy, token.id, { x: 1, y: 0 })).toMatchObject({ ok: true });
	});

	it('applies nothing when any field is invalid', () => {
		const { room, gm, sam } = setup();
		const token = place(room, gm, 0, 0);
		expect(updateToken(room, gm, token.id, { name: 'Renamed', ownerId: sam.id })).toMatchObject({
			code: 'invalid_owner'
		});
		expect(token.name).toBe('T00');
	});

	it('refuses players trying to claim or delete tokens', () => {
		const { room, gm, pip } = setup();
		const token = place(room, gm, 0, 0);
		expect(updateToken(room, pip, token.id, { ownerId: pip.id })).toMatchObject({
			code: 'forbidden'
		});
		expect(deleteToken(room, pip, token.id)).toMatchObject({ code: 'forbidden' });
		expect(token.ownerId).toBeNull();
		expect(deleteToken(room, gm, token.id)).toMatchObject({ ok: true });
		expect(room.tokens.size).toBe(0);
	});
});
