// The SRD 5.2.1 catalog as the fifth edition rules read it at run time: the
// committed JSON in content/srd/5.2.1/catalog (written by `npm run srd`),
// checked against its manifest (the pinned source, each file's hash and
// count) and indexed by record id. Loaded on first use, one kind at a time,
// so a server that never builds a fifth edition character never reads it.
// Plain data only: nothing here runs what the files hold.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ContentSource } from '../../../src/lib/content/catalog';
import { isHomebrewId, packOfId } from '../../../src/lib/rules/dnd55e/homebrew';
import { heldPack, homebrewRecord } from './homebrew/registry';
import type { SrdKind, SrdRecord } from './srd/records';

/** Where the catalog is committed, relative to the repository (the server's working directory). */
export const CATALOG_DIR = path.join('content', 'srd', '5.2.1', 'catalog');

/** The catalog a character is built from: its source, pinned by the source file's hash. */
export interface CatalogPin {
	/** The source's id, e.g. "srd-5.2.1". */
	source: string;
	/** The source's version, e.g. "5.2.1". */
	version: string;
	/** SHA-256 of the source file the catalog was imported from. */
	sha256: string;
}

export type RecordOf<K extends SrdKind> = Extract<SrdRecord, { kind: K }>;

export interface Catalog {
	source: ContentSource;
	pin: CatalogPin;
	/**
	 * A hash of the catalog as built (each kind's file hash, from its
	 * manifest): the same source imported by another importer reads as
	 * another build (milestone 55).
	 */
	build: string;
	/** A record by id, if it is of that kind. */
	get<K extends SrdKind>(kind: K, id: string): RecordOf<K> | undefined;
	/** A record of that kind by its name as the SRD prints it. */
	named<K extends SrdKind>(kind: K, name: string): RecordOf<K> | undefined;
	all<K extends SrdKind>(kind: K): readonly RecordOf<K>[];
}

export class CatalogDamaged extends Error {}

interface Manifest {
	format: string;
	source: ContentSource;
	files: Record<string, { file: string; count: number; sha256: string }>;
}

/** The catalog's build: each kind's file hash, in order of kind. */
function buildOf(manifest: Manifest): string {
	const files = Object.keys(manifest.files)
		.sort()
		.map((k) => `${k}:${manifest.files[k].sha256}`)
		.join('\n');
	return createHash('sha256').update(files).digest('hex');
}

/** Reads the catalog in `dir`: the manifest now, each kind's file the first time it is asked for. */
export function openCatalog(dir = CATALOG_DIR): Catalog {
	const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Manifest;
	if (manifest.format !== 'thirdfold-catalog')
		throw new CatalogDamaged(`${dir} is not a thirdfold catalog`);
	const kinds = new Map<SrdKind, { list: SrdRecord[]; byId: Map<string, SrdRecord> }>();
	const load = (kind: SrdKind) => {
		const known = kinds.get(kind);
		if (known) return known;
		const entry = manifest.files[kind];
		if (!entry) throw new CatalogDamaged(`the catalog has no ${kind} file`);
		const json = readFileSync(path.join(dir, entry.file), 'utf8');
		if (createHash('sha256').update(json).digest('hex') !== entry.sha256)
			throw new CatalogDamaged(`${entry.file} is not the file its manifest names`);
		const list = JSON.parse(json) as SrdRecord[];
		if (list.length !== entry.count || list.some((r) => r.kind !== kind))
			throw new CatalogDamaged(`${entry.file} does not hold ${entry.count} ${kind} records`);
		const loaded = { list, byId: new Map(list.map((r) => [r.id, r])) };
		kinds.set(kind, loaded);
		return loaded;
	};
	return {
		source: manifest.source,
		pin: {
			source: manifest.source.id,
			version: manifest.source.version,
			sha256: manifest.source.sha256
		},
		build: buildOf(manifest),
		get: <K extends SrdKind>(kind: K, id: string) =>
			load(kind).byId.get(id) as RecordOf<K> | undefined,
		named: <K extends SrdKind>(kind: K, name: string) =>
			load(kind).list.find((r) => r.name === name) as RecordOf<K> | undefined,
		all: <K extends SrdKind>(kind: K) => load(kind).list as RecordOf<K>[]
	};
}

/**
 * The catalog with homebrew (milestone 52) layered over it, never into it: a
 * homebrew record is found by its id (which starts with its pack's, never
 * with an SRD source's), and the SRD's records are the base's, untouched.
 * Without `scope`, `all` and `named` are the base's alone and `get` finds a
 * record of any held pack (a character already checked carries its ids);
 * with `scope`, the packs a story has, `all` offers their records after the
 * SRD's and `get` finds only theirs.
 */
export function withHomebrew(base: Catalog, scope?: readonly string[]): Catalog {
	const inScope = (id: string) => !scope || scope.includes(packOfId(id)!);
	return {
		source: base.source,
		pin: base.pin,
		build: base.build,
		get<K extends SrdKind>(kind: K, id: string) {
			if (!isHomebrewId(id)) return base.get(kind, id);
			const record = inScope(id) ? homebrewRecord(id) : undefined;
			return record?.kind === kind ? (record as RecordOf<K>) : undefined;
		},
		named: (kind, name) => base.named(kind, name),
		all<K extends SrdKind>(kind: K) {
			if (!scope?.length) return base.all(kind);
			const extra = scope.flatMap(
				(p) => heldPack(p)?.records.filter((r): r is RecordOf<K> => r.kind === kind) ?? []
			);
			return extra.length ? [...base.all(kind), ...extra] : base.all(kind);
		}
	};
}

let base: Catalog | undefined;
let shared: Catalog | undefined;

/** The server's catalog, opened once, with held homebrew found by id. */
export function srdCatalog(): Catalog {
	shared ??= withHomebrew((base ??= openCatalog()));
	return shared;
}
