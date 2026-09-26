// The SRD 5.2.1 importer: reads the pinned PDF, checks it is exactly the
// file the source names (by SHA-256), runs every parser, and returns the
// catalog (records sorted by id, one file per kind), a manifest and the
// diagnostics: what was repaired, noted, or left out. The same file always
// imports to the same bytes, so a re-import shows up as a reviewable diff.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ContentSource } from '../../../../src/lib/content/catalog';
import { parseClasses } from './classes';
import { SrdDocument, type Diagnostic } from './document';
import { parseArmor, parseWeapons } from './equipment';
import { parseRules } from './glossary';
import { parseMonsters } from './monsters';
import { parseBackgrounds, parseFeats, parseSpecies } from './origins';
import { readPdf } from './pdf';
import { SRD_KINDS, type SrdKind, type SrdRecord } from './records';
import { SRD_521 } from './source';
import { parseSpells } from './spells';

/** Bumped whenever the importer's output changes for the same source. */
export const IMPORTER_VERSION = 1;
/** The PDF reader the output depends on (pinned exactly in package.json). */
export const PDFJS_VERSION = '6.3.289';

export { CATALOG_DIR } from '../catalog';

/** The chapters of the SRD this importer does not turn into records (their text is only in the source). */
export const NOT_IMPORTED = [
	'Playing the Game',
	'Character Creation',
	'Equipment: Coins, Tools, Adventuring Gear, Mounts and Vehicles, Lifestyle Expenses, Food, Drink, and Lodging, Hirelings, Spellcasting services, Magic Items for sale, Crafting',
	'Spells: Gaining Spells, Casting Spells (the rules; every spell is imported)',
	'Classes: the class spell lists (each spell records its classes)',
	'Gameplay Toolbox',
	'Magic Items',
	'Monsters: Stat Block Overview, Parts of a Stat Block, Running a Monster; the lore between stat blocks; stat blocks printed inside spells and magic items'
];

export interface CatalogManifest {
	format: 'thirdfold-catalog';
	version: 1;
	source: ContentSource;
	importer: { version: number; pdfjs: string };
	files: Record<SrdKind, { file: string; count: number; sha256: string }>;
	notImported: string[];
	diagnostics: { file: string; count: number };
}

export interface ImportedCatalog {
	manifest: CatalogManifest;
	records: Record<SrdKind, SrdRecord[]>;
	diagnostics: Diagnostic[];
	/** Every file of the catalog, by name, as written. */
	files: Map<string, string>;
}

export class SourceMismatch extends Error {}

const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');

/** Plain JSON, tab-indented, ending with a newline: the same value always writes the same bytes. */
export function stableJson(value: unknown): string {
	return `${JSON.stringify(value, null, '\t')}\n`;
}

export async function importSrd(bytes: Uint8Array): Promise<ImportedCatalog> {
	const actual = sha256(bytes);
	if (actual !== SRD_521.sha256)
		throw new SourceMismatch(
			`${SRD_521.file} is not the pinned SRD 5.2.1 (SHA-256 ${actual}, expected ${SRD_521.sha256}).`
		);
	const doc = new SrdDocument(await readPdf(bytes));
	const all: SrdRecord[] = [
		...parseRules(doc),
		...parseSpecies(doc),
		...parseBackgrounds(doc),
		...parseFeats(doc),
		...parseClasses(doc),
		...parseWeapons(doc),
		...parseArmor(doc),
		...parseSpells(doc),
		...parseMonsters(doc)
	];
	const records = Object.fromEntries(SRD_KINDS.map((k) => [k, [] as SrdRecord[]])) as Record<
		SrdKind,
		SrdRecord[]
	>;
	for (const r of all) records[r.kind].push(r);
	for (const k of SRD_KINDS) records[k].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

	const files = new Map<string, string>();
	const manifestFiles = {} as CatalogManifest['files'];
	for (const k of SRD_KINDS) {
		const file = `${k}.json`;
		const json = stableJson(records[k]);
		files.set(file, json);
		manifestFiles[k] = { file, count: records[k].length, sha256: sha256(json) };
	}
	const diagnostics = doc.diagnostics;
	files.set('diagnostics.json', stableJson(diagnostics));
	const manifest: CatalogManifest = {
		format: 'thirdfold-catalog',
		version: 1,
		source: SRD_521,
		importer: { version: IMPORTER_VERSION, pdfjs: PDFJS_VERSION },
		files: manifestFiles,
		notImported: NOT_IMPORTED,
		diagnostics: { file: 'diagnostics.json', count: diagnostics.length }
	};
	files.set('manifest.json', stableJson(manifest));
	return { manifest, records, diagnostics, files };
}

/** Reads the pinned source from the repository. */
export function readSource(root = '.'): Uint8Array {
	return new Uint8Array(readFileSync(path.join(root, SRD_521.file)));
}

/** The catalog files that differ from what is written in `dir` (missing, changed or left over). */
export function staleCatalog(dir: string, catalog: ImportedCatalog): string[] {
	const stale: string[] = [];
	for (const [name, json] of catalog.files) {
		const file = path.join(dir, name);
		if (!existsSync(file) || readFileSync(file, 'utf8') !== json) stale.push(name);
	}
	if (existsSync(dir))
		for (const name of readdirSync(dir)) if (!catalog.files.has(name)) stale.push(name);
	return stale.sort();
}

/** Writes the catalog into `dir`, replacing what was there. */
export function writeCatalog(dir: string, catalog: ImportedCatalog): void {
	if (existsSync(dir)) rmSync(dir, { recursive: true });
	mkdirSync(dir, { recursive: true });
	for (const [name, json] of catalog.files) writeFileSync(path.join(dir, name), json);
}
