// The adventure library (see src/lib/game/library.ts): adventures creators
// publish, each a list of versions of an adventure file, owned by the GM key
// that published it (by its hash, like saves). Anyone can find and play a
// listed adventure; its creator can publish new versions, take it out of the
// library (unlist) or remove it. Plays and ratings are counted here. Since
// milestone 54 each item also has an access level and grants (who may find,
// open and play it: src/lib/game/access.ts); the store keeps them, and the
// game server decides by them (server/library-access.ts).
//
// The file and memory stores share one implementation over a small key/value
// interface; the Supabase store keeps the same data in Postgres.

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
	accessOf,
	flagsOf,
	GRANT_LIMITS,
	grantActive,
	parseGrant,
	type Grant,
	type LibraryAccess,
	type NewGrant
} from '../src/lib/game/access';
import {
	LIBRARY_ID_PATTERN,
	LIBRARY_LIMITS,
	matchesQuery,
	ratingOf,
	sortListings,
	type Creator,
	type LibraryKind,
	type LibraryListing,
	type LibrarySort,
	type MyAdventure,
	type SharedListing
} from '../src/lib/game/library';

export type LibraryErrorCode = 'forbidden' | 'not_found' | 'too_many';

/** A publish or change the library refuses; its message is for the creator. */
export class LibraryError extends Error {
	constructor(
		readonly code: LibraryErrorCode,
		message: string
	) {
		super(message);
	}
}

export interface Publication {
	/** What it is: an adventure (the default), a homebrew pack or a collection. */
	kind?: LibraryKind;
	/** The publishing GM's key hash. */
	owner: string;
	creatorName: string;
	title: string;
	about: string;
	/** The checked file: an adventure, a pack or a collection. */
	file: unknown;
}

export interface LibraryQuery {
	/** Which kind to list: adventures when absent. */
	kind?: LibraryKind;
	query?: string | null;
	creator?: string | null;
	sort?: LibrarySort;
}

/** A version of an adventure, to play. */
export interface LibraryCopy {
	listing: LibraryListing;
	listed: boolean;
	/** Listed, but only for its owner and those granted it (milestone 54). */
	restricted: boolean;
	owner: string;
	/** Every grant on it, revoked and lapsed ones too: what access is decided by (server/library-access.ts). */
	grants: Grant[];
	file: unknown;
}

export interface LibraryStore {
	/**
	 * Publishes an adventure (or a pack or collection, by its `kind`) and
	 * returns its id and version. With `id`, adds a new version of that one,
	 * which must be `owner`'s and of the same kind.
	 */
	publish(publication: Publication, id?: string): Promise<{ id: string; version: number }>;
	/** Listed adventures, or the query's kind (a creator's, with `creator`), latest versions, in the sort's order. */
	list(query: LibraryQuery): Promise<{ adventures: LibraryListing[]; creator: Creator | null }>;
	/** An owner's own adventures, packs and collections, listed or not, newest first. */
	mine(owner: string): Promise<MyAdventure[]>;
	/** A version (the latest without one), or null when there is no such adventure or version. */
	get(id: string, version?: number): Promise<LibraryCopy | null>;
	/** Sets who may find and use an owner's item (public, restricted, private); false if it isn't theirs. */
	setAccess(id: string, owner: string, access: LibraryAccess): Promise<boolean>;
	/**
	 * The owner grants a role on their item; null if it isn't theirs. At most
	 * GRANT_LIMITS.active grants are in force on one item (else `too_many`).
	 */
	grant(id: string, owner: string, grant: NewGrant, now?: Date): Promise<Grant | null>;
	/** The owner revokes a grant (kept, marked revoked); false if there is no such grant of theirs in force. */
	revoke(id: string, owner: string, grantId: string, now?: Date): Promise<boolean>;
	/** What others shared with a creator (by public id), by grants in force, newest first. */
	shared(creator: string, now?: Date): Promise<SharedListing[]>;
	/** Removes an owner's adventure and all its versions; false if it isn't theirs. */
	remove(id: string, owner: string): Promise<boolean>;
	/** A table started playing it. */
	played(id: string): Promise<void>;
	/** Someone who played it gives it 1-5 stars (again: their new rating replaces the old). */
	rate(id: string, rater: string, stars: number): Promise<void>;
}

