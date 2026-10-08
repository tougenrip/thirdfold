// Licensed sources installed on this server (milestone 59; the shared model
// is src/lib/content/licence.ts, the guide docs/LICENSED.md). The operator
// puts each source in its own folder of `LICENSED_DIR` (default
// content/licensed): a `source.json` (`thirdfold-licensed-source`: who
// publishes it, its terms, its credit, its marks, where it came from) and
// the content file it names, pinned by its SHA-256. They are read once when
// the game server starts, checked in full, and held here by source id. A
// GM never uploads one: licensed content reaches a story only from here, by
// a grant the store in licence-store.ts keeps.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
	DISPLAY_TERMS,
	ENTITLEMENT_POLICIES,
	LICENSED_FORMAT,
	LICENSED_FORMAT_VERSION,
	LICENSED_SOURCE_ID,
	WITHDRAWAL_TERMS,
	type LicensedSourceFile
} from '../../src/lib/content/licence';

/** A source as installed: its file, its content as written, and the content's SHA-256. */
export interface InstalledSource {
	file: LicensedSourceFile;
	content: unknown;
	sha256: string;
}

/** The longest a source's content file may be. */
export const LICENSED_CONTENT_MAX_BYTES = 1024 * 1024;

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Words that look like markup, a template or code: never in a source file. */
const CODE = /<\s*\/?\s*[a-z!?]|javascript:|data:|\$\{|\{\{|=>|\bfunction\s*\(|\beval\s*\(/i;

export type SourceFileRead =
	{ ok: true; file: LicensedSourceFile } | { ok: false; problems: string[] };

/** A source file read field by field: unknown fields refused, every value bounded. */
export function readSourceFile(raw: unknown): SourceFileRead {
	const problems: string[] = [];
	if (!isObject(raw)) return { ok: false, problems: ['a source file must be an object'] };
	const reader = (obj: Raw, at: string) => {
		const used = new Set<string>();
		const bad = (field: string, what: string) => problems.push(`${at}${field}: ${what}`);
		const take = (field: string) => {
			used.add(field);
			return obj[field];
		};
		return {
			bad,
			take,
			text(field: string, max: number): string {
				const v = take(field);
				if (typeof v !== 'string' || !v.trim() || v.length > max) {
					bad(field, `text of 1 to ${max} characters`);
					return '';
				}
				if (CODE.test(v)) bad(field, 'no markup, templates or code');
				return v.trim();
			},
			oneOf<T extends string>(field: string, options: readonly T[]): T {
				const v = take(field);
				if (!options.includes(v as T)) bad(field, `one of ${options.join(', ')}`);
				return v as T;
			},
			flag(field: string): boolean {
				const v = take(field);
				if (typeof v !== 'boolean') bad(field, 'true or false');
				return v === true;
			},
			object(field: string): Raw {
				const v = take(field);
				if (!isObject(v)) {
					bad(field, 'an object');
					return {};
				}
				return v;
			},
			done() {
				for (const k of Object.keys(obj))
					if (!used.has(k)) bad(k, 'a field this server does not know');
			}
		};
	};

	const top = reader(raw, '');
	if (top.take('format') !== LICENSED_FORMAT) top.bad('format', `"${LICENSED_FORMAT}"`);
	const formatVersion = top.take('formatVersion');
	if (formatVersion !== LICENSED_FORMAT_VERSION)
		top.bad(
			'formatVersion',
			typeof formatVersion === 'number' && formatVersion > LICENSED_FORMAT_VERSION
				? `version ${formatVersion} is newer than this server reads`
				: `${LICENSED_FORMAT_VERSION}`
		);
	const id = top.text('id', 40);
	if (id && !LICENSED_SOURCE_ID.test(id)) top.bad('id', 'lowercase words joined by hyphens');
	const name = top.text('name', 80);
	const publisher = top.text('publisher', 80);
	const version = top.text('version', 16);
	if (version && !/^\d{1,4}(?:\.\d{1,4}){0,2}$/.test(version)) top.bad('version', 'like 1.0');
	const about = top.text('about', 500);
	const attribution = top.text('attribution', 600);

	const rulesRaw = top.object('rules');
	const rules = reader(rulesRaw, 'rules.');
	const rulesId = rules.text('id', 48);
	const rulesVersion = rules.take('version');
	if (!Number.isSafeInteger(rulesVersion) || (rulesVersion as number) < 1)
		rules.bad('version', 'a whole number');
	rules.done();

	const marksRaw = top.take('trademarks');
	const trademarks: string[] = [];
	if (!Array.isArray(marksRaw) || marksRaw.length > 16)
		top.bad('trademarks', 'a list of at most 16');
	else
		for (const [i, m] of marksRaw.entries()) {
			if (typeof m !== 'string' || m.trim().length < 2 || m.length > 60 || CODE.test(m))
				top.bad(`trademarks[${i}]`, 'a mark of 2 to 60 characters');
			else trademarks.push(m.trim());
		}

	const t = reader(top.object('terms'), 'terms.');
	const licenceRaw = t.object('licence');
	const licence = reader(licenceRaw, 'terms.licence.');
	const licenceName = licence.text('name', 120);
	const urlRaw = licence.take('url');
	let url: string | null = null;
	if (urlRaw !== null) {
		if (typeof urlRaw !== 'string' || !/^https:\/\/[^\s<>"]{1,300}$/.test(urlRaw))
			licence.bad('url', 'an https address, or null');
		else url = urlRaw;
	}
	licence.done();
	const entitlement = t.oneOf('entitlement', ENTITLEMENT_POLICIES);
	const usesRaw = t.object('uses');
	const uses = reader(usesRaw, 'terms.uses.');
	const mayExport = uses.flag('export');
	const reference = uses.flag('reference');
	uses.done();
	const display = t.oneOf('display', DISPLAY_TERMS);
	const withdrawal = t.oneOf('withdrawal', WITHDRAWAL_TERMS);
	t.done();

	const p = reader(top.object('provenance'), 'provenance.');
	const suppliedBy = p.text('suppliedBy', 120);
	const received = p.text('received', 40);
	if (received && Number.isNaN(Date.parse(received))) p.bad('received', 'a date');
	const agreement = p.text('agreement', 200);
	const hypothetical = p.flag('hypothetical');
	p.done();

	const c = reader(top.object('content'), 'content.');
	const contentFile = c.text('file', 80);
	if (contentFile && !/^[a-z0-9][a-z0-9-]{0,60}\.json$/.test(contentFile))
		c.bad('file', 'a .json file beside the source file');
	const sha = c.take('sha256');
	if (typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha)) c.bad('sha256', '64 hex digits');
	c.done();
	top.done();

	if (problems.length) return { ok: false, problems };
	return {
		ok: true,
		file: {
			format: LICENSED_FORMAT,
			formatVersion: LICENSED_FORMAT_VERSION,
			id,
			name,
			publisher,
			version,
			about,
			rules: { id: rulesId, version: rulesVersion as number },
			attribution,
			trademarks,
			terms: {
				licence: { name: licenceName, url },
				entitlement,
				uses: { export: mayExport, reference },
				display,
				withdrawal
			},
			provenance: { suppliedBy, received, agreement, hypothetical },
			content: { file: contentFile, sha256: sha as string }
		}
	};
}

/** Reads one installed source's folder: its source file, and its content pinned by hash. */
export function readSourceDir(
	dir: string
): { ok: true; source: InstalledSource } | { ok: false; problems: string[] } {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path.join(dir, 'source.json'), 'utf8'));
	} catch (err) {
		return { ok: false, problems: [`source.json: ${(err as Error).message}`] };
	}
	const read = readSourceFile(raw);
	if (!read.ok) return read;
	const file = path.join(dir, read.file.content.file);
	let bytes: Buffer;
	try {
		bytes = readFileSync(file);
	} catch (err) {
		return { ok: false, problems: [`${read.file.content.file}: ${(err as Error).message}`] };
	}
	if (bytes.length > LICENSED_CONTENT_MAX_BYTES)
		return { ok: false, problems: [`${read.file.content.file}: larger than 1 MB`] };
	// Hashed with Windows line endings read as Unix ones, so a checkout's line endings don't matter.
	const sha256 = contentHash(bytes);
	if (sha256 !== read.file.content.sha256)
		return {
			ok: false,
			problems: [
				`${read.file.content.file}: its SHA-256 is ${sha256}, not the ${read.file.content.sha256} its source file pins`
			]
		};
	let content: unknown;
	try {
		content = JSON.parse(bytes.toString('utf8'));
	} catch (err) {
		return { ok: false, problems: [`${read.file.content.file}: ${(err as Error).message}`] };
	}
	return { ok: true, source: { file: read.file, content, sha256 } };
}

/** A content file's SHA-256, its CRLF line endings read as LF. */
export function contentHash(bytes: Buffer | string): string {
	const text = typeof bytes === 'string' ? bytes : bytes.toString('utf8');
	return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

const installed = new Map<string, InstalledSource>();

/**
 * Installs every source in `dir` (one folder each), replacing what was
 * installed. A source that doesn't read is skipped and named; the rest are
 * checked again by their rules when a story takes them up.
 */
export function installSources(dir: string): { installed: string[]; skipped: string[] } {
	installed.clear();
	const out = { installed: [] as string[], skipped: [] as string[] };
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const read = readSourceDir(path.join(dir, entry.name));
		if (!read.ok) {
			out.skipped.push(`${entry.name}: ${read.problems.slice(0, 3).join('; ')}`);
			continue;
		}
		if (read.source.file.id !== entry.name || installed.has(entry.name)) {
			out.skipped.push(
				`${entry.name}: its folder must be named for its id (${read.source.file.id})`
			);
			continue;
		}
		installed.set(read.source.file.id, read.source);
		out.installed.push(read.source.file.id);
	}
	return out;
}

/** Installs one source as read (tests). */
export function installSource(source: InstalledSource): void {
	installed.set(source.file.id, source);
}

export function installedSource(id: string): InstalledSource | undefined {
	return installed.get(id);
}

export function installedSources(): InstalledSource[] {
	return [...installed.values()];
}

/** Forgets every installed source (tests). */
export function forgetSources(): void {
	installed.clear();
}
