// A story's lock (milestone 55, src/lib/adventure/versions.ts): every piece
// of rules and content it plays by, at the version it found. It is worked
// out from the story (which already carries its adventure file and homebrew
// as written, and pins its rules and collection), saved with it, and on a
// load compared with what this server would play it by: content from another
// source refuses the story with what to do about it, and content rebuilt
// from the same source (the catalog re-imported) is a migration the load
// checks in full and names.

import type { ContentPin, StoryLock, VersionStep } from '../../src/lib/adventure/versions';
import { VERSION_STEPS_MAX } from '../../src/lib/adventure/versions';
import { contentOf } from './registry';
import { fileOf } from './custom';
import type { AdventureState } from './state';
import { findRuleset } from '../rules/ruleset';

/** What a story plays by, now. */
export function lockOf(adventure: AdventureState): StoryLock {
	const ruleset = findRuleset(adventure.rules);
	const A = contentOf(adventure.id);
	const file = fileOf(A.id);
	return {
		rules: {
			id: adventure.rules.id,
			version: adventure.rules.version,
			name: ruleset?.name ?? adventure.rules.id
		},
		content: ruleset?.contentPins?.().map((p) => ({ ...p })) ?? [],
		adventure: file
			? {
					kind: 'file',
					id: A.id,
					title: A.title,
					library: adventure.library
						? {
								id: adventure.library.id,
								version: adventure.library.version,
								creator: { ...adventure.library.creator }
							}
						: null
				}
			: { kind: 'built-in', id: A.id, version: A.version },
		packs: (adventure.packs ?? []).map((p) => {
			const listing = ruleset?.packs?.listing(p.id, { owner: p.owner, visibility: 'table' });
			return { id: p.id, name: listing?.name ?? p.id, version: listing?.version ?? '' };
		}),
		collection: adventure.collection
			? {
					id: adventure.collection.id,
					version: adventure.collection.version,
					title: adventure.collection.title
				}
			: null
	};
}

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max = 200) => typeof v === 'string' && v.length <= max;

/** The content pins a saved lock names, or null when it is not a lock (the rest is the story's own to check). */
export function savedPins(raw: unknown): ContentPin[] | null {
	if (!isObject(raw) || !Array.isArray(raw.content) || raw.content.length > 8) return null;
	const pins: ContentPin[] = [];
	for (const p of raw.content) {
		if (
			!isObject(p) ||
			!text(p.id, 64) ||
			!text(p.name) ||
			!text(p.version, 32) ||
			typeof p.sha256 !== 'string' ||
			!/^[0-9a-f]{64}$/.test(p.sha256) ||
			typeof p.build !== 'string' ||
			!/^[0-9a-f]{64}$/.test(p.build)
		)
			return null;
		pins.push({
			id: p.id as string,
			name: p.name as string,
			version: p.version as string,
			sha256: p.sha256,
			build: p.build
		});
	}
	return pins;
}

/**
 * What a load makes of the content a story was locked to, against what this
 * server has: `error` when it can't be played here (and what to do), `notes`
 * for what was migrated and checked.
 */
export function compareContent(
	saved: readonly ContentPin[],
	current: readonly ContentPin[]
): { error: string | null; notes: string[] } {
	const notes: string[] = [];
	for (const pin of saved) {
		const here = current.find((c) => c.id === pin.id);
		if (!here)
			return {
				error: `This story plays by ${pin.name} ${pin.version}, which this server doesn't have. Open it on a server that has it.`,
				notes
			};
		if (here.sha256 !== pin.sha256)
			return {
				error: `This story was played with ${pin.name} made from another source (${pin.sha256.slice(0, 12)}…) than this server's (${here.sha256.slice(0, 12)}…), and no migration between them is known. Open it on a server with the same source.`,
				notes
			};
		if (here.build !== pin.build)
			notes.push(
				`${pin.name} was rebuilt from the same source since this story was saved (build ${pin.build.slice(0, 8)} → ${here.build.slice(0, 8)}); every character was checked against this build.`
			);
	}
	return { error: null, notes };
}

/** The steps a story's content was moved by, read back: each well formed, at most VERSION_STEPS_MAX. */
export function readSteps(raw: unknown): VersionStep[] | null {
	if (!Array.isArray(raw) || raw.length > VERSION_STEPS_MAX) return null;
	const out: VersionStep[] = [];
	const version = (v: unknown) =>
		typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 100;
	for (const s of raw) {
		if (
			!isObject(s) ||
			Object.keys(s).length !== 6 ||
			(s.what !== 'adventure' && s.what !== 'collection') ||
			typeof s.item !== 'string' ||
			!/^[0-9a-f]{32}$/.test(s.item) ||
			!version(s.from) ||
			!version(s.to) ||
			typeof s.rollback !== 'boolean' ||
			typeof s.at !== 'string' ||
			Number.isNaN(Date.parse(s.at))
		)
			return null;
		out.push({
			what: s.what,
			item: s.item,
			from: s.from as number,
			to: s.to as number,
			rollback: s.rollback,
			at: s.at
		});
	}
	return out;
}

/** A step added to a story's, the oldest dropped beyond what is kept. */
export function withStep(
	steps: readonly VersionStep[] | undefined,
	step: VersionStep
): VersionStep[] {
	return [...(steps ?? []), step].slice(-VERSION_STEPS_MAX);
}
