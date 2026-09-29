// A renamed prop id keeps loading: with the catalogue aliasing `old-crate` to
// `crate` (as assets/catalog.json would after a rename), every place a prop id
// comes in reads the old id and keeps the new one.

import { describe, expect, it, vi } from 'vitest';
import { exampleAdventure } from '../src/lib/adventure/example';
import { parseAdventureFile } from '../src/lib/adventure/file';
import { parseClientMessage } from '../src/lib/game/protocol';
import { blankScene, parseSceneFile, SCENE_FILE_VERSION } from '../src/lib/game/scene-file';
import { beginAdventure, claimCharacter, startAdventure } from './adventure/engine';
import { readAdventure } from './adventure/persist';
import { RoomManager } from './rooms';
import { exportScene } from './scene-io';

vi.mock('../src/lib/game/catalog', async (original) => ({
	...(await original<typeof import('../src/lib/game/catalog')>()),
	ALIASES: { 'old-crate': 'crate' }
}));

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}

describe('an aliased prop id', () => {
	it('loads in a scene file, stored as the prop that replaced it', () => {
		const scene = blankScene('Cellar', 6, 6, null);
		expect(scene.version).toBe(9);
		expect(SCENE_FILE_VERSION).toBe(9);
		scene.props = [
			{ id: 'p1', assetId: 'old-crate' as never, pos: { x: 1, y: 1 }, rotation: 0, scale: 1 }
		];
		const parsed = ok(parseSceneFile(JSON.parse(JSON.stringify(scene))));
		expect(parsed.scene.props[0].assetId).toBe('crate');
	});

	it('loads in a saved story’s origins, stored as the prop that replaced it', () => {
		const rooms = new RoomManager();
		const { room, player: gm } = ok(rooms.create('Gia'));
		const ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
		ok(startAdventure(room, gm));
		ok(claimCharacter(room, ana, 'warden'));
		ok(beginAdventure(room, gm, 1000));
		const file = JSON.parse(JSON.stringify(exportScene(room, 'Bellweather')));
		const origins = file.adventure.state.origins as Record<string, { assetId: string }>;
		const [id] = Object.keys(origins);
		origins[id].assetId = 'old-crate';
		const scene = ok(parseSceneFile(file)).scene;
		const read = ok(readAdventure(scene.adventure!, scene));
		expect(read.adventure.origins.get(id)?.assetId).toBe('crate');
	});

	it('is accepted from a client placing a prop, and passed on as the new id', () => {
		const message = parseClientMessage({
			type: 'prop_create',
			assetId: 'old-crate',
			pos: { x: 1, y: 2 },
			rotation: 0
		});
		expect(message).toEqual({
			type: 'prop_create',
			assetId: 'crate',
			pos: { x: 1, y: 2 },
			rotation: 0
		});
		expect(parseClientMessage({ ...message, assetId: 'old-box' })).toBeNull();
	});

	it('loads in an adventure file’s looks and effects, stored as the new id', () => {
		const file = JSON.parse(JSON.stringify(exampleAdventure()));
		const sack = file.objects.find((o: { id: string }) => o.id === 'sack');
		sack.looks = { used: { assetId: 'old-crate' } };
		sack.verbs[0].does[1].do.push({ prop: 'sack', asset: 'old-crate' });
		const parsed = ok(parseAdventureFile(file));
		const read = parsed.file.objects.find((o) => o.id === 'sack')!;
		expect(read.looks?.used?.assetId).toBe('crate');
		expect(read.verbs[0].does![1].do).toContainEqual({ prop: 'sack', asset: 'crate' });
	});
});
