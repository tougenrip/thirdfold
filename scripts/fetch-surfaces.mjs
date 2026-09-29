// Fetches the surface library's CC0 source sets (#187, docs/ART.md section 11) into
// art/surfaces/<id>/, which git ignores but for each meta.json: the download's URL and SHA-256
// are its provenance.source, so a set is fetched once, checked, and unzipped beside its meta.
// By hand, never in CI: the cooked KTX2 files and assets/cook.lock.json are what is committed.
//
//   node scripts/fetch-surfaces.mjs            fetch what is missing, refuse a hash mismatch
//   node scripts/fetch-surfaces.mjs --record   write the hash of a set whose meta has none (all zeros)
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
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

let failed = false;
for (const id of readdirSync(ROOT).sort()) {
	const metaFile = path.join(ROOT, id, 'meta.json');
	if (!existsSync(metaFile)) continue;
	const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
	const { url, sha256: want } = meta.provenance.source;
	if (!HOSTS.has(new URL(url).hostname)) {
		console.error(`${id}: ${url} is not ambientCG or Poly Haven`);
		failed = true;
		continue;
	}
	const zip = path.join(ROOT, id, `${id}.zip`);
	let data = existsSync(zip) ? readFileSync(zip) : null;
	if (!data || sha256(data) !== want) {
		console.log(`${id}: fetching ${url}`);
		const res = await fetch(url);
		if (!res.ok) {
			console.error(`${id}: ${res.status} ${res.statusText}`);
			failed = true;
			continue;
		}
		data = Buffer.from(await res.arrayBuffer());
		writeFileSync(zip, data);
	}
	const got = sha256(data);
	if (want === UNPINNED && record) {
		meta.provenance.source.sha256 = got;
		writeFileSync(metaFile, `${JSON.stringify(meta, null, '\t')}\n`);
		console.log(`${id}: recorded ${got}`);
	} else if (got !== want) {
		console.error(`${id}: the download's SHA-256 is ${got}, not ${want}; removed`);
		rmSync(zip);
		failed = true;
		continue;
	}
	// The maps only (PNGs), flat beside the meta.
	execFileSync('unzip', ['-o', '-j', '-q', zip, '*.png', '-d', path.join(ROOT, id)]);
	console.log(`${id}: ok`);
}
if (failed) process.exit(1);
