// Measures the client in a real browser and gates it against a committed
// baseline: the first load, loading tables, frames (idle and while the camera
// moves), what the GPU is given (draw calls, triangles, geometries, textures,
// shader programs), memory, leaks across table reloads and Tabletop remounts,
// the network traffic of a move, and the bundle sizes. See docs/PERFORMANCE.md.
//
// Needs the built app served and a game server running:
//   npm run build && npx vite preview --port 4173 &
//   npm run server:start &
//   node scripts/perf-client.mjs [--json perf.json] [--baseline docs/perf-baseline.json]
//        [--update-baseline docs/perf-baseline.json] [http://localhost:4173] [tests/fixtures/scenes]
//
// --baseline compares the deterministic counters with the baseline and exits 1
// on a regression; --update-baseline writes them as the new baseline (say why
// in the PR). Chromium's software WebGL (SwiftShader) makes frame times far
// slower than a real GPU: times are printed for comparison, never gated.
// PERF_BACKEND (webgl by default, or webgpu) and PERF_GPU pick what draws (see
// perf-browser.mjs); a baseline is for one backend, and says which.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkBackend, launchBrowser, PERF_QUERY } from './perf-browser.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
	const i = args.indexOf(name);
	if (i < 0) return null;
	const [, value] = args.splice(i, 2);
	return value;
};
const JSON_OUT = flag('--json') ?? process.env.PERF_JSON ?? null;
const BASELINE = flag('--baseline');
const UPDATE_BASELINE = flag('--update-baseline');
const BASE = args[0] ?? 'http://localhost:4173';
const SCENES = args[1] ?? 'tests/fixtures/scenes';
/**
 * The tables measured: the test world (server/fixtures/test-world.ts), a bit of everything in one
 * small table, so a run takes minutes. SCENES=a,b measures other fixture tables instead.
 */
const TABLES = (process.env.SCENES ?? 'test-world').split(',');
const RELOADS = 2;
const REMOUNTS = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
const round = (n, d = 1) => (n == null ? null : Number(n.toFixed(d)));
const readTable = (name) => JSON.parse(readFileSync(path.join(SCENES, `${name}.json`), 'utf8'));

const browser = await launchBrowser();

/** A page that records long tasks, WebSocket traffic and WebGL context warnings from the start. */
async function open(name) {
	// Reduced motion: no flicker or mist, so a table goes quiet as soon as it is drawn and the
	// waits below are short. What is counted (draws, programs, memory) is the same.
	const context = await browser.newContext({
		viewport: { width: 1400, height: 900 },
		reducedMotion: 'reduce'
	});
	await context.addInitScript(() => {
		window.__longTasks = [];
		new PerformanceObserver((list) => {
			for (const e of list.getEntries()) window.__longTasks.push(e.duration);
		}).observe({ type: 'longtask', buffered: true });
	});
	const page = await context.newPage();
	const ws = { received: 0, frames: 0 };
	const p = { page, ws, name, contextWarnings: 0 };
	page.on('websocket', (socket) =>
		socket.on('framereceived', (f) => {
			ws.received +=
				typeof f.payload === 'string' ? Buffer.byteLength(f.payload) : f.payload.length;
			ws.frames++;
		})
	);
	page.on('console', (m) => {
		if (/too many active webgl contexts/i.test(m.text())) p.contextWarnings++;
		if (m.type() === 'error') console.log(`  [${name}] console error: ${m.text()}`);
	});
	p.cdp = await context.newCDPSession(page);
	return p;
}

async function heap(p) {
	await p.cdp.send('HeapProfiler.collectGarbage');
	const { usedSize } = await p.cdp.send('Runtime.getHeapUsage');
	return usedSize;
}

const stats = (p) => p.page.evaluate(() => window.thirdfoldPerf?.stats() ?? null);
const resetStats = (p) => p.page.evaluate(() => window.thirdfoldPerf?.resetStats());
const longTasks = (p) =>
	p.page.evaluate(() => {
		const t = window.__longTasks.splice(0);
		return { count: t.length, total: t.reduce((a, b) => a + b, 0), max: Math.max(0, ...t) };
	});
