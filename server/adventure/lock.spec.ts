// A story's lock (milestone 55): what it plays by, at the versions it found,
// kept with the save and compared on a load.

import { describe, expect, it } from 'vitest';
import { RoomManager, type Room } from '../rooms';
import { exportScene } from '../scene-io';
import { srdCatalog } from '../rules/dnd55e/catalog';
import { startAdventure } from './engine';
import { compareContent, lockOf, readSteps, savedPins, withStep } from './lock';
import { readAdventure } from './persist';

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}

function playing(id: string): Room {
	const { room, player } = ok(new RoomManager().create('Gia'));
	ok(startAdventure(room, player, id));
	return room;
}

const pin = () => {
	const c = srdCatalog();
	return {
		id: 'srd-5.2.1',
		name: c.source.title,
		version: '5.2.1',
		sha256: c.pin.sha256,
		build: c.build
	};
};

describe('a story’s lock', () => {
	it('names the rules, the content they read, the adventure, its homebrew and its collection', () => {
		const barrow = lockOf(playing('barrow').adventure!);
		expect(barrow).toEqual({
			rules: { id: 'dnd-5.5e', version: 1, name: 'Fifth Edition (SRD 5.2.1)' },
			content: [pin()],
			adventure: { kind: 'built-in', id: 'barrow', version: 1 },
			packs: [],
			collection: null
		});
		expect(barrow.content[0].build).toMatch(/^[0-9a-f]{64}$/);
		// The classic rules read no catalog.
		expect(lockOf(playing('hollow-bell').adventure!)).toMatchObject({
			rules: { id: 'thirdfold-classic', version: 1 },
			content: [],
			adventure: { kind: 'built-in', id: 'hollow-bell' }
		});
	});

	it('is saved with the story, and a load says when content was rebuilt or comes from elsewhere', () => {
		const room = playing('barrow');
		const scene = exportScene(room, 'Barrow');
		const state = scene.adventure!.state as Record<string, unknown>;
		expect(state.lock).toEqual(lockOf(room.adventure!));
		expect(ok(readAdventure(scene.adventure!, scene)).notes).toEqual([]);

		const withLock = (lock: unknown) =>
			readAdventure({ ...scene.adventure!, state: { ...state, lock } }, scene);
		const locked = state.lock as { content: ReturnType<typeof pin>[] };

		// The same source rebuilt: the story loads, every character checked, and the GM is told.
		const rebuilt = ok(
			withLock({ ...locked, content: [{ ...locked.content[0], build: 'a'.repeat(64) }] })
		);
		expect(rebuilt.notes).toEqual([
			expect.stringMatching(/^System Reference Document 5\.2\.1 was rebuilt from the same source/)
		]);

		// Another source: refused, with what to do.
		const other = withLock({
			...locked,
			content: [{ ...locked.content[0], sha256: 'b'.repeat(64) }]
		});
		expect(other).toEqual({
			ok: false,
			error: expect.stringContaining('made from another source')
		});
		expect(!other.ok && other.error).toContain('Open it on a server with the same source.');
		// Content this server lacks.
		const missing = withLock({ ...locked, content: [{ ...locked.content[0], id: 'srd-6' }] });
		expect(!missing.ok && missing.error).toContain("which this server doesn't have");
		// A lock that isn't one.
		expect(withLock({ content: 'everything' })).toEqual({
			ok: false,
			error: 'The saved story is invalid: its lock.'
		});
		// Saves from before locks read as they always did.
		const { lock: _lock, ...older } = state;
		void _lock;
		expect(ok(readAdventure({ ...scene.adventure!, state: older }, scene)).notes).toEqual([]);
	});

	it('compares content pins on their own', () => {
		const p = pin();
		expect(compareContent([p], [p])).toEqual({ error: null, notes: [] });
		expect(compareContent([], [p])).toEqual({ error: null, notes: [] });
		expect(savedPins({ content: [p] })).toEqual([p]);
		expect(savedPins({ content: [{ ...p, sha256: 'short' }] })).toBeNull();
	});
});

describe('the steps a story was moved by', () => {
	const step = {
		what: 'adventure' as const,
		item: 'c'.repeat(32),
		from: 1,
		to: 2,
		rollback: false,
		at: '2026-10-06T10:00:00.000Z'
	};

	it('are read back whole, and only so many are kept', () => {
		expect(readSteps([step])).toEqual([step]);
		expect(readSteps([{ ...step, to: 0 }])).toBeNull();
		expect(readSteps([{ ...step, extra: 1 }])).toBeNull();
		expect(readSteps('all')).toBeNull();
		let steps = withStep(undefined, step);
		for (let i = 0; i < 30; i++) steps = withStep(steps, { ...step, from: 2, to: 3 });
		expect(steps).toHaveLength(20);
		expect(steps[0].from).toBe(2);
	});
});