export function newLibraryId(): string {
	return randomBytes(16).toString('hex');
}

/** A creator's public id: derived from their key's hash, so it names them without revealing it. */
export function creatorIdOf(owner: string): string {
	return createHash('sha256').update(`thirdfold-creator:${owner}`).digest('hex').slice(0, 16);
}

// -----------------------------------------------------------------------------

interface Entry {
	id: string;
	/** Absent in entries from before milestone 53: an adventure. */
	kind?: LibraryKind;
	owner: string;
	creatorName: string;
	title: string;
	about: string;
	listed: boolean;
	version: number;
	publishedAt: string;
	createdAt: string;
	plays: number;
	/** Stars by rater. */
	ratings: Record<string, number>;
	/** Absent in entries from before milestone 54: not restricted. */
	restricted?: boolean;
	/** Absent in entries from before milestone 54: none. */
	grants?: Grant[];
}

/** Where the shared store keeps its text: one entry per adventure, one per version. */
interface Blobs {
	get(key: string): Promise<string | null>;
	put(key: string, text: string): Promise<void>;
	delete(key: string): Promise<void>;
	keys(): Promise<string[]>;
}

const entryKey = (id: string) => `${id}.json`;
const versionKey = (id: string, version: number) => `${id}.v${version}.json`;
const ENTRY_KEY = /^([0-9a-f]{32})\.json$/;

function listingOf(e: Entry): LibraryListing {
	const stars = Object.values(e.ratings);
	return {
		id: e.id,
		kind: e.kind ?? 'adventure',
		title: e.title,
		about: e.about,
		creator: { id: creatorIdOf(e.owner), name: e.creatorName },
		version: e.version,
		publishedAt: e.publishedAt,
		plays: e.plays,
		rating: ratingOf(
			stars.reduce((a, b) => a + b, 0),
			stars.length
		),
		access: accessOf(e.listed, e.restricted ?? false)
	};
}

const grantsOf = (e: Entry): Grant[] =>
	(e.grants ?? []).map(parseGrant).filter((g): g is Grant => g !== null);

/** A new grant, as the owner asked for it. */
export function makeGrant(owner: string, g: NewGrant, now: Date): Grant {
	return {
		id: randomBytes(16).toString('hex'),
		target: { ...g.target },
		role: g.role,
		by: creatorIdOf(owner),
		at: now.toISOString(),
		expires:
			g.hours === undefined ? null : new Date(now.getTime() + g.hours * 3600_000).toISOString(),
		revoked: null,
		note: g.note ?? ''
	};
}

/**
 * Adds a grant to an item's, refusing one too many in force, and dropping
 * the oldest revoked or lapsed ones beyond what is kept.
 */
export function withGrant(grants: Grant[], added: Grant, now: Date): Grant[] {
	const t = now.getTime();
	if (grants.filter((g) => grantActive(g, t)).length >= GRANT_LIMITS.active)
		throw new LibraryError('too_many', 'That has as many grants in force as it can have.');
	const all = [added, ...grants];
	let over = all.length - GRANT_LIMITS.kept;
	for (let i = all.length - 1; i >= 0 && over > 0; i--)
		if (!grantActive(all[i], t)) {
			all.splice(i, 1);
			over--;
		}
	return all;
}

class BlobLibraryStore implements LibraryStore {
	/** Changes to one adventure go one at a time (two publishes never take the same version). */
	private queue: Promise<unknown> = Promise.resolve();

	constructor(private readonly blobs: Blobs) {}

