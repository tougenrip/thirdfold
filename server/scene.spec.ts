import { describe, expect, it } from 'vitest';
import { MAX_TOKENS_PER_ROOM } from '../src/lib/game/token';
import { RoomManager, type Player, type Room } from './rooms';
import {
	createObject,
	createProp,
	createToken,
	deleteObject,
	deleteProp,
	deleteToken,
	moveToken,
	toggleDoor,
	updateProp,
	updateToken
} from './scene';

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

describe('walls and doors', () => {
	const c = (x: number, y: number) => ({ x, y });

	function build(
		room: Room,
		gm: Player,
		kind: 'wall' | 'door',
		a: [number, number],
		b: [number, number]
	) {
		const r = createObject(room, gm, kind, c(...a), c(...b));
		if (!r.ok) throw new Error(r.message);
		return r;
	}

	it('lets only the GM build, and validates the segment', () => {
		const { room, gm, pip } = setup();
		expect(createObject(room, pip, 'wall', c(0, 0), c(3, 0))).toMatchObject({ code: 'forbidden' });
		expect(createObject(room, gm, 'wall', c(0, 0), c(3, 3))).toMatchObject({
			code: 'invalid_object'
		});
		expect(createObject(room, gm, 'wall', c(0, 0), c(21, 0))).toMatchObject({
			code: 'invalid_object'
		});
		expect(createObject(room, gm, 'door', c(0, 0), c(2, 0))).toMatchObject({
			code: 'invalid_object'
		});
		expect(build(room, gm, 'wall', [3, 0], [0, 0]).upserted[0]).toMatchObject({
			a: c(0, 0),
			b: c(3, 0)
		});
		expect(room.objects.size).toBe(1);
	});

	it('cuts a doorway when a door is placed in a wall', () => {
		const { room, gm } = setup();
		const wallId = build(room, gm, 'wall', [5, 0], [5, 10]).upserted[0].id;
		const r = build(room, gm, 'door', [5, 4], [5, 5]);
		expect(r.removed).toEqual([]);
		expect(r.upserted.map((o) => [o.kind, o.a, o.b])).toEqual([
			['wall', c(5, 0), c(5, 4)],
			['wall', c(5, 5), c(5, 10)],
			['door', c(5, 4), c(5, 5)]
		]);
		expect(r.upserted[0].id).toBe(wallId);
		expect(room.objects.size).toBe(3);
		expect(createObject(room, gm, 'door', c(5, 4), c(5, 5))).toMatchObject({
			code: 'edge_occupied'
		});
		expect(createObject(room, gm, 'wall', c(5, 2), c(5, 6))).toMatchObject({
			code: 'edge_occupied'
		});
	});

	it('removes a one-square wall entirely when a door replaces it', () => {
		const { room, gm } = setup();
		const wallId = build(room, gm, 'wall', [2, 2], [3, 2]).upserted[0].id;
		expect(build(room, gm, 'door', [2, 2], [3, 2]).removed).toEqual([wallId]);
		expect([...room.objects.values()].map((o) => o.kind)).toEqual(['door']);
	});

	it('stops players walking through walls and closed doors, but not the GM', () => {
		const { room, gm, pip } = setup();
		build(room, gm, 'wall', [5, 0], [5, 20]);
		const door = build(room, gm, 'door', [5, 4], [5, 5]).upserted.at(-1)!;
		const hero = place(room, gm, 4, 4, pip.id);

		expect(moveToken(room, pip, hero.id, c(8, 8))).toMatchObject({ ok: false, code: 'no_path' });
		expect(hero.pos).toEqual(c(4, 4));

		expect(toggleDoor(room, pip, door.id)).toMatchObject({ ok: true, door: { open: true } });
		expect(moveToken(room, pip, hero.id, c(8, 8))).toMatchObject({ ok: true });

		const npc = place(room, gm, 0, 0);
		toggleDoor(room, gm, door.id);
		expect(moveToken(room, gm, npc.id, c(9, 9))).toMatchObject({ ok: true });
	});

	it('lets a player use a door only with their own token beside it', () => {
		const { room, gm, pip, ivy, sam } = setup();
		const door = build(room, gm, 'door', [5, 4], [5, 5]).upserted[0];
		place(room, gm, 4, 4, pip.id); // west of the door
		place(room, gm, 7, 4, ivy.id); // two cells east: too far

		expect(toggleDoor(room, ivy, door.id)).toMatchObject({ ok: false, code: 'forbidden' });
		expect(toggleDoor(room, sam, door.id)).toMatchObject({ ok: false, code: 'forbidden' });
		expect(toggleDoor(room, pip, door.id)).toMatchObject({ ok: true });
		expect(toggleDoor(room, gm, door.id)).toMatchObject({ ok: true, door: { open: false } });
		expect(toggleDoor(room, gm, 'nope')).toMatchObject({ code: 'object_not_found' });
	});

	it('deletes objects GM-only', () => {
		const { room, gm, pip } = setup();
		const wall = build(room, gm, 'wall', [0, 1], [4, 1]).upserted[0];
		expect(deleteObject(room, pip, wall.id)).toMatchObject({ code: 'forbidden' });
		expect(deleteObject(room, gm, wall.id)).toMatchObject({ ok: true });
		expect(deleteObject(room, gm, wall.id)).toMatchObject({ code: 'object_not_found' });
	});
});

