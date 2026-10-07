// Campaign collections on the server (milestone 53, src/lib/game/collection.ts):
// what a collection names is looked up where it lives, each piece checked as
// it would be to play it (an adventure loaded, a pack held by its rules, a
// table found among the shared ones), and the whole is compatible only when
// every adventure and pack plays by the collection's rules. The report says
// what became of each piece; nothing starts unless every one is there.
//
// A library piece is available to a collection when the collection may
// include it (milestone 54, server/library-access.ts): it is public, its
// creator's own, the creator is a collaborator on it, or it was granted to
// the collection. A piece the asker may not even know of reads as missing.

import { loadServerAdventure } from './adventure/rules-content';
import {
	refName,
	type AdventureRef,
	type CollectionDraft,
	type CollectionFile,
	type CollectionReport,
	type DependencyReport,
	type PinnedRef,
	type TableRef
} from '../src/lib/game/collection';
import type { Creator } from '../src/lib/game/library';
import type { Entitlement } from '../src/lib/game/access';
import { builtInAdventures } from './adventure/registry';
import { decide, entitlementOf } from './library-access';
import type { LibraryCopy, LibraryStore } from './library-store';
import { CLASSIC } from './rules/classic';
import { findRuleset, type RulesetRef } from './rules/ruleset';
import type { SceneStore } from './scene-store';

/** Where a collection's pieces are looked for. */
export interface Shelves {
	library: LibraryStore;
	scenes: SceneStore;
}

/** An adventure of a collection, found: how to start it. */
export type FoundAdventure =
	| { ref: { builtIn: string }; title: string }
	| { ref: PinnedRef; title: string; copy: LibraryCopy; entitlement: Entitlement | null };

/** A pack of a collection, found and held by its rules. */
export interface FoundPack {
	ref: PinnedRef;
	title: string;
	/** The pack's own id (from its content). */
	packId: string;
	/** The public creator id of whoever published it. */
	creator: Creator;
	/** The grant it is carried by, when it isn't public or the collection creator's own. */
	entitlement: Entitlement | null;
}

/** Everything a collection names, found and fitting: what a table starts from. */
export interface Resolved {
	file: CollectionFile;
	adventures: FoundAdventure[];
	packs: FoundPack[];
	tables: TableRef[];
}

const sameRules = (a: RulesetRef, b: RulesetRef) => a.id === b.id && a.version === b.version;
const rulesName = (r: RulesetRef) => findRuleset(r)?.name ?? `${r.id} v${r.version}`;

/** The rules an adventure plays by: its own, else the classic rules. */
function rulesOfAdventure(ref: AdventureRef, copy?: LibraryCopy): RulesetRef | null {
	if ('builtIn' in ref) {
		const found = builtInAdventures().find((a) => a.id === ref.builtIn);
		return found ? (found.rules ?? CLASSIC) : null;
	}
	if (!copy) return null;
	const loaded = loadServerAdventure(copy.file, `library-${ref.library}`);
	return loaded.ok ? (loaded.adventure.rules ?? CLASSIC) : null;
}

/**
 * A library item at its version, when it is of the kind and the collection
 * (made by `owner`, and `collection` once it has an id) may include it.
 */
async function pinned(
	shelves: Shelves,
	ref: PinnedRef,
	kind: 'adventure' | 'pack',
	owner: string,
	collection: string | null
): Promise<
	| { copy: LibraryCopy; entitlement: Entitlement | null }
	| { status: 'missing' | 'unavailable'; message: string; title?: string }
> {
	const copy = await shelves.library.get(ref.library, ref.version);
	const missing = {
		status: 'missing' as const,
		message: `No ${kind} ${refName(ref)} in the library.`
	};
	if (!copy || copy.listing.kind !== kind) return missing;
	const decision = decide(copy, { owner, collection }, 'include');
	if (!decision.ok) {
		// One the asker can't know of is as good as not there.
		if (!decision.visible) return missing;
		return {
			status: 'unavailable',
			title: copy.listing.title,
			message:
				copy.listing.access === 'restricted'
					? `${copy.listing.title} is shared only with those its creator chooses: ask them to grant this collection or you.`
					: `${copy.listing.title} was taken out of the library by its creator.`
		};
	}
	return { copy, entitlement: entitlementOf(ref.library, decision) };
}

/**
 * Fills a draft's rules from its first adventure (the server's to say, not
 * the page's); null when that adventure can't be found.
 */
export async function withRules(
	shelves: Shelves,
	draft: CollectionDraft,
	owner: string,
	collection: string | null = null
): Promise<CollectionFile | null> {
	if (draft.rules) return draft as CollectionFile;
	const first = draft.adventures[0];
	let copy: LibraryCopy | undefined;
	if (first && !('builtIn' in first)) {
		const found = await pinned(shelves, first, 'adventure', owner, collection);
		if (!('copy' in found)) return null;
		copy = found.copy;
	}
	const rules = first ? rulesOfAdventure(first, copy) : null;
	return rules ? { ...draft, rules: { id: rules.id, version: rules.version } } : null;
}

