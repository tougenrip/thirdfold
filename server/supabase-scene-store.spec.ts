import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID } from '../src/lib/game/grid';
import { parseSceneFile, serializeScene } from '../src/lib/game/scene-file';
import { emptyMask } from '../src/lib/game/visibility';
import { SCENE_ID_PATTERN } from './scene-store';
import { SupabaseSceneStore } from './supabase-scene-store';
import { restoreRoom, serializeRoom, SupabaseRoomStore } from './room-store';
import { RoomManager } from './rooms';
import { SupabaseLibraryStore } from './supabase-library-store';
import { libraryStoreSuite } from './library-store.suite';

const scene = serializeScene('Crypt', {
	grid: DEFAULT_GRID,
	tokens: [],
	objects: [{ id: 'w1', kind: 'wall', a: { x: 0, y: 1 }, b: { x: 3, y: 1 } }],
	props: [{ id: 'p1', assetId: 'crate', pos: { x: 5, y: 5 }, rotation: 0, scale: 1 }],
	lights: [],
	ambient: 'dusk',
	fog: { enabled: true, revealed: emptyMask(DEFAULT_GRID), shared: false },
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
			[
				'insert',
				{
					id,
					name: 'Crypt',
					data: scene,
					owner: null,
					auto: false,
					summary: null,
					saved_at: scene.savedAt
				}
			]
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

describe.skipIf(!url || !serviceKey || !anonKey)('Owned saves (live Supabase)', () => {
	const owner = (c: string) => c.repeat(64);

	it('lists a GM’s own saves newest first, replaces one in place, and forgets it for its owner only', async () => {
		const store = SupabaseSceneStore.connect(url!, serviceKey!);
		const alice = owner(String(Math.floor(Math.random() * 10)));
		const bob = owner('e');
		for (const s of await store.list(alice)) await store.remove(s.id, alice);
		const story = {
			title: 'The Hollow Bell',
			chapter: 'The quiet village',
			location: 'Bellweather',
			party: ['The Warden (Ana)']
		};
		const older = await store.save(
			{ ...scene, savedAt: '2026-09-23T20:00:00.000Z' },
			{ owner: alice }
		);
		const auto = await store.save(
			{ ...scene, savedAt: '2026-09-24T21:43:00.000Z' },
			{ owner: alice, auto: true, story }
		);
		const mine = await store.list(alice);
		expect(mine.map((x) => x.id)).toEqual([auto, older]);
		expect(mine[0]).toMatchObject({ auto: true, story, savedAt: '2026-09-24T21:43:00.000Z' });
		expect(await store.ownerOf(auto)).toBe(alice);
		await store.save(
			{ ...scene, savedAt: '2026-09-25T09:00:00.000Z' },
			{ owner: alice, auto: true, story },
			auto
		);
		expect((await store.list(alice))[0]).toMatchObject({
			id: auto,
			savedAt: '2026-09-25T09:00:00.000Z'
		});
		await expect(store.save(scene, { owner: bob }, auto)).rejects.toThrow(/someone else/);
		expect(await store.remove(auto, bob)).toBe(false);
		expect(await store.remove(auto, alice)).toBe(true);
		expect(await store.load(auto)).toBeNull();
		await store.remove(older, alice);
	});

	it('refuses an owner that is not a key hash at the database', async () => {
		const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
		const bad = await admin
			.from('scenes')
			.insert({ id: '9'.repeat(32), name: 'x', data: {}, owner: 'not-a-hash' });
		expect(bad.error).not.toBeNull();
	});
});

describe.skipIf(!url || !serviceKey || !anonKey)('SupabaseRoomStore (live Supabase)', () => {
	const liveRoom = () => {
		const rooms = new RoomManager();
		const created = rooms.create('Gia');
		if (!created.ok) throw new Error(created.message);
		return serializeRoom(created.room);
	};

	it('keeps a live room in Postgres, replaces it on save, and forgets it on remove', async () => {
		const store = SupabaseRoomStore.connect(url!, serviceKey!);
		const room = liveRoom();
		await store.save(room);
		await store.save({ ...room, nextSeq: room.nextSeq + 1 });
		const kept = (await store.loadAll()).filter((r) => (r as { id: string }).id === room.id);
		expect(kept).toHaveLength(1);
		const back = restoreRoom(kept[0]);
		expect(back.ok && back.room.nextSeq).toBe(room.nextSeq + 1);
		await store.remove(room.id);
		const gone = (await store.loadAll()).filter((r) => (r as { id: string }).id === room.id);
		expect(gone).toEqual([]);
	});

	it('keeps live rooms (and their session tokens) away from the browser key', async () => {
		const room = liveRoom();
		await SupabaseRoomStore.connect(url!, serviceKey!).save(room);
		const browser = createClient(url!, anonKey!, { auth: { persistSession: false } });
		const all = await browser.from('live_rooms').select('data');
		expect(all.data ?? []).toEqual([]);
		const write = await browser.from('live_rooms').insert({ id: 'ABCDEF', data: {} });
		expect(write.error).not.toBeNull();
		await SupabaseRoomStore.connect(url!, serviceKey!).remove(room.id);
	});

	it('rejects rows that are not rooms at the database too', async () => {
		const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
		const bad = await admin.from('live_rooms').insert({ id: '../x', data: {} });
		expect(bad.error).not.toBeNull();
	});
});

describe.skipIf(!url || !serviceKey || !anonKey)('SupabaseLibraryStore (live Supabase)', () => {
	libraryStoreSuite(() => SupabaseLibraryStore.connect(url!, serviceKey!));

	it('keeps the library away from the browser key: no reading, writing or rating', async () => {
		const store = SupabaseLibraryStore.connect(url!, serviceKey!);
		const owner = 'e'.repeat(64);
		const { id } = await store.publish({
			owner,
			creatorName: 'Mira',
			title: 'Private',
			about: '',
			file: {}
		});
		const browser = createClient(url!, anonKey!, { auth: { persistSession: false } });
		for (const table of ['library_adventures', 'library_versions', 'library_ratings']) {
			const read = await browser.from(table).select('*');
			expect(read.data ?? []).toEqual([]);
		}
		const write = await browser.from('library_adventures').update({ plays: 999 }).eq('id', id);
		expect(write.error).not.toBeNull();
		const play = await browser.rpc('library_play', { target: id });
		expect(play.error).not.toBeNull();
		const rate = await browser.rpc('library_rate', { target: id, who: owner, score: 5 });
		expect(rate.error).not.toBeNull();
		const publish = await browser.rpc('library_publish', {
			target: id,
			who: owner,
			creator: '0'.repeat(16),
			creator_label: 'x',
			label: 'x',
			blurb: '',
			body: {}
		});
		expect(publish.error).not.toBeNull();
		expect((await store.get(id))?.listing).toMatchObject({ plays: 0, version: 1, rating: null });
		await store.remove(id, owner);
	});

	it('rejects rows that are not library rows at the database too', async () => {
		const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
		const bad = await admin.from('library_adventures').insert({
			id: '../x',
			owner: 'f'.repeat(64),
			creator_id: '0'.repeat(16),
			creator_name: 'x',
			title: 'x',
			version: 1
		});
		expect(bad.error).not.toBeNull();
		const stars = await admin.rpc('library_rate', {
			target: 'f'.repeat(32),
			who: 'f'.repeat(64),
			score: 9
		});
		expect(stars.error).not.toBeNull();
	});
});
