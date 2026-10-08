// Moving a story to another version of its library adventure (milestone
// 55): reviewed (what changes, whether it fits), applied only when asked,
// kept as a step, and saved pinned to where it went; a version that doesn't
// fit the story where it is, or plays by other rules, is refused with why.

import { beforeEach, describe, expect, it } from 'vitest';
import { exampleAdventure } from '../../src/lib/adventure/example';
import { RoomManager, type Player, type Room } from '../rooms';
import { exportScene } from '../scene-io';
import { loadCustomAdventure } from './custom';
import { startAdventure } from './engine';
import { readAdventure } from './persist';
import { adventureChanges, prepareMove, type MoveTarget } from './upgrade';
import { contentOf } from './registry';
import { adventureView } from './view';

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}

const LIB = 'a'.repeat(32);
const creator = { id: '0123456789abcdef', name: 'Mira' };
const v1 = () => JSON.parse(JSON.stringify(exampleAdventure()));
/** Version 2: a new clue, the miller's words changed, and a new title. */
function v2() {
	const f = v1();
	f.title = 'The Miller’s Key (revised)';
	f.clues.flour = {
		title: 'Flour on the stair',
		text: 'Small prints in the flour.',
		kind: 'environment'
	};
	return f;
}

let room: Room;
let gm: Player;

beforeEach(() => {
	const created = ok(new RoomManager().create('Gia'));
	room = created.room;
	gm = created.player;
	const loaded = ok(loadCustomAdventure(v1()));
	ok(startAdventure(room, gm, loaded.adventure.id));
	room.adventure!.library = { id: LIB, version: 1, creator };
});

const target = (file: unknown, to: number, from = 1): MoveTarget => ({
	what: 'adventure',
	item: LIB,
	title: 'The Miller’s Key',
	from,
	to,
	file,
	library: { id: LIB, version: to, creator },
	collection: null,
	packs: [],
	entitlements: []
});

describe('moving a story to another version', () => {
	it('reviews what changes, and leaves the story as it was', () => {
		const before = room.adventure;
		const { review, next } = prepareMove(room, target(v2(), 2));
		expect(review).toMatchObject({ what: 'adventure', from: 1, to: 2, rollback: false, ok: true });
		expect(review.problems).toEqual([]);
		expect(review.changes).toEqual([
			{
				section: 'Title',
				added: ['The Miller’s Key (revised)'],
				removed: ['The Miller’s Key'],
				changed: []
			},
			{ section: 'Clues', added: ['flour'], removed: [], changed: [] }
		]);
		expect(next).not.toBeNull();
		// Nothing changed until it is put in place.
		expect(room.adventure).toBe(before);
		expect(room.adventure!.library!.version).toBe(1);
	});

	it('puts it in place pinned to the new version, keeps the step, and a save loads as that version', () => {
		const firstId = room.adventure!.id;
		const { next } = prepareMove(room, target(v2(), 2), new Date('2026-10-06T12:00:00Z'));
		room.adventure = next;
		expect(room.adventure!.id).not.toBe(firstId);
		expect(contentOf(room.adventure!.id).title).toBe('The Miller’s Key (revised)');
		expect(room.adventure!.library).toEqual({ id: LIB, version: 2, creator });
		expect(room.adventure!.steps).toEqual([
			{
				what: 'adventure',
				item: LIB,
				from: 1,
				to: 2,
				rollback: false,
				at: '2026-10-06T12:00:00.000Z'
			}
		]);
		const view = adventureView(room, gm, new Set(), null)!;
		expect(view.versions).toMatchObject({
			lock: { adventure: { kind: 'file', library: { id: LIB, version: 2 } } },
			steps: [{ from: 1, to: 2 }],
			movable: { adventure: true, collection: false }
		});
		// The publisher's next update changes nothing here: the save carries version 2's file.
		const scene = exportScene(room, 'Mill');
		const back = ok(readAdventure(scene.adventure!, scene)).adventure;
		expect(contentOf(back.id).title).toBe('The Miller’s Key (revised)');
		expect(back.steps).toHaveLength(1);

		// And back again, the same way.
		const { review, next: rolled } = prepareMove(room, target(v1(), 1, 2));
		expect(review).toMatchObject({ rollback: true, ok: true });
		room.adventure = rolled;
		expect(room.adventure!.id).toBe(firstId);
		expect(room.adventure!.steps!.map((s) => s.rollback)).toEqual([false, true]);
	});

	it('refuses a version the story doesn’t fit where it is, saying why', () => {
		const renamed = v1();
		renamed.chapters.the_millhouse = renamed.chapters.the_mill;
		delete renamed.chapters.the_mill;
		renamed.start.chapter = 'the_millhouse';
		const { review, next } = prepareMove(room, target(renamed, 2));
		expect(next).toBeNull();
		expect(review.ok).toBe(false);
		expect(review.problems).toEqual([
			expect.stringMatching(/^The story where it is doesn't fit version 2: chapter/)
		]);
		expect(review.changes).toContainEqual({
			section: 'Chapters',
			added: ['the_millhouse'],
			removed: ['the_mill'],
			changed: []
		});
	});

	it('refuses a version that doesn’t read, homebrew that doesn’t, and the version it already plays', () => {
		expect(
			prepareMove(room, { ...target(v2(), 2), packs: [{ pack: { format: 'nope' }, owner: null }] })
				.review.problems
		).toContain('Homebrew in version 2 no longer reads.');
		expect(prepareMove(room, target({ format: 'nope' }, 2)).review.problems[0]).toMatch(
			/^Version 2 no longer reads/
		);
		expect(prepareMove(room, target(v1(), 1)).review.problems).toContain(
			'The story already plays version 1.'
		);
	});

	it('waits while a choice is pending or something is moving', () => {
		room.adventure!.pending = 'flour';
		expect(prepareMove(room, target(v2(), 2)).review.problems).toContain(
			'Answer the choice first.'
		);
	});

	it('compares adventures section by section', () => {
		const a = contentOf(room.adventure!.id);
		expect(adventureChanges(a, a)).toEqual([]);
	});
});
