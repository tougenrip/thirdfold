// Who may use which licensed source, and whether it is withdrawn (milestone
// 59). The server's operator keeps both (npm run licensed, cli.ts), by the
// agreement the publisher made: a grant names a source and a creator's
// public id (the one the library shows, never a GM key), runs out or is
// revoked but is never forgotten; a source's status is active or withdrawn.
// In files (`LICENCES_DIR`, default data/licences) or in Supabase
// (`public.licensed_grants`, `public.licensed_status`: RLS on, nothing
// granted to browser roles). Everything read back is checked.

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import {
	LICENSED_SOURCE_ID,
	SOURCE_STATUSES,
	type SourceStatus
} from '../../src/lib/content/licence';
import { CREATOR_ID_PATTERN } from '../../src/lib/game/library';

export interface LicenceGrant {
	id: string;
	source: string;
	/** The creator's public id. */
	creator: string;
	/** Who granted it (the operator, by name). */
	by: string;
	at: string;
	expires: string | null;
	revoked: string | null;
	note: string;
}

export interface StatusRecord {
	source: string;
	status: SourceStatus;
	at: string;
	note: string;
}

export const LICENCE_GRANT_ID = /^[0-9a-f]{32}$/;

export interface LicenceStore {
	grant(
		source: string,
		creator: string,
		options: { by: string; days?: number; note?: string },
		now?: Date
	): Promise<LicenceGrant>;
	/** Revokes a grant; false when there is no such grant in force. */
	revoke(id: string, now?: Date): Promise<boolean>;
	/** Every grant of a source (or of every source), oldest first. */
	grants(source?: string): Promise<LicenceGrant[]>;
	/** A grant by id. */
	get(id: string): Promise<LicenceGrant | null>;
	/** The grant in force of `source` to `creator`, if any (the latest). */
	holding(source: string, creator: string, now?: Date): Promise<LicenceGrant | null>;
	/** A source's status as its operator set it; null when never set (active). */
	status(source: string): Promise<StatusRecord | null>;
	setStatus(source: string, status: SourceStatus, note: string, now?: Date): Promise<void>;
}

/** In force: not revoked and not run out. */
export function licenceActive(grant: LicenceGrant, now = Date.now()): boolean {
	return grant.revoked === null && (grant.expires === null || Date.parse(grant.expires) > now);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const isTime = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;
const plain = (v: string, max: number) => v.replace(CONTROL, ' ').trim().slice(0, max);

/** A grant as stored, checked; null when anything is off. */
export function readLicenceGrant(raw: unknown): LicenceGrant | null {
	if (
		!isObject(raw) ||
		typeof raw.id !== 'string' ||
		!LICENCE_GRANT_ID.test(raw.id) ||
		typeof raw.source !== 'string' ||
		!LICENSED_SOURCE_ID.test(raw.source) ||
		typeof raw.creator !== 'string' ||
		!CREATOR_ID_PATTERN.test(raw.creator) ||
		typeof raw.by !== 'string' ||
		raw.by.length > 60 ||
		!isTime(raw.at) ||
		!(raw.expires === null || isTime(raw.expires)) ||
		!(raw.revoked === null || isTime(raw.revoked)) ||
		typeof raw.note !== 'string' ||
		raw.note.length > 200
	)
		return null;
	return {
		id: raw.id,
		source: raw.source,
		creator: raw.creator,
		by: raw.by,
		at: raw.at as string,
		expires: raw.expires as string | null,
		revoked: raw.revoked as string | null,
		note: raw.note
	};
}

function readStatus(raw: unknown): StatusRecord | null {
	if (
		!isObject(raw) ||
		typeof raw.source !== 'string' ||
		!LICENSED_SOURCE_ID.test(raw.source) ||
		!SOURCE_STATUSES.includes(raw.status as SourceStatus) ||
		!isTime(raw.at) ||
		typeof raw.note !== 'string'
	)
		return null;
	return {
		source: raw.source,
		status: raw.status as SourceStatus,
		at: raw.at as string,
		note: raw.note
	};
}

/** A new grant, checked before it is stored. */
export function newLicenceGrant(
	source: string,
	creator: string,
	options: { by: string; days?: number; note?: string },
	now = new Date()
): LicenceGrant {
	if (!LICENSED_SOURCE_ID.test(source)) throw new Error('Not a licensed source id.');
	if (!CREATOR_ID_PATTERN.test(creator)) throw new Error('Not a creator id.');
	const by = plain(options.by, 60);
	if (!by) throw new Error('Say who grants it.');
	const days = options.days;
	if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 3650))
		throw new Error('A grant runs for 1 to 3650 days.');
	return {
		id: randomBytes(16).toString('hex'),
		source,
		creator,
		by,
		at: now.toISOString(),
		expires: days ? new Date(now.getTime() + days * 86_400_000).toISOString() : null,
		revoked: null,
		note: plain(options.note ?? '', 200)
	};
}

