// Campaign collections (milestone 53): a creator's set of adventures, shared
// tables and homebrew packs, published to the library like an adventure. A
// collection holds no content of its own: it names each piece where it
// lives (an adventure that comes with thirdfold by id; a library adventure
// or pack by id and the exact version; a shared table by its code) and the
// rules they all play by. The server checks every one of them before a
// table starts the collection, says what is missing or doesn't fit, and the
// story keeps the versions it started with. Plain data, relative imports
// only.

import { LIBRARY_ID_PATTERN, type Creator } from './library';

export const COLLECTION_FORMAT = 'thirdfold-collection';
export const COLLECTION_FORMAT_VERSION = 1;

export const COLLECTION_LIMITS = {
	title: 120,
	about: 1000,
	adventures: 12,
	packs: 8,
	tables: 12,
	tableName: 48,
	versions: 100
} as const;

/** An adventure in a collection: one that comes with thirdfold, or a library one at a version. */
export type AdventureRef = { builtIn: string } | { library: string; version: number };
/** A library item at an exact version. */
export interface PinnedRef {
	library: string;
	version: number;
}
/** A shared table (Share table's code) and the name the collection gives it. */
export interface TableRef {
	code: string;
	name: string;
}

export interface CollectionFile {
	format: typeof COLLECTION_FORMAT;
	formatVersion: typeof COLLECTION_FORMAT_VERSION;
	title: string;
	about: string;
	/** The rules every adventure and pack in it plays by (the server fills it from the first adventure). */
	rules: { id: string; version: number };
	/** In order: the first is where the campaign starts. */
	adventures: AdventureRef[];
	/** Homebrew every story of the collection has. */
	packs: PinnedRef[];
	/** Tables the GM can open alongside. */
	tables: TableRef[];
}

/** A collection as a creator sends it: the rules may be left for the server to fill in. */
export type CollectionDraft = Omit<CollectionFile, 'rules'> & { rules?: CollectionFile['rules'] };

const BUILT_IN_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const TABLE_CODE = /^[0-9a-f]{32}$/;
const RULES_ID = /^[a-z0-9][a-z0-9.-]{0,39}$/;

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const version = (v: unknown) =>
	typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= COLLECTION_LIMITS.versions;
const text = (v: unknown, max: number, empty = false) =>
	typeof v === 'string' && v.length <= max && (empty || v.trim().length > 0);
// eslint-disable-next-line no-control-regex
const clean = (v: string) => v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
const only = (o: Raw, keys: string[]) => Object.keys(o).every((k) => keys.includes(k));

/** A library item's reference as words: "the library's 3f…a1, version 2". */
export function refName(ref: AdventureRef | PinnedRef): string {
	return 'builtIn' in ref ? ref.builtIn : `${ref.library.slice(0, 8)}… v${ref.version}`;
}

/**
 * Reads a collection, field by field: every reference well formed, nothing
 * named twice, nothing else. What the references point to is the server's
 * to check (`server/collections.ts`).
 */
