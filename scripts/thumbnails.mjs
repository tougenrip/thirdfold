// Renders a thumbnail of every model in the asset manifest (#194) with the dev server's asset
// turntable (/dev/assets?thumb=<id>): the day light, the three-quarter pose, the plain table.
// Each goes to <out>/<id>.png with an <id>.meta.json giving its provenance (a thirdfold
// original); `npm run assets` then lists them in the manifest (ModelEntry.thumbnail). The GPU
// and its driver change the pixels, so thumbnails are made by hand, never in CI.
//
//   npm run dev &
//   node scripts/thumbnails.mjs [http://localhost:1420] [--out assets/thumbnails] [--size 256]
//        [--only id,id]
// PERF_GPU and PERF_BACKEND pick what draws, as for the perf scripts (perf-browser.mjs).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BACKEND, launchBrowser } from './perf-browser.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(name);
	if (i < 0) return fallback;
	const [, value] = args.splice(i, 2);
	return value;
};
const OUT = flag('--out', 'assets/thumbnails');
const SIZE = Number(flag('--size', '256'));
const ONLY = flag('--only', null)?.split(',') ?? null;
const BASE = args[0] ?? 'http://localhost:1420';
/** THUMBNAIL_BYTES in src/lib/assets/manifest.ts: the pipeline refuses a larger one. */
const MAX_BYTES = 64 * 1024;
const PROVENANCE = {
	provenance: {
		license: 'LicenseRef-thirdfold-original',
		author: 'thirdfold contributors',
		modified: false
	}
};

const manifest = JSON.parse(readFileSync('static/assets/manifest.json', 'utf8'));
const ids = Object.keys(manifest.models).filter((id) => !ONLY || ONLY.includes(id));
mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser();
const context = await browser.newContext({
	viewport: { width: SIZE, height: SIZE },
	deviceScaleFactor: 1,
	reducedMotion: 'reduce'
});
const query = BACKEND === 'webgl' ? '&backend=webgl' : '';
let failed = 0;
for (const id of ids) {
	const page = await context.newPage();
	page.on('console', (m) => m.type() === 'error' && console.log(`  [${id}] ${m.text()}`));
	try {
		await page.goto(`${BASE}/dev/assets?thumb=${id}&size=${SIZE}${query}`);
		await page.waitForFunction(() => window.thirdfoldThumbReady === true, null, {
			timeout: 60_000
		});
		const png = await page.locator('canvas').screenshot({ type: 'png' });
		writeFileSync(path.join(OUT, `${id}.png`), png);
		writeFileSync(path.join(OUT, `${id}.meta.json`), `${JSON.stringify(PROVENANCE, null, '\t')}\n`);
		const over =
			png.length > MAX_BYTES ? ` (over ${MAX_BYTES} bytes: the pipeline will refuse it)` : '';
		console.log(`${id}: ${(png.length / 1024).toFixed(1)} kB${over}`);
		if (over) failed++;
	} catch (err) {
		console.log(`${id}: failed (${err.message.split('\n')[0]})`);
		failed++;
	}
	await page.close();
}
await browser.close();
if (failed) process.exit(1);
