// Licences and provenance (#189, docs/ART.md sections 12 and 13): every asset
// says on what terms we have it, and the build refuses anything else.
//
// A binary source (a GLB, PNG, KTX2, WAV or Ogg) carries its own provenance in
// `<id>.meta.json` under "provenance", so a file dropped in from elsewhere never
// inherits ours. A text source (a part list, a recipe, materials.json, an
// environment, a grade) may fall back on its folder's `_provenance.json`, which
// may only grant LicenseRef-thirdfold-original. The manifest carries a compact
// `credit` from it on every file, and /credits lists them.

import { existsSync } from 'node:fs';
import path from 'node:path';
import {
	LICENSES,
	type Credit,
	type License,
	type Manifest,
	type TextureUsage
} from '../../src/lib/assets/manifest';
import type { AdventureDef } from '../adventure/define';
import { AssetError, isRecord, readJson } from './pipeline-files';

export interface Provenance {
	license: License;
	/** A person, studio or site. */
	author: string;
	/** Where a third-party file was downloaded, and the download's SHA-256. */
	source?: { url: string; sha256: string };
	/** Whether we changed it. */
	modified: boolean;
	/** A generator used to make it: only on a plan whose terms give us the output. */
	ai?: { tool: string; version?: string; plan: 'paid' | 'self-hosted'; date: string };
}

export const ORIGINAL: License = 'LicenseRef-thirdfold-original';

/** Tools refused by name, matched in `ai.tool` whatever the case: Hunyuan3D's licence excludes the EU, the UK and South Korea. */
export const AI_DENYLIST = ['hunyuan'];

/** Sources that must carry their own provenance. */
export const BINARY_EXTS = ['glb', 'png', 'ktx2', 'wav', 'ogg'];

/** The folder default's file name (skipped as a source by `list`). */
export const FOLDER_DEFAULT = '_provenance.json';

const text = (v: unknown, max: number): v is string =>
	typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/** Checks a provenance record, throwing an AssetError naming `where`. */
export function readProvenance(raw: unknown, where: string): Provenance {
	const fail = (message: string): never => {
		throw new AssetError(where, message);
	};
	if (!isRecord(raw)) return fail('provenance must be an object');
	const license = LICENSES.find((l) => l === raw.license);
	if (!license) {
		return fail(
			`licence "${String(raw.license)}" is not allowed (only ${LICENSES.join(', ')}; see docs/ART.md)`
		);
	}
	if (!text(raw.author, 200)) return fail('provenance needs an author');
	if (typeof raw.modified !== 'boolean') return fail('provenance needs "modified": true or false');
	const p: Provenance = { license, author: raw.author, modified: raw.modified };
	if (raw.source !== undefined) {
		const s = raw.source;
		if (!isRecord(s) || !text(s.url, 200) || !s.url.startsWith('https://')) {
			return fail('a source needs an https "url"');
		}
		if (typeof s.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(s.sha256)) {
			return fail('a source needs the "sha256" of the downloaded file');
		}
		p.source = { url: s.url, sha256: s.sha256 };
	}
	if ((license === 'CC0-1.0' || license === 'CC-BY-4.0') && !p.source) {
		return fail(`${license} needs a source: the URL and hash of the download`);
	}
	if (raw.ai !== undefined) {
		const ai = raw.ai;
		if (!isRecord(ai) || !text(ai.tool, 100)) return fail('"ai" needs the tool');
		const tool = ai.tool.toLowerCase();
		if (AI_DENYLIST.some((d) => tool.includes(d))) return fail(`"${ai.tool}" is refused`);
		if (ai.plan !== 'paid' && ai.plan !== 'self-hosted') {
			return fail(`AI output needs a paid or self-hosted plan, not "${String(ai.plan)}"`);
		}
		if (typeof ai.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ai.date)) {
			return fail('"ai" needs the date (YYYY-MM-DD)');
		}
		if (ai.version !== undefined && !text(ai.version, 100)) return fail('bad "ai" version');
		if (!p.modified) return fail('AI output must be repainted by a person ("modified": true)');
		p.ai = {
			tool: ai.tool,
			...(ai.version !== undefined ? { version: ai.version as string } : {}),
			plan: ai.plan,
			date: ai.date
		};
	}
	return p;
}

/** The manifest's compact form: the source's URL only, and `modified` only when it was. */
export function creditOf(p: Provenance): Credit {
	return {
		license: p.license,
		author: p.author,
		...(p.source ? { source: p.source.url } : {}),
		...(p.modified ? { modified: true } : {}),
		...(p.ai ? { ai: { tool: p.ai.tool } } : {})
	};
}

