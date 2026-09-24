import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID } from '../src/lib/game/grid';
import { parseSceneFile, serializeScene } from '../src/lib/game/scene-file';
import { emptyMask } from '../src/lib/game/visibility';
import { SCENE_ID_PATTERN } from './scene-store';
import { SupabaseSceneStore } from './supabase-scene-store';

const scene = serializeScene('Crypt', {
	grid: DEFAULT_GRID,
	tokens: [],
	objects: [{ id: 'w1', kind: 'wall', a: { x: 0, y: 1 }, b: { x: 3, y: 1 } }],
	props: [{ id: 'p1', assetId: 'crate', pos: { x: 5, y: 5 }, rotation: 0, scale: 1 }],
	lights: [],
	ambient: 'dusk',
	fog: { enabled: true, revealed: emptyMask(DEFAULT_GRID) },
	playerName: () => undefined
});

/** Just enough of the supabase-js query builder to record what the store asks for. */
function fakeClient(result: { data?: unknown; error?: { message: string } | null }) {
	const calls: unknown[][] = [];
	const builder = {
		insert: (row: unknown) => (
			calls.push(['insert', row]),
			Promise.resolve({ error: result.error ?? null })
		),
		select: (cols: string) => (calls.push(['select', cols]), builder),
		eq: (col: string, v: unknown) => (calls.push(['eq', col, v]), builder),
		maybeSingle: () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null })
	};
	const client = { from: (table: string) => (calls.push(['from', table]), builder) };
	return { client: client as unknown as SupabaseClient, calls };
}

describe('SupabaseSceneStore (unit)', () => {
	it('inserts the scene under a fresh random id', async () => {
		const { client, calls } = fakeClient({});
		const id = await new SupabaseSceneStore(client).save(scene);
		expect(id).toMatch(SCENE_ID_PATTERN);
		expect(calls).toEqual([
			['from', 'scenes'],
			['insert', { id, name: 'Crypt', data: scene }]
		]);
	});

	it('loads by id and returns null when missing', async () => {
		const found = fakeClient({ data: { data: scene } });
		expect(await new SupabaseSceneStore(found.client).load('a'.repeat(32))).toEqual(scene);
		expect(found.calls).toContainEqual(['eq', 'id', 'a'.repeat(32)]);
		expect(await new SupabaseSceneStore(fakeClient({}).client).load('b'.repeat(32))).toBeNull();
	});

	it('never queries with an id that is not a scene id', async () => {
		const { client, calls } = fakeClient({});
		expect(await new SupabaseSceneStore(client).load("x' or 1=1 --")).toBeNull();
		expect(calls).toEqual([]);
	});

	it('turns database errors into failures, so the GM gets persistence_failed', async () => {
		const { client } = fakeClient({ error: { message: 'connection refused' } });
		const store = new SupabaseSceneStore(client);
		await expect(store.save(scene)).rejects.toThrow(/connection refused/);
		await expect(store.load('c'.repeat(32))).rejects.toThrow(/connection refused/);
	});
});

// Runs against a real Supabase when configured, e.g. a local one from `npx supabase start`:
// SUPABASE_URL, SUPABASE_SERVICE_KEY and SUPABASE_ANON_KEY (the browser-side key).
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

describe.skipIf(!url || !serviceKey || !anonKey)('SupabaseSceneStore (live Supabase)', () => {
	it('round-trips a scene through Postgres, still valid on the way back', async () => {
		const store = SupabaseSceneStore.connect(url!, serviceKey!);
		const id = await store.save(scene);
		const loaded = await store.load(id);
		expect(parseSceneFile(loaded)).toEqual({ ok: true, scene });
		expect(await store.load('f'.repeat(32))).toBeNull();
	});

	it('keeps saves away from the browser key: no reading, listing or writing', async () => {
		const id = await SupabaseSceneStore.connect(url!, serviceKey!).save(scene);
		const browser = createClient(url!, anonKey!, { auth: { persistSession: false } });
		const byId = await browser.from('scenes').select('data').eq('id', id);
		expect(byId.data ?? []).toEqual([]);
		const all = await browser.from('scenes').select('id');
		expect(all.data ?? []).toEqual([]);
		const write = await browser.from('scenes').insert({ id: 'e'.repeat(32), name: 'x', data: {} });
		expect(write.error).not.toBeNull();
	});

	it('rejects rows that are not scenes at the database too', async () => {
		const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
		const badId = await admin.from('scenes').insert({ id: '../../x', name: 'x', data: {} });
		expect(badId.error).not.toBeNull();
		const badName = await admin.from('scenes').insert({ id: 'd'.repeat(32), name: '', data: {} });
		expect(badName.error).not.toBeNull();
	});
});