/**
 * Looks for everything a collection names, as its creator (`owner`, the
 * key hash) may include it in this collection (`collection`, its library id
 * once it has one). Every piece gets a line in the report; `resolved` is
 * there only when every line is ok.
 */
export async function resolveCollection(
	shelves: Shelves,
	file: CollectionFile,
	owner: string,
	collection: string | null = null
): Promise<{ items: DependencyReport[]; resolved: Resolved | null }> {
	const items: DependencyReport[] = [];
	const rules = file.rules;
	const ruleset = findRuleset(rules);
	items.push({
		kind: 'rules',
		ref: `${rules.id} v${rules.version}`,
		title: ruleset?.name ?? null,
		version: rules.version,
		status: ruleset ? 'ok' : 'missing',
		message: ruleset ? '' : `This server doesn't have the rules ${rules.id} v${rules.version}.`
	});

	const adventures: FoundAdventure[] = [];
	for (const ref of file.adventures) {
		const line: DependencyReport = {
			kind: 'adventure',
			ref: refName(ref),
			title: null,
			version: 'builtIn' in ref ? null : ref.version,
			status: 'ok',
			message: ''
		};
		items.push(line);
		if ('builtIn' in ref) {
			const found = builtInAdventures().find((a) => a.id === ref.builtIn);
			if (!found) {
				Object.assign(line, {
					status: 'missing',
					message: `This server has no adventure "${ref.builtIn}".`
				});
				continue;
			}
			line.title = found.title;
			const own = found.rules ?? CLASSIC;
			if (!sameRules(own, rules)) {
				Object.assign(line, {
					status: 'incompatible',
					message: `${found.title} plays by ${rulesName(own)}, not ${rulesName(rules)}.`
				});
				continue;
			}
			adventures.push({ ref: { builtIn: ref.builtIn }, title: found.title });
			continue;
		}
		const found = await pinned(shelves, ref, 'adventure', owner, collection);
		if (!('copy' in found)) {
			Object.assign(line, found);
			continue;
		}
		line.title = found.copy.listing.title;
		const loaded = loadServerAdventure(found.copy.file, `library-${ref.library}`);
		if (!loaded.ok) {
			Object.assign(line, { status: 'invalid', message: loaded.error });
			continue;
		}
		const own = loaded.adventure.rules ?? CLASSIC;
		if (!sameRules(own, rules)) {
			Object.assign(line, {
				status: 'incompatible',
				message: `${line.title} plays by ${rulesName(own)}, not ${rulesName(rules)}.`
			});
			continue;
		}
		adventures.push({ ref, title: line.title!, copy: found.copy, entitlement: found.entitlement });
	}

	const packs: FoundPack[] = [];
	for (const ref of file.packs) {
		const line: DependencyReport = {
			kind: 'pack',
			ref: refName(ref),
			title: null,
			version: ref.version,
			status: 'ok',
			message: ''
		};
		items.push(line);
		const found = await pinned(shelves, ref, 'pack', owner, collection);
		if (!('copy' in found)) {
			Object.assign(line, found);
			continue;
		}
		line.title = found.copy.listing.title;
		if (!ruleset?.packs) {
			Object.assign(line, {
				status: 'incompatible',
				message: `${rulesName(rules)} take no homebrew.`
			});
			continue;
		}
		const held = ruleset.packs.hold(found.copy.file);
		if (!held.ok) {
			Object.assign(line, {
				status: 'invalid',
				message: `It no longer reads: ${held.problems.slice(0, 2).join('; ')}.`
			});
			continue;
		}
		packs.push({
			ref,
			title: line.title!,
			packId: held.id,
			creator: { ...found.copy.listing.creator },
			entitlement: found.entitlement
		});
	}

	for (const table of file.tables) {
		const shared = (await shelves.scenes.ownerOf(table.code)) === null;
		items.push({
			kind: 'table',
			ref: table.code,
			title: table.name,
			version: null,
			status: shared ? 'ok' : 'missing',
			message: shared ? '' : `No shared table with the code ${table.code}.`
		});
	}

	const ok = items.every((i) => i.status === 'ok');
	return {
		items,
		resolved: ok ? { file, adventures, packs, tables: file.tables.map((t) => ({ ...t })) } : null
	};
}

/** A report for a collection found in the library. */
export function reportOf(
	copy: LibraryCopy,
	file: CollectionFile,
	items: DependencyReport[]
): CollectionReport {
	return {
		id: copy.listing.id,
		version: copy.listing.version,
		title: file.title,
		about: file.about,
		creator: { ...copy.listing.creator },
		rules: { ...file.rules, name: findRuleset(file.rules)?.name ?? null },
		items,
		ok: items.every((i) => i.status === 'ok')
	};
}

/** What is wrong with a collection, in a sentence: its first few problems. */
export function problemsOf(items: DependencyReport[]): string {
	const bad = items.filter((i) => i.status !== 'ok');
	return `${bad
		.slice(0, 3)
		.map((i) => i.message)
		.join(' ')}${bad.length > 3 ? ` (and ${bad.length - 3} more)` : ''}`;
}