	private serial<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.queue.then(fn, fn);
		this.queue = run.catch(() => undefined);
		return run;
	}

	private async entry(id: string): Promise<Entry | null> {
		if (!LIBRARY_ID_PATTERN.test(id)) return null;
		const text = await this.blobs.get(entryKey(id));
		return text === null ? null : (JSON.parse(text) as Entry);
	}

	private async entries(): Promise<Entry[]> {
		const out: Entry[] = [];
		for (const key of await this.blobs.keys()) {
			const id = ENTRY_KEY.exec(key)?.[1];
			const e = id ? await this.entry(id) : null;
			if (e) out.push(e);
		}
		return out;
	}

	private save(e: Entry): Promise<void> {
		return this.blobs.put(entryKey(e.id), JSON.stringify(e));
	}

	publish(p: Publication, id?: string): Promise<{ id: string; version: number }> {
		return this.serial(async () => {
			const now = new Date().toISOString();
			let e = id === undefined ? null : await this.entry(id);
			const kind = p.kind ?? 'adventure';
			if (id !== undefined && (!e || (e.kind ?? 'adventure') !== kind))
				throw new LibraryError('not_found', `There is no such ${kind}.`);
			if (e && e.owner !== p.owner) {
				throw new LibraryError('forbidden', 'That adventure belongs to someone else.');
			}
			if (e && e.version >= LIBRARY_LIMITS.versions) {
				throw new LibraryError('too_many', 'That adventure has as many versions as it can keep.');
			}
			if (!e) {
				const own = (await this.entries()).filter((x) => x.owner === p.owner).length;
				if (own >= LIBRARY_LIMITS.perCreator) {
					throw new LibraryError('too_many', 'You have published as many adventures as you can.');
				}
				e = {
					id: newLibraryId(),
					kind,
					owner: p.owner,
					creatorName: p.creatorName,
					title: p.title,
					about: p.about,
					listed: true,
					version: 0,
					publishedAt: now,
					createdAt: now,
					plays: 0,
					ratings: {},
					restricted: false,
					grants: []
				};
			}
			const version = e.version + 1;
			// The version first: an entry never names a version that isn't there.
			await this.blobs.put(versionKey(e.id, version), JSON.stringify(p.file));
			await this.save({
				...e,
				creatorName: p.creatorName,
				title: p.title,
				about: p.about,
				version,
				publishedAt: now
			});
			return { id: e.id, version };
		});
	}

	async list(q: LibraryQuery) {
		const all = await this.entries();
		const kind = q.kind ?? 'adventure';
		const listed = all.filter(
			(e) =>
				e.listed &&
				(e.kind ?? 'adventure') === kind &&
				(!q.creator || creatorIdOf(e.owner) === q.creator)
		);
		const adventures = sortListings(
			listed.map(listingOf).filter((l) => matchesQuery(l, q.query ?? null)),
			q.sort ?? 'top'
		).slice(0, LIBRARY_LIMITS.list);
		const latest = listed.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
		const creator = q.creator && latest ? { id: q.creator, name: latest.creatorName } : null;
		return { adventures, creator };
	}

	async mine(owner: string): Promise<MyAdventure[]> {
		return (await this.entries())
			.filter((e) => e.owner === owner)
			.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
			.map((e) => ({ ...listingOf(e), listed: e.listed, grants: grantsOf(e) }));
	}

	async shared(creator: string, now = new Date()): Promise<SharedListing[]> {
		const t = now.getTime();
		const out: SharedListing[] = [];
		for (const e of await this.entries()) {
			const grant = grantsOf(e)
				.filter((g) => grantActive(g, t) && g.target.kind === 'creator' && g.target.id === creator)
				.sort((a, b) => (a.role === b.role ? 0 : a.role === 'collaborator' ? -1 : 1))[0];
			if (grant) out.push({ ...listingOf(e), role: grant.role, grant });
		}
		return out.sort((a, b) => b.grant.at.localeCompare(a.grant.at)).slice(0, LIBRARY_LIMITS.list);
	}

	async get(id: string, version?: number): Promise<LibraryCopy | null> {
		const e = await this.entry(id);
		const v = version ?? e?.version;
		if (!e || !v || !Number.isInteger(v) || v < 1 || v > e.version) return null;
		const text = await this.blobs.get(versionKey(id, v));
		if (text === null) return null;
		return {
			listing: { ...listingOf(e), version: v },
			listed: e.listed,
			restricted: e.restricted ?? false,
			owner: e.owner,
			grants: grantsOf(e),
			file: JSON.parse(text)
		};
	}

	setAccess(id: string, owner: string, access: LibraryAccess): Promise<boolean> {
		return this.serial(async () => {
			const e = await this.entry(id);
			if (!e || e.owner !== owner) return false;
			await this.save({ ...e, ...flagsOf(access) });
			return true;
		});
	}

	grant(id: string, owner: string, g: NewGrant, now = new Date()): Promise<Grant | null> {
		return this.serial(async () => {
			const e = await this.entry(id);
			if (!e || e.owner !== owner) return null;
			const added = makeGrant(owner, g, now);
			await this.save({ ...e, grants: withGrant(grantsOf(e), added, now) });
			return added;
		});
	}

	revoke(id: string, owner: string, grantId: string, now = new Date()): Promise<boolean> {
		return this.serial(async () => {
			const e = await this.entry(id);
			if (!e || e.owner !== owner) return false;
			const grants = grantsOf(e);
			const g = grants.find((x) => x.id === grantId);
			if (!g || !grantActive(g, now.getTime())) return false;
			await this.save({
				...e,
				grants: grants.map((x) => (x === g ? { ...x, revoked: now.toISOString() } : x))
			});
			return true;
		});
	}

	remove(id: string, owner: string): Promise<boolean> {
		return this.serial(async () => {
			const e = await this.entry(id);
			if (!e || e.owner !== owner) return false;
			await this.blobs.delete(entryKey(id));
			for (let v = 1; v <= e.version; v++) await this.blobs.delete(versionKey(id, v));
			return true;
		});
	}

	played(id: string): Promise<void> {
		return this.serial(async () => {
			const e = await this.entry(id);
			if (e) await this.save({ ...e, plays: e.plays + 1 });
		});
	}

	rate(id: string, rater: string, stars: number): Promise<void> {
		return this.serial(async () => {
			const e = await this.entry(id);
			if (!e) throw new LibraryError('not_found', 'That adventure is no longer in the library.');
			await this.save({ ...e, ratings: { ...e.ratings, [rater]: stars } });
		});
	}
}