export function parseCollectionFile(
	raw: unknown
): { ok: true; file: CollectionDraft } | { ok: false; problems: string[] } {
	const problems: string[] = [];
	if (!isObject(raw)) return { ok: false, problems: ['a collection must be an object'] };
	const known = [
		'format',
		'formatVersion',
		'title',
		'about',
		'rules',
		'adventures',
		'packs',
		'tables'
	];
	for (const k of Object.keys(raw))
		if (!known.includes(k)) problems.push(`${k}: not a field of a collection`);
	if (raw.format !== COLLECTION_FORMAT) problems.push(`format: "${COLLECTION_FORMAT}"`);
	if (raw.formatVersion !== COLLECTION_FORMAT_VERSION)
		problems.push(`formatVersion: ${COLLECTION_FORMAT_VERSION}`);
	if (!text(raw.title, COLLECTION_LIMITS.title))
		problems.push(`title: 1 to ${COLLECTION_LIMITS.title} characters`);
	if (!text(raw.about ?? '', COLLECTION_LIMITS.about, true))
		problems.push(`about: at most ${COLLECTION_LIMITS.about} characters`);
	let rules: CollectionFile['rules'] | undefined;
	if (raw.rules !== undefined) {
		const r = raw.rules;
		if (
			!isObject(r) ||
			!only(r, ['id', 'version']) ||
			typeof r.id !== 'string' ||
			!RULES_ID.test(r.id) ||
			typeof r.version !== 'number' ||
			!Number.isInteger(r.version) ||
			r.version < 1
		)
			problems.push('rules: { "id": a ruleset, "version": its version }');
		else rules = { id: r.id, version: r.version };
	}

	const list = (field: string, max: number, min = 0): unknown[] => {
		const v = raw[field] ?? [];
		if (!Array.isArray(v) || v.length > max || v.length < min) {
			problems.push(`${field}: a list of ${min ? `${min} to ` : 'at most '}${max}`);
			return [];
		}
		return v;
	};
	const adventures: AdventureRef[] = [];
	list('adventures', COLLECTION_LIMITS.adventures, 1).forEach((a, i) => {
		if (
			isObject(a) &&
			only(a, ['builtIn']) &&
			typeof a.builtIn === 'string' &&
			BUILT_IN_ID.test(a.builtIn)
		)
			adventures.push({ builtIn: a.builtIn });
		else if (
			isObject(a) &&
			only(a, ['library', 'version']) &&
			typeof a.library === 'string' &&
			LIBRARY_ID_PATTERN.test(a.library) &&
			version(a.version)
		)
			adventures.push({ library: a.library, version: a.version as number });
		else problems.push(`adventures[${i}]: { "builtIn": id } or { "library": id, "version": n }`);
	});
	const packs: PinnedRef[] = [];
	list('packs', COLLECTION_LIMITS.packs).forEach((p, i) => {
		if (
			isObject(p) &&
			only(p, ['library', 'version']) &&
			typeof p.library === 'string' &&
			LIBRARY_ID_PATTERN.test(p.library) &&
			version(p.version)
		)
			packs.push({ library: p.library, version: p.version as number });
		else problems.push(`packs[${i}]: { "library": id, "version": n }`);
	});
	const tables: TableRef[] = [];
	list('tables', COLLECTION_LIMITS.tables).forEach((t, i) => {
		if (
			isObject(t) &&
			only(t, ['code', 'name']) &&
			typeof t.code === 'string' &&
			TABLE_CODE.test(t.code) &&
			text(t.name, COLLECTION_LIMITS.tableName)
		)
			tables.push({ code: t.code, name: clean(t.name as string) });
		else problems.push(`tables[${i}]: { "code": a shared table's code, "name": its name }`);
	});
	const key = (r: AdventureRef | PinnedRef) => ('builtIn' in r ? r.builtIn : r.library);
	if (new Set(adventures.map(key)).size !== adventures.length)
		problems.push('adventures: each once');
	if (new Set(packs.map(key)).size !== packs.length) problems.push('packs: each once');
	if (new Set(tables.map((t) => t.code)).size !== tables.length) problems.push('tables: each once');
	if (problems.length) return { ok: false, problems };
	return {
		ok: true,
		file: {
			format: COLLECTION_FORMAT,
			formatVersion: COLLECTION_FORMAT_VERSION,
			title: clean(raw.title as string),
			about: clean((raw.about as string | undefined) ?? ''),
			...(rules ? { rules } : {}),
			adventures,
			packs,
			tables
		}
	};
}

/** What became of one piece of a collection when the server looked for it. */
export type DependencyStatus = 'ok' | 'missing' | 'unavailable' | 'incompatible' | 'invalid';

export interface DependencyReport {
	kind: 'rules' | 'adventure' | 'pack' | 'table';
	/** How the collection names it: an id, a library id and version, or a table's code. */
	ref: string;
	/** Its title where it was found. */
	title: string | null;
	/** The pinned version, for library items. */
	version: number | null;
	status: DependencyStatus;
	/** What is wrong, in words; empty when all is well. */
	message: string;
}

/** A collection and everything it depends on, as the server found them. */
export interface CollectionReport {
	id: string;
	version: number;
	title: string;
	about: string;
	creator: Creator;
	rules: { id: string; version: number; name: string | null };
	items: DependencyReport[];
	/** Every item is there and fits: the collection can be started. */
	ok: boolean;
}

/** The collection a story was started from, as the table shows it. */
export interface CollectionView {
	id: string;
	version: number;
	title: string;
	creator: Creator;
	/** Its adventures in order, and which one this story is. */
	adventures: { title: string; playing: boolean }[];
	/** Its homebrew, by title. */
	packs: string[];
	tables: TableRef[];
}
