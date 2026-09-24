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
	lights: [],
	ambient: 'day',
	fog: { enabled: false, revealed: emptyMask(DEFAULT_GRID) },
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
		expect(await readdir(dir)).toEqual([`${id}.json`]);
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
		expect(await readdir(nested)).toEqual([`${id}.json`]);
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
