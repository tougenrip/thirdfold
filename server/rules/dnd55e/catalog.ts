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
		get: <K extends SrdKind>(kind: K, id: string) =>
			load(kind).byId.get(id) as RecordOf<K> | undefined,
		named: <K extends SrdKind>(kind: K, name: string) =>
			load(kind).list.find((r) => r.name === name) as RecordOf<K> | undefined,
		all: <K extends SrdKind>(kind: K) => load(kind).list as RecordOf<K>[]
	};
}

let shared: Catalog | undefined;

/** The server's catalog, opened once. */
export function srdCatalog(): Catalog {
	shared ??= openCatalog();
	return shared;
}
