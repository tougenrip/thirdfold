// Plays every built-in adventure from start to finish in a real browser, and
// checks the renderer keeps up: a GM and a player (who takes a character),
// the GM's Direct panel skipping scene by scene (answering each choice with its
// first option). After every step the player's table must draw the change and
// come to rest (the render scheduler back to idle or ambient, never stuck
// active), a token move must animate at each new place, and no page may log an
// error. Needs the built app served and a game server running, like the perf
// scripts (see perf-client.mjs); runs on the GPU perf-browser.mjs picks:
//   node scripts/playthrough.mjs [http://localhost:4173]

import { launchBrowser, PERF_QUERY } from './perf-browser.mjs';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const MAX_STEPS = 80;
/** How long a table may take to come to rest after a step (a new table, a fight). */
const REST_MS = 20_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchBrowser();
const errors = [];
async function open(name) {
	const page = await (
		await browser.newContext({ viewport: { width: 1400, height: 900 } })
	).newPage();
	page.on(
		'console',
		(m) => m.type() === 'error' && errors.push(`${name}: ${m.text().slice(0, 200)}`)
	);
	page.on('pageerror', (e) => errors.push(`${name}: ${String(e).slice(0, 200)}`));
	return page;
}
const stats = (page) => page.evaluate(() => window.thirdfoldPerf?.stats() ?? null);
const room = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.thirdfoldRoom.room)));
const send = (page, msg) => page.evaluate((m) => window.thirdfoldRoom.send(m), msg);

/**
 * Waits until the page's table is at rest: no warm-up holding it, the scheduler idle or ambient
 * (never active), for half a second on end. Returns how long that took; throws if it never is.
 */
async function rest(page) {
	const start = Date.now();
	let calmSince = null;
	while (Date.now() - start < REST_MS) {
		const s = await stats(page);
		const calm = s && !s.holding && (s.mode === 'idle' || s.mode === 'ambient');
		calmSince = calm ? (calmSince ?? Date.now()) : null;
		if (calmSince && Date.now() - calmSince >= 500) return calmSince - start;
		await sleep(50);
	}
	const s = await stats(page);
	throw new Error(`table stuck: mode ${s?.mode}, holding ${s?.holding}, ${s?.frames} frames`);
}

/** Moves the player's token a cell and checks the move animates (frames drawn while active). */
async function moveAnimates(page, tokenId) {
	const r = await room(page);
	const token = r.tokens.find((t) => t.id === tokenId);
	if (!token) return 'no token';
	for (const [dx, dy] of [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1]
	]) {
		const to = { x: token.pos.x + dx, y: token.pos.y + dy };
		const before = (await stats(page)).frames;
		await send(page, { type: 'token_move', tokenId, to });
		await sleep(150);
		const moved = (await room(page)).tokens.find((t) => t.id === tokenId);
		if (moved.pos.x !== to.x || moved.pos.y !== to.y) continue;
		let sawActive = false;
		for (let i = 0; i < 20 && !sawActive; i++) {
			sawActive = (await stats(page)).mode === 'active';
			if (!sawActive) await sleep(25);
		}
		await rest(page);
		const drawn = (await stats(page)).frames - before;
		if (drawn < 3) throw new Error(`a move drew only ${drawn} frames`);
		return `${drawn} frames`;
	}
	return 'nowhere to move';
}

const gm = await open('GM');
await gm.goto(`${BASE}/`);
await gm.fill('input[placeholder="e.g. Morgan"]', 'Gia');
await gm.click('text=Create room');
await gm.waitForURL(/room\//);
const roomUrl = gm.url().split('?')[0];
await gm.goto(`${roomUrl}${PERF_QUERY}`);
await gm.waitForFunction(() => (window.thirdfoldPerf?.stats().frames ?? 0) > 0);
const ana = await open('Ana');
await ana.goto(`${roomUrl}${PERF_QUERY}`);
await ana.fill('input[placeholder="e.g. Morgan"]', 'Ana');
await ana.click('button:has-text("Join the game")');
await ana.waitForFunction(() => (window.thirdfoldPerf?.stats().frames ?? 0) > 0);

let failed = false;
for (const { id, title } of (await room(gm)).adventures) {
	const started = Date.now();
	try {
		await send(gm, { type: 'adventure_start', adventureId: id });
		await gm.waitForFunction((a) => window.thirdfoldRoom.room.adventure?.id === a, id);
		await ana.waitForFunction(() => window.thirdfoldRoom.room.adventure?.stage === 'choosing');
		const character = (await room(ana)).adventure.characters[0].id;
		await send(ana, { type: 'adventure_claim', characterId: character });
		await sleep(500);
		await send(gm, { type: 'adventure_begin' });
		await ana.waitForFunction(() => window.thirdfoldRoom.room.adventure?.stage === 'playing');
		console.log(`\n${title}: playing as ${character}`);
		let place = null;
		let steps = 0;
		for (; steps < MAX_STEPS; steps++) {
			const adventure = (await room(gm)).adventure;
			if (adventure.stage === 'complete' || adventure.stage === 'defeat') break;
			const where = `${adventure.chapter.title} · ${adventure.location.name}`;
			if (adventure.decision) {
				const { id: decisionId, options } = adventure.decision;
				await send(gm, { type: 'adventure_decide', decisionId, optionId: options[0].id });
			} else {
				await send(gm, { type: 'adventure_direct', direction: { op: 'skip' } });
			}
			await sleep(400);
			const ms = await rest(ana);
			let move = '';
			const now = (await room(ana)).adventure;
			if (now.location.id !== place && now.stage === 'playing' && !now.encounter) {
				place = now.location.id;
				const mine = now.characters.find((c) => c.id === character);
				if (mine?.tokenId) move = `; a move: ${await moveAnimates(ana, mine.tokenId)}`;
			}
			console.log(`  ${where}: at rest after ${ms} ms${move}`);
		}
		const end = (await room(gm)).adventure;
		if (end.stage !== 'complete' && end.stage !== 'defeat')
			throw new Error(`not over after ${steps} steps (${end.chapter.title})`);
		console.log(
			`${title}: ${end.stage} (${end.ending?.title ?? 'no ending'}) in ${steps} steps, ${Math.round((Date.now() - started) / 1000)} s`
		);
	} catch (e) {
		failed = true;
		console.log(`${title}: FAILED: ${e.message}`);
	}
}

await browser.close();
if (errors.length) {
	console.log(`\n${errors.length} console error(s):\n  ${errors.slice(0, 10).join('\n  ')}`);
	failed = true;
}
console.log(failed ? '\nPlaythrough failed.' : '\nPlaythrough passed.');
process.exit(failed ? 1 : 0);
