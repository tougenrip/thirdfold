// Measures the client in a real browser: the first load, loading each of The
// Hollow Bell's tables, frames (idle and while the camera moves), what the GPU
// is given (draw calls, triangles, geometries, textures, shader programs),
// memory, and the network traffic of a move. See docs/PERFORMANCE.md.
//
// Needs the built app served and a game server running:
//   npm run build && npx vite preview --port 4173 &
//   npm run server:start &
//   npx tsx server/perf/scenes.ts data/perf
//   node scripts/perf-client.mjs [http://localhost:4173] [data/perf]
//
// Chromium's software WebGL (SwiftShader) makes frame times far slower than
// a real GPU; compare them with each other, not with a real machine.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.argv[2] ?? 'http://localhost:4173';
const SCENES = process.argv[3] ?? 'data/perf';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
const round = (n, d = 1) => (n == null ? null : Number(n.toFixed(d)));

const browser = await chromium.launch({
	executablePath: process.env.CHROMIUM_PATH || undefined,
	args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});

/** A page that records long tasks and WebSocket traffic from the start. */
async function open(name) {
	const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
	await context.addInitScript(() => {
		window.__longTasks = [];
		new PerformanceObserver((list) => {
			for (const e of list.getEntries()) window.__longTasks.push(e.duration);
		}).observe({ type: 'longtask', buffered: true });
	});
	const page = await context.newPage();
	const ws = { received: 0, frames: 0 };
	page.on('websocket', (socket) =>
		socket.on('framereceived', (f) => {
			ws.received +=
				typeof f.payload === 'string' ? Buffer.byteLength(f.payload) : f.payload.length;
			ws.frames++;
		})
	);
	page.on('console', (m) => {
		if (m.type() === 'error') console.log(`  [${name}] console error: ${m.text()}`);
	});
	const cdp = await context.newCDPSession(page);
	return { page, ws, cdp, name };
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

const report = { load: {}, scenes: {} };

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
const gm = await open('gm');
await gm.page.goto(`${BASE}/`);
await gm.page.fill('input[placeholder="e.g. Morgan"]', 'Gia');
await gm.page.click('text=Create room');
await gm.page.waitForURL(/room\//);
const roomUrl = gm.page.url().split('?')[0];
{
	const start = Date.now();
	await gm.page.goto(`${roomUrl}?perf`, { waitUntil: 'load' });
	await waitFor(gm, () => (window.thirdfoldPerf?.stats().frames ?? 0) > 0);
	const firstFrame = Date.now() - start;
	const nav = await gm.page.evaluate(() => {
		const res = performance.getEntriesByType('resource');
		return {
			bytes: res.reduce((s, r) => s + r.transferSize, 0),
			requests: res.length
		};
	});
	report.load.room = { firstFrame, ...nav };
	console.log(
		`room page: first table frame after ${firstFrame} ms, ${nav.requests} requests, ${kb(nav.bytes)} transferred`
	);
}

// --- Two players join by the invite link (cold: nothing cached).
const players = [];
for (const name of ['Ana', 'Ben']) {
	const p = await open(name);
	const opened = Date.now();
	await p.page.goto(`${roomUrl}?perf`, { waitUntil: 'load' });
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

for (const name of ['village', 'monastery', 'hollow']) {
	const file = JSON.parse(readFileSync(path.join(SCENES, `${name}.json`), 'utf8'));
	for (const p of everyone) {
		await resetStats(p);
		await longTasks(p);
		p.ws.received = 0;
	}
	const start = Date.now();
	await send(gm, { type: 'scene_import', file });
	const w = file.grid.width;
	for (const p of everyone) {
		await waitFor(
			p,
			(width) => {
				const s = window.thirdfoldPerf?.stats();
				return !!s?.timings.setGrid && document.querySelector('canvas') && width > 0;
			},
			w
		);
	}
	const loaded = Date.now() - start;
	await sleep(1500);
	const scene = { loadedMs: loaded };
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
			geometries: s.geometries,
			textures: s.textures,
			programs: s.programs
		};
	}
	console.log(
		`\n${name} (${file.grid.width}×${file.grid.height}): every table built after ${loaded} ms`
	);
	for (const p of everyone) {
		const r = scene[p.name];
		console.log(
			`  ${p.name}: snapshot ${kb(r.snapshot)}; long tasks ${r.longTasks.count} (${round(r.longTasks.total)} ms, max ${round(r.longTasks.max)}); setGrid ${r.setGrid} ms, setTokens ${r.setTokens} ms, setProps ${r.setProps} ms, lighting ×${r.lighting.count} ${r.lighting.total} ms; ${r.drawCalls} draws, ${r.triangles.toLocaleString()} tris, ${r.geometries} geo, ${r.textures} tex, ${r.programs} programs`
		);
	}

	// Idle: nothing happens; frames drawn anyway are the idle cost.
	await resetStats(ana);
	await sleep(4000);
	const idle = await stats(ana);
	scene.idle = {
		frames: idle.frames,
		fps: round(idle.frames / 4),
		frameMs: round((idle.timings.frame?.total ?? 0) / Math.max(1, idle.frames), 2)
	};
	console.log(
		`  idle (Ana, 4 s): ${idle.frames} frames (${scene.idle.fps}/s), ${scene.idle.frameMs} ms each`
	);

	// The camera moving: Ana drags to orbit for two seconds.
	await resetStats(ana);
	const box = await ana.page.locator('canvas').boundingBox();
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	await ana.page.mouse.move(cx, cy);
	await ana.page.mouse.down();
	const t0 = Date.now();
	let i = 0;
	while (Date.now() - t0 < 2000) {
		await ana.page.mouse.move(cx + Math.sin(i / 10) * 200, cy + Math.cos(i / 13) * 60);
		i++;
		await sleep(16);
	}
	await ana.page.mouse.up();
	const orbit = await stats(ana);
	const f = orbit.timings.frame;
	scene.orbit = {
		shadowPasses: orbit.timings.shadows?.count ?? 0,
		drawCalls: orbit.drawCalls,
		fps: round(orbit.frames / 2),
		frameMs: round(f.total / f.count, 2),
		maxMs: round(f.max, 1),
		drawMs: round(orbit.timings.draw.total / orbit.timings.draw.count, 2)
	};
	console.log(
		`  orbit (Ana, 2 s): ${scene.orbit.fps} fps, frame ${scene.orbit.frameMs} ms (max ${scene.orbit.maxMs}), of which draw ${scene.orbit.drawMs} ms; ${scene.orbit.drawCalls} draws a frame, ${scene.orbit.shadowPasses} shadow passes`
	);

	// Moving: Ana's character steps back and forth.
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

	for (const p of everyone) scene[p.name].heap = await heap(p);
	console.log(
		`  heap after GC: ${everyone.map((p) => `${p.name} ${kb(scene[p.name].heap)}`).join(', ')}`
	);
	report.scenes[name] = scene;
}

// Leaks: load the three tables twice more; GPU resources and heap should come back to the same.
const before = await stats(ana);
const heapBefore = await heap(ana);
for (let round2 = 0; round2 < 2; round2++) {
	for (const name of ['village', 'monastery', 'hollow']) {
		const file = JSON.parse(readFileSync(path.join(SCENES, `${name}.json`), 'utf8'));
		await send(gm, { type: 'scene_import', file });
		await sleep(2500);
	}
}
const after = await stats(ana);
const heapAfter = await heap(ana);
report.leaks = {
	geometries: [before.geometries, after.geometries],
	textures: [before.textures, after.textures],
	programs: [before.programs, after.programs],
	heap: [heapBefore, heapAfter]
};
console.log(
	`\nafter loading the three tables twice more (Ana, same table): geometries ${before.geometries} → ${after.geometries}, textures ${before.textures} → ${after.textures}, programs ${before.programs} → ${after.programs}, heap ${kb(heapBefore)} → ${kb(heapAfter)}`
);

if (process.env.PERF_JSON) {
	const { writeFileSync } = await import('node:fs');
	writeFileSync(process.env.PERF_JSON, JSON.stringify(report, null, 2));
}
await browser.close();
