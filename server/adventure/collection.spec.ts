// A story started from a collection (milestone 53) keeps it: which version,
// its adventures and which one this is, and its homebrew, through a save;
// and a save names exactly that set, or it isn't read.

import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../src/lib/game/chat';
import { RoomManager, type Player, type Room } from '../rooms';
import { dnd55e } from '../rules/dnd55e';
import { examplePack } from '../rules/dnd55e/homebrew/example';
import { exportScene } from '../scene-io';
import { adventureView } from './view';
import { beginCollection, control, startAdventure } from './engine';
import { readAdventure } from './persist';
import type { CollectionSource } from './state';

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}
const texts = (log: readonly ChatMessage[]) => log.map((m) => ('text' in m ? m.text : ''));

let room: Room;
let gm: Player;
let packId: string;
const source = (): CollectionSource => ({
	id: 'c'.repeat(32),
	version: 3,
	title: 'Cold Hill Campaign',
	creator: { id: '0123456789abcdef', name: 'Mira' },
	entry: 0,
	adventures: [
		{ ref: { builtIn: 'barrow' }, title: 'The Barrow on Cold Hill' },
		{ ref: { library: 'd'.repeat(32), version: 2 }, title: 'Beyond the Barrow' }
	],
	packs: [
		{ ref: { library: 'e'.repeat(32), version: 1 }, title: 'The Cold Hill Armory 1.0', packId }
	],
	tables: [{ code: 'f'.repeat(32), name: 'The crossroads' }]
});

beforeEach(() => {
	const created = ok(new RoomManager().create('Gia'));
	room = created.room;
	gm = created.player;
	packId = (dnd55e.packs!.hold(examplePack()) as { id: string }).id;
	ok(startAdventure(room, gm, 'barrow'));
});

describe('a story from a collection', () => {
	it('records the collection and brings its homebrew, credited to whoever published it', () => {
		const done = ok(beginCollection(room, source(), [{ id: packId, owner: '0123456789abcdef' }]));
		expect(texts(done.log)).toEqual([
			'The GM opens Cold Hill Campaign by Mira: The Barrow on Cold Hill, 1 of 2, with The Cold Hill Armory 1.0.'
		]);
		const view = adventureView(room, gm, new Set(), null)!;
		expect(view.collection).toEqual({
			id: 'c'.repeat(32),
			version: 3,
			title: 'Cold Hill Campaign',
			creator: { id: '0123456789abcdef', name: 'Mira' },
			adventures: [
				{ title: 'The Barrow on Cold Hill', playing: true },
				{ title: 'Beyond the Barrow', playing: false }
			],
			packs: ['The Cold Hill Armory 1.0'],
			tables: [{ code: 'f'.repeat(32), name: 'The crossroads' }]
		});
		expect(view.packs!.map((p) => [p.id, p.access.owner])).toEqual([[packId, '0123456789abcdef']]);
		// Starting over keeps it.
		ok(control(room, gm, 'restart'));
		expect(room.adventure!.collection?.version).toBe(3);
	});

	it('keeps it in a save, and reads back only the set it names', () => {
		ok(beginCollection(room, source(), [{ id: packId, owner: '0123456789abcdef' }]));
		const scene = exportScene(room, 'Cold Hill');
		const back = ok(readAdventure(scene.adventure!, scene)).adventure;
		expect(back.collection).toEqual(room.adventure!.collection);

		const forge = (
			change: (state: { collection: Record<string, unknown> } & Record<string, unknown>) => void
		) => {
			const copy = structuredClone(scene.adventure!) as unknown as {
				state: { collection: Record<string, unknown> } & Record<string, unknown>;
			};
			change(copy.state);
			return readAdventure(copy as unknown as typeof scene.adventure & object, scene);
		};
		// This story is the collection's first adventure, not its second.
		expect(forge((s) => (s.collection.entry = 1)).ok).toBe(false);
		// Its homebrew is among the story's.
		expect(forge((s) => delete s.packs).ok).toBe(false);
		// Nothing more than a collection holds.
		expect(forge((s) => (s.collection.script = 'x')).ok).toBe(false);
		expect(forge((s) => (s.collection.tables = [{ code: 'nope', name: 'x' }])).ok).toBe(false);
		// The same set read again is the same.
		expect(forge(() => undefined).ok).toBe(true);
	});
});
