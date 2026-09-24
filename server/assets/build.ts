// Builds the assets: `npm run assets` (writes static/assets), or
// `npm run assets -- --check` (fails if static/assets isn't what the sources build).

import path from 'node:path';
import { AssetError, buildAssets, staleAssets, writeAssets } from './pipeline';
import { checkScenes } from './scenes';

const SOURCES = 'assets';
const OUT = path.join('static', 'assets');

try {
	const built = buildAssets(SOURCES);
	const problems = checkScenes(built.manifest);
	if (problems.length) {
		console.error(`The Hollow Bell's tables refer to missing assets:\n  ${problems.join('\n  ')}`);
		process.exit(1);
	}
	const bytes = [...built.files.values()].reduce((sum, d) => sum + d.length, 0);
	const count = (o: object) => Object.keys(o).length;
	const m = built.manifest;
	const summary = `${count(m.models)} models, ${count(m.textures)} textures, ${count(m.materials)} materials, ${count(m.environments)} environments, ${count(m.audio)} sounds (${(bytes / 1024).toFixed(0)} kB)`;
	if (process.argv.includes('--check')) {
		const stale = staleAssets(OUT, built);
		if (stale.length) {
			console.error(
				`static/assets is out of date; run \`npm run assets\`:\n  ${stale.join('\n  ')}`
			);
			process.exit(1);
		}
		console.log(`static/assets is up to date: ${summary}`);
	} else {
		const { written, removed } = writeAssets(OUT, built);
		console.log(`Built ${summary}: ${written} written, ${removed} removed.`);
	}
} catch (err) {
	if (err instanceof AssetError) {
		console.error(err.message);
		process.exit(1);
	}
	throw err;
}
