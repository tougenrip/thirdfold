// The adventure library in Supabase Postgres (tables `library_adventures`,
// `library_versions`, `library_ratings` and their functions, see
// supabase/migrations). Server-side only: it needs the service/secret key.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
	LIBRARY_ID_PATTERN,
	LIBRARY_LIMITS,
	matchesQuery,
	ratingOf,
	sortListings,
	type LibraryListing,
	type MyAdventure
} from '../src/lib/game/library';
import {
	creatorIdOf,
	LibraryError,
	newLibraryId,
	type LibraryCopy,
	type LibraryQuery,
	type LibraryStore,
	type Publication
} from './library-store';

interface Row {
	id: string;
	owner: string;
	creator_id: string;
	creator_name: string;
	title: string;
	about: string;
	listed: boolean;
	version: number;
	published_at: string;
	plays: number;
	rating_sum: number;
	rating_count: number;
}

const COLUMNS =
	'id, owner, creator_id, creator_name, title, about, listed, version, published_at, plays, rating_sum, rating_count';

function listingOf(r: Row): LibraryListing {
	return {
		id: r.id,
		title: r.title,
		about: r.about,
		creator: { id: r.creator_id, name: r.creator_name },
		version: r.version,
		publishedAt: new Date(r.published_at).toISOString(),
		plays: r.plays,
		rating: ratingOf(r.rating_sum, r.rating_count)
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
		if (id !== undefined) {
			const current = await this.row(id);
			if (!current) throw new LibraryError('not_found', 'There is no such adventure.');
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
			body: p.file
		});
		if (error) {
			if (error.message.includes('forbidden')) {
				throw new LibraryError('forbidden', 'That adventure belongs to someone else.');
			}
			throw new Error(`Publishing failed: ${error.message}`);
		}
		return { id: target, version: data as number };
	}

	async list(q: LibraryQuery) {
		let request = this.db.from('library_adventures').select(COLUMNS).eq('listed', true);
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
		return ((data ?? []) as Row[]).map((r) => ({ ...listingOf(r), listed: r.listed }));
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
			owner: r.owner,
			file: (data as { file: unknown }).file
		};
	}

	async setListed(id: string, owner: string, listed: boolean): Promise<boolean> {
		if (!LIBRARY_ID_PATTERN.test(id)) return false;
		const { data, error } = await this.db
			.from('library_adventures')
			.update({ listed })
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
