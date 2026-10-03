// The adventure library and the open games, asked of the game server from
// outside a table (see server/library-store.ts). The GM key goes only to
// that server; a key it issues on a first publish is kept in this browser.

import type { LibraryOp } from '$lib/game/protocol';
import type { LibraryKind, LibrarySort, MyAdventure } from '$lib/game/library';
import { saveGmKey } from '$lib/prefs';
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

/** One listed adventure, opened: its listing, opening and facts; null when there is none. */
export async function openStory(id: string) {
	return (await ask({ type: 'library_story', id }, 'library_story')).story;
}

/** A creator's own items, of one kind when asked. */
export async function listMine(gmKey: string, kind?: LibraryKind): Promise<MyAdventure[]> {
	const all = (await ask({ type: 'library_mine', gmKey }, 'library_mine')).adventures;
	return kind ? all.filter((a) => a.kind === kind) : all;
}

/** A collection and what became of everything it names; null when there is no such collection. */
export async function checkCollection(id: string, version?: number, gmKey?: string | null) {
	return (
		await ask(
			{
				type: 'collection_check',
				id,
				...(version !== undefined ? { version } : {}),
				...(gmKey ? { gmKey } : {})
			},
			'collection_report'
		)
	).report;
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
