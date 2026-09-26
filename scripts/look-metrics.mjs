// Measures how close our renders are to the private reference shots and
// prints the distances (docs/LOOK.md). The references are never committed:
// point LOOK_REFS at the folder holding 1.jpg … 8.jpg and they are copied into
// .look-refs/ (gitignored) for the run. Only numbers land in
// docs/look-metrics.json, keyed by milestone.
//   LOOK_REFS=/path/to/refs node scripts/look-metrics.mjs [--milestone m63] [--ours-only]
// --ours-only measures our renders against the reference numbers already
// committed, without the images.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const oursOnly = args.includes('--ours-only');
const at = args.indexOf('--milestone');
const milestone = at >= 0 ? args[at + 1] : 'm61';

if (!oursOnly) {
	const refs = process.env.LOOK_REFS;
	if (!refs || !existsSync(refs)) {
		console.error('Set LOOK_REFS to the folder with the reference images, or pass --ours-only.');
		process.exit(1);
	}
	mkdirSync('.look-refs', { recursive: true });
	for (const file of readdirSync(refs)) {
		if (/^[1-8]\.jpg$/.test(file))
			copyFileSync(path.join(refs, file), path.join('.look-refs', file));
	}
}

execFileSync(
	'npx',
	['vitest', 'run', '--project', 'client', 'src/lib/tabletop/look-metrics.svelte.spec.ts'],
	{
		stdio: 'inherit',
		env: {
			...process.env,
			VITE_LOOK_MILESTONE: milestone,
			VITE_LOOK_OURS_ONLY: oursOnly ? '1' : ''
		}
	}
);

const report = JSON.parse(readFileSync('docs/look-metrics.json', 'utf8'));
console.log(`\nDistance to each reference (0 is identical), ${milestone}:`);
for (const [key, entry] of Object.entries(report.pairings)) {
	const history = Object.entries(entry.ours)
		.map(([m, r]) => `${m} ${r.distance.toFixed(3)}`)
		.join(', ');
	console.log(`  ${key} (${entry.fixture}, ${entry.pose}, ${entry.band}): ${history}`);
}
