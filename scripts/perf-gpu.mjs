// GPU cost of a frame on each of The Hollow Bell's tables, for the GM and a
// player: the view drawn again and again, waiting for the GPU each time (see
// Tabletop.benchmark). Same setup as perf-client.mjs:
//   node scripts/perf-gpu.mjs [http://localhost:4173] [data/perf]

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.argv[2] ?? 'http://localhost:4173';
const SCENES = process.argv[3] ?? 'data/perf';
const FRAMES = Number(process.env.FRAMES ?? 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
	executablePath: process.env.CHROMIUM_PATH || undefined,
	args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
async function open() {
	const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
	return context.newPage();
}
const ready = (page) =>
	page.waitForFunction(() => (window.thirdfoldPerf?.stats().frames ?? 0) > 0, null, {
		timeout: 60_000
	});

const gm = await open();
await gm.goto(`${BASE}/`);
await gm.fill('input[placeholder="e.g. Morgan"]', 'Gia');
await gm.click('text=Create room');
await gm.waitForURL(/room\//);
const roomUrl = gm.url().split('?')[0];
await gm.goto(`${roomUrl}?perf`);
await ready(gm);
const ana = await open();
await ana.goto(`${roomUrl}?perf`);
await ana.fill('input[placeholder="e.g. Morgan"]', 'Ana');
await ana.click('button:has-text("Join the game")');
await ready(ana);

for (const name of (process.env.SCENES ?? 'village,monastery,hollow').split(',')) {
	const file = JSON.parse(readFileSync(path.join(SCENES, `${name}.json`), 'utf8'));
	await gm.evaluate((f) => window.thirdfoldRoom.send({ type: 'scene_import', file: f }), file);
	await sleep(6000);
	const row = [];
	for (const [who, page] of [
		['GM', gm],
		['Ana', ana]
	]) {
		// A first frame compiles whatever is new; measure after it.
		await page.evaluate(() => window.thirdfoldPerf.benchmark(1));
		const r = await page.evaluate((n) => window.thirdfoldPerf.benchmark(n), FRAMES);
		row.push(
			`${who} ${r.gpu.toFixed(0)} ms/frame (main thread ${r.cpu.toFixed(1)} ms, ${r.drawCalls} draws)`
		);
	}
	console.log(`${name}: ${row.join('; ')}`);
}
await browser.close();
