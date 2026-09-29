// Fetches the surface library's CC0 source sets (#187, docs/ART.md section 11) into
// art/surfaces/<id>/, which git ignores but for each meta.json: the download's URL and SHA-256
// are its provenance.source, so a set is fetched once, checked, and unzipped beside its meta.
// An ambientCG set is one zip; a Poly Haven set is one PNG per map, so its meta's source is the
// colour map and `maps` lists the others, each with its URL and SHA-256 alike.
// By hand, never in CI: the cooked KTX2 files and assets/cook.lock.json are what is committed.
//
//   node scripts/fetch-surfaces.mjs [id...]    fetch what is missing (of those surfaces, or all),
//                                              refuse a hash mismatch
//   node scripts/fetch-surfaces.mjs --record   write the hash of a file whose meta has none (all zeros)
//
// Only ambientCG and Poly Haven are fetched from.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = 'art/surfaces';
const HOSTS = new Set(['ambientcg.com', 'dl.polyhaven.org']);
const UNPINNED = '0'.repeat(64);
const record = process.argv.includes('--record');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** Fetches one pinned file into `dir` (a zip as `<id>.zip`, a map by its own name); false if it fails. */
async function fetchPinned(id, dir, file, meta) {
	const url = new URL(file.url);
	if (!HOSTS.has(url.hostname)) {
		console.error(`${id}: ${file.url} is not ambientCG or Poly Haven`);
		return false;
	}
	const zipped = url.hostname === 'ambientcg.com';
	const local = path.join(dir, zipped ? `${id}.zip` : path.basename(url.pathname));
	let data = existsSync(local) ? readFileSync(local) : null;
	if (!data || sha256(data) !== file.sha256) {
		console.log(`${id}: fetching ${file.url}`);
		const res = await fetch(file.url);
		if (!res.ok) {
			console.error(`${id}: ${res.status} ${res.statusText}`);
			return false;
		}
		data = Buffer.from(await res.arrayBuffer());
		writeFileSync(local, data);
	}
	const got = sha256(data);
	if (file.sha256 === UNPINNED && record) {
		file.sha256 = got;
		writeFileSync(path.join(dir, 'meta.json'), `${JSON.stringify(meta, null, '\t')}\n`);
		console.log(`${id}: recorded ${got}`);
	} else if (got !== file.sha256) {
		console.error(`${id}: the download's SHA-256 is ${got}, not ${file.sha256}; removed`);
		rmSync(local);
		return false;
	}
	// The maps only (PNGs), flat beside the meta.
	if (zipped) execFileSync('unzip', ['-o', '-j', '-q', local, '*.png', '-d', dir]);
	return true;
}

let failed = false;
for (const id of readdirSync(ROOT).sort()) {
	const dir = path.join(ROOT, id);
	if (!existsSync(path.join(dir, 'meta.json')) || (only.length && !only.includes(id))) continue;
	const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'));
	let ok = true;
	for (const file of [meta.provenance.source, ...(meta.maps ?? [])])
		ok = (await fetchPinned(id, dir, file, meta)) && ok;
	if (ok) console.log(`${id}: ok`);
	else failed = true;
}
if (failed) process.exit(1);
