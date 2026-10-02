// Imports the SRD 5.2.1: `npm run srd` (writes content/srd/5.2.1/catalog),
// or `npm run srd:check` (fails if the catalog isn't what the source imports to).

import {
	CATALOG_DIR,
	importSrd,
	readSource,
	SourceMismatch,
	staleCatalog,
	writeCatalog
} from './importer';
import { validateCatalog } from './validate';

try {
	const catalog = await importSrd(readSource());
	const problems = validateCatalog(catalog.manifest, catalog.records);
	if (problems.length) {
		console.error(`The imported catalog has problems:\n  ${problems.join('\n  ')}`);
		process.exit(1);
	}
	const counts = Object.entries(catalog.manifest.files)
		.map(([kind, f]) => `${f.count} ${kind}`)
		.join(', ');
	const summary = `${counts}; ${catalog.diagnostics.length} diagnostics`;
	if (process.argv.includes('--check')) {
		const stale = staleCatalog(CATALOG_DIR, catalog);
		if (stale.length) {
			console.error(`${CATALOG_DIR} is out of date; run \`npm run srd\`:\n  ${stale.join('\n  ')}`);
			process.exit(1);
		}
		console.log(`${CATALOG_DIR} is up to date: ${summary}`);
	} else {
		writeCatalog(CATALOG_DIR, catalog);
		console.log(`Imported the SRD 5.2.1: ${summary}.`);
	}
} catch (err) {
	if (err instanceof SourceMismatch) {
		console.error(err.message);
		process.exit(1);
	}
	throw err;
}
