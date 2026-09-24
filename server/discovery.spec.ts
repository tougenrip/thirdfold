import { describe, expect, it } from 'vitest';
import { parseSceneFile } from '../src/lib/game/scene-file';
import { decodeMask } from '../src/lib/game/visibility';
import { RoomManager, type Player, type Room } from './rooms';
import {
	createObject,
	createProp,
	createToken,
	fogRoom,
	moveToken,
	setFog,
	setFogShared,
	updateProp,
	updateToken
} from './scene';
import { applyScene, exportScene } from './scene-io';
import { viewFor } from './views';

/**
 * A 20×20 table with fog on: a small walled room (x 12-15, y 2-5) with a door
 * in its west wall at y 3; Pip's Hero outside it at (8, 3), Ivy's Scout far
 * off in the south-west, a GM goblin inside the room.
 */
function table() {
	const rooms = new RoomManager();
	const created = rooms.create('Gemma');
	if (!created.ok) throw new Error(created.message);
	const { room, player: gm } = created;
	const seat = (name: string): Player => {
		const r = rooms.join(room.id, name, 'player');
		if (!r.ok) throw new Error(r.message);
		return r.player;
	};
	const pip = seat('Pip');
	const ivy = seat('Ivy');
	const joined = rooms.join(room.id, 'Sam', 'spectator');
	if (!joined.ok) throw new Error(joined.message);
	const sam = joined.player;
	setFog(room, gm, true);
	createObject(room, gm, 'wall', { x: 12, y: 2 }, { x: 16, y: 2 });
	createObject(room, gm, 'wall', { x: 12, y: 6 }, { x: 16, y: 6 });
	createObject(room, gm, 'wall', { x: 16, y: 2 }, { x: 16, y: 6 });
	createObject(room, gm, 'wall', { x: 12, y: 2 }, { x: 12, y: 6 });
	const cut = createObject(room, gm, 'door', { x: 12, y: 3 }, { x: 12, y: 4 });
	if (!cut.ok) throw new Error(cut.message);
	const place = (name: string, x: number, y: number, ownerId: string | null) => {
		const r = createToken(room, gm, { name, color: '#c0392b', pos: { x, y }, ownerId });
		if (!r.ok) throw new Error(r.message);
		return r.token;
	};
	const hero = place('Hero', 8, 3, pip.id);
	const scout = place('Scout', 2, 18, ivy.id);
	const goblin = place('Goblin', 14, 4, null);
	return { room, gm, pip, ivy, sam, hero, scout, goblin };
}

const size = (room: Room) => room.grid.width * room.grid.height;
const cell = (room: Room, x: number, y: number) => y * room.grid.width + x;
const visible = (room: Room, viewer: Player) =>
	decodeMask(viewFor(room, viewer).fog.visible, size(room));
const explored = (room: Room, viewer: Player) =>
	decodeMask(viewFor(room, viewer).fog.explored, size(room));
const tokenNames = (room: Room, viewer: Player) =>
	viewFor(room, viewer)
		.tokens.map((t) => t.name)
		.sort();

describe('player-specific and shared visibility', () => {
	it('lets each player see only through their own tokens, until the GM shares the party’s sight', () => {
		const { room, gm, pip, ivy, sam } = table();
		expect(visible(room, pip)[cell(room, 2, 18)]).toBe(0);
		expect(tokenNames(room, pip)).toEqual(['Hero']);
		expect(viewFor(room, pip).fog.shared).toBe(false);

		expect(setFogShared(room, pip, true)).toMatchObject({ ok: false, code: 'forbidden' });
		expect(setFogShared(room, gm, true)).toMatchObject({ ok: true, changed: true });
		// Now Pip sees what Ivy's Scout sees, and the Scout itself.
		expect(visible(room, pip)[cell(room, 2, 18)]).toBe(1);
		expect(tokenNames(room, pip)).toEqual(['Hero', 'Scout']);
		expect(viewFor(room, ivy).fog.shared).toBe(true);
		// A spectator always had the party's view.
		expect(visible(room, sam)[cell(room, 2, 18)]).toBe(1);

		// Turned off again, what each saw is remembered, but they see only through their own.
		setFogShared(room, gm, false);
		expect(visible(room, pip)[cell(room, 2, 18)]).toBe(0);
		expect(explored(room, pip)[cell(room, 2, 18)]).toBe(1);
	});
});

