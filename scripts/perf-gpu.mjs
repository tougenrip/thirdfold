// GPU cost of a frame on the fixture tables, for the GM and a player, at each
// table's named poses: the view drawn again and again (`benchmark`). The GPU
// is timed by timestamp queries where there are any ("timestamp": the GPU's
// own clock; real GPUs on both backends) and else by waiting for each frame
// ("sync"; SwiftShader). Same setup as perf-client.mjs:
//   PERF_GPU=vulkan PERF_BACKEND=webgpu node scripts/perf-gpu.mjs [http://localhost:4173] [tests/fixtures/scenes] [out.json]
// TIER=medium picks a tier (TIER=low,medium,high each in turn); MINIATURE=tilt or dof turns
// tilt-shift or depth of field on (#165): the difference from a run without is what it costs.
//
// Draw and triangle budgets (#264): LAYERS=1 also counts each frame's draws and triangles by
// layer and pass (`thirdfoldPerf.layers()`, perf-layers.ts), and BUDGETS=1 checks every run
// against `DRAW_BUDGETS` and `TRIANGLE_BUDGETS` below and against the kit walls' share of
// the WebGPU budget, exiting 1 over any. The kit tables in seconds, per backend:
//   SCENES=village,monastery,hollow,ref-8,outdoor-64 POSES=overview,close,low,dark \
//     TIER=low,medium,high LAYERS=1 BUDGETS=1 node scripts/perf-gpu.mjs
// (add ultra to TIER with PERF_BACKEND=webgpu). See docs/RENDERING.md "Kit budgets".
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

/**
 * Draw calls per frame, shadow passes included (#264, from the roadmap): 500 on WebGL2's low tier
 * (and mobile, which runs low), 1,000 on the desktop tiers, 2,000 on WebGPU, which draws a
 * BatchedMesh one call per instance where WebGL2 makes one multi-draw.
 */
const DRAW_BUDGETS = {
	webgl2: { low: 500, medium: 1000, high: 1000, ultra: 1000 },
	webgpu: { low: 2000, medium: 2000, high: 2000, ultra: 2000 }
};
/**
 * Triangles per frame, every pass (#264): the low tier is the integrated GPU's and a phone's, the
 * medium the RTX 4060 Laptop's (the middle of the scale). Set with the M70 measurements in
 * docs/RENDERING.md "Kit budgets" at about twice the heaviest pose (452k triangles on low, 934k
 * on high), never loosened to fit.
 */
const TRIANGLE_BUDGETS = { low: 1_000_000, medium: 2_000_000, high: 2_000_000, ultra: 3_000_000 };
/** Kit pieces drawn as BatchedMesh (#252, #253, #260): their draws on WebGPU. */
const KIT_LAYERS = ['walls', 'doors', 'window glass'];
/** Over a quarter of the WebGPU budget, the walls go to an InstancedMesh per piece (#264). */
const KIT_SHARE = 0.25;

const BASE = process.argv[2] ?? 'http://localhost:4173';
const SCENES = process.argv[3] ?? 'tests/fixtures/scenes';
const OUT = process.argv[4] ?? null;
const FRAMES = Number(process.env.FRAMES ?? 16);
/** The test world by default (see perf-client.mjs); SCENES=a,b for other fixture tables. */
const TABLES = (process.env.SCENES ?? 'test-world').split(',');
const POSES = (process.env.POSES ?? 'overview,close').split(',');
const VIEWPORTS = [{ width: 1920, height: 1080 }];
const LAYERS = !!process.env.LAYERS || !!process.env.BUDGETS;
const BUDGETS = !!process.env.BUDGETS;
/**
 * MINIATURE=tilt|dof: the Miniature option on (#165), with motion not reduced: tilt-shift in the
 * tactical view, or depth of field in the tabletop view.
 */
const MINIATURE = process.env.MINIATURE ?? null;
/** TIER=low|medium|high|ultra (or a list): that tier (`?tier=`), else the device's own. */
const TIERS = process.env.TIER ? process.env.TIER.split(',') : [null];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Waits until the page's tabletop has stopped drawing for `quietMs` (as perf-client.mjs does). */
async function settle(page, quietMs = 600, limitMs = 15_000) {
	const start = Date.now();
	let [last, quietSince] = [-1, Date.now()];
	while (Date.now() - start < limitMs) {
		const frames = await page.evaluate(() => window.thirdfoldPerf.stats().frames);
		if (frames !== last) [last, quietSince] = [frames, Date.now()];
		else if (Date.now() - quietSince >= quietMs) return;
		await sleep(50);
	}
}
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