const send = (p, msg) => p.page.evaluate((m) => window.thirdfoldRoom.send(m), msg);

async function waitFor(p, fn, arg, timeout = 30_000) {
	await p.page.waitForFunction(fn, arg, { timeout, polling: 50 });
}

/** Waits until the page's tabletop has stopped drawing (a few quiet checks in a row). */
async function settle(p, quietMs = 600, limitMs = 15_000) {
	const start = Date.now();
	let last = -1;
	let quietSince = Date.now();
	while (Date.now() - start < limitMs) {
		const frames = (await stats(p))?.frames ?? 0;
		if (frames !== last) {
			last = frames;
			quietSince = Date.now();
		} else if (Date.now() - quietSince >= quietMs) return;
		await sleep(50);
	}
}

const counts = (s) => ({ geometries: s.geometries, textures: s.textures, programs: s.programs });

const report = { load: {}, scenes: {}, gate: { chromium: browser.version(), tables: {} } };

// --- First load: the landing page, cold.
{
	const p = await open('landing');
	const start = Date.now();
	await p.page.goto(`${BASE}/`, { waitUntil: 'load' });
	const nav = await p.page.evaluate(() => {
		const n = performance.getEntriesByType('navigation')[0];
		const fcp = performance.getEntriesByName('first-contentful-paint')[0];
		const res = performance.getEntriesByType('resource');
		return {
			domContentLoaded: n.domContentLoadedEventEnd,
			load: n.loadEventEnd,
			fcp: fcp?.startTime ?? null,
			bytes: res.reduce((s, r) => s + r.transferSize, 0) + n.transferSize,
			decoded: res.reduce((s, r) => s + r.decodedBodySize, 0) + n.decodedBodySize,
			requests: res.length + 1
		};
	});
	report.load.landing = { ...nav, wall: Date.now() - start };
	console.log(
		`landing: FCP ${round(nav.fcp)} ms, load ${round(nav.load)} ms, ${nav.requests} requests, ${kb(nav.bytes)} transferred (${kb(nav.decoded)} decoded)`
	);
	await p.page.context().close();
}

