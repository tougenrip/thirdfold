// Puts a backup from `npm run data:backup` back, to roll a deploy back (docs/RENDERING.md,
// "Scene-file policy"). Stop the game server first: a running one would write its rooms over it.
//
//   npm run data:restore -- <backup dir> --yes
//
// Files go back into SCENES_DIR, ROOMS_DIR and LIBRARY_DIR, replacing any file of the same name;
// rows are upserted by primary key into the Supabase of SUPABASE_URL and SUPABASE_SERVICE_KEY.
// Nothing made after the backup is deleted, but whatever the backup holds is replaced by it.

import { cp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	dataDirs,
	isTemp,
	listFiles,
	supabaseFromEnv,
	TABLES,
	type BackupManifest,
	type DataDirs
} from './data-backup';

/** Rows per upsert stay under this many bytes (a library version may be 1 MB alone). */
const BATCH_BYTES = 4_000_000;

export async function restoreData(
	from: string,
	dirs: DataDirs,
	db: SupabaseClient | null
): Promise<BackupManifest> {
	const manifest = JSON.parse(
		await readFile(path.join(from, 'manifest.json'), 'utf8')
	) as BackupManifest;
	if (manifest.tables && !db) {
		throw new Error('This backup has Supabase tables: set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
	}

	for (const store of ['scenes', 'rooms', 'library'] as const) {
		const source = path.join(from, 'files', store);
		const names = await listFiles(source);
		if ((names?.length ?? null) !== manifest.files[store]) {
			throw new Error(`${source} does not match the manifest`);
		}
		if (names) await cp(source, dirs[store], { recursive: true, filter: (src) => !isTemp(src) });
	}

	if (manifest.tables && db) {
		for (const table of TABLES) {
			const text = await readFile(path.join(from, 'tables', `${table.name}.ndjson`), 'utf8');
			const rows = text
				.split('\n')
				.filter((line) => line !== '')
				.map((line) => JSON.parse(line) as Record<string, unknown>);
			if (rows.length !== manifest.tables[table.name]) {
				throw new Error(`${table.name}.ndjson does not match the manifest`);
			}
			for (const batch of batches(rows)) {
				const { error } = await db
					.from(table.name)
					.upsert(batch, { onConflict: table.key.join(',') });
				if (error) throw new Error(`Restoring ${table.name} failed: ${error.message}`);
			}
		}
	}
	return manifest;
}

function* batches(rows: Record<string, unknown>[]): Generator<Record<string, unknown>[]> {
	let batch: Record<string, unknown>[] = [];
	let bytes = 0;
	for (const row of rows) {
		const size = JSON.stringify(row).length;
		if (batch.length > 0 && bytes + size > BATCH_BYTES) {
			yield batch;
			batch = [];
			bytes = 0;
		}
		batch.push(row);
		bytes += size;
	}
	if (batch.length > 0) yield batch;
}

async function main(args: string[]): Promise<void> {
	const from = args.find((arg) => !arg.startsWith('--'));
	if (!from) throw new Error('usage: npm run data:restore -- <backup dir> --yes');
	if (!args.includes('--yes')) {
		throw new Error(
			`this replaces live data with ${from}. Stop the game server, then run again with --yes.`
		);
	}
	const manifest = await restoreData(path.resolve(from), dataDirs(), supabaseFromEnv());
	console.info(`[data:restore] restored the backup of ${manifest.createdAt} (${manifest.app})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main(process.argv.slice(2)).catch((err: Error) => {
		console.error(`[data:restore] failed: ${err.message}`);
		process.exit(1);
	});
}