/** For tests and throwaway servers. */
export class MemoryLibraryStore extends BlobLibraryStore {
	constructor() {
		const map = new Map<string, string>();
		super({
			get: async (k) => map.get(k) ?? null,
			put: async (k, t) => void map.set(k, t),
			delete: async (k) => void map.delete(k),
			keys: async () => [...map.keys()]
		});
	}
}

/** One JSON file per adventure and one per version, written then renamed. */
export class FileLibraryStore extends BlobLibraryStore {
	constructor(dir: string) {
		const KEY = /^[0-9a-f]{32}(\.v\d{1,3})?\.json$/;
		const file = (key: string) => {
			if (!KEY.test(key)) throw new Error('Invalid library key');
			return path.join(dir, key);
		};
		super({
			async get(key) {
				try {
					return await readFile(file(key), 'utf8');
				} catch (err) {
					if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
					throw err;
				}
			},
			async put(key, text) {
				await mkdir(dir, { recursive: true });
				const tmp = `${file(key)}.${process.pid}.tmp`;
				await writeFile(tmp, text, 'utf8');
				await rename(tmp, file(key));
			},
			async delete(key) {
				await rm(file(key), { force: true });
			},
			async keys() {
				try {
					return (await readdir(dir)).filter((k) => KEY.test(k));
				} catch (err) {
					if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
					throw err;
				}
			}
		});
	}
}