interface Book {
	grants: LicenceGrant[];
	status: StatusRecord[];
}

/** Every store over one book of grants and statuses (memory or a file). */
abstract class BookStore implements LicenceStore {
	protected abstract read(): Promise<Book>;
	protected abstract write(book: Book): Promise<void>;
	/** One change at a time. */
	private queue: Promise<unknown> = Promise.resolve();
	private change<T>(f: (book: Book) => T): Promise<T> {
		const next = this.queue.then(async () => {
			const book = await this.read();
			const out = f(book);
			await this.write(book);
			return out;
		});
		this.queue = next.catch(() => undefined);
		return next;
	}

	async grant(
		source: string,
		creator: string,
		options: { by: string; days?: number; note?: string },
		now = new Date()
	) {
		const grant = newLicenceGrant(source, creator, options, now);
		return await this.change((book) => {
			book.grants.push(grant);
			return { ...grant };
		});
	}
	revoke(id: string, now = new Date()) {
		return this.change((book) => {
			const g = book.grants.find((x) => x.id === id);
			if (!g || !licenceActive(g, now.getTime())) return false;
			g.revoked = now.toISOString();
			return true;
		});
	}
	async grants(source?: string) {
		return (await this.read()).grants
			.filter((g) => !source || g.source === source)
			.map((g) => ({ ...g }));
	}
	async get(id: string) {
		const g = (await this.read()).grants.find((x) => x.id === id);
		return g ? { ...g } : null;
	}
	async holding(source: string, creator: string, now = new Date()) {
		const held = (await this.read()).grants.filter(
			(g) => g.source === source && g.creator === creator && licenceActive(g, now.getTime())
		);
		return held.length ? { ...held[held.length - 1] } : null;
	}
	async status(source: string) {
		const s = (await this.read()).status.find((x) => x.source === source);
		return s ? { ...s } : null;
	}
	setStatus(source: string, status: SourceStatus, note: string, now = new Date()) {
		if (!LICENSED_SOURCE_ID.test(source))
			return Promise.reject(new Error('Not a licensed source id.'));
		return this.change((book) => {
			book.status = book.status.filter((s) => s.source !== source);
			book.status.push({ source, status, at: now.toISOString(), note: plain(note, 200) });
		});
	}
}

export class MemoryLicenceStore extends BookStore {
	private text = JSON.stringify({ grants: [], status: [] });
	protected async read(): Promise<Book> {
		return JSON.parse(this.text) as Book;
	}
	protected async write(book: Book): Promise<void> {
		this.text = JSON.stringify(book);
	}
}

