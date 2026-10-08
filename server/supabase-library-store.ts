// The adventure library in Supabase Postgres (tables `library_adventures`,
// `library_versions`, `library_ratings` and their functions, see
// supabase/migrations). Server-side only: it needs the service/secret key.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
	accessOf,
	flagsOf,
	GRANT_LIMITS,
	grantActive,
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
	type LibraryKind,
	type LibraryListing,
	type MyAdventure,
	type SharedListing
} from '../src/lib/game/library';
import {
	creatorIdOf,
	LibraryError,
	makeGrant,
	newLibraryId,
	type LibraryCopy,
	type LibraryQuery,
	type LibraryStore,
	type Publication
} from './library-store';

interface Row {
	id: string;
	kind: LibraryKind;
	owner: string;
	creator_id: string;
	creator_name: string;
	title: string;
	about: string;
	listed: boolean;
	restricted: boolean;
	version: number;
	published_at: string;
	plays: number;
	rating_sum: number;
	rating_count: number;
}

const COLUMNS =
	'id, kind, owner, creator_id, creator_name, title, about, listed, restricted, version, published_at, plays, rating_sum, rating_count';

interface GrantRow {
	id: string;
	adventure_id: string;
	target_kind: 'creator' | 'collection' | 'room';
	target_id: string;
	role: 'collaborator' | 'member';
	granted_by: string;
	granted_at: string;
	expires_at: string | null;
	revoked_at: string | null;
	note: string;
}

const GRANT_COLUMNS =
	'id, adventure_id, target_kind, target_id, role, granted_by, granted_at, expires_at, revoked_at, note';

const iso = (t: string | null) => (t === null ? null : new Date(t).toISOString());

function grantOf(r: GrantRow): Grant {
	return {
		id: r.id,
		target: { kind: r.target_kind, id: r.target_id },
		role: r.role,
		by: r.granted_by,
		at: iso(r.granted_at)!,
		expires: iso(r.expires_at),
		revoked: iso(r.revoked_at),
		note: r.note
	};
}

function listingOf(r: Row): LibraryListing {
	return {
		id: r.id,
		kind: r.kind,
		title: r.title,
		about: r.about,
		creator: { id: r.creator_id, name: r.creator_name },
		version: r.version,
		publishedAt: new Date(r.published_at).toISOString(),
		plays: r.plays,
		rating: ratingOf(r.rating_sum, r.rating_count),
		access: accessOf(r.listed, r.restricted)
	};
}

export class SupabaseLibraryStore implements LibraryStore {
	constructor(private readonly db: SupabaseClient) {}

	/** A store for a Supabase project URL and its service_role / secret key. */
	static connect(url: string, serviceKey: string): SupabaseLibraryStore {
		return new SupabaseLibraryStore(
			createClient(url, serviceKey, {
				auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
			})
		);
	}

	private async row(id: string): Promise<Row | null> {
		if (!LIBRARY_ID_PATTERN.test(id)) return null;
		const { data, error } = await this.db
			.from('library_adventures')
			.select(COLUMNS)
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(`Reading the library failed: ${error.message}`);
		return (data as Row | null) ?? null;
	}

	async publish(p: Publication, id?: string): Promise<{ id: string; version: number }> {
		const kind = p.kind ?? 'adventure';
		if (id !== undefined) {
			const current = await this.row(id);
			if (!current || current.kind !== kind)
				throw new LibraryError('not_found', `There is no such ${kind}.`);
			if (current.owner !== p.owner) {
				throw new LibraryError('forbidden', 'That adventure belongs to someone else.');
			}
			if (current.version >= LIBRARY_LIMITS.versions) {
				throw new LibraryError('too_many', 'That adventure has as many versions as it can keep.');
			}
		} else {
			const { count, error } = await this.db
				.from('library_adventures')
				.select('id', { count: 'exact', head: true })
				.eq('owner', p.owner);
			if (error) throw new Error(`Reading the library failed: ${error.message}`);
			if ((count ?? 0) >= LIBRARY_LIMITS.perCreator) {
				throw new LibraryError('too_many', 'You have published as many adventures as you can.');
			}
		}
		const target = id ?? newLibraryId();
		const { data, error } = await this.db.rpc('library_publish', {
			target,
			who: p.owner,
			creator: creatorIdOf(p.owner),
			creator_label: p.creatorName,
			label: p.title,
			blurb: p.about,
			body: p.file,
			item_kind: kind
		});
		if (error) {
			if (error.message.includes('not_found')) {
				throw new LibraryError('not_found', `There is no such ${kind}.`);
			}
			if (error.message.includes('forbidden')) {
				throw new LibraryError('forbidden', 'That adventure belongs to someone else.');
			}
			throw new Error(`Publishing failed: ${error.message}`);
		}
		return { id: target, version: data as number };
	}

