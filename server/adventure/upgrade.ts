// Moving a story to another version of its library content (milestone 55):
// the adventure it plays, or the collection it was started from. A move is
// asked for, never made by a publisher's update: the server works out what
// the story would be under the other version by saving it and reading it
// back with that content in place (every check a load makes: its chapter and
// people, every character, its homebrew), shows what changes section by
// section, and only then, when the GM says so, puts it in place. The move is
// kept with the story, so it can be moved back the same way.

import type { Entitlement } from '../../src/lib/game/access';
import type { SectionChange, UpgradeReview } from '../../src/lib/adventure/versions';
import type { Room } from '../rooms';
import { exportScene } from '../scene-io';
import { loadCustomAdventure } from './custom';
import type { AdventureDef } from './define';
import { withStep } from './lock';
import { readAdventure, saveAdventure } from './persist';
import { contentOf } from './registry';
import type { AdventureState, CollectionSource, LibrarySource } from './state';
import { findRuleset } from '../rules/ruleset';

/** What a story would play by after a move, as the game server found it in the library. */
export interface MoveTarget {
	what: 'adventure' | 'collection';
	/** The library item that moves (the adventure, or the collection). */
	item: string;
	title: string;
	from: number;
	to: number;
	/** The adventure file to play, or null to keep the adventure (a built-in one). */
	file: unknown | null;
	library: LibrarySource | null;
	collection: CollectionSource | null;
	/** Homebrew the story will have (as written, with whoever brought it). */
	packs: { pack: unknown; owner: string | null }[];
	/** The grants the story rests on after the move. */
	entitlements: Entitlement[];
	/** Problems found before the story was tried (an adventure gone from a collection). */
	problems?: string[];
}

/** The sections of an adventure a review compares, and what to call them. */
const SECTIONS: [keyof AdventureDef, string][] = [
	['chapters', 'Chapters'],
	['locations', 'Places'],
	['characters', 'Characters'],
	['npcs', 'People'],
	['objects', 'Things'],
	['signs', 'Signs'],
	['clues', 'Clues'],
	['events', 'Events'],
	['decisions', 'Choices'],
	['enemies', 'Enemies'],
	['encounters', 'Fights'],
	['mechanisms', 'Mechanisms'],
	['areas', 'Areas'],
	['reactions', 'Reactions'],
	['cues', 'Read-aloud cues']
];

/** Entries of a section by id: a record's keys, or a list's `id`s (by position when they have none). */
function entries(value: unknown): Map<string, string> {
	const out = new Map<string, string>();
	if (Array.isArray(value))
		value.forEach((v, i) => {
			const id = (v as { id?: unknown })?.id;
			out.set(typeof id === 'string' ? id : `#${i + 1}`, JSON.stringify(v));
		});
	else if (value && typeof value === 'object')
		for (const [k, v] of Object.entries(value)) out.set(k, JSON.stringify(v));
	return out;
}

/** What changes between two adventures, section by section (only sections that change). */
export function adventureChanges(from: AdventureDef, to: AdventureDef): SectionChange[] {
	const changes: SectionChange[] = [];
	for (const [key, section] of SECTIONS) {
		const a = entries(from[key]);
		const b = entries(to[key]);
		const added = [...b.keys()].filter((k) => !a.has(k));
		const removed = [...a.keys()].filter((k) => !b.has(k));
		const changed = [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k));
		if (added.length || removed.length || changed.length)
			changes.push({ section, added, removed, changed });
	}
	if ((from.about ?? '') !== (to.about ?? ''))
		changes.unshift({ section: 'About', added: [], removed: [], changed: ['the description'] });
	if (from.title !== to.title)
		changes.unshift({ section: 'Title', added: [to.title], removed: [from.title], changed: [] });
	return changes;
}

/** Why a story can't be moved at all right now, or null. */
export function cannotMove(adventure: AdventureState | null): string | null {
	if (!adventure) return 'No story is being played.';
	if (adventure.encounter) return 'Finish or call off the fight first.';
	if (adventure.running.size) return 'Wait for what is moving on the table to come to rest.';
	if (adventure.pending) return 'Answer the choice first.';
	return null;
}

