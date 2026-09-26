// GPU cost of a frame on the fixture tables, for the GM and a player, at each
// table's named poses: the view drawn again and again (`benchmark`). The GPU
// is timed by timestamp queries where there are any ("timestamp": the GPU's
// own clock; real GPUs on both backends) and else by waiting for each frame
// ("sync"; SwiftShader). Same setup as perf-client.mjs:
//   PERF_GPU=vulkan PERF_BACKEND=webgpu node scripts/perf-gpu.mjs [http://localhost:4173] [tests/fixtures/scenes] [out.json]
//
// PERF_GPU and PERF_BACKEND pick the GPU and the renderer's backend (see
// perf-browser.mjs). The report starts with the backend and the GPU the
// browser used, so a run on the wrong adapter is obvious. On a laptop with two
// GPUs, Vulkan picks the discrete one (an RTX 4060 is the medium tier's
// reference, the middle of the scale); to measure the integrated one (the low
// tier's reference), limit Vulkan to its driver:
//   VK_DRIVER_FILES=/usr/share/vulkan/icd.d/intel_icd.json PERF_GPU=vulkan node scripts/perf-gpu.mjs
// (egl may fall back to llvmpipe, software rendering, where no GPU GL is set up.)

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BACKEND, checkBackend, GPU, launchBrowser, PERF_QUERY } from './perf-browser.mjs';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const SCENES = process.argv[3] ?? 'tests/fixtures/scenes';
const OUT = process.argv[4] ?? null;
const FRAMES = Number(process.env.FRAMES ?? 16);
const TABLES = (
	process.env.SCENES ??
	'village,monastery,hollow,ref-1,ref-6,ref-7,ref-8,dungeon-40,outdoor-64,crowd-60'
).split(',');
const POSES = (process.env.POSES ?? 'overview,close,low').split(',');
const VIEWPORTS = [
	{ width: 1400, height: 900 },
	{ width: 1920, height: 1080 }
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n, d = 2) => (n == null ? null : Number(n.toFixed(d)));

const browser = await launchBrowser();
const report = {
	gpu: GPU,
	backend: null,
	chromium: browser.version(),
	adapter: null,
	frames: FRAMES,
	runs: []
};

for (const viewport of VIEWPORTS) {
	const open = async () => (await browser.newContext({ viewport, deviceScaleFactor: 1 })).newPage();
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
	await gm.goto(`${roomUrl}${PERF_QUERY}`);
	await ready(gm);
	const first = await gm.evaluate(() => window.thirdfoldPerf.stats());
	checkBackend(first);
	report.backend = first.backend;
	report.adapter = first.adapter;
	if (viewport === VIEWPORTS[0])
		console.log(
			`${first.backend}${first.compat ? ' (compat)' : ''} on ${first.adapter} (PERF_GPU=${GPU}, PERF_BACKEND=${BACKEND}), Chromium ${report.chromium}`
		);
	const ana = await open();
	await ana.goto(`${roomUrl}${PERF_QUERY}`);
	await ana.fill('input[placeholder="e.g. Morgan"]', 'Ana');
	await ana.click('button:has-text("Join the game")');
	await ready(ana);

	for (const name of TABLES) {
		const file = JSON.parse(readFileSync(path.join(SCENES, `${name}.json`), 'utf8'));
		const sidecar = JSON.parse(readFileSync(path.join(SCENES, `${name}.poses.json`), 'utf8'));
		await gm.evaluate((f) => window.thirdfoldRoom.send({ type: 'scene_import', file: f }), file);
		await sleep(6000);
		for (const [who, page] of [
			['GM', gm],
			['Ana', ana]
		]) {
			for (const poseName of POSES) {
				await page.evaluate((p) => window.thirdfoldPerf.setGridPose(p), sidecar.poses[poseName]);
				// A first frame compiles whatever is new; measure after it.
				await page.evaluate(() => window.thirdfoldPerf.benchmark(2));
				const b = await page.evaluate((n) => window.thirdfoldPerf.benchmark(n), FRAMES);
				const programs = await page.evaluate(() => window.thirdfoldPerf.stats().programs);
				const run = {
					viewport: `${viewport.width}x${viewport.height}`,
					table: name,
					viewer: who,
					pose: poseName,
					gpuMs: round(b.gpu),
					gpuTimer: b.gpuTimer,
					mainThreadMs: round(b.cpu),
					drawCalls: b.drawCalls,
					programs
				};
				report.runs.push(run);
				console.log(
					`${run.viewport} ${name} ${who} ${poseName}: GPU ${run.gpuMs ?? '–'} ms (${run.gpuTimer}), main thread ${run.mainThreadMs} ms, ${run.drawCalls} draws, ${programs} programs`
				);
			}
		}
	}
	await gm.context().close();
	await ana.context().close();
}
await browser.close();
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