	async list(q: LibraryQuery) {
		let request = this.db
			.from('library_adventures')
			.select(COLUMNS)
			.eq('listed', true)
			.eq('kind', q.kind ?? 'adventure');
		if (q.creator) request = request.eq('creator_id', q.creator);
		// The newest few hundred, matched and sorted here: the library is small.
		const { data, error } = await request.order('published_at', { ascending: false }).limit(500);
		if (error) throw new Error(`Reading the library failed: ${error.message}`);
		const rows = (data ?? []) as Row[];
		const adventures = sortListings(
			rows.map(listingOf).filter((l) => matchesQuery(l, q.query ?? null)),
			q.sort ?? 'top'
		).slice(0, LIBRARY_LIMITS.list);
		const creator = q.creator && rows[0] ? { id: q.creator, name: rows[0].creator_name } : null;
		return { adventures, creator };
	}

	async mine(owner: string): Promise<MyAdventure[]> {
		const { data, error } = await this.db
			.from('library_adventures')
			.select(COLUMNS)
			.eq('owner', owner)
			.order('published_at', { ascending: false })
			.limit(LIBRARY_LIMITS.perCreator);
		if (error) throw new Error(`Reading the library failed: ${error.message}`);
		const rows = (data ?? []) as Row[];
		const grants = await this.grantsOn(rows.map((r) => r.id));
		return rows.map((r) => ({
			...listingOf(r),
			listed: r.listed,
			grants: grants.get(r.id) ?? []
		}));
	}

	/** Every grant on these items, newest first. */
	private async grantsOn(ids: string[]): Promise<Map<string, Grant[]>> {
		const out = new Map<string, Grant[]>();
		if (!ids.length) return out;
		const { data, error } = await this.db
			.from('library_grants')
			.select(GRANT_COLUMNS)
			.in('adventure_id', ids)
			.order('granted_at', { ascending: false });
		if (error) throw new Error(`Reading the library failed: ${error.message}`);
		for (const r of (data ?? []) as GrantRow[]) {
			const list = out.get(r.adventure_id) ?? [];
			list.push(grantOf(r));
			out.set(r.adventure_id, list);
		}
		return out;
	}

	async shared(creator: string, now = new Date()): Promise<SharedListing[]> {
		const { data, error } = await this.db
			.from('library_grants')
			.select(GRANT_COLUMNS)
			.eq('target_kind', 'creator')
			.eq('target_id', creator)
			.is('revoked_at', null)
			.order('granted_at', { ascending: false })
			.limit(500);
		if (error) throw new Error(`Reading the library failed: ${error.message}`);
		const best = new Map<string, Grant>();
		for (const r of (data ?? []) as GrantRow[]) {
			const g = grantOf(r);
			if (!grantActive(g, now.getTime())) continue;
			const had = best.get(r.adventure_id);
			if (!had || (had.role === 'member' && g.role === 'collaborator')) best.set(r.adventure_id, g);
		}
		if (!best.size) return [];
		const rows = await this.db
			.from('library_adventures')
			.select(COLUMNS)
			.in('id', [...best.keys()]);
		if (rows.error) throw new Error(`Reading the library failed: ${rows.error.message}`);
		return ((rows.data ?? []) as Row[])
			.map((r) => {
				const grant = best.get(r.id)!;
				return { ...listingOf(r), role: grant.role, grant };
			})
			.sort((a, b) => b.grant.at.localeCompare(a.grant.at))
			.slice(0, LIBRARY_LIMITS.list);
	}

