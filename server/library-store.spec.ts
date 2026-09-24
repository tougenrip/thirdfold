import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
	LIBRARY_LIMITS,
	matchesQuery,
	normalizeQuery,
	sortListings
} from '../src/lib/game/library';
import type { LibraryListing } from '../src/lib/game/library';
import { FileLibraryStore, MemoryLibraryStore } from './library-store';
import { libraryStoreSuite } from './library-store.suite';

describe('MemoryLibraryStore', () => {
	libraryStoreSuite(() => new MemoryLibraryStore());

	it('caps how many adventures a creator publishes', async () => {
		const store = new MemoryLibraryStore();
		const owner = 'a'.repeat(64);
		const pub = { owner, creatorName: 'M', title: 'T', about: '', file: {} };
		for (let i = 0; i < LIBRARY_LIMITS.perCreator; i++) await store.publish(pub);
		await expect(store.publish(pub)).rejects.toMatchObject({ code: 'too_many' });
	});

	it('gives two publishes at once of the same adventure different versions', async () => {
		const store = new MemoryLibraryStore();
		const owner = 'b'.repeat(64);
		const pub = { owner, creatorName: 'M', title: 'T', about: '', file: {} };
		const { id } = await store.publish(pub);
		const versions = await Promise.all([store.publish(pub, id), store.publish(pub, id)]);
		expect(versions.map((v) => v.version).sort()).toEqual([2, 3]);
	});
});

const dirs: string[] = [];
afterAll(async () => {
	for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe('FileLibraryStore', () => {
	const make = async () => {
		const dir = await mkdtemp(path.join(tmpdir(), 'thirdfold-library-'));
		dirs.push(dir);
		return new FileLibraryStore(dir);
	};
	libraryStoreSuite(make);

	it('keeps one file per adventure and per version, and never touches a path from an id', async () => {
		const dir = await mkdtemp(path.join(tmpdir(), 'thirdfold-library-'));
		dirs.push(dir);
		const store = new FileLibraryStore(dir);
		const owner = 'c'.repeat(64);
		const { id } = await store.publish({
			owner,
			creatorName: 'M',
			title: 'T',
			about: '',
			file: {}
		});
		await store.publish({ owner, creatorName: 'M', title: 'T', about: '', file: {} }, id);
		expect((await readdir(dir)).sort()).toEqual([`${id}.json`, `${id}.v1.json`, `${id}.v2.json`]);
		expect(await store.get('../../etc/passwd')).toBeNull();
		expect(await store.remove('../x', owner)).toBe(false);
		// A new store on the same folder reads the same library.
		expect((await new FileLibraryStore(dir).get(id))?.listing.version).toBe(2);
	});
});

describe('searching and sorting the library', () => {
	const listing = (over: Partial<LibraryListing>): LibraryListing => ({
		id: 'x',
		title: 'Untitled',
		about: '',
		creator: { id: '0'.repeat(16), name: 'Someone' },
		version: 1,
		publishedAt: '2026-01-01T00:00:00.000Z',
		plays: 0,
		rating: null,
		...over
	});

	it('matches every word of a search in the title, about or creator, ignoring case', () => {
		const l = listing({
			title: 'The Salt Road',
			about: 'A caravan',
			creator: { id: '', name: 'Mira' }
		});
		expect(matchesQuery(l, normalizeQuery('  SALT   mira '))).toBe(true);
		expect(matchesQuery(l, normalizeQuery('caravan road'))).toBe(true);
		expect(matchesQuery(l, normalizeQuery('salt frost'))).toBe(false);
		expect(matchesQuery(l, normalizeQuery(''))).toBe(true);
		expect(normalizeQuery('x'.repeat(200))).toHaveLength(LIBRARY_LIMITS.query);
	});

	it('puts many good ratings above one perfect one', () => {
		const one = listing({ id: 'one', rating: { average: 5, count: 1 } });
		const many = listing({ id: 'many', rating: { average: 4.6, count: 20 } });
		const none = listing({ id: 'none', plays: 50 });
		expect(sortListings([one, none, many], 'top').map((l) => l.id)).toEqual([
			'many',
			'one',
			'none'
		]);
		expect(sortListings([one, none, many], 'played').map((l) => l.id)[0]).toBe('none');
	});
});
