import { describe, expect, it } from 'vitest';
import { parseSceneFile } from '../src/lib/game/scene-file';
import { RoomManager, type Player } from './rooms';
import { applyScene, exportScene } from './scene-io';
import {
	createLight,
	createObject,
	createToken,
	fogArea,
	setAmbient,
	setFog,
	updateToken
} from './scene';

function room() {
	const rooms = new RoomManager();
	const created = rooms.create('Gemma');
	if (!created.ok) throw new Error(created.message);
	const seat = (name: string, role: 'player' | 'spectator' = 'player'): Player => {
		const r = rooms.join(created.room.id, name, role);
		if (!r.ok) throw new Error(r.message);
		return r.player;
	};
	return { rooms, room: created.room, gm: created.player, seat };
}

function build() {
	const t = room();
	const pip = t.seat('Pip');
	createObject(t.room, t.gm, 'wall', { x: 5, y: 0 }, { x: 5, y: 10 });
	createObject(t.room, t.gm, 'door', { x: 5, y: 4 }, { x: 5, y: 5 });
	createToken(t.room, t.gm, {
		name: 'Hero',
		color: '#2e86c1',
		pos: { x: 2, y: 4 },
		ownerId: pip.id
	});
	createToken(t.room, t.gm, { name: 'Orc', color: '#c0392b', pos: { x: 8, y: 4 }, ownerId: null });
	setFog(t.room, t.gm, true);
	fogArea(t.room, t.gm, { x: 0, y: 0 }, { x: 1, y: 1 }, true);
	return { ...t, pip, file: exportScene(t.room, 'Crypt') };
}

describe('exportScene / applyScene', () => {
	it('exports a file that passes validation', () => {
		const { file } = build();
		expect(parseSceneFile(JSON.parse(JSON.stringify(file)))).toEqual({ ok: true, scene: file });
		expect(file.tokens.find((t) => t.name === 'Hero')?.owner).toMatchObject({ name: 'Pip' });
	});

	it('rebuilds the table in a fresh room, re-matching owners by name', () => {
		const { file } = build();
		const fresh = room();
		const newPip = fresh.seat('pip'); // same player, new session, different case
		applyScene(fresh.room, file);
		expect([...fresh.room.objects.values()].map((o) => o.kind).sort()).toEqual([
			'door',
			'wall',
			'wall'
		]);
		const hero = [...fresh.room.tokens.values()].find((t) => t.name === 'Hero');
		expect(hero).toMatchObject({ pos: { x: 2, y: 4 }, ownerId: newPip.id });
		expect([...fresh.room.tokens.values()].find((t) => t.name === 'Orc')?.ownerId).toBeNull();
		expect(fresh.room.fog.enabled).toBe(true);
		expect(fresh.room.fog.revealed[0]).toBe(1);
		expect(fresh.room.fog.revealed[21]).toBe(1);
	});

	it('makes tokens GM-only when their owner is not in the room, or is only a spectator', () => {
		const { file } = build();
		const fresh = room();
		fresh.seat('Pip', 'spectator');
		applyScene(fresh.room, file);
		expect([...fresh.room.tokens.values()].every((t) => t.ownerId === null)).toBe(true);
	});

	it('replaces the previous table entirely and resets explored maps', () => {
		const { room: r, gm, pip, file } = build();
		createToken(r, gm, { name: 'Extra', color: '#27ae60', pos: { x: 15, y: 15 }, ownerId: null });
		pip.explored.fill(1);
		applyScene(r, file);
		expect([...r.tokens.values()].map((t) => t.name).sort()).toEqual(['Hero', 'Orc']);
		expect(pip.explored.every((v) => v === 0)).toBe(true);
		// Same session: owner kept by id.
		expect([...r.tokens.values()].find((t) => t.name === 'Hero')?.ownerId).toBe(pip.id);
	});
});

describe('scene name', () => {
	it('follows the loaded scene', () => {
		const { file } = build();
		const fresh = room();
		expect(fresh.room.sceneName).toBe('Untitled scene');
		applyScene(fresh.room, file);
		expect(fresh.room.sceneName).toBe('Crypt');
	});
});

describe('lights in saved scenes', () => {
	it('saves and restores lights, the ambient level and carried light', () => {
		const t = room();
		const pip = t.seat('Pip');
		createLight(t.room, t.gm, { pos: { x: 3, y: 3 }, radius: 5, color: '#8f7bff' });
		const made = createToken(t.room, t.gm, {
			name: 'Hero',
			color: '#2e86c1',
			pos: { x: 1, y: 1 },
			ownerId: pip.id
		});
		if (!made.ok) throw new Error(made.message);
		updateToken(t.room, t.gm, made.token.id, { light: 2 });
		setAmbient(t.room, t.gm, 'dark');
		const file = exportScene(t.room, 'Lit');

		const fresh = room();
		fresh.seat('Pip');
		applyScene(fresh.room, file);
		expect(fresh.room.ambient).toBe('dark');
		expect([...fresh.room.lights.values()]).toMatchObject([
			{ pos: { x: 3, y: 3 }, radius: 5, color: '#8f7bff', on: true }
		]);
		expect([...fresh.room.tokens.values()][0].light).toBe(2);
	});
});
