import { describe, expect, it } from 'vitest';
import { decodeMask } from '../src/lib/game/visibility';
import { RoomManager, type Player, type Room } from './rooms';
import { postSystem } from './chat';
import {
	createLight,
	createObject,
	createToken,
	fogArea,
	moveToken,
	setAmbient,
	setFog,
	toggleDoor,
	updateLight,
	updateToken
} from './scene';
import { diffView, sentFrom, snapshotFor, viewFor } from './views';

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

function token(
	room: Room,
	gm: Player,
	name: string,
	x: number,
	y: number,
	ownerId: string | null = null
) {
	const r = createToken(room, gm, { name, color: '#c0392b', pos: { x, y }, ownerId });
	if (!r.ok) throw new Error(r.message);
	return r.token;
}

const names = (room: Room, viewer: Player) =>
	viewFor(room, viewer)
		.tokens.map((t) => t.name)
		.sort();
const seesCell = (room: Room, viewer: Player, x: number, y: number) =>
	decodeMask(viewFor(room, viewer).fog.visible, room.grid.width * room.grid.height)[
		y * room.grid.width + x
	] === 1;

describe('views with fog off', () => {
	it('shows everyone everything', () => {
		const { room, gm, pip } = setup();
		token(room, gm, 'Goblin', 18, 18);
		expect(names(room, pip)).toEqual(['Goblin']);
		expect(viewFor(room, pip).fog.enabled).toBe(false);
	});
});

describe('views with fog on', () => {
	function dungeon() {
		const t = setup();
		setFog(t.room, t.gm, true);
		// A wall on x=10 splits the table; a door at y 5..6.
		createObject(t.room, t.gm, 'wall', { x: 10, y: 0 }, { x: 10, y: 20 });
		const cut = createObject(t.room, t.gm, 'door', { x: 10, y: 5 }, { x: 10, y: 6 });
		const door = cut.ok ? cut.upserted.at(-1)! : null;
		const hero = token(t.room, t.gm, 'Hero', 8, 5, t.pip.id);
		const scout = token(t.room, t.gm, 'Scout', 2, 18, t.ivy.id);
		const goblin = token(t.room, t.gm, 'Goblin', 12, 5);
		const rat = token(t.room, t.gm, 'Rat', 7, 7);
		return { ...t, door: door!, hero, scout, goblin, rat };
	}

	it('shows a player their own tokens and what those can see, not what is behind walls', () => {
		const { room, pip } = dungeon();
		expect(names(room, pip)).toEqual(['Hero', 'Rat']);
		expect(seesCell(room, pip, 8, 5)).toBe(true);
		expect(seesCell(room, pip, 12, 5)).toBe(false);
	});

	it("keeps each player's vision separate", () => {
		const { room, ivy } = dungeon();
		expect(names(room, ivy)).toEqual(['Scout']);
	});

	it('opens sight through an open door', () => {
		const { room, gm, pip, door } = dungeon();
		toggleDoor(room, gm, door.id);
		expect(names(room, pip)).toEqual(['Goblin', 'Hero', 'Rat']);
	});

	it('gives spectators the whole party view and the GM everything', () => {
		const { room, gm, sam } = dungeon();
		expect(names(room, sam)).toEqual(['Hero', 'Rat', 'Scout']);
		expect(names(room, gm)).toEqual(['Goblin', 'Hero', 'Rat', 'Scout']);
		// The GM's fog view is the party's, for shading.
		expect(seesCell(room, gm, 8, 5)).toBe(true);
		expect(seesCell(room, gm, 15, 15)).toBe(false);
	});

	it('only sends walls a player has seen next to', () => {
		const { room, gm, pip } = dungeon();
		createObject(room, gm, 'wall', { x: 15, y: 15 }, { x: 18, y: 15 });
		const kinds = viewFor(room, pip).objects.map((o) => `${o.kind}:${o.a.x},${o.a.y}`);
		expect(kinds).toContain('door:10,5');
		expect(kinds).not.toContain('wall:15,15');
	});

	it('remembers explored cells after the token moves away, without showing tokens there', () => {
		const { room, gm, pip, hero, rat } = dungeon();
		viewFor(room, pip); // sees around (8,5), including the rat
		expect(moveToken(room, gm, hero.id, { x: 3, y: 15 })).toMatchObject({ ok: true });
		const view = viewFor(room, pip);
		const explored = decodeMask(view.fog.explored, 400);
		expect(explored[5 * 20 + 8]).toBe(1);
		expect(seesCell(room, pip, 8, 5)).toBe(false);
		expect(view.tokens.map((t) => t.id)).not.toContain(rat.id);
	});

	it('reveals GM areas to everyone and hiding clears what players explored', () => {
		const { room, gm, pip, ivy } = dungeon();
		fogArea(room, gm, { x: 11, y: 4 }, { x: 13, y: 6 }, true);
		expect(names(room, ivy)).toEqual(['Goblin', 'Scout']);
		fogArea(room, gm, { x: 11, y: 4 }, { x: 13, y: 6 }, false);
		expect(names(room, ivy)).toEqual(['Scout']);
		viewFor(room, pip);
		fogArea(room, gm, { x: 0, y: 0 }, { x: 19, y: 19 }, false);
		expect(pip.explored.every((v) => v === 0)).toBe(true);
	});

	it('keeps GM-only notices out of player and spectator snapshots', () => {
		const { room, gm, pip, sam } = dungeon();
		postSystem(room, 'Gemma placed Dragon.', 'gm');
		postSystem(room, 'Pip opened a door.');
		const texts = (p: Player) =>
			snapshotFor(room, p, viewFor(room, p)).log.map((m) => (m.kind === 'system' ? m.text : ''));
		expect(texts(gm)).toContain('Gemma placed Dragon.');
		expect(texts(pip)).not.toContain('Gemma placed Dragon.');
		expect(texts(sam)).not.toContain('Gemma placed Dragon.');
		expect(texts(pip)).toContain('Pip opened a door.');
	});

	it('only lets the GM control fog', () => {
		const { room, pip } = dungeon();
		expect(setFog(room, pip, false)).toMatchObject({ ok: false, code: 'forbidden' });
		expect(fogArea(room, pip, { x: 0, y: 0 }, { x: 5, y: 5 }, true)).toMatchObject({
			code: 'forbidden'
		});
		expect(room.fog.enabled).toBe(true);
	});
});

