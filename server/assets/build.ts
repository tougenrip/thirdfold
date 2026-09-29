// Builds the assets: `npm run assets` (writes static/assets), or
// `npm run assets -- --check` (fails if static/assets or the lock isn't what the sources build).
// Also generates the prop catalogue's module and shipped list (catalog.ts).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkCredits } from './licence';
import { CATALOG_MODULE, SHIPPED_FILE, shippedText, staleCatalog } from './catalog';
import { AssetError, buildAssets, staleAssets, writeAssets } from './pipeline';
import { adventures, checkScenes, sceneReport } from './scenes';
import { LOCK_FILE, lockOf, lockText } from './store';

const SOURCES = 'assets';
const OUT = path.join('static', 'assets');

try {
	const built = await buildAssets(SOURCES);
	const problems = checkScenes(built.manifest);
	if (problems.length) {
		console.error(
			`The adventures' tables refer to missing assets or go over budget:\n  ${problems.join('\n  ')}`
		);
		process.exit(1);
	}
	const named = checkCredits(
		built.manifest,
		adventures().filter((A) => typeof A !== 'string')
	);
	if (named.length) {
		console.error(`The public manifest names the story:\n  ${named.join('\n  ')}`);
		process.exit(1);
	}
	const bytes = [...built.files.values()].reduce((sum, d) => sum + d.length, 0);
	const count = (o: object) => Object.keys(o).length;
	const m = built.manifest;
	const summary = `${count(m.models)} models, ${count(m.textures)} textures, ${count(m.materials)} materials, ${count(m.environments)} environments, ${count(m.audio)} sounds (${(bytes / 1024).toFixed(0)} kB)`;
	const kB = (n: number) => `${(n / 1024).toFixed(0)} kB`;
	const packs = Object.entries(m.packs).map(
		([id, p]) => `${id}: ${kB(p.bytes)} (${kB(p.gpuBytes)} GPU)`
	);
	console.log(`Per pack:\n  ${packs.join('\n  ')}`);
	console.log(
		`Per table (docs/PERFORMANCE.md, "Asset budgets"):\n  ${sceneReport(m).join('\n  ')}`
	);
	if (process.argv.includes('--check')) {
		const stale = [...staleAssets(OUT, built), ...staleCatalog('.', SOURCES, built)];
		if (
			!existsSync(LOCK_FILE) ||
			readFileSync(LOCK_FILE, 'utf8') !== lockText(lockOf(built.files))
		) {
			stale.push(`${LOCK_FILE} is out of date`);
		}
		if (stale.length) {
			console.error(
				`static/assets is out of date; run \`npm run assets\`:\n  ${stale.join('\n  ')}`
			);
			process.exit(1);
		}
		console.log(`static/assets is up to date: ${summary}`);
	} else {
		const { written, removed } = writeAssets(OUT, built);
		writeFileSync(CATALOG_MODULE, built.catalogModule);
		writeFileSync(path.join(SOURCES, SHIPPED_FILE), shippedText(built.shipped));
		writeFileSync(LOCK_FILE, lockText(lockOf(built.files)));
		console.log(`Built ${summary}: ${written} written, ${removed} removed.`);
	}
} catch (err) {
	if (err instanceof AssetError) {
		console.error(err.message);
		process.exit(1);
	}
	throw err;
}