/**
 * Works out the story under `target` without touching the room: the review
 * of what changes and whether it reads, and the story itself when it does.
 */
export function prepareMove(
	room: Room,
	target: MoveTarget,
	now = new Date()
): { review: UpgradeReview; next: AdventureState | null } {
	const current = room.adventure!;
	const problems = [...(target.problems ?? [])];
	const blocked = cannotMove(current);
	if (blocked) problems.push(blocked);
	if (target.from === target.to) problems.push(`The story already plays version ${target.to}.`);
	const before = contentOf(current.id);
	const ruleset = findRuleset(current.rules);
	const beforePacks = (current.packs ?? []).map(
		(p) => ruleset?.packs?.listing(p.id, { owner: p.owner, visibility: 'table' })?.name ?? p.id
	);

	let after: AdventureDef | null = before;
	let next: AdventureState | null = null;
	if (target.file !== null) {
		const loaded = loadCustomAdventure(target.file);
		after = loaded.ok ? loaded.adventure : null;
		if (!loaded.ok) problems.push(`Version ${target.to} no longer reads: ${loaded.error}`);
	}
	const sameRules = (r?: { id: string; version: number }) =>
		(r?.id ?? 'thirdfold-classic') === current.rules.id &&
		(r?.version ?? 1) === current.rules.version;
	if (after && !sameRules(after.rules))
		problems.push(
			`Version ${target.to} plays by other rules than the story (${current.rules.id} v${current.rules.version}).`
		);

	const afterPacks: string[] = [];
	for (const p of target.packs) {
		const held = ruleset?.packs?.hold(p.pack);
		if (!held?.ok) {
			problems.push(`Homebrew in version ${target.to} no longer reads.`);
			continue;
		}
		afterPacks.push(
			ruleset!.packs!.listing(held.id, { owner: p.owner, visibility: 'table' })!.name
		);
	}

	if (!problems.length && after) {
		// The story saved, then read back with the other content in place: every check a load makes.
		const scene = exportScene(room, room.sceneName);
		const saved = saveAdventure(current);
		const state: Record<string, unknown> = {
			...saved.state,
			packs: target.packs.map((p) => ({ owner: p.owner, pack: p.pack })),
			steps: withStep(current.steps, {
				what: target.what,
				item: target.item,
				from: target.from,
				to: target.to,
				rollback: target.to < target.from,
				at: now.toISOString()
			})
		};
		delete state.lock;
		if (!target.packs.length) delete state.packs;
		if (target.library) state.library = { ...target.library };
		else delete state.library;
		if (target.collection) state.collection = JSON.parse(JSON.stringify(target.collection));
		else delete state.collection;
		if (target.entitlements.length) state.entitlements = target.entitlements.map((e) => ({ ...e }));
		else delete state.entitlements;
		const read = readAdventure(
			{
				id: after.id,
				version: after.version,
				...(target.file !== null ? { content: target.file as Record<string, unknown> } : {}),
				state
			},
			scene
		);
		if (read.ok) {
			next = read.adventure;
			// What isn't saved stays as it was.
			if (current.rated) next.rated = current.rated;
			if (current.again) next.again = current.again;
		} else
			problems.push(
				`The story where it is doesn't fit version ${target.to}: ${read.error.replace(/^The saved story is invalid: /, '')}`
			);
	}

	return {
		review: {
			what: target.what,
			title: target.title,
			from: target.from,
			to: target.to,
			rollback: target.to < target.from,
			changes: after ? adventureChanges(before, after) : [],
			packs: {
				added: afterPacks.filter((n) => !beforePacks.includes(n)),
				removed: beforePacks.filter((n) => !afterPacks.includes(n))
			},
			problems,
			ok: problems.length === 0 && next !== null
		},
		next: problems.length ? null : next
	};
}