describe('diffView', () => {
	it('sends moves as moves, and tokens entering or leaving sight as upserts and deletes', () => {
		const { room, gm, pip } = setup();
		setFog(room, gm, true);
		const hero = token(room, gm, 'Hero', 5, 5, pip.id);
		const goblin = token(room, gm, 'Goblin', 15, 5);
		const start = sentFrom(viewFor(room, pip));

		moveToken(room, gm, hero.id, { x: 11, y: 5 });
		const approach = diffView(start, viewFor(room, pip), gm.id);
		expect(approach.map((m) => m.type)).toEqual(['fog_update', 'token_moved', 'token_upserted']);
		expect(approach[2]).toMatchObject({ token: { id: goblin.id } });

		const near = sentFrom(viewFor(room, pip));
		moveToken(room, gm, hero.id, { x: 2, y: 5 });
		const retreat = diffView(near, viewFor(room, pip));
		expect(retreat).toContainEqual({ type: 'token_deleted', tokenId: goblin.id });
	});

	it('sends nothing when nothing changed', () => {
		const { room, pip } = setup();
		const sent = sentFrom(viewFor(room, pip));
		expect(diffView(sent, viewFor(room, pip))).toEqual([]);
	});
});

describe('lighting and visibility', () => {
	function darkRoom() {
		const t = setup();
		setFog(t.room, t.gm, true);
		setAmbient(t.room, t.gm, 'dark');
		const hero = token(t.room, t.gm, 'Hero', 3, 3, t.pip.id);
		const goblin = token(t.room, t.gm, 'Goblin', 6, 3);
		return { ...t, hero, goblin };
	}

	it('in the dark, a player sees only their own cell without light', () => {
		const { room, pip } = darkRoom();
		expect(names(room, pip)).toEqual(['Hero']);
		expect(seesCell(room, pip, 3, 3)).toBe(true);
		expect(seesCell(room, pip, 4, 3)).toBe(false);
	});

	it('a carried torch lights the way', () => {
		const { room, gm, pip, hero } = darkRoom();
		updateToken(room, gm, hero.id, { light: 4 });
		expect(names(room, pip)).toEqual(['Goblin', 'Hero']);
	});

	it('a GM light shows what it lights, within vision, but not beyond walls', () => {
		const { room, gm, pip } = darkRoom();
		const lit = createLight(room, gm, { pos: { x: 6, y: 5 }, radius: 3, color: '#ffa04d' });
		expect(lit.ok).toBe(true);
		expect(names(room, pip)).toEqual(['Goblin', 'Hero']);
		// A wall between the hero and the lit area hides it again.
		createObject(room, gm, 'wall', { x: 5, y: 0 }, { x: 5, y: 12 });
		expect(names(room, pip)).toEqual(['Hero']);
	});

	it('switching a light off plunges its area into darkness', () => {
		const { room, gm, pip } = darkRoom();
		const r = createLight(room, gm, { pos: { x: 6, y: 5 }, radius: 3, color: '#ffa04d' });
		if (!r.ok) throw new Error(r.message);
		updateLight(room, gm, r.light.id, { on: false });
		expect(names(room, pip)).toEqual(['Hero']);
	});

	it('an NPC carrying a light is visible from afar', () => {
		const { room, gm, pip, goblin } = darkRoom();
		updateToken(room, gm, goblin.id, { light: 1 });
		expect(names(room, pip)).toEqual(['Goblin', 'Hero']);
	});

	it('only sends players light fixtures on cells they have seen', () => {
		const { room, gm, pip } = darkRoom();
		createLight(room, gm, { pos: { x: 18, y: 18 }, radius: 2, color: '#ffa04d' });
		createLight(room, gm, { pos: { x: 3, y: 3 }, radius: 2, color: '#ffa04d' });
		expect(viewFor(room, pip).lights.map((l) => l.pos)).toEqual([{ x: 3, y: 3 }]);
		expect(viewFor(room, gm).lights).toHaveLength(2);
	});

	it('ignores light entirely in daylight', () => {
		const { room, gm, pip } = darkRoom();
		setAmbient(room, gm, 'day');
		expect(names(room, pip)).toEqual(['Goblin', 'Hero']);
	});

	it('keeps lighting GM-only', () => {
		const { room, pip } = darkRoom();
		expect(setAmbient(room, pip, 'day')).toMatchObject({ ok: false, code: 'forbidden' });
		expect(
			createLight(room, pip, { pos: { x: 1, y: 1 }, radius: 2, color: '#ffa04d' })
		).toMatchObject({
			code: 'forbidden'
		});
		expect(room.ambient).toBe('dark');
	});
});
