// The prop catalogue: assets/catalog.json is the source of what props there
// are (name, palette group, footprint, what they block) and of the aliases that
// keep renamed ids loading. The build checks it and generates the shared module
// src/lib/game/catalog.ts from it, committed like static/assets and checked for
// staleness the same way. assets/catalog.shipped.json lists every id ever
// shipped: an id may become an alias, never disappear, or old saves would break.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ASSET_ID_PATTERN } from '../../src/lib/assets/manifest';
import { PROP_CATEGORIES, type Asset, type PropCategory } from '../../src/lib/game/props';
import { AssetError, isRecord, readJson } from './pipeline-files';

export const CATALOG_FILE = 'catalog.json';
export const SHIPPED_FILE = 'catalog.shipped.json';
export const CATALOG_MODULE = path.join('src', 'lib', 'game', 'catalog.ts');

export interface Catalog {
	props: Record<string, Asset>;
	aliases: Record<string, string>;
}

const NAME_MAX = 40;
const SIDE_MAX = 8;
const JITTER_MAX = 0.4;
const BLOCKS = ['none', 'movement', 'sight'] as const;
// Plain text, so the generated module never needs escaping.
const NAME = /^[^'"\\\n\r\t]+$/;

/** Checks a parsed catalog.json. Throws an AssetError naming the first bad entry. */
export function readCatalog(raw: unknown, source = CATALOG_FILE): Catalog {
	if (!isRecord(raw) || !isRecord(raw.props) || !isRecord(raw.aliases)) {
		throw new AssetError(source, 'needs "props" and "aliases" objects');
	}
	const props: Record<string, Asset> = {};
	for (const [id, p] of Object.entries(raw.props)) {
		const where = `${source} (${id})`;
		if (!ASSET_ID_PATTERN.test(id)) throw new AssetError(where, 'bad id');
		if (!isRecord(p)) throw new AssetError(where, 'not an object');
		const { name, category, w, h, blocks, jitter } = p;
		if (typeof name !== 'string' || name.length > NAME_MAX || !NAME.test(name)) {
			throw new AssetError(where, `needs a name of at most ${NAME_MAX} plain characters`);
		}
		if (!PROP_CATEGORIES.includes(category as PropCategory)) {
			throw new AssetError(where, `category must be one of ${PROP_CATEGORIES.join(', ')}`);
		}
		const side = (v: unknown) =>
			Number.isInteger(v) && (v as number) >= 1 && (v as number) <= SIDE_MAX;
		if (!side(w) || !side(h)) throw new AssetError(where, `w and h are 1 to ${SIDE_MAX} cells`);
		if (!BLOCKS.includes(blocks as Asset['blocks'])) {
			throw new AssetError(where, `blocks is ${BLOCKS.join(', ')}`);
		}
		if (
			jitter !== undefined &&
			(typeof jitter !== 'number' || !(jitter >= 0 && jitter <= JITTER_MAX))
		) {
			throw new AssetError(where, `jitter is 0 to ${JITTER_MAX} of a cell`);
		}
		const extra = Object.keys(p).filter(
			(k) => !['name', 'category', 'w', 'h', 'blocks', 'jitter'].includes(k)
		);
		if (extra.length) throw new AssetError(where, `unknown field "${extra[0]}"`);
		props[id] = {
			name,
			category: category as PropCategory,
			w: w as number,
			h: h as number,
			blocks: blocks as Asset['blocks'],
			...(jitter === undefined ? {} : { jitter })
		};
	}
	const aliases: Record<string, string> = {};
	for (const [from, to] of Object.entries(raw.aliases)) {
		const where = `${source} (alias ${from})`;
		if (!ASSET_ID_PATTERN.test(from)) throw new AssetError(where, 'bad id');
		if (Object.hasOwn(props, from)) throw new AssetError(where, 'is also a prop id');
		if (typeof to !== 'string' || !Object.hasOwn(props, to)) {
			const chained = typeof to === 'string' && Object.hasOwn(raw.aliases, to);
			throw new AssetError(
				where,
				chained ? `points at the alias "${to}": name the prop` : `no prop "${String(to)}"`
			);
		}
		aliases[from] = to;
	}
	return { props, aliases };
}

/** Ids once shipped that are now neither a prop nor an alias. */
export function removedIds(catalog: Catalog, shipped: readonly string[]): string[] {
	return shipped.filter(
		(id) => !Object.hasOwn(catalog.props, id) && !Object.hasOwn(catalog.aliases, id)
	);
}

/** Reads assets/catalog.json and the shipped list, refusing a shipped id that is gone. */
export function loadCatalog(dir: string): { catalog: Catalog; shipped: string[] } {
	const source = path.join(dir, CATALOG_FILE);
	if (!existsSync(source)) throw new AssetError(source, 'missing: the prop catalogue');
	const catalog = readCatalog(readJson(source), source);
	const shippedFile = path.join(dir, SHIPPED_FILE);
	const old = existsSync(shippedFile) ? readJson(shippedFile) : [];
	if (!Array.isArray(old) || !old.every((id) => typeof id === 'string')) {
		throw new AssetError(shippedFile, 'must be a list of ids');
	}
	const removed = removedIds(catalog, old);
	if (removed.length) {
		throw new AssetError(
			shippedFile,
			`"${removed[0]}" was shipped: keep it, or alias it to the prop that replaces it`
		);
	}
	const shipped = [...new Set([...old, ...Object.keys(catalog.props)])].sort();
	return { catalog, shipped };
}

export function shippedText(shipped: readonly string[]): string {
	return `${JSON.stringify(shipped, null, '\t')}\n`;
}

const key = (id: string) => (/^[a-z_$][a-z0-9_$]*$/.test(id) ? id : `'${id}'`);

/** src/lib/game/catalog.ts: the catalogue as a literal, so AssetId stays a union of its ids. */
export function catalogModule(catalog: Catalog): string {
	// A prop on one line when it fits in prettier's width (counting the tab
	// generously), else one field a line, which prettier keeps as it is.
	const prop = ([id, a]: [string, Asset]) => {
		const fields = [
			`name: '${a.name}'`,
			`category: '${a.category}'`,
			`w: ${a.w}`,
			`h: ${a.h}`,
			`blocks: '${a.blocks}'`,
			...(a.jitter === undefined ? [] : [`jitter: ${a.jitter}`])
		];
		const line = `${key(id)}: { ${fields.join(', ')} }`;
		if (line.length + 5 <= 100) return `\t${line}`;
		return `\t${key(id)}: {\n${fields.map((f) => `\t\t${f}`).join(',\n')}\n\t}`;
	};
	const aliases = Object.entries(catalog.aliases).map(([from, to]) => `\t${key(from)}: '${to}'`);
	return [
		'// Generated by `npm run assets` from assets/catalog.json. Do not edit: change the',
		'// catalogue and rebuild (docs/ASSETS.md, "Catalogue").',
		'',
		"import type { Asset } from './props';",
		'',
		'export const ASSETS = {',
		Object.entries(catalog.props).map(prop).join(',\n'),
		'} as const satisfies Record<string, Asset>;',
		'',
		'/** Old prop ids and the ids that replaced them. */',
		`export const ALIASES: Readonly<Record<string, keyof typeof ASSETS>> = {${
			aliases.length ? `\n${aliases.join(',\n')}\n` : ''
		}};`,
		''
	].join('\n');
}

/** What is out of date among the generated catalogue files, given a fresh build. */
export function staleCatalog(
	root: string,
	dir: string,
	built: { catalogModule: string; shipped: string[] }
): string[] {
	const problems: string[] = [];
	const same = (file: string, text: string) =>
		existsSync(file) && readFileSync(file, 'utf8') === text;
	if (!same(path.join(root, CATALOG_MODULE), built.catalogModule)) {
		problems.push(`${CATALOG_MODULE} is out of date`);
	}
	if (!same(path.join(dir, SHIPPED_FILE), shippedText(built.shipped))) {
		problems.push(`${path.join(dir, SHIPPED_FILE)} is missing new ids`);
	}
	return problems;
}