describe('rooms', () => {
	it('lets the GM reveal or hide a whole room with one cell, and refuses open ground', () => {
		const { room, gm, pip } = table();
		expect(visible(room, pip)[cell(room, 15, 5)]).toBe(0);
		expect(fogRoom(room, pip, { x: 13, y: 3 }, true)).toMatchObject({ ok: false });
		expect(fogRoom(room, gm, { x: 13, y: 3 }, true)).toEqual({ ok: true, cells: 16 });
		expect(visible(room, pip)[cell(room, 15, 5)]).toBe(1);
		expect(tokenNames(room, pip)).toEqual(['Goblin', 'Hero']);
		// The corridor outside is open ground, not a room.
		expect(fogRoom(room, gm, { x: 5, y: 10 }, true)).toMatchObject({
			ok: false,
			code: 'invalid_position'
		});
		// Hidden again: the room is dark and forgotten.
		expect(fogRoom(room, gm, { x: 13, y: 3 }, false)).toEqual({ ok: true, cells: 16 });
		expect(visible(room, pip)[cell(room, 15, 5)]).toBe(0);
		expect(explored(room, pip)[cell(room, 15, 5)]).toBe(0);
	});

	it('lets a character who walks into a room learn its layout, but not who stands in the dark corners', () => {
		const { room, gm, pip, hero } = table();
		// A crate in the far corner, behind a pillar from the doorway.
		createProp(room, gm, { assetId: 'crate', pos: { x: 15, y: 5 }, rotation: 0 });
		createProp(room, gm, { assetId: 'pillar', pos: { x: 14, y: 5 }, rotation: 0 });
		expect(explored(room, pip)[cell(room, 15, 2)]).toBe(0);
		room.objects.forEach((o) => {
			if (o.kind === 'door') o.open = true;
		});
		const moved = moveToken(room, pip, hero.id, { x: 12, y: 3 });
		expect(moved.ok).toBe(true);
		const seen = explored(room, pip);
		// Every cell of the room is known now, the whole layout.
		for (let y = 2; y <= 5; y++)
			for (let x = 12; x <= 15; x++) expect(seen[cell(room, x, y)]).toBe(1);
		expect(
			viewFor(room, pip)
				.props.map((p) => p.assetId)
				.sort()
		).toEqual(['crate', 'pillar']);
	});
});

describe('hidden enemies and objects', () => {
	it('keeps a hidden token from every player and spectator, fog or not, but its owner and the GM see it', () => {
		const { room, gm, pip, sam, goblin, hero } = table();
		fogRoom(room, gm, { x: 13, y: 3 }, true);
		expect(tokenNames(room, pip)).toContain('Goblin');
		expect(updateToken(room, pip, goblin.id, { hidden: true })).toMatchObject({ ok: false });
		expect(updateToken(room, gm, goblin.id, { hidden: true })).toMatchObject({ ok: true });
		expect(tokenNames(room, pip)).not.toContain('Goblin');
		expect(tokenNames(room, sam)).not.toContain('Goblin');
		expect(viewFor(room, gm).tokens.find((t) => t.id === goblin.id)).toMatchObject({
			hidden: true
		});
		setFog(room, gm, false);
		expect(tokenNames(room, pip)).not.toContain('Goblin');
		// A hidden token's own player still has it.
		updateToken(room, gm, hero.id, { hidden: true });
		expect(tokenNames(room, pip)).toContain('Hero');
		// Shown again.
		updateToken(room, gm, goblin.id, { hidden: false });
		expect(tokenNames(room, pip)).toContain('Goblin');
		expect(room.tokens.get(goblin.id)!.hidden).toBeUndefined();
	});

	it('keeps a hidden prop off players’ tables while it still blocks the way', () => {
		const { room, gm, pip } = table();
		setFog(room, gm, false);
		const made = createProp(room, gm, { assetId: 'chest', pos: { x: 8, y: 4 }, rotation: 0 });
		if (!made.ok) throw new Error(made.message);
		expect(viewFor(room, pip).props.map((p) => p.id)).toContain(made.prop.id);
		expect(updateProp(room, gm, made.prop.id, { hidden: true })).toMatchObject({ ok: true });
		expect(viewFor(room, pip).props.map((p) => p.id)).not.toContain(made.prop.id);
		expect(viewFor(room, gm).props.find((p) => p.id === made.prop.id)).toMatchObject({
			hidden: true
		});
		updateProp(room, gm, made.prop.id, { hidden: false });
		expect(viewFor(room, pip).props.map((p) => p.id)).toContain(made.prop.id);
	});
});

describe('persistent discovery', () => {
	it('saves what each player discovered and whether sight is shared, and gives it back by name', () => {
		const { room, gm, pip, ivy, goblin } = table();
		setFogShared(room, gm, true);
		updateToken(room, gm, goblin.id, { hidden: true });
		viewFor(room, pip);
		viewFor(room, ivy);
		const pipSaw = explored(room, pip);
		const file = parseSceneFile(JSON.parse(JSON.stringify(exportScene(room, 'Mapped'))));
		if (!file.ok) throw new Error(file.error);
		expect(file.scene.fog.shared).toBe(true);
		expect(Object.keys(file.scene.discovery).sort()).toEqual(['Ivy', 'Pip']);
		expect(file.scene.tokens.find((t) => t.id === goblin.id)).toMatchObject({ hidden: true });

		// A new session: the same group, new player ids.
		const rooms = new RoomManager();
		const again = rooms.create('Gemma');
		if (!again.ok) throw new Error(again.message);
		const pip2 = rooms.join(again.room.id, 'pip', 'player');
		const newcomer = rooms.join(again.room.id, 'Zed', 'player');
		if (!pip2.ok || !newcomer.ok) throw new Error('join failed');
		applyScene(again.room, file.scene);
		expect(again.room.fog.shared).toBe(true);
		expect([...pip2.player.explored]).toEqual([...pipSaw]);
		expect(newcomer.player.explored.every((v) => v === 0)).toBe(true);
	});
});
