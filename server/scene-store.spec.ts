import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_GRID } from '../src/lib/game/grid';
import { serializeScene } from '../src/lib/game/scene-file';
import { emptyMask } from '../src/lib/game/visibility';
import { FileSceneStore, MemorySceneStore, SCENE_ID_PATTERN } from './scene-store';

const scene = serializeScene('Crypt', {
	grid: DEFAULT_GRID,
	tokens: [],
	objects: [{ id: 'w', kind: 'wall', a: { x: 0, y: 1 }, b: { x: 3, y: 1 } }],
	props: [],
	lights: [],
	ambient: 'day',
	fog: { enabled: false, revealed: emptyMask(DEFAULT_GRID), shared: false },
	playerName: () => undefined
});

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(path.join(tmpdir(), 'thirdfold-scenes-'));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe('FileSceneStore', () => {
	it('saves under a fresh random id and loads it back, even from a new store instance', async () => {
		const id = await new FileSceneStore(dir).save(scene);
		expect(id).toMatch(SCENE_ID_PATTERN);
		expect(await new FileSceneStore(dir).load(id)).toEqual(scene);
		expect((await readdir(dir)).sort()).toEqual([`${id}.json`, `${id}.meta.json`]);
	});

	it('returns null for unknown ids and refuses ids that could escape the directory', async () => {
		const store = new FileSceneStore(dir);
		await writeFile(path.join(dir, 'secret.json'), '{"format":"x"}');
		expect(await store.load('0'.repeat(32))).toBeNull();
		expect(await store.load('../secret')).toBeNull();
		expect(await store.load('secret')).toBeNull();
	});

	it('creates its directory on first save', async () => {
		const nested = path.join(dir, 'a', 'b');
		const id = await new FileSceneStore(nested).save(scene);
		expect(await readdir(nested)).toContain(`${id}.json`);
	});
});

describe('MemorySceneStore', () => {
	it('stores copies, not references', async () => {
		const store = new MemorySceneStore();
		const copy = structuredClone(scene);
		const id = await store.save(copy);
		copy.name = 'changed';
		expect(await store.load(id)).toMatchObject({ name: 'Crypt' });
		expect(await store.load('nope')).toBeNull();
	});
});

describe('saves belong to their GM', () => {
	const alice = 'a'.repeat(64);
	const bob = 'b'.repeat(64);
	const story = {
		title: 'The Hollow Bell',
		chapter: 'The quiet village',
		location: 'Bellweather',
		party: []
	};
	const later = (iso: string) => ({ ...scene, savedAt: iso });

	for (const [kind, make] of [
		['FileSceneStore', () => new FileSceneStore(dir)],
		['MemorySceneStore', () => new MemorySceneStore()]
	] as const) {
		it(`${kind}: lists a GM's own saves, newest first, with where the story had got to`, async () => {
			const store = make();
			const first = await store.save(later('2026-09-23T20:00:00.000Z'), { owner: alice });
			const second = await store.save(later('2026-09-24T21:43:00.000Z'), {
				owner: alice,
				auto: true,
				story
			});
			await store.save(scene, { owner: bob });
			const mine = await store.list(alice);
			expect(mine.map((s) => s.id)).toEqual([second, first]);
			expect(mine[0]).toMatchObject({ auto: true, story, savedAt: '2026-09-24T21:43:00.000Z' });
			expect(await store.list(bob)).toHaveLength(1);
			expect(await store.ownerOf(first)).toBe(alice);
			expect(await store.ownerOf('0'.repeat(32))).toBeUndefined();
		});

		it(`${kind}: replaces a save in place only for its owner, and forgets it only for them`, async () => {
			const store = make();
			const id = await store.save(scene, { owner: alice, auto: true });
			expect(
				await store.save(later('2026-09-25T10:00:00.000Z'), { owner: alice, auto: true }, id)
			).toBe(id);
			expect((await store.list(alice))[0].savedAt).toBe('2026-09-25T10:00:00.000Z');
			await expect(store.save(scene, { owner: bob }, id)).rejects.toThrow(/someone else/);
			expect(await store.remove(id, bob)).toBe(false);
			expect(await store.remove(id, alice)).toBe(true);
			expect(await store.load(id)).toBeNull();
		});
	}

	it('keeps saves from before owners loadable by id, owned by nobody', async () => {
		const store = new FileSceneStore(dir);
		await writeFile(path.join(dir, `${'c'.repeat(32)}.json`), JSON.stringify(scene));
		expect(await store.ownerOf('c'.repeat(32))).toBeNull();
		expect(await store.load('c'.repeat(32))).toEqual(scene);
		await expect(store.save(scene, { owner: alice }, 'c'.repeat(32))).rejects.toThrow();
		expect(await store.list(alice)).toEqual([]);
	});
});