	async get(id: string, version?: number): Promise<LibraryCopy | null> {
		const r = await this.row(id);
		const v = version ?? r?.version;
		if (!r || !v || !Number.isInteger(v) || v < 1 || v > r.version) return null;
		const { data, error } = await this.db
			.from('library_versions')
			.select('file')
			.eq('adventure_id', id)
			.eq('version', v)
			.maybeSingle();
		if (error) throw new Error(`Reading the library failed: ${error.message}`);
		if (!data) return null;
		return {
			listing: { ...listingOf(r), version: v },
			listed: r.listed,
			restricted: r.restricted,
			owner: r.owner,
			grants: (await this.grantsOn([id])).get(id) ?? [],
			file: (data as { file: unknown }).file
		};
	}

	async grant(id: string, owner: string, g: NewGrant, now = new Date()): Promise<Grant | null> {
		const r = await this.row(id);
		if (!r || r.owner !== owner) return null;
		const all = (await this.grantsOn([id])).get(id) ?? [];
		if (all.filter((x) => grantActive(x, now.getTime())).length >= GRANT_LIMITS.active)
			throw new LibraryError('too_many', 'That has as many grants in force as it can have.');
		const added = makeGrant(owner, g, now);
		const { error } = await this.db.from('library_grants').insert({
			id: added.id,
			adventure_id: id,
			target_kind: added.target.kind,
			target_id: added.target.id,
			role: added.role,
			granted_by: added.by,
			granted_at: added.at,
			expires_at: added.expires,
			revoked_at: null,
			note: added.note
		});
		if (error) throw new Error(`Granting failed: ${error.message}`);
		// Beyond what is kept, the oldest revoked or lapsed grants go.
		const spent = all.filter((x) => !grantActive(x, now.getTime()));
		const over = all.length + 1 - GRANT_LIMITS.kept;
		if (over > 0) {
			const drop = spent.slice(-over).map((x) => x.id);
			const gone = await this.db.from('library_grants').delete().in('id', drop);
			if (gone.error) throw new Error(`Granting failed: ${gone.error.message}`);
		}
		return added;
	}

	async revoke(id: string, owner: string, grantId: string, now = new Date()): Promise<boolean> {
		const r = await this.row(id);
		if (!r || r.owner !== owner || !/^[0-9a-f]{32}$/.test(grantId)) return false;
		const g = ((await this.grantsOn([id])).get(id) ?? []).find((x) => x.id === grantId);
		if (!g || !grantActive(g, now.getTime())) return false;
		const { data, error } = await this.db
			.from('library_grants')
			.update({ revoked_at: now.toISOString() })
			.eq('id', grantId)
			.eq('adventure_id', id)
			.is('revoked_at', null)
			.select('id');
		if (error) throw new Error(`Revoking failed: ${error.message}`);
		return (data ?? []).length > 0;
	}

	async setAccess(id: string, owner: string, access: LibraryAccess): Promise<boolean> {
		if (!LIBRARY_ID_PATTERN.test(id)) return false;
		const { data, error } = await this.db
			.from('library_adventures')
			.update(flagsOf(access))
			.eq('id', id)
			.eq('owner', owner)
			.select('id');
		if (error) throw new Error(`Changing the library failed: ${error.message}`);
		return (data ?? []).length > 0;
	}

	async remove(id: string, owner: string): Promise<boolean> {
		if (!LIBRARY_ID_PATTERN.test(id)) return false;
		const { data, error } = await this.db
			.from('library_adventures')
			.delete()
			.eq('id', id)
			.eq('owner', owner)
			.select('id');
		if (error) throw new Error(`Changing the library failed: ${error.message}`);
		return (data ?? []).length > 0;
	}

	async played(id: string): Promise<void> {
		const { error } = await this.db.rpc('library_play', { target: id });
		if (error) throw new Error(`Counting a play failed: ${error.message}`);
	}

	async rate(id: string, rater: string, stars: number): Promise<void> {
		if (!(await this.row(id))) {
			throw new LibraryError('not_found', 'That adventure is no longer in the library.');
		}
		const { error } = await this.db.rpc('library_rate', { target: id, who: rater, score: stars });
		if (error) throw new Error(`Rating failed: ${error.message}`);
	}
}
