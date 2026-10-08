// The adventure library and the open games, asked of the game server from
// outside a table (see server/library-store.ts). The GM key goes only to
// that server; a key it issues on a first publish is kept in this browser.

import type { LibraryOp } from '$lib/game/protocol';
import type { NewGrant } from '$lib/game/access';
import type { LibraryKind, LibrarySort, MyAdventure, SharedListing } from '$lib/game/library';
import { saveGmKey } from '$lib/prefs';
import type { ContentKind, Validation } from '$lib/validation/diagnostics';
import type { AdventurePreview } from '$lib/adventure/preview';
import type { MonsterListing } from '$lib/adventure/adventure';
import { ask } from './ask';

export async function listLibrary(q: {
	query?: string;
	creator?: string;
	sort?: LibrarySort;
	kind?: LibraryKind;
}) {
	const query = q.query?.trim();
	return ask(
		{
			type: 'library_list',
			...(query ? { query } : {}),
			...(q.creator ? { creator: q.creator } : {}),
			...(q.sort ? { sort: q.sort } : {}),
			...(q.kind && q.kind !== 'adventure' ? { kind: q.kind } : {})
		},
		'library_list'
	);
}

/**
 * One adventure, opened: its listing, opening and facts; null when there is
 * none this browser's GM key may open (`locked` when it is listed but shared
 * only with those its creator chooses).
 */
export async function openStory(id: string, gmKey?: string | null) {
	const reply = await ask(
		{ type: 'library_story', id, ...(gmKey ? { gmKey } : {}) },
		'library_story'
	);
	return { story: reply.story, locked: reply.locked === true };
}

/**
 * A collection and what became of everything it names; null when there is
 * no such collection this GM key may open (`locked`: listed, but restricted).
 */
export async function checkCollection(id: string, version?: number, gmKey?: string | null) {
	const reply = await ask(
		{
			type: 'collection_check',
			id,
			...(version !== undefined ? { version } : {}),
			...(gmKey ? { gmKey } : {})
		},
		'collection_report'
	);
	return { report: reply.report, locked: reply.locked === true };
}

/**
 * Checks content the way the server will use it (milestone 56), changing
 * nothing: a collection as this GM key's creator may include its pieces.
 */
export async function validateOnServer(
	kind: ContentKind,
	file: unknown,
	gmKey?: string | null
): Promise<{ validation: Validation; preview: AdventurePreview | null }> {
	const reply = await ask(
		{ type: 'content_validate', kind, file, ...(gmKey ? { gmKey } : {}) },
		'validation',
		undefined,
		15000
	);
	return { validation: reply.validation, preview: reply.preview ?? null };
}

/** Monsters a ruleset's bestiary can play, by name, type or challenge (milestone 57: the builder). */
export async function searchBestiary(
	rules: { id: string; version: number },
	query: string
): Promise<MonsterListing[]> {
	return (await ask({ type: 'bestiary_search', rules, query }, 'monster_search')).monsters;
}

/** A creator's own items, what others shared with them, and the id others grant to. */
export interface LibraryHome {
	mine: MyAdventure[];
	shared: SharedListing[];
	creatorId: string;
}

const homeOf = (m: { adventures: MyAdventure[]; shared: SharedListing[]; creatorId: string }) => ({
	mine: m.adventures,
	shared: m.shared,
	creatorId: m.creatorId
});

export async function libraryHome(gmKey: string): Promise<LibraryHome> {
	return homeOf(await ask({ type: 'library_mine', gmKey }, 'library_mine'));
}

/** The owner shares one of their items. */
export async function grantAccess(
	gmKey: string,
	adventureId: string,
	grant: NewGrant
): Promise<LibraryHome> {
	return homeOf(await ask({ type: 'library_grant', gmKey, adventureId, grant }, 'library_mine'));
}

/** The owner takes a grant back. */
export async function revokeGrant(
	gmKey: string,
	adventureId: string,
	grantId: string
): Promise<LibraryHome> {
	return homeOf(await ask({ type: 'library_revoke', gmKey, adventureId, grantId }, 'library_mine'));
}

/**
 * Publishes an adventure file, as a new adventure or the next version of one
 * of the creator's. Returns where it went and the GM key it is theirs by.
 */
export async function publishAdventure(p: {
	gmKey: string | null;
	creator: string;
	file: unknown;
	adventureId?: string;
	/** An adventure unless said: a homebrew pack or a collection. */
	kind?: LibraryKind;
}): Promise<{ adventureId: string; version: number; gmKey: string }> {
	const done = await ask(
		{
			type: 'library_publish',
			creator: p.creator,
			file: p.file,
			...(p.kind && p.kind !== 'adventure' ? { kind: p.kind } : {}),
			...(p.gmKey ? { gmKey: p.gmKey } : {}),
			...(p.adventureId ? { adventureId: p.adventureId } : {})
		},
		'library_published',
		undefined,
		15000
	);
	const gmKey = done.gmKey ?? p.gmKey!;
	if (done.gmKey) saveGmKey(done.gmKey);
	return { adventureId: done.adventureId, version: done.version, gmKey };
}

export async function manageAdventure(
	gmKey: string,
	adventureId: string,
	op: LibraryOp,
	kind?: LibraryKind
): Promise<MyAdventure[]> {
	const all = (await ask({ type: 'library_manage', gmKey, adventureId, op }, 'library_mine'))
		.adventures;
	return kind ? all.filter((a) => a.kind === kind) : all;
}

export async function listGames() {
	return (await ask({ type: 'games_list' }, 'games_list')).games;
}