/** One file, `licences.json`, written then renamed; anything damaged in it is dropped with a warning. */
export class FileLicenceStore extends BookStore {
	constructor(private readonly dir: string) {
		super();
	}
	private get file() {
		return path.join(this.dir, 'licences.json');
	}
	protected async read(): Promise<Book> {
		let raw: unknown;
		try {
			raw = JSON.parse(await readFile(this.file, 'utf8'));
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { grants: [], status: [] };
			throw err;
		}
		const book = isObject(raw) ? raw : {};
		const grants = (Array.isArray(book.grants) ? book.grants : []).map(readLicenceGrant);
		const status = (Array.isArray(book.status) ? book.status : []).map(readStatus);
		if (grants.includes(null) || status.includes(null))
			console.warn('[licences] skipped damaged entries in', this.file);
		return {
			grants: grants.filter((g): g is LicenceGrant => g !== null),
			status: status.filter((s): s is StatusRecord => s !== null)
		};
	}
	protected async write(book: Book): Promise<void> {
		await mkdir(this.dir, { recursive: true });
		const tmp = `${this.file}.${process.pid}.tmp`;
		await writeFile(tmp, JSON.stringify(book, null, '\t'), 'utf8');
		await rename(tmp, this.file);
	}
}

/** Grants and statuses in Supabase Postgres (service key only). */
export class SupabaseLicenceStore implements LicenceStore {
	constructor(private readonly db: SupabaseClient) {}

	static connect(url: string, serviceKey: string): SupabaseLicenceStore {
		return new SupabaseLicenceStore(
			createClient(url, serviceKey, {
				auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
			})
		);
	}

	async grant(
		source: string,
		creator: string,
		options: { by: string; days?: number; note?: string },
		now = new Date()
	) {
		const grant = newLicenceGrant(source, creator, options, now);
		const { error } = await this.db.from('licensed_grants').insert(grant);
		if (error) throw new Error(`Granting failed: ${error.message}`);
		return grant;
	}
	async revoke(id: string, now = new Date()) {
		if (!LICENCE_GRANT_ID.test(id)) return false;
		const grant = await this.get(id);
		if (!grant || !licenceActive(grant, now.getTime())) return false;
		const { error } = await this.db
			.from('licensed_grants')
			.update({ revoked: now.toISOString() })
			.eq('id', id)
			.is('revoked', null);
		if (error) throw new Error(`Revoking failed: ${error.message}`);
		return true;
	}
	private rows(data: unknown[] | null): LicenceGrant[] {
		return (data ?? []).map(readLicenceGrant).filter((g): g is LicenceGrant => g !== null);
	}
	async grants(source?: string) {
		let q = this.db.from('licensed_grants').select('*').order('at', { ascending: true });
		if (source) q = q.eq('source', source);
		const { data, error } = await q;
		if (error) throw new Error(`Listing grants failed: ${error.message}`);
		return this.rows(data);
	}
	async get(id: string) {
		if (!LICENCE_GRANT_ID.test(id)) return null;
		const { data, error } = await this.db
			.from('licensed_grants')
			.select('*')
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(`Reading a grant failed: ${error.message}`);
		return data ? readLicenceGrant(data) : null;
	}
	async holding(source: string, creator: string, now = new Date()) {
		if (!LICENSED_SOURCE_ID.test(source) || !CREATOR_ID_PATTERN.test(creator)) return null;
		const { data, error } = await this.db
			.from('licensed_grants')
			.select('*')
			.eq('source', source)
			.eq('creator', creator)
			.is('revoked', null)
			.order('at', { ascending: true });
		if (error) throw new Error(`Reading grants failed: ${error.message}`);
		const held = this.rows(data).filter((g) => licenceActive(g, now.getTime()));
		return held.length ? held[held.length - 1] : null;
	}
	async status(source: string) {
		if (!LICENSED_SOURCE_ID.test(source)) return null;
		const { data, error } = await this.db
			.from('licensed_status')
			.select('*')
			.eq('source', source)
			.maybeSingle();
		if (error) throw new Error(`Reading a status failed: ${error.message}`);
		return data ? readStatus(data) : null;
	}
	async setStatus(source: string, status: SourceStatus, note: string, now = new Date()) {
		if (!LICENSED_SOURCE_ID.test(source)) throw new Error('Not a licensed source id.');
		const { error } = await this.db
			.from('licensed_status')
			.upsert({ source, status, at: now.toISOString(), note: plain(note, 200) });
		if (error) throw new Error(`Setting a status failed: ${error.message}`);
	}
}