// --- The GM's table: create a room, then open it with ?perf.
const gm = await open('Gia');
await gm.page.goto(`${BASE}/`);
await gm.page.fill('input[placeholder="e.g. Morgan"]', 'Gia');
await gm.page.click('text=Create room');
await gm.page.waitForURL(/room\//);
const roomUrl = gm.page.url().split('?')[0];
{
	const start = Date.now();
	await gm.page.goto(`${roomUrl}${PERF_QUERY}`, { waitUntil: 'load' });
	await waitFor(gm, () => (window.thirdfoldPerf?.stats().frames ?? 0) > 0);
	const firstFrame = Date.now() - start;
	const drawing = await stats(gm);
	checkBackend(drawing);
	report.gate.backend = drawing.backend;
	report.gate.adapter = drawing.adapter;
	console.log(`drawing with ${drawing.backend} on ${drawing.adapter}`);
	const nav = await gm.page.evaluate(() => {
		const res = performance.getEntriesByType('resource');
		return { bytes: res.reduce((s, r) => s + r.transferSize, 0), requests: res.length };
	});
	report.load.room = { firstFrame, ...nav };
	console.log(
		`room page: first table frame after ${firstFrame} ms, ${nav.requests} requests, ${kb(nav.bytes)} transferred`
	);
}

// --- Two players join by the invite link (cold: nothing cached). Ana plays the frozen tables' hero.
const players = [];
for (const name of ['Ana', 'Ben']) {
	const p = await open(name);
	const opened = Date.now();
	await p.page.goto(`${roomUrl}${PERF_QUERY}`, { waitUntil: 'load' });
	await p.page.waitForSelector('button:has-text("Join the game")');
	const joinForm = Date.now() - opened;
	const joinBytes = await p.page.evaluate(() =>
		performance.getEntriesByType('resource').reduce((s, r) => s + r.transferSize, 0)
	);
	await p.page.fill('input[placeholder="e.g. Morgan"]', name);
	await p.page.click('button:has-text("Join the game")');
	const joined = Date.now();
	await waitFor(p, () => (window.thirdfoldPerf?.stats().frames ?? 0) > 0);
	const firstFrame = Date.now() - joined;
	if (name === 'Ana') {
		report.load.join = { joinForm, joinBytes, firstFrame };
		console.log(
			`invite link (cold): join form after ${joinForm} ms (${kb(joinBytes)} transferred by then); first table frame ${firstFrame} ms after joining`
		);
	}
	players.push(p);
}
const [ana] = players;
const everyone = [gm, ...players];

async function importTable(name) {
	const file = readTable(name);
	await send(gm, { type: 'scene_import', file });
	for (const p of everyone) {
		// SwiftShader compiles the node renderer's shaders on the CPU, three pages at once: a
		// page's main thread can be busy for tens of seconds on a new table.
		await waitFor(
			p,
			() => {
				const s = window.thirdfoldPerf?.stats();
				return !!s?.timings.setGrid && !!document.querySelector('canvas');
			},
			undefined,
			120_000
		).catch(async (e) => {
			const why = await p.page.evaluate(() => window.thirdfoldRoom?.actionError ?? null);
			throw new Error(`${p.name} never showed ${name} (last refusal: ${why}): ${e.message}`);
		});
	}
	for (const p of everyone) await settle(p);
	return file;
}

for (const name of TABLES) {
	for (const p of everyone) {
		await resetStats(p);
		await longTasks(p);
		p.ws.received = 0;
	}
	const start = Date.now();
	const file = await importTable(name);
	const loaded = Date.now() - start;
	const scene = { loadedMs: loaded, ambient: file.ambient };
	const gate = { ambient: file.ambient, viewers: {} };
	for (const p of everyone) {
		const s = await stats(p);
		const lt = await longTasks(p);
		const t = (k) => s.timings[k] ?? { count: 0, total: 0, max: 0 };
		scene[p.name] = {
			snapshot: p.ws.received,
			longTasks: lt,
			setGrid: round(t('setGrid').total),
			setTokens: round(t('setTokens').total),
			setProps: round(t('setProps').total),
			lighting: { count: t('lighting').count, total: round(t('lighting').total) },
			drawCalls: s.drawCalls,
			triangles: s.triangles,
			...counts(s)
		};
		gate.viewers[p.name] = { ...counts(s), heap: await heap(p) };
	}
	console.log(
		`\n${name} (${file.grid.width}×${file.grid.height}, ${file.ambient}): built in ${loaded} ms`
	);
	for (const p of everyone) {
		const r = scene[p.name];
		console.log(
			`  ${p.name}: snapshot ${kb(r.snapshot)}; long tasks ${r.longTasks.count} (${round(r.longTasks.total)} ms, max ${round(r.longTasks.max)}); setGrid ${r.setGrid} ms, setTokens ${r.setTokens} ms, setProps ${r.setProps} ms, lighting ×${r.lighting.count} ${r.lighting.total} ms; ${r.drawCalls} draws, ${r.triangles.toLocaleString()} tris, ${r.geometries} geo, ${r.textures} tex, ${r.programs} programs`
		);
	}

	// Idle: once nothing has been drawn for 1 s (models arrived, the camera at rest), nothing
	// happens for 2 s; frames drawn anyway are the idle cost (none: motion is reduced).
	await settle(ana, 1000, 30_000);
	await resetStats(ana);
	await sleep(2000);
	const idle = await stats(ana);
	scene.idle = {
		frames: idle.frames,
		frameMs: round((idle.timings.frame?.total ?? 0) / Math.max(1, idle.frames), 2)
	};
	gate.idleFrames = idle.frames;
	console.log(`  idle (Ana, 2 s): ${idle.frames} frames, ${scene.idle.frameMs} ms each`);

	// The camera moving: Ana drags a fixed path to orbit, then lets it settle. The last
	// frame's draw calls (shadow passes included) are deterministic for the path.
	await resetStats(ana);
	const box = await ana.page.locator('canvas').boundingBox();
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	await ana.page.mouse.move(cx, cy);
	await ana.page.mouse.down();
	const t0 = Date.now();
	for (let i = 0; i < 90; i++) {
		await ana.page.mouse.move(cx + Math.sin(i / 10) * 200, cy + Math.cos(i / 13) * 60);
		await sleep(16);
	}
	await ana.page.mouse.move(cx, cy);
	await ana.page.mouse.up();
	const dragMs = Date.now() - t0;
	const moving = await stats(ana);
	// The camera eases to a stop over many slow software frames: wait for it.
	await settle(ana, 2000, 60_000);
	const settled = await stats(ana);
	const f = moving.timings.frame;
	scene.orbit = {
		shadowPasses: moving.timings.shadows?.count ?? 0,
		drawCalls: settled.drawCalls,
		fps: round(moving.frames / (dragMs / 1000)),
		frameMs: round(f.total / f.count, 2),
		maxMs: round(f.max, 1),
		drawMs: round(moving.timings.draw.total / moving.timings.draw.count, 2)
	};
	gate.orbitDrawCalls = settled.drawCalls;
	gate.orbitShadowPasses = scene.orbit.shadowPasses;
	console.log(
		`  orbit (Ana): ${scene.orbit.fps} fps, frame ${scene.orbit.frameMs} ms (max ${scene.orbit.maxMs}), of which draw ${scene.orbit.drawMs} ms; ${scene.orbit.drawCalls} draws in the settled frame, ${scene.orbit.shadowPasses} shadow passes while moving`
	);

	// Moving: Ana's character steps back and forth (story tables, where she plays).
	const mine = await ana.page.evaluate(() => {
		const r = window.thirdfoldRoom.room;
		const t = r.tokens.find((t) => t.ownerId === window.thirdfoldRoom.playerId);
		return t && { id: t.id, pos: t.pos };
	});
	if (mine) {
		for (const p of everyone) {
			await resetStats(p);
			p.ws.received = 0;
			p.ws.frames = 0;
		}
		const moves = 6;
		const targets = [
			{ x: mine.pos.x, y: mine.pos.y + 1 },
			{ x: mine.pos.x, y: mine.pos.y - 1 },
			{ x: mine.pos.x + 1, y: mine.pos.y },
			{ x: mine.pos.x - 1, y: mine.pos.y }
		];
		let step = null;
		for (const to of targets) {
			await send(ana, { type: 'token_move', tokenId: mine.id, to });
			await sleep(400);
			const at = await ana.page.evaluate(
				(id) => window.thirdfoldRoom.room.tokens.find((t) => t.id === id)?.pos,
				mine.id
			);
			if (at.x === to.x && at.y === to.y) {
				step = to;
				break;
			}
		}
		for (let k = 0; k < moves - 1 && step; k++) {
			await send(ana, { type: 'token_move', tokenId: mine.id, to: k % 2 === 0 ? mine.pos : step });
			await sleep(700);
		}
		await sleep(800);
		scene.moves = {};
		for (const p of everyone) {
			const s = await stats(p);
			const t = (k) => s.timings[k] ?? { count: 0, total: 0 };
			scene.moves[p.name] = {
				bytes: round(p.ws.received / moves),
				frames: round(p.ws.frames / moves, 1),
				setTokens: round(t('setTokens').total / moves, 2),
				lighting: round(t('lighting').total / moves, 2),
				lightingCalls: round(t('lighting').count / moves, 1),
				setFog: round(t('setFog').total / moves, 2),
				frameMs: round(t('frame').total / Math.max(1, t('frame').count), 2),
				renders: round(s.frames / moves, 1)
			};
		}
		for (const p of everyone) {
			const m = scene.moves[p.name];
			console.log(
				`  per move (${p.name}): ${kb(m.bytes)} in ${m.frames} messages; setTokens ${m.setTokens} ms, setFog ${m.setFog} ms, lighting ×${m.lightingCalls} ${m.lighting} ms; ${m.renders} frames at ${m.frameMs} ms`
			);
		}
	}
	report.scenes[name] = scene;
	report.gate.tables[name] = gate;
}

// Leaks across table reloads: every table loaded RELOADS times more; GPU resources come back.
{
	const last = TABLES[TABLES.length - 1];
	const first = counts(await stats(ana));
	const heapFirst = await heap(ana);
	for (let r = 0; r < RELOADS; r++) for (const name of TABLES) await importTable(name);
	await importTable(last);
	const after = counts(await stats(ana));
	const heapAfter = await heap(ana);
	report.gate.reload = {
		first: { ...first, heap: heapFirst },
		after: { ...after, heap: heapAfter }
	};
	console.log(
		`\nafter loading every table ${RELOADS} times more (Ana, ${last}): geometries ${first.geometries} → ${after.geometries}, textures ${first.textures} → ${after.textures}, programs ${first.programs} → ${after.programs}, heap ${kb(heapFirst)} → ${kb(heapAfter)}`
	);
}

// Leaks across Tabletop remounts: Ana leaves the room and comes back (resuming her seat).
// The first return is the reference (a fresh renderer on the table); later ones match it.
{
	const runs = [];
	for (let r = 0; r <= REMOUNTS; r++) {
		await ana.page.goto(`${BASE}/`, { waitUntil: 'load' });
		await ana.page.goto(`${roomUrl}${PERF_QUERY}`, { waitUntil: 'load' });
		await waitFor(ana, () => !!window.thirdfoldPerf?.stats().timings.setGrid);
		await settle(ana);
		runs.push({ ...counts(await stats(ana)), heap: await heap(ana) });
	}
	const first = runs.shift();
	report.gate.remount = { first, runs, contextWarnings: ana.contextWarnings };
	console.log(
		`after ${REMOUNTS} remounts (Ana): ${runs.map((r) => `${r.geometries} geo, ${r.textures} tex, ${r.programs} programs, heap ${kb(r.heap)}`).join('; ')} (first ${first.geometries} geo, ${first.textures} tex, ${first.programs} programs, heap ${kb(first.heap)}); ${ana.contextWarnings} WebGL context warnings`
	);
}

// Memory per tier (#166): Ana's table at each tier the backend runs (`?tier=`, a fresh renderer
// each), its render targets and texture bytes. The post chain's targets are most of what a
// tier adds; a rise is a regression unless the baseline changes with it.
{
	const tiers =
		report.gate.backend === 'webgpu'
			? ['low', 'medium', 'high', 'ultra']
			: ['low', 'medium', 'high'];
	report.gate.tiers = {};
	const measure = async (query) => {
		await ana.page.goto(`${roomUrl}${PERF_QUERY}${query}`, { waitUntil: 'load' });
		await waitFor(ana, () => !!window.thirdfoldPerf?.stats().timings.setGrid);
		await settle(ana);
		return stats(ana);
	};
	for (const tier of tiers) {
		const s = await measure(`&tier=${tier}`);
		// Shader programs and pipelines per tier and backend (#170): exact, a change needs a reason.
		const { renderTargets, texturesBytes, programs, pipelines } = s;
		report.gate.tiers[tier] = { renderTargets, texturesBytes, programs, pipelines };
	}
	console.log(
		`memory per tier (Ana): ${Object.entries(report.gate.tiers)
			.map(
				([t, m]) =>
					`${t} ${m.renderTargets} targets, ${(m.texturesBytes / 2 ** 20).toFixed(1)} MB textures`
			)
			.join('; ')}`
	);
}

// Bundle sizes, from the same build.
try {
	const out = execFileSync('node', ['scripts/check-bundle.mjs', '--json'], { encoding: 'utf8' });
	report.gate.bundle = JSON.parse(out);
} catch (e) {
	report.gate.bundle = e.stdout ? JSON.parse(e.stdout) : { sizes: {}, failures: [String(e)] };
}

await browser.close();

if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));

