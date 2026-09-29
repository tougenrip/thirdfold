import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { BUCKET, lockOf, parseLock, publish, pull, sha256, type Lock } from './store';

const MODEL = 'models/crate.19ff9d96.glb';
const SOUND = 'audio/bell.0af6d182.wav';

/** A built folder with two hosted files, and its lock. */
function built(): { dir: string; lock: Lock; files: Map<string, Uint8Array> } {
	const dir = mkdtempSync(path.join(tmpdir(), 'thirdfold-store-'));
	const files = new Map<string, Uint8Array>([
		[MODEL, new Uint8Array([1, 2, 3])],
		[SOUND, new Uint8Array([4, 5])],
		['decoders/basis-dc5e5d6a/basis_transcoder.js', new Uint8Array([6])]
	]);
	for (const [file, data] of files) {
		mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		writeFileSync(path.join(dir, file), data);
	}
	return { dir, lock: lockOf(files), files };
}

/** Supabase Storage's object API over a map, as supabase-js calls it. */
function fakeStorage(objects = new Map<string, { data: Uint8Array; headers: Headers }>()) {
	const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(String(input));
		const key = decodeURIComponent(url.pathname.replace('/storage/v1/object/assets/', ''));
		const method = init?.method ?? 'GET';
		if (method === 'HEAD') return new Response(null, { status: objects.has(key) ? 200 : 400 });
		if (method === 'POST') {
			if (objects.has(key)) return Response.json({ error: 'Duplicate' }, { status: 409 });
			const data = new Uint8Array(init!.body as Uint8Array);
			objects.set(key, { data, headers: new Headers(init!.headers) });
			return Response.json({ Key: `assets/${key}`, Id: key });
		}
		return new Response(null, { status: 405 });
	}) as typeof fetch;
	return { objects, fetcher };
}

describe('The asset lock', () => {
	it('lists every hosted file’s SHA-256, not the decoders', () => {
		const { lock, files } = built();
		expect(lock).toEqual({
			[SOUND]: sha256(files.get(SOUND)!),
			[MODEL]: sha256(files.get(MODEL)!)
		});
		expect(Object.keys(lock)).toEqual([SOUND, MODEL]);
	});

	it('refuses names that are not asset files and hashes that are not whole', () => {
		expect(parseLock(JSON.stringify({ [MODEL]: 'a'.repeat(64) }))).toEqual({
			[MODEL]: 'a'.repeat(64)
		});
		expect(() => parseLock(JSON.stringify({ '../secret.glb': 'a'.repeat(64) }))).toThrow(
			/not an asset file/
		);
		expect(() => parseLock(JSON.stringify({ [MODEL]: '19ff9d96' }))).toThrow(/bad SHA-256/);
		expect(() => parseLock('[]')).toThrow(/not an object/);
	});

	it('is committed and parses', () => {
		const lock = parseLock(readFileSync('assets/assets.lock.json', 'utf8'));
		expect(Object.keys(lock)).toContain('audio/bell-great.d370c2af.wav');
	});
});

describe('Publishing to the bucket', () => {
	const env = (fetcher: typeof fetch) => ({
		url: 'http://store.test',
		serviceKey: 'k',
		fetch: fetcher
	});

	it('uploads what the bucket lacks, immutable for a year, and never replaces a file', async () => {
		const { dir, lock, files } = built();
		const storage = fakeStorage();
		expect(await publish(dir, lock, env(storage.fetcher))).toEqual({
			done: [SOUND, MODEL],
			skipped: []
		});
		const model = storage.objects.get(MODEL)!;
		expect([...model.data]).toEqual([...files.get(MODEL)!]);
		expect(model.headers.get('cache-control')).toBe('max-age=31536000');
		expect(model.headers.get('content-type')).toBe('model/gltf-binary');
		expect(model.headers.get('x-upsert')).toBe('false');
		expect(storage.objects.get(SOUND)!.headers.get('content-type')).toBe('audio/wav');
		expect(storage.objects.has('decoders/basis-dc5e5d6a/basis_transcoder.js')).toBe(false);

		expect(await publish(dir, lock, env(storage.fetcher))).toEqual({
			done: [],
			skipped: [SOUND, MODEL]
		});
	});

	it('refuses a file that is not what the lock lists, before uploading anything', async () => {
		const { dir, lock } = built();
		writeFileSync(path.join(dir, MODEL), new Uint8Array([9]));
		const storage = fakeStorage();
		await expect(publish(dir, lock, env(storage.fetcher))).rejects.toThrow(
			`${MODEL} is not what the lock lists`
		);
		expect(storage.objects.size).toBe(0);
	});

	it('takes a variant kept elsewhere as published only if the bucket has it', async () => {
		const { lock, files } = built();
		const storage = fakeStorage();
		storage.objects.set(SOUND, { data: files.get(SOUND)!, headers: new Headers() });
		const gone = mkdtempSync(path.join(tmpdir(), 'thirdfold-store-')); // no files here at all
		expect(await publish(gone, { [SOUND]: lock[SOUND] }, env(storage.fetcher), true)).toEqual({
			done: [],
			skipped: [SOUND]
		});
		await expect(publish(gone, lock, env(storage.fetcher), true)).rejects.toThrow(
			`${MODEL} is neither in ${gone} nor in the store`
		);
	});
});

