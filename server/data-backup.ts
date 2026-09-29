// Backs up every place the game server keeps data, before a deploy that bumps the scene file
// (docs/RENDERING.md, "Scene-file policy"): saves, live rooms and the library.
//
//   npm run data:backup                  into backups/<ISO time>/
//   npm run data:backup -- <dir>         into <dir>
//
// Files come from SCENES_DIR, ROOMS_DIR and LIBRARY_DIR (the defaults of server/index.ts) into
// <dir>/files/; with SUPABASE_URL and SUPABASE_SERVICE_KEY set, each table is paged out into
// <dir>/tables/<table>.ndjson. manifest.json says what was taken. A backup holds session tokens
// and GM key hashes: keep it like the database. `npm run data:restore` puts it back.

import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface DataDirs {
	scenes: string;
	rooms: string;
	library: string;
}

/** The tables, parents before children (restore order), with their primary keys. */
export const TABLES = [
	{ name: 'scenes', key: ['id'] },
	{ name: 'live_rooms', key: ['id'] },
	{ name: 'library_adventures', key: ['id'] },
	{ name: 'library_versions', key: ['adventure_id', 'version'] },
	{ name: 'library_ratings', key: ['adventure_id', 'rater'] }
] as const;

export interface BackupManifest {
	createdAt: string;
	/** package.json's version of the build that took it. */
	app: string;
	/** Files per store directory, or null where there was no directory. */
	files: Record<keyof DataDirs, number | null>;
	/** Rows per table, or null when Supabase wasn't configured. */
	tables: Record<string, number> | null;
	/** How many saves and live rooms carry each scene-file version. */
	sceneVersions: Record<string, number>;
}

const PAGE = 500;

export function dataDirs(env = process.env): DataDirs {
	return {
		scenes: path.resolve(env.SCENES_DIR ?? 'data/scenes'),
		rooms: path.resolve(env.ROOMS_DIR ?? 'data/rooms'),
		library: path.resolve(env.LIBRARY_DIR ?? 'data/library')
	};
}

/** The service-key client when Supabase is configured, as server/index.ts decides. */
export function supabaseFromEnv(env = process.env): SupabaseClient | null {
	const { SUPABASE_URL: url, SUPABASE_SERVICE_KEY: key } = env;
	if (url && key) {
		return createClient(url, key, {
			auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
		});
	}
	if (url || key) throw new Error('Set both SUPABASE_URL and SUPABASE_SERVICE_KEY, or neither.');
	return null;
}

/** A store's temporary write-then-rename file, never worth keeping. */
export const isTemp = (file: string) => file.endsWith('.tmp');

export async function backupData(
	out: string,
	dirs: DataDirs,
	db: SupabaseClient | null,
	now = new Date()
): Promise<BackupManifest> {
	await mkdir(out, { recursive: true });
	if ((await readdir(out)).length > 0) throw new Error(`${out} is not empty`);
	const versions = new Map<unknown, number>();
	const seen = (v: unknown) => versions.set(v, (versions.get(v) ?? 0) + 1);

	const files = {} as BackupManifest['files'];
	for (const store of ['scenes', 'rooms', 'library'] as const) {
		const names = await listFiles(dirs[store]);
		files[store] = names?.length ?? null;
		if (!names) continue;
		await cp(dirs[store], path.join(out, 'files', store), {
			recursive: true,
			filter: (src) => !isTemp(src)
		});
		for (const name of names) {
			if (store === 'library' || name.endsWith('.meta.json')) continue;
			const data = JSON.parse(await readFile(path.join(dirs[store], name), 'utf8'));
			seen(store === 'scenes' ? data?.version : data?.scene?.version);
		}
	}

	let tables: BackupManifest['tables'] = null;
	if (db) {
		tables = {};
		await mkdir(path.join(out, 'tables'), { recursive: true });
		for (const table of TABLES) {
			const rows = await readTable(db, table.name, table.key);
			await writeFile(
				path.join(out, 'tables', `${table.name}.ndjson`),
				rows.map((row) => JSON.stringify(row) + '\n').join(''),
				'utf8'
			);
			tables[table.name] = rows.length;
			for (const row of rows) {
				const data = (row as { data?: { version?: unknown; scene?: { version?: unknown } } }).data;
				if (table.name === 'scenes') seen(data?.version);
				if (table.name === 'live_rooms') seen(data?.scene?.version);
			}
		}
	}

	const manifest: BackupManifest = {
		createdAt: now.toISOString(),
		app: await appVersion(),
		files,
		tables,
		sceneVersions: Object.fromEntries([...versions].map(([v, n]) => [String(v), n]))
	};
	await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, '\t') + '\n');
	return manifest;
}

/** The JSON files in a store's directory, or null when there is no directory. */
export async function listFiles(dir: string): Promise<string[] | null> {
	try {
		if (!(await stat(dir)).isDirectory()) throw new Error(`${dir} is not a directory`);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw err;
	}
	return (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
}

async function readTable(
	db: SupabaseClient,
	table: string,
	key: readonly string[]
): Promise<unknown[]> {
	const rows: unknown[] = [];
	for (let from = 0; ; from += PAGE) {
		let query = db.from(table).select('*');
		for (const column of key) query = query.order(column, { ascending: true });
		const { data, error } = await query.range(from, from + PAGE - 1);
		if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
		rows.push(...(data ?? []));
		if ((data ?? []).length < PAGE) return rows;
	}
}

async function appVersion(): Promise<string> {
	const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
	return String(pkg.version);
}

async function main(target: string | undefined): Promise<void> {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const out = path.resolve(target ?? path.join('backups', stamp));
	const db = supabaseFromEnv();
	const manifest = await backupData(out, dataDirs(), db);
	console.info(`[data:backup] ${out}`);
	console.info(JSON.stringify(manifest, null, '\t'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main(process.argv[2]).catch((err: Error) => {
		console.error(`[data:backup] failed: ${err.message}`);
		process.exit(1);
	});
}