/** The counters a baseline keeps: deterministic for a given build, fixtures and Chromium. */
function baselineOf(gate) {
	return {
		chromium: gate.chromium,
		backend: gate.backend,
		adapter: gate.adapter,
		tables: gate.tables,
		reload: gate.reload,
		remount: { first: gate.remount.first },
		tiers: gate.tiers,
		bundle: gate.bundle.sizes
	};
}

if (UPDATE_BASELINE) {
	writeFileSync(UPDATE_BASELINE, JSON.stringify(baselineOf(report.gate), null, '\t') + '\n');
	console.log(`\nWrote the baseline to ${UPDATE_BASELINE}.`);
}

if (BASELINE) {
	const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
	const rows = [];
	const check = (what, value, limit, ok) => rows.push({ what, value, limit, ok });
	const up10 = (n) => Math.ceil(n * 1.1);
	// Counters differ between backends (programs most of all): compare like with like.
	check('backend', report.gate.backend, base.backend ?? '-', base.backend === report.gate.backend);
	for (const [name, t] of Object.entries(report.gate.tables)) {
		const b = base.tables[name];
		if (!b) {
			check(`${name}: in the baseline`, 'new', '-', false);
			continue;
		}
		check(
			`${name}: draw calls after orbit`,
			t.orbitDrawCalls,
			up10(b.orbitDrawCalls),
			t.orbitDrawCalls <= up10(b.orbitDrawCalls)
		);
		// Moving the camera changes no shadow: the sun's map is only redrawn when the table changes.
		check(
			`${name}: shadow passes while orbiting`,
			t.orbitShadowPasses,
			0,
			t.orbitShadowPasses === 0
		);
		check(`${name}: frames in 2 s idle`, t.idleFrames, 0, t.idleFrames === 0);
		for (const [viewer, v] of Object.entries(t.viewers)) {
			const bv = b.viewers[viewer];
			if (!bv) continue;
			check(`${name} ${viewer}: programs`, v.programs, bv.programs, v.programs <= bv.programs);
			for (const k of ['geometries', 'textures', 'heap']) {
				check(`${name} ${viewer}: ${k}`, v[k], up10(bv[k]), v[k] <= up10(bv[k]));
			}
		}
	}
	const { first, after } = report.gate.reload;
	for (const k of ['geometries', 'textures', 'programs']) {
		check(`reloads: ${k}`, after[k], first[k], after[k] <= first[k]);
	}
	const { remount } = report.gate;
	remount.runs.forEach((r, i) => {
		for (const k of ['geometries', 'textures', 'programs']) {
			check(`remount ${i + 1}: ${k}`, r[k], remount.first[k], r[k] <= remount.first[k]);
		}
		check(
			`remount ${i + 1}: heap`,
			r.heap,
			up10(remount.first.heap),
			r.heap <= up10(remount.first.heap)
		);
	});
	check(
		'remounts: WebGL context warnings',
		remount.contextWarnings,
		0,
		remount.contextWarnings === 0
	);
	for (const [tier, m] of Object.entries(report.gate.tiers)) {
		const b = base.tiers?.[tier];
		if (!b) {
			check(`tier ${tier}: in the baseline`, 'new', '-', false);
			continue;
		}
		check(
			`tier ${tier}: render targets`,
			m.renderTargets,
			b.renderTargets,
			m.renderTargets <= b.renderTargets
		);
		check(
			`tier ${tier}: texture bytes`,
			m.texturesBytes,
			b.texturesBytes,
			m.texturesBytes <= b.texturesBytes
		);
		for (const k of ['programs', 'pipelines']) {
			// Until the baseline is next written with them (--update-baseline), shown, not failed.
			if (b[k] == null) check(`tier ${tier}: ${k}`, m[k], 'not in the baseline', true);
			else check(`tier ${tier}: ${k}`, m[k], b[k], m[k] === b[k]);
		}
	}
	for (const failure of report.gate.bundle.failures)
		check(`bundle: ${failure}`, 'fail', '-', false);

	const failed = rows.filter((r) => !r.ok);
	const table = [
		'| Check | Value | Limit | |',
		'| --- | --- | --- | --- |',
		...rows.map((r) => `| ${r.what} | ${r.value} | ${r.limit} | ${r.ok ? 'ok' : '**fail**'} |`)
	].join('\n');
	const summary = `### Perf gate: ${failed.length ? `${failed.length} regression(s)` : 'passed'}\n\nChromium ${report.gate.chromium} (baseline ${base.chromium}).\n\n${table}\n`;
	console.log(`\n${summary}`);
	if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
	if (failed.length) process.exit(1);
}