describe('props', () => {
	const c = (x: number, y: number) => ({ x, y });

	function placeProp(
		room: Room,
		gm: Player,
		assetId: Parameters<typeof createProp>[2]['assetId'],
		x: number,
		y: number,
		rotation: 0 | 1 | 2 | 3 = 0
	) {
		const r = createProp(room, gm, { assetId, pos: c(x, y), rotation });
		if (!r.ok) throw new Error(r.message);
		return r.prop;
	}

	it('lets only the GM place, arrange and remove props', () => {
		const { room, gm, pip } = setup();
		expect(createProp(room, pip, { assetId: 'crate', pos: c(1, 1), rotation: 0 })).toMatchObject({
			code: 'forbidden'
		});
		const crate = placeProp(room, gm, 'crate', 1, 1);
		expect(updateProp(room, pip, crate.id, { pos: c(2, 2) })).toMatchObject({ code: 'forbidden' });
		expect(deleteProp(room, pip, crate.id)).toMatchObject({ code: 'forbidden' });
		expect(deleteProp(room, gm, crate.id)).toMatchObject({ ok: true });
		expect(deleteProp(room, gm, crate.id)).toMatchObject({ code: 'prop_not_found' });
	});

	it('keeps footprints on the table, including after rotating', () => {
		const { room, gm } = setup();
		expect(createProp(room, gm, { assetId: 'table', pos: c(19, 0), rotation: 0 })).toMatchObject({
			code: 'invalid_position'
		});
		const table = placeProp(room, gm, 'table', 19, 0, 1);
		expect(updateProp(room, gm, table.id, { rotation: 0 })).toMatchObject({
			code: 'invalid_position'
		});
		expect(table.rotation).toBe(1);
	});

	it('will not put a blocking prop on a token or another blocking prop, but rugs go anywhere', () => {
		const { room, gm, pip } = setup();
		place(room, gm, 3, 3, pip.id);
		expect(createProp(room, gm, { assetId: 'crate', pos: c(3, 3), rotation: 0 })).toMatchObject({
			code: 'cell_occupied'
		});
		placeProp(room, gm, 'rug', 2, 2);
		const table = placeProp(room, gm, 'table', 5, 5);
		expect(createProp(room, gm, { assetId: 'barrel', pos: c(6, 5), rotation: 0 })).toMatchObject({
			code: 'cell_occupied'
		});
		expect(createProp(room, gm, { assetId: 'chair', pos: c(6, 5), rotation: 0 })).toMatchObject({
			ok: true
		});
		// Moving a prop onto its own old footprint is fine.
		expect(updateProp(room, gm, table.id, { pos: c(6, 5) })).toMatchObject({ ok: true });
	});

	it('blocks tokens from standing in or walking through solid props', () => {
		const { room, gm, pip } = setup();
		const hero = place(room, gm, 4, 4, pip.id);
		// A wall of bookshelves across the room, with a gap at x=10..11.
		for (const x of [0, 2, 4, 6, 8, 12, 14, 16, 18]) placeProp(room, gm, 'bookshelf', x, 6);
		expect(moveToken(room, pip, hero.id, c(4, 6))).toMatchObject({ code: 'cell_occupied' });
		expect(moveToken(room, pip, hero.id, c(4, 9))).toMatchObject({ ok: true }); // via the gap
		placeProp(room, gm, 'crate', 10, 6);
		placeProp(room, gm, 'crate', 11, 6);
		expect(moveToken(room, pip, hero.id, c(4, 2))).toMatchObject({ code: 'no_path' });
		expect(
			createToken(room, gm, { name: 'Ghost', color: '#ecf0f1', pos: c(10, 6), ownerId: null })
		).toMatchObject({
			code: 'cell_occupied'
		});
	});
});