/** A layer report's draws and triangles by layer, every pass summed. */
function byLayer(layers) {
	const out = {};
	for (const pass of Object.values(layers.passes))
		for (const [layer, c] of Object.entries(pass)) {
			const o = (out[layer] ??= { draws: 0, triangles: 0 });
			o.draws += c.draws;
			o.triangles += c.triangles;
		}
	return out;
}

for (const viewport of VIEWPORTS)
	for (const tierAsked of TIERS) {
		const query = PERF_QUERY + (tierAsked ? `&tier=${tierAsked}` : '');
		const open = async () => {
			const reducedMotion = MINIATURE ? 'no-preference' : 'reduce';
			const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion });
			if (MINIATURE)
				await context.addInitScript(
					(view) => {
						const graphics = { tier: 'auto', overrides: { miniature: true } };
						localStorage.setItem('thirdfold:graphics', JSON.stringify(graphics));
						localStorage.setItem('thirdfold:view', view);
					},
					MINIATURE === 'dof' ? 'tabletop' : 'tactical'
				);
			return context.newPage();
		};
		const ready = (page) =>
			page.waitForFunction(() => (window.thirdfoldPerf?.stats().frames ?? 0) > 0, null, {
				timeout: 60_000
			});
		/** Every load the view started has settled (kit pieces, models) and nothing is warming. */
		const loaded = (page) =>
			page.waitForFunction(
				() => {
					const t = window.thirdfoldPerf;
					const [settled, started] = t?.loads() ?? [0, 1];
					return settled === started && !t.stats().holding;
				},
				null,
				{ timeout: 60_000, polling: 100 }
			);

		const gm = await open();
		await gm.goto(`${BASE}/`);
		await gm.fill('input[placeholder="e.g. Morgan"]', 'Gia');
		await gm.click('text=Create room');
		await gm.waitForURL(/room\//);
		const roomUrl = gm.url().split('?')[0];
		await gm.goto(`${roomUrl}${query}`);
		await ready(gm);
		const first = await gm.evaluate(() => window.thirdfoldPerf.stats());
		checkBackend(first);
		report.backend = first.backend;
		report.adapter = first.adapter;
		if (viewport === VIEWPORTS[0] && tierAsked === TIERS[0])
			console.log(
				`${first.backend}${first.compat ? ' (compat)' : ''} on ${first.adapter} (PERF_GPU=${GPU}, PERF_BACKEND=${BACKEND}), Chromium ${report.chromium}`
			);
		const ana = await open();
		await ana.goto(`${roomUrl}${query}`);
		await ana.fill('input[placeholder="e.g. Morgan"]', 'Ana');
		await ana.click('button:has-text("Join the game")');
		await ready(ana);

		for (const name of TABLES) {
			const file = JSON.parse(readFileSync(path.join(SCENES, `${name}.json`), 'utf8'));
			const sidecar = JSON.parse(readFileSync(path.join(SCENES, `${name}.poses.json`), 'utf8'));
			await gm.evaluate((f) => window.thirdfoldRoom.send({ type: 'scene_import', file: f }), file);
			await sleep(2000);
			for (const poseName of POSES) {
				// A pose may ask for another band (the `dark` pose: night, its torches and moon).
				const { ambient } = sidecar.poses[poseName];
				const setAmbient = async (a) => {
					await gm.evaluate((m) => window.thirdfoldRoom.send(m), {
						type: 'ambient_set',
						ambient: a
					});
					await sleep(1000);
				};
				if (ambient && ambient !== file.ambient) await setAmbient(ambient);
				for (const [who, page] of [
					['GM', gm],
					['Ana', ana]
				]) {
					await loaded(page);
					await page.evaluate((p) => window.thirdfoldPerf.setGridPose(p), sidecar.poses[poseName]);
					// A first frame compiles whatever is new (and starts loads a new pose needs); then the
					// table comes to rest (hero shadows handed over, nothing moving): steady frames.
					await page.evaluate(() => window.thirdfoldPerf.benchmark(2));
					await loaded(page);
					await settle(page);
					const b = await page.evaluate((n) => window.thirdfoldPerf.benchmark(n), FRAMES);
					const { programs, tier, triangles } = await page.evaluate(() =>
						window.thirdfoldPerf.stats()
					);
					const layers = LAYERS ? await page.evaluate(() => window.thirdfoldPerf.layers()) : null;
					const run = {
						viewport: `${viewport.width}x${viewport.height}`,
						table: name,
						viewer: who,
						pose: poseName,
						tier,
						gpuMs: round(b.gpu),
						gpuTimer: b.gpuTimer,
						mainThreadMs: round(b.cpu),
						drawCalls: b.drawCalls,
						triangles,
						programs,
						// GPU ms by pass (#166), where the GPU has timestamps.
						passes: b.passes
							? Object.fromEntries(Object.entries(b.passes).map(([k, v]) => [k, round(v)]))
							: null,
						layers
					};
					report.runs.push(run);
					console.log(
						`${run.viewport} ${name} ${who} ${poseName} (${tier}): GPU ${run.gpuMs ?? '–'} ms (${run.gpuTimer}), main thread ${run.mainThreadMs} ms, ${run.drawCalls} draws, ${triangles.toLocaleString()} tris, ${programs} programs`
					);
					if (run.passes)
						console.log(
							`  by pass: ${Object.entries(run.passes)
								.map(([k, v]) => `${k} ${v}`)
								.join(', ')}`
						);
					if (layers) {
						// The frame with the key light's shadow redrawn: what any change to the table costs.
						const { steady, shadowed } = layers;
						const draws = (pass) => Object.values(pass).reduce((s, c) => s + c.draws, 0);
						console.log(
							`  steady ${steady.total.draws} draws, ${steady.total.triangles.toLocaleString()} tris; with the shadow redrawn ${shadowed.total.draws} draws, ${shadowed.total.triangles.toLocaleString()} tris: ${Object.entries(
								shadowed.passes
							)
								.map(([p, c]) => `${p} ${draws(c)}`)
								.join(', ')}`
						);
						console.log(
							`  by layer: ${Object.entries(byLayer(shadowed))
								.sort((a, b) => b[1].draws - a[1].draws)
								.map(([l, c]) => `${l} ${c.draws} (${c.triangles.toLocaleString()} tris)`)
								.join(', ')}`
						);
						const inst = Object.entries(shadowed.instanced);
						if (inst.length)
							console.log(
								`  as InstancedMesh per piece: ${inst.map(([l, n]) => `${l} ${n}`).join(', ')}`
							);
					}
				}
				if (ambient && ambient !== file.ambient) await setAmbient(file.ambient);
			}
		}
		await gm.context().close();
		await ana.context().close();
	}
