// What every library store does, run against each (memory, files, and live
// Supabase in supabase-scene-store.spec.ts). Not a spec file itself.

import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { GRANT_LIMITS } from '../src/lib/game/access';
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
		expect(await store.setAccess(id, stranger, 'private')).toBe(false);
		expect(await store.setAccess(id, owner, 'private')).toBe(true);
		expect((await store.list({ query: tag })).adventures).toEqual([]);
		// Unlisted: out of the library, still its creator's, and still playable by id.
		expect((await store.mine(owner)).map((m) => [m.id, m.listed, m.access])).toEqual([
			[id, false, 'private']
		]);
		expect((await store.get(id))?.listed).toBe(false);
		expect((await store.get(id))?.listing.access).toBe('private');
		expect(await store.setAccess(id, owner, 'public')).toBe(true);
		expect((await store.list({ query: tag })).adventures.map((l) => l.id)).toEqual([id]);

		expect(await store.remove(id, stranger)).toBe(false);
		expect(await store.remove(id, owner)).toBe(true);
		expect(await store.get(id)).toBeNull();
		expect(await store.get(id, 1)).toBeNull();
		expect(await store.mine(owner)).toEqual([]);
	});

	it('keeps adventures, packs and collections apart: listed by kind, versions keep their kind', async () => {
		const store = await make();
		const owner = hex64();
		const tag = randomBytes(4).toString('hex');
		const story = await store.publish(publication(owner, `Story ${tag}`));
		const pack = await store.publish(
			publication(owner, `Armory ${tag}`, { kind: 'pack', file: { format: 'thirdfold-homebrew' } })
		);
		const set = await store.publish(
			publication(owner, `Campaign ${tag}`, {
				kind: 'collection',
				file: { format: 'thirdfold-collection' }
			})
		);
		// Adventures by default, each kind by asking for it.
		expect((await store.list({ query: tag })).adventures.map((l) => l.id)).toEqual([story.id]);
		expect(
			(await store.list({ query: tag, kind: 'pack' })).adventures.map((l) => [l.id, l.kind])
		).toEqual([[pack.id, 'pack']]);
		expect(
			(await store.list({ query: tag, kind: 'collection' })).adventures.map((l) => l.kind)
		).toEqual(['collection']);
		expect((await store.get(set.id))?.listing.kind).toBe('collection');
		expect((await store.get(story.id))?.listing.kind).toBe('adventure');
		// An owner sees all of theirs, each with its kind.
		expect((await store.mine(owner)).map((m) => m.kind).sort()).toEqual([
			'adventure',
			'collection',
			'pack'
		]);
		// A new version is of the same kind: a pack can't become a collection.
		expect(
			await store.publish(publication(owner, `Armory ${tag} 2`, { kind: 'pack' }), pack.id)
		).toEqual({
			id: pack.id,
			version: 2
		});
		await expect(
			store.publish(publication(owner, 'Not a pack', { kind: 'collection' }), pack.id)
		).rejects.toMatchObject({ code: 'not_found' });
		await expect(store.publish(publication(owner, 'Not a story'), set.id)).rejects.toMatchObject({
			code: 'not_found'
		});
	});

	it('restricts an item: listed for anyone, its grants kept with it', async () => {
		const store = await make();
		const owner = hex64();
		const tag = randomBytes(4).toString('hex');
		const { id } = await store.publish(publication(owner, `Licensed ${tag}`));
		expect((await store.get(id))?.listing.access).toBe('public');
		expect(await store.setAccess(id, owner, 'restricted')).toBe(true);
		const copy = await store.get(id);
		expect(copy).toMatchObject({ listed: true, restricted: true, grants: [] });
		expect(copy!.listing.access).toBe('restricted');
		// Still listed: anyone finds it (the game server keeps the rest from them).
		expect((await store.list({ query: tag })).adventures.map((l) => [l.id, l.access])).toEqual([
			[id, 'restricted']
		]);
		// A new version keeps the access.
		await store.publish(publication(owner, `Licensed ${tag} 2`), id);
		expect((await store.get(id))?.restricted).toBe(true);
	});

	it('grants and revokes for its owner only, keeping who gave what and when', async () => {
		const store = await make();
		const owner = hex64();
		const ana = hex64();
		const tag = randomBytes(4).toString('hex');
		const { id } = await store.publish(publication(owner, `Shared ${tag}`));
		await store.setAccess(id, owner, 'private');
		const now = new Date();

		expect(
			await store.grant(id, ana, {
				target: { kind: 'creator', id: creatorIdOf(ana) },
				role: 'member'
			})
		).toBeNull();
		const member = await store.grant(
			id,
			owner,
			{ target: { kind: 'creator', id: creatorIdOf(ana) }, role: 'member', note: 'For Ana' },
			now
		);
		expect(member).toMatchObject({
			target: { kind: 'creator', id: creatorIdOf(ana) },
			role: 'member',
			by: creatorIdOf(owner),
			at: now.toISOString(),
			expires: null,
			revoked: null,
			note: 'For Ana'
		});
		expect(member!.id).toMatch(/^[0-9a-f]{32}$/);
		const table = await store.grant(
			id,
			owner,
			{ target: { kind: 'room', id: 'ABC234' }, role: 'member', hours: 2 },
			now
		);
		expect(Date.parse(table!.expires!) - now.getTime()).toBe(2 * 3600_000);

		expect((await store.get(id))?.grants.map((g) => g.id).sort()).toEqual(
			[member!.id, table!.id].sort()
		);
		expect((await store.mine(owner))[0].grants).toHaveLength(2);

		// What was shared with Ana, whatever its access.
		const shared = await store.shared(creatorIdOf(ana));
		expect(shared.map((s) => [s.id, s.role, s.grant.id])).toEqual([[id, 'member', member!.id]]);
		expect(await store.shared(creatorIdOf(hex64()))).toEqual([]);

		// Revoked, not forgotten.
		expect(await store.revoke(id, ana, member!.id)).toBe(false);
		expect(await store.revoke(id, owner, 'f'.repeat(32))).toBe(false);
		const later = new Date(now.getTime() + 1000);
		expect(await store.revoke(id, owner, member!.id, later)).toBe(true);
		expect(await store.revoke(id, owner, member!.id, later)).toBe(false);
		const kept = (await store.get(id))!.grants.find((g) => g.id === member!.id)!;
		expect(kept.revoked).toBe(later.toISOString());
		expect(await store.shared(creatorIdOf(ana))).toEqual([]);

		// Removing the item takes its grants with it.
		expect(await store.remove(id, owner)).toBe(true);
		expect(await store.shared(creatorIdOf(ana))).toEqual([]);
	});

	it('refuses more grants in force than an item may have', async () => {
		const store = await make();
		const owner = hex64();
		const { id } = await store.publish(publication(owner, 'Popular'));
		const grants = [];
		for (let i = 0; i < GRANT_LIMITS.active; i++)
			grants.push(
				await store.grant(id, owner, {
					target: { kind: 'creator', id: creatorIdOf(hex64()) },
					role: 'member'
				})
			);
		await expect(
			store.grant(id, owner, {
				target: { kind: 'creator', id: creatorIdOf(hex64()) },
				role: 'member'
			})
		).rejects.toMatchObject({ code: 'too_many' });
		// A revoked one makes room.
		expect(await store.revoke(id, owner, grants[0]!.id)).toBe(true);
		expect(
			await store.grant(id, owner, {
				target: { kind: 'collection', id: 'a'.repeat(32) },
				role: 'member'
			})
		).not.toBeNull();
	});
}
