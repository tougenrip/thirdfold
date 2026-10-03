// Collections (milestone 53): a collection names its adventures, homebrew
// and tables; the server finds each where it lives and says what became of
// it, and only a collection whose every piece is there and fits starts.

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseCollectionFile, type CollectionFile } from '../src/lib/game/collection';
import { blankScene } from '../src/lib/game/scene-file';
import { exampleAdventure } from '../src/lib/adventure/example';
import { resolveCollection, withRules, type Shelves } from './collections';
import { MemoryLibraryStore } from './library-store';
import { examplePack } from './rules/dnd55e/homebrew/example';
import { dnd55e } from './rules/dnd55e';
import { MemorySceneStore } from './scene-store';

const hex64 = () => randomBytes(32).toString('hex');

async function shelvesWith() {
	const shelves: Shelves = { library: new MemoryLibraryStore(), scenes: new MemorySceneStore() };
	const owner = hex64();
	const packFile = dnd55e.packs!.content((dnd55e.packs!.hold(examplePack()) as { id: string }).id);
	const pack = await shelves.library.publish({
		kind: 'pack',
		owner,
		creatorName: 'Mira',
		title: 'The Cold Hill Armory 1.0',
		about: '',
		file: packFile
	});
	const story = await shelves.library.publish({
		owner,
		creatorName: 'Mira',
		title: "The Miller's Key",
		about: '',
		file: exampleAdventure()
	});
	const table = await shelves.scenes.save(blankScene('Crossroads', 8, 8, null));
	return { shelves, owner, pack, story, table };
}

const collection = (over: Partial<CollectionFile> = {}): CollectionFile => ({
	format: 'thirdfold-collection',
	formatVersion: 1,
	title: 'Cold Hill Campaign',
	about: 'The barrow, and what lies beyond.',
	rules: { id: 'dnd-5.5e', version: 1 },
	adventures: [{ builtIn: 'barrow' }],
	packs: [],
	tables: [],
	...over
});

describe('reading a collection', () => {
	it('takes references well formed and named once, and nothing else', () => {
		const ok = parseCollectionFile({ ...collection(), rules: undefined });
		expect(ok).toMatchObject({ ok: true, file: { adventures: [{ builtIn: 'barrow' }] } });
		expect(ok.ok && 'rules' in ok.file).toBe(false);
		const bad = parseCollectionFile({
			...collection(),
			script: 'run()',
			adventures: [{ builtIn: 'barrow' }, { builtIn: 'barrow' }, { library: 'x', version: 1 }],
			packs: [{ library: 'f'.repeat(32) }],
			tables: [{ code: 'nope', name: 'Somewhere' }]
		});
		expect(bad.ok ? [] : bad.problems).toEqual([
			'script: not a field of a collection',
			'adventures[2]: { "builtIn": id } or { "library": id, "version": n }',
			'packs[0]: { "library": id, "version": n }',
			'tables[0]: { "code": a shared table\'s code, "name": its name }',
			'adventures: each once'
		]);
		expect(parseCollectionFile({ ...collection(), adventures: [] }).ok).toBe(false);
	});
});

describe('resolving a collection', () => {
	it('finds a built-in adventure, a library pack and a shared table, all under one set of rules', async () => {
		const { shelves, owner, pack, table } = await shelvesWith();
		const file = collection({
			packs: [{ library: pack.id, version: 1 }],
			tables: [{ code: table, name: 'The crossroads' }]
		});
		const { items, resolved } = await resolveCollection(shelves, file, owner);
		expect(items.map((i) => [i.kind, i.status, i.title])).toEqual([
			['rules', 'ok', 'Fifth Edition (SRD 5.2.1)'],
			['adventure', 'ok', 'The Barrow on Cold Hill'],
			['pack', 'ok', 'The Cold Hill Armory 1.0'],
			['table', 'ok', 'The crossroads']
		]);
		expect(resolved!.packs[0].packId).toMatch(/^hb-[0-9a-f]{16}$/);
		expect(resolved!.adventures[0]).toEqual({
			ref: { builtIn: 'barrow' },
			title: 'The Barrow on Cold Hill'
		});
	});

	it('says what is missing, unavailable or doesn’t fit, and resolves nothing then', async () => {
		const { shelves, owner, pack, story } = await shelvesWith();
		const stranger = hex64();
		const file = collection({
			adventures: [
				{ builtIn: 'barrow' },
				{ builtIn: 'hollow-bell' },
				{ library: story.id, version: 1 },
				{ builtIn: 'no-such-story' }
			],
			packs: [{ library: pack.id, version: 2 }],
			tables: [{ code: 'a'.repeat(32), name: 'Gone' }]
		});
		const { items, resolved } = await resolveCollection(shelves, file, owner);
		expect(resolved).toBeNull();
		expect(items.map((i) => [i.kind, i.status])).toEqual([
			['rules', 'ok'],
			['adventure', 'ok'],
			['adventure', 'incompatible'],
			['adventure', 'incompatible'],
			['adventure', 'missing'],
			['pack', 'missing'],
			['table', 'missing']
		]);
		expect(items[2].message).toBe(
			'The Hollow Bell plays by Thirdfold Classic, not Fifth Edition (SRD 5.2.1).'
		);

		// An unlisted pack is still its creator's to use, nobody else's.
		await shelves.library.setListed(pack.id, owner, false);
		const withPack = collection({ packs: [{ library: pack.id, version: 1 }] });
		expect((await resolveCollection(shelves, withPack, owner)).resolved).not.toBeNull();
		const theirs = await resolveCollection(shelves, withPack, stranger);
		expect(theirs.items[2]).toMatchObject({ status: 'unavailable' });
		// A library adventure where a pack should be is not a pack.
		const wrongKind = collection({ packs: [{ library: story.id, version: 1 }] });
		expect((await resolveCollection(shelves, wrongKind, owner)).items[2]).toMatchObject({
			status: 'missing'
		});
		// Rules this server lacks.
		const unknown = await resolveCollection(
			shelves,
			collection({ rules: { id: 'pathfinder', version: 2 } }),
			owner
		);
		expect(unknown.items[0]).toMatchObject({ status: 'missing' });
	});

	it('takes its rules from its first adventure when the creator leaves them out', async () => {
		const { shelves, owner, story } = await shelvesWith();
		const draft = { ...collection(), rules: undefined };
		expect((await withRules(shelves, draft, owner))?.rules).toEqual({ id: 'dnd-5.5e', version: 1 });
		const classic = { ...draft, adventures: [{ library: story.id, version: 1 }] };
		expect((await withRules(shelves, classic, owner))?.rules).toEqual({
			id: 'thirdfold-classic',
			version: 1
		});
	});
});