await browser.close();
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));

if (BUDGETS) {
	const rows = [];
	const backend = report.backend;
	for (const r of report.runs) {
		const what = `${r.table} ${r.viewer} ${r.pose} (${r.tier})`;
		const draws = DRAW_BUDGETS[backend]?.[r.tier];
		const tris = TRIANGLE_BUDGETS[r.tier];
		// The worse of the benchmark's frames and the frame with the shadow redrawn.
		const worst = r.layers?.shadowed.total ?? { draws: 0, triangles: 0 };
		const d = Math.max(r.drawCalls, worst.draws);
		const t = Math.max(r.triangles, worst.triangles);
		rows.push({ what: `${what}: draws`, value: d, limit: draws, ok: d <= draws });
		rows.push({ what: `${what}: triangles`, value: t, limit: tris, ok: t <= tris });
		if (backend === 'webgpu' && r.layers) {
			const layers = byLayer(r.layers.shadowed);
			const kit = KIT_LAYERS.reduce((s, l) => s + (layers[l]?.draws ?? 0), 0);
			const limit = Math.floor(draws * KIT_SHARE);
			rows.push({ what: `${what}: kit-piece draws`, value: kit, limit, ok: kit <= limit });
		}
	}
	const failed = rows.filter((r) => !r.ok);
	console.log(
		[
			`\n### Kit budgets (${backend}): ${failed.length ? `${failed.length} over` : 'all within'}\n`,
			'| Check | Value | Limit | |',
			'| --- | --- | --- | --- |',
			...rows.map((r) => `| ${r.what} | ${r.value} | ${r.limit} | ${r.ok ? 'ok' : '**over**'} |`)
		].join('\n')
	);
	if (failed.length) process.exit(1);
}
