// What every library store does, run against each (memory, files, and live
// Supabase in supabase-scene-store.spec.ts). Not a spec file itself.

import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { CREATOR_ID_PATTERN, LIBRARY_ID_PATTERN } from '../src/lib/game/library';
import { creatorIdOf, LibraryError, type LibraryStore, type Publication } from './library-store';

const hex64 = () => randomBytes(32).toString('hex');
/** Publishes land in different milliseconds, so "newest first" has an answer. */
const later = () => new Promise((r) => setTimeout(r, 5));

export function libraryStoreSuite(make: () => LibraryStore | Promise<LibraryStore>): void {
	const publication = (owner: string, title: string, extra: Partial<Publication> = {}) => ({
		owner,
		creatorName: 'Mira',
		title,
		about: `About ${title}`,
		file: { format: 'thirdfold-adventure', title },
		...extra
	});

	it('publishes an adventure, then new versions of it for its owner only', async () => {
		const store = await make();
		const owner = hex64();
		const first = await store.publish(publication(owner, 'The Salt Road'));
		expect(first.id).toMatch(LIBRARY_ID_PATTERN);
		expect(first.version).toBe(1);
		const second = await store.publish(
			publication(owner, 'The Salt Road, revised', { creatorName: 'Mira K.' }),
			first.id
		);
		expect(second).toEqual({ id: first.id, version: 2 });

		const latest = await store.get(first.id);
		expect(latest).toMatchObject({
			listed: true,
			owner,
			file: { title: 'The Salt Road, revised' },
			listing: {
				title: 'The Salt Road, revised',
				version: 2,
				creator: { id: creatorIdOf(owner), name: 'Mira K.' },
				plays: 0,
				rating: null
			}
		});
		expect(latest!.listing.creator.id).toMatch(CREATOR_ID_PATTERN);
		// Earlier versions stay playable: a table playing version 1 keeps it.
		expect((await store.get(first.id, 1))?.file).toEqual({
			format: 'thirdfold-adventure',
			title: 'The Salt Road'
		});
		expect(await store.get(first.id, 3)).toBeNull();
		expect(await store.get('0'.repeat(32))).toBeNull();

		const stranger = hex64();
		await expect(store.publish(publication(stranger, 'Mine now'), first.id)).rejects.toThrow(
			LibraryError
		);
		await expect(store.publish(publication(owner, 'Gone'), 'f'.repeat(32))).rejects.toMatchObject({
			code: 'not_found'
		});
	});

	it('lists listed adventures by search and sort, and by creator', async () => {
		const store = await make();
		const mira = hex64();
		const otto = hex64();
		const tag = randomBytes(4).toString('hex');
		const a = await store.publish(publication(mira, `Salt ${tag} one`));
		await later();
		const b = await store.publish(publication(mira, `Salt ${tag} two`));
		await later();
		const c = await store.publish(publication(otto, `Frost ${tag}`, { creatorName: 'Otto' }));

		const all = await store.list({ query: tag, sort: 'new' });
		expect(all.adventures.map((l) => l.id)).toEqual([c.id, b.id, a.id]);
		expect((await store.list({ query: `salt ${tag}` })).adventures.map((l) => l.id).sort()).toEqual(
			[a.id, b.id].sort()
		);
		expect((await store.list({ query: `${tag} otto` })).adventures.map((l) => l.id)).toEqual([
			c.id
		]);

		await store.played(b.id);
		await store.played(b.id);
		await store.played(a.id);
		const played = await store.list({ query: tag, sort: 'played' });
		expect(played.adventures.map((l) => [l.id, l.plays])).toEqual([
			[b.id, 2],
			[a.id, 1],
			[c.id, 0]
		]);

		const byMira = await store.list({ creator: creatorIdOf(mira), sort: 'new' });
		expect(byMira.creator).toEqual({ id: creatorIdOf(mira), name: 'Mira' });
		expect(byMira.adventures.map((l) => l.id)).toEqual([b.id, a.id]);
		expect((await store.list({ creator: creatorIdOf(hex64()) })).adventures).toEqual([]);
	});

	it('rates: one rating per rater, replaced when they rate again, best rated first', async () => {
		const store = await make();
		const owner = hex64();
		const tag = randomBytes(4).toString('hex');
		const good = await store.publish(publication(owner, `Good ${tag}`));
		const fair = await store.publish(publication(owner, `Fair ${tag}`));
		const ana = hex64();
		const ben = hex64();
		await store.rate(good.id, ana, 4);
		await store.rate(good.id, ben, 5);
		await store.rate(good.id, ana, 5);
		await store.rate(fair.id, ana, 2);
		expect((await store.get(good.id))?.listing.rating).toEqual({ average: 5, count: 2 });
		expect((await store.get(fair.id))?.listing.rating).toEqual({ average: 2, count: 1 });
		const top = await store.list({ query: tag, sort: 'top' });
		expect(top.adventures.map((l) => l.id)).toEqual([good.id, fair.id]);
		await expect(store.rate('e'.repeat(32), ana, 3)).rejects.toMatchObject({ code: 'not_found' });
	});

	it('lets its creator unlist, list again and remove it; nobody else', async () => {
		const store = await make();
		const owner = hex64();
		const tag = randomBytes(4).toString('hex');
		const { id } = await store.publish(publication(owner, `Hidden ${tag}`));
		const stranger = hex64();
		expect(await store.setListed(id, stranger, false)).toBe(false);
		expect(await store.setListed(id, owner, false)).toBe(true);
		expect((await store.list({ query: tag })).adventures).toEqual([]);
		// Unlisted: out of the library, still its creator's, and still playable by id.
		expect((await store.mine(owner)).map((m) => [m.id, m.listed])).toEqual([[id, false]]);
		expect((await store.get(id))?.listed).toBe(false);
		expect(await store.setListed(id, owner, true)).toBe(true);
		expect((await store.list({ query: tag })).adventures.map((l) => l.id)).toEqual([id]);

		expect(await store.remove(id, stranger)).toBe(false);
		expect(await store.remove(id, owner)).toBe(true);
		expect(await store.get(id)).toBeNull();
		expect(await store.get(id, 1)).toBeNull();
		expect(await store.mine(owner)).toEqual([]);
	});
}
