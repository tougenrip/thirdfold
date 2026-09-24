import { describe, expect, it } from 'vitest';
import { exampleAdventure } from '../../src/lib/adventure/example';
import { parseSceneFile } from '../../src/lib/game/scene-file';
import { RoomManager } from '../rooms';
import { applyScene, exportScene } from '../scene-io';
import { loadCustomAdventure } from './custom';
import * as engine from './engine';
import { readAdventure } from './persist';
import { findAdventure, forgetCustom } from './registry';

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
	return result as Extract<T, { ok: true }>;
}

const file = () => JSON.parse(JSON.stringify(exampleAdventure()));

describe("creators' adventures", () => {
	it('gets its id from its content: the same file is the same adventure', () => {
		const a = ok(loadCustomAdventure(file()));
		const b = ok(loadCustomAdventure(file()));
		expect(a.adventure.id).toMatch(/^custom-[0-9a-f]{32}$/);
		expect(b.adventure.id).toBe(a.adventure.id);
		const changed = file();
		changed.title = 'Another Key';
		expect(ok(loadCustomAdventure(changed)).adventure.id).not.toBe(a.adventure.id);
	});

	it('refuses a file that is broken, naming the problem', () => {
		const broken = file();
		broken.start.chapter = 'nowhere';
		expect(loadCustomAdventure(broken)).toMatchObject({
			ok: false,
			error: expect.stringContaining('no chapter "nowhere"')
		});
		expect(loadCustomAdventure({ format: 'nope' })).toMatchObject({ ok: false });
	});

	it('is played by the same engine, and a save carries it wherever it goes', () => {
		const rooms = new RoomManager();
		const created = ok(rooms.create('Gia'));
		const room = created.room;
		room.dice = () => 10;
		const gm = created.player;
		const ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
		const id = ok(loadCustomAdventure(file())).adventure.id;
		ok(engine.startAdventure(room, gm, id));
		ok(engine.claimCharacter(room, ana, 'veil'));
		ok(engine.beginAdventure(room, gm));
		const me = () => engine.characterOf(room, ana.id)!;
		me().token.pos = { x: 6, y: 9 };
		ok(engine.interact(room, ana, 'miller'));
		expect(room.adventure!.chapter).toBe('the_key');
		me().token.pos = { x: 6, y: 4 };
		ok(engine.interact(room, ana, 'sack', 'search'));
		ok(engine.share(room, ana, 'key'));
		expect(room.adventure!.rewards).toEqual(['The cellar key']);
		me().token.pos = { x: 4, y: 2 };
		const down = engine.afterMove(room, me().token, null);
		expect(down.reset).toBe(true);
		expect(room.adventure).toMatchObject({ chapter: 'the_cellar', location: 'cellar' });
		expect(room.adventure!.encounter?.id).toBe('rats');

		// Saved mid-fight: the file goes with it. Forgotten here, it comes back from the save.
		const saved = exportScene(room, 'Mill');
		expect(saved.adventure!.content).toMatchObject({ title: 'The Miller’s Key' });
		forgetCustom(id);
		expect(findAdventure(id)).toBeUndefined();
		const parsed = parseSceneFile(JSON.parse(JSON.stringify(saved)));
		if (!parsed.ok) throw new Error(parsed.error);
		const read = ok(readAdventure(parsed.scene.adventure!, parsed.scene));
		expect(read.adventure).toMatchObject({ id, chapter: 'the_cellar' });
		expect(findAdventure(id)?.title).toBe('The Miller’s Key');

		// A save whose content was changed under the same id is refused.
		forgetCustom(id);
		const tampered = structuredClone(parsed.scene.adventure!);
		(tampered.content as { title: string }).title = 'Not the same';
		expect(readAdventure(tampered, parsed.scene)).toMatchObject({
			ok: false,
			error: 'The saved adventure does not match its content.'
		});

		// Played on: the fight won, a choice, an ending with the party's rewards.
		applyScene(room, parsed.scene);
		room.adventure = ok(readAdventure(parsed.scene.adventure!, parsed.scene)).adventure;
		ok(engine.direct(room, gm, { op: 'encounter_end', result: 'won' }));
		expect(room.adventure!.pending).toBe('flour');
		ok(engine.decide(room, ana, 'flour', 'share'));
		expect(room.adventure).toMatchObject({ stage: 'complete', ending: 'honour' });
		expect(room.adventure!.rewards).toEqual(['The cellar key', 'The miller’s thanks']);
	});

	it('remembers a library adventure’s source in a save, and refuses a bad one', () => {
		const rooms = new RoomManager();
		const created = ok(rooms.create('Gia'));
		const room = created.room;
		const id = ok(loadCustomAdventure(file())).adventure.id;
		ok(engine.startAdventure(room, created.player, id));
		const source = {
			id: 'a'.repeat(32),
			version: 3,
			creator: { id: 'b'.repeat(16), name: 'Mira' }
		};
		room.adventure!.library = source;
		const saved = JSON.parse(JSON.stringify(exportScene(room, 'Mill')));
		const parsed = parseSceneFile(saved);
		if (!parsed.ok) throw new Error(parsed.error);
		expect(ok(readAdventure(parsed.scene.adventure!, parsed.scene)).adventure.library).toEqual(
			source
		);
		// Starting over keeps where it came from.
		ok(engine.control(room, created.player, 'restart'));
		expect(room.adventure!.library).toEqual(source);

		const bad = structuredClone(parsed.scene.adventure!);
		(bad.state as { library: { version: number } }).library.version = 0;
		expect(readAdventure(bad, parsed.scene)).toMatchObject({ ok: false });
		const named = structuredClone(parsed.scene.adventure!);
		(named.state as { library: { creator: { name: string } } }).library.creator.name = '';
		expect(readAdventure(named, parsed.scene)).toMatchObject({ ok: false });
	});
});