/** The provenance of `<dir>/<id>.<ext>`: its own meta.json for a binary, else its folder's default. */
export function provenanceFor(dir: string, id: string, ext: string): Provenance {
	const source = path.join(dir, `${id}.${ext}`);
	if (BINARY_EXTS.includes(ext)) {
		const meta = path.join(dir, `${id}.meta.json`);
		const raw = existsSync(meta) ? readJson(meta) : undefined;
		if (!isRecord(raw) || raw.provenance === undefined) {
			throw new AssetError(
				source,
				`no provenance: a ${ext} file needs its own ${id}.meta.json with "provenance" (a folder default never covers one)`
			);
		}
		return readProvenance(raw.provenance, meta);
	}
	const folder = path.join(dir, FOLDER_DEFAULT);
	if (!existsSync(folder)) {
		throw new AssetError(source, `no provenance: add ${FOLDER_DEFAULT} to its folder`);
	}
	const p = readProvenance(readJson(folder), folder);
	if (p.license !== ORIGINAL) {
		throw new AssetError(folder, `a folder default may only grant ${ORIGINAL}`);
	}
	return p;
}

/**
 * The story's names: people, foes, places and chapters. The manifest, its credits and ids are
 * public, so none may name them (docs/ART.md: ids describe looks, never story roles). Whole
 * names only, not their words: "Widow Crane" is a secret, "crane" is not.
 */
export function storyNames(adventures: readonly AdventureDef[]): string[] {
	const names = new Set<string>();
	for (const A of adventures) {
		for (const n of Object.values(A.npcs)) names.add(n.name);
		for (const e of Object.values(A.enemies)) names.add(e.name);
		for (const l of Object.values(A.locations)) names.add(l.name);
		for (const c of Object.values(A.chapters)) names.add(c.title);
	}
	return [...names].map(plain).filter((n) => n.length > 0);
}

/** Lower case, words split on anything but letters and digits: "bell-keeper" reads "bell keeper". */
const plain = (s: string) =>
	s
		.toLowerCase()
		.replace(/[’']/g, '')
		.split(/[^a-z0-9]+/)
		.filter(Boolean)
		.join(' ');

/** Ids, pack names and credits that name the story; empty when none does. */
export function checkCredits(manifest: Manifest, adventures: readonly AdventureDef[]): string[] {
	const names = storyNames(adventures);
	const problems: string[] = [];
	const check = (what: string, value: string | undefined) => {
		if (!value) return;
		const words = ` ${plain(value)} `;
		const hit = names.find((n) => words.includes(` ${n} `));
		if (hit) problems.push(`${what} "${value}" names the story ("${hit}")`);
	};
	const file = (what: string, credit: Credit) => {
		check(`${what} author`, credit.author);
		check(`${what} source`, credit.source);
		check(`${what} AI tool`, credit.ai?.tool);
	};
	for (const [section, entries] of Object.entries({
		model: manifest.models,
		texture: manifest.textures,
		material: manifest.materials,
		surface: manifest.surfaces,
		environment: manifest.environments,
		audio: manifest.audio,
		pack: manifest.packs
	})) {
		for (const id of Object.keys(entries)) check(`${section} id`, id);
	}
	for (const [id, m] of Object.entries(manifest.models)) {
		file(`model ${id}`, m.credit);
		if (m.preview) file(`model ${id} preview`, m.preview.credit);
		if (m.thumbnail) file(`model ${id} thumbnail`, m.thumbnail.credit);
	}
	for (const [id, t] of Object.entries(manifest.textures)) file(`texture ${id}`, t.credit);
	for (const [id, a] of Object.entries(manifest.audio)) file(`audio ${id}`, a.credit);
	for (const [id, e] of Object.entries(manifest.environments)) check(`environment ${id}`, e.name);
	return problems;
}

/** An art folder's meta.json (cook.ts): its provenance first, then how it is cooked. */
export interface ArtMeta {
	provenance: unknown;
	swing?: unknown;
	setPiece?: boolean;
	/** The pack it downloads with (#192), checked by the build. */
	pack?: string;
	textureSize?: number;
	lods?: { ratio?: number; error?: number; screenSize?: number }[];
	lockBorder?: boolean;
	usage?: TextureUsage;
}

export function readMeta(dir: string): ArtMeta {
	const file = path.join(dir, 'meta.json');
	if (!existsSync(file)) throw new AssetError(dir, 'needs a meta.json with its provenance');
	const meta = readJson(file);
	if (!isRecord(meta)) throw new AssetError(file, 'must be an object');
	readProvenance(meta.provenance, file);
	const size = meta.textureSize;
	if (size !== undefined && !(Number.isInteger(size) && (size as number) >= 4)) {
		throw new AssetError(file, 'textureSize must be a whole number of pixels, at least 4');
	}
	if (meta.lods !== undefined && !(Array.isArray(meta.lods) && meta.lods.every(isRecord))) {
		throw new AssetError(file, 'lods must be a list of { ratio, error, screenSize }');
	}
	return meta as unknown as ArtMeta;
}
