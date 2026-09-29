// The asset store (#191, docs/ASSETS.md "The asset store"): every built file by its hashed
// name in the public Supabase Storage bucket `assets`, which only the service key can write.
//
//   npm run assets:publish   uploads what the bucket lacks (SUPABASE_URL, SUPABASE_SERVICE_KEY)
//   npm run assets:pull      downloads what static/assets lacks from the bucket's public URL
//                            (ASSET_STORE_URL), each file checked against the lock
//
// Both do texture detail's 1K and 2K variants too (variants.ts): from and into variants/, by
// assets/variants.lock.json; a variant cooked elsewhere need only be in the bucket.
//
// The lock, assets/assets.lock.json, maps each hosted file (ASSET_FILE_PATTERN: not the manifest,
// not the decoders, which are code and always ship with the page) to its SHA-256. `npm run assets`
// writes it and `assets:check` fails when it differs from what the sources build.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { ASSET_FILE_PATTERN } from '../../src/lib/assets/manifest';
import { VARIANTS_DIR, lockedVariants, readVariantLock } from './variants';

export const LOCK_FILE = path.join('assets', 'assets.lock.json');
export const BUCKET = 'assets';
/** A year: every hosted name is its content's hash, so a file never changes under its name. */
export const CACHE_SECONDS = 31536000;

/** Hosted file → its SHA-256 (hex). */
export type Lock = Record<string, string>;

const SHA256 = /^[0-9a-f]{64}$/;
const TYPES: Record<string, string> = {
	glb: 'model/gltf-binary',
	png: 'image/png',
	ktx2: 'image/ktx2',
	wav: 'audio/wav',
	ogg: 'audio/ogg'
};

export const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

/** The lock for a build's files: the hosted ones, sorted. */
export function lockOf(files: Map<string, Uint8Array>): Lock {
	const hosted = [...files.keys()].filter((file) => ASSET_FILE_PATTERN.test(file)).sort();
	return Object.fromEntries(hosted.map((file) => [file, sha256(files.get(file)!)]));
}

export const lockText = (lock: Lock) => `${JSON.stringify(lock, null, '\t')}\n`;

/** Reads and checks a lock: every key a hosted file's name, every value a whole SHA-256. */
export function parseLock(text: string): Lock {
	const raw: unknown = JSON.parse(text);
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		throw new Error('the lock is not an object');
	}
	for (const [file, hash] of Object.entries(raw)) {
		if (!ASSET_FILE_PATTERN.test(file))
			throw new Error(`the lock names ${file}, not an asset file`);
		if (typeof hash !== 'string' || !SHA256.test(hash)) throw new Error(`bad SHA-256 for ${file}`);
	}
	return raw as Lock;
}

/** A file's bytes from `dir`, refused unless they are what the lock says. */
function lockedBytes(dir: string, file: string, lock: Lock): Uint8Array {
	const data = readFileSync(path.join(dir, file));
	if (sha256(data) !== lock[file]) throw new Error(`${file} is not what the lock lists`);
	return data;
}

export interface Tally {
	done: string[];
	skipped: string[];
}

/**
 * Uploads every locked file the bucket lacks, never replacing one; each checked against the lock
 * first. With `elsewhere`, a file that isn't in `dir` must already be in the bucket (a variant
 * cooked on another machine).
 */
export async function publish(
	dir: string,
	lock: Lock,
	env: { url: string; serviceKey: string; fetch?: typeof fetch },
	elsewhere = false
): Promise<Tally> {
	const bucket = createClient(env.url, env.serviceKey, {
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		global: env.fetch ? { fetch: env.fetch } : {}
	}).storage.from(BUCKET);
	// Every file checked before the first upload, so a bad build publishes nothing.
	const here = Object.keys(lock).filter((f) => !elsewhere || existsSync(path.join(dir, f)));
	const files = new Map(here.map((file) => [file, lockedBytes(dir, file, lock)]));
	const tally: Tally = { done: [], skipped: [] };
	for (const file of Object.keys(lock).filter((f) => !files.has(f))) {
		if (!(await bucket.exists(file)).data)
			throw new Error(`${file} is neither in ${dir} nor in the store: cook it or pull it`);
		tally.skipped.push(file);
	}
	for (const [file, data] of files) {
		const present = await bucket.exists(file);
		if (present.data) {
			tally.skipped.push(file);
			continue;
		}
		const { error } = await bucket.upload(file, data, {
			cacheControl: String(CACHE_SECONDS),
			contentType: TYPES[file.slice(file.lastIndexOf('.') + 1)],
			upsert: false
		});
		if (error) throw new Error(`${file}: ${error.message}`);
		tally.done.push(file);
	}
	return tally;
}

/**
 * Downloads every locked file missing from `dir` from the public bucket (`store`, its URL), checked
 * against the lock before it is written. A file already there must be what the lock says.
 */
export async function pull(
	dir: string,
	lock: Lock,
	store: string,
	fetcher: typeof fetch = fetch
): Promise<Tally> {
	const base = store.replace(/\/+$/, '');
	const tally: Tally = { done: [], skipped: [] };
	for (const [file, hash] of Object.entries(lock)) {
		const target = path.join(dir, file);
		if (existsSync(target)) {
			lockedBytes(dir, file, lock);
			tally.skipped.push(file);
			continue;
		}
		const response = await fetcher(`${base}/${file}`);
		if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
		const data = new Uint8Array(await response.arrayBuffer());
		if (sha256(data) !== hash) throw new Error(`${file} from the store is not what the lock lists`);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, data);
		tally.done.push(file);
	}
	return tally;
}

async function main(command: string | undefined): Promise<void> {
	const dir = path.join('static', 'assets');
	const lock = parseLock(readFileSync(LOCK_FILE, 'utf8'));
	// Texture detail's 1K and 2K (variants.ts): only in the store and in variants/, never committed.
	const variants = Object.fromEntries(lockedVariants(readVariantLock('assets')));
	if (command === 'publish') {
		const { SUPABASE_URL: url, SUPABASE_SERVICE_KEY: serviceKey } = process.env;
		if (!url || !serviceKey) throw new Error('set SUPABASE_URL and SUPABASE_SERVICE_KEY');
		const env = { url, serviceKey };
		const base = await publish(dir, lock, env);
		const larger = await publish(VARIANTS_DIR, variants, env, true);
		console.log(
			`Published ${base.done.length} files and ${larger.done.length} variants; ${base.skipped.length + larger.skipped.length} were already there.`
		);
	} else if (command === 'pull') {
		const store = process.env.ASSET_STORE_URL;
		if (!store) throw new Error('set ASSET_STORE_URL (<supabase>/storage/v1/object/public/assets)');
		const base = await pull(dir, lock, store);
		const larger = await pull(VARIANTS_DIR, variants, store);
		console.log(
			`Pulled ${base.done.length} files and ${larger.done.length} variants; ${base.skipped.length + larger.skipped.length} were already here.`
		);
	} else {
		throw new Error('usage: tsx server/assets/store.ts publish|pull');
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main(process.argv[2]).catch((err: Error) => {
		console.error(err.message);
		process.exit(1);
	});
}