describe('Pulling from the bucket', () => {
	const serving = (files: Map<string, Uint8Array>) => {
		const asked: string[] = [];
		const fetcher = (async (input: string | URL | Request) => {
			const url = String(input);
			asked.push(url);
			const file = url.replace('https://cdn.test/assets/', '');
			const data = files.get(file);
			return data ? new Response(data) : new Response(null, { status: 404 });
		}) as typeof fetch;
		return { asked, fetcher };
	};

	it('restores the missing files from the public URL, checked, and keeps the ones there', async () => {
		const { lock, files } = built();
		const dir = mkdtempSync(path.join(tmpdir(), 'thirdfold-pull-'));
		mkdirSync(path.join(dir, 'audio'));
		writeFileSync(path.join(dir, SOUND), files.get(SOUND)!);
		const store = serving(files);
		expect(await pull(dir, lock, 'https://cdn.test/assets/', store.fetcher)).toEqual({
			done: [MODEL],
			skipped: [SOUND]
		});
		expect(store.asked).toEqual([`https://cdn.test/assets/${MODEL}`]);
		expect([...readFileSync(path.join(dir, MODEL))]).toEqual([...files.get(MODEL)!]);
	});

	it('refuses bytes from the store that are not what the lock lists, and writes nothing', async () => {
		const { lock } = built();
		const dir = mkdtempSync(path.join(tmpdir(), 'thirdfold-pull-'));
		const tampered = new Map([
			[SOUND, new Uint8Array([4, 5])],
			[MODEL, new Uint8Array([6, 6, 6])]
		]);
		await expect(
			pull(dir, lock, 'https://cdn.test/assets', serving(tampered).fetcher)
		).rejects.toThrow(`${MODEL} from the store is not what the lock lists`);
		expect(existsSync(path.join(dir, MODEL))).toBe(false);
	});

	it('fails on a file the store lacks, and on a local file that differs from the lock', async () => {
		const { lock, files } = built();
		const empty = mkdtempSync(path.join(tmpdir(), 'thirdfold-pull-'));
		await expect(
			pull(empty, lock, 'https://cdn.test/assets', serving(new Map()).fetcher)
		).rejects.toThrow(`${SOUND}: HTTP 404`);
		const { dir } = built();
		writeFileSync(path.join(dir, MODEL), new Uint8Array([0]));
		await expect(
			pull(dir, lock, 'https://cdn.test/assets', serving(files).fetcher)
		).rejects.toThrow(`${MODEL} is not what the lock lists`);
	});
});

// Against a local Supabase with storage (`npm run db:start`), as the CI `supabase` job runs it.
const LIVE = {
	url: process.env.SUPABASE_URL ?? '',
	serviceKey: process.env.SUPABASE_SERVICE_KEY ?? '',
	anonKey: process.env.SUPABASE_ANON_KEY ?? ''
};

describe.skipIf(!LIVE.url || !LIVE.serviceKey || !LIVE.anonKey)('The assets bucket', () => {
	it('takes a publish once, serves it to anyone for a year, and nobody else writes', async () => {
		const data = randomBytes(64);
		const lock = lockOf(new Map([[`models/probe.${sha256(data).slice(0, 8)}.glb`, data]]));
		const [file] = Object.keys(lock);
		const dir = mkdtempSync(path.join(tmpdir(), 'thirdfold-live-'));
		mkdirSync(path.join(dir, 'models'));
		writeFileSync(path.join(dir, file), data);
		const admin = createClient(LIVE.url, LIVE.serviceKey).storage.from(BUCKET);
		try {
			expect(await publish(dir, lock, LIVE)).toEqual({ done: [file], skipped: [] });
			expect(await publish(dir, lock, LIVE)).toEqual({ done: [], skipped: [file] });

			const store = `${LIVE.url}/storage/v1/object/public/${BUCKET}`;
			const served = await fetch(`${store}/${file}`);
			expect(served.headers.get('cache-control')).toContain('max-age=31536000');
			const out = mkdtempSync(path.join(tmpdir(), 'thirdfold-live-'));
			expect(await pull(out, lock, store)).toEqual({ done: [file], skipped: [] });

			const anon = createClient(LIVE.url, LIVE.anonKey).storage.from(BUCKET);
			expect((await anon.upload('models/intruder.00000000.glb', data)).error).not.toBeNull();
			await anon.remove([file]);
			expect((await fetch(`${store}/${file}`)).ok).toBe(true);
		} finally {
			await admin.remove([file]);
		}
	});
});
