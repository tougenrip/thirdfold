// Measures multiplayer synchronization: what the server spends and each
// client receives when a scene loads and when a character moves, at each of
// The Hollow Bell's big tables, with a GM, players and a spectator.
//
//   npx tsx server/perf/sync.ts [moves]
//
// Two measurements: a real game server with WebSocket clients (bytes and
// messages each client receives, and the time from a move to the last
// client having it), and the per-viewer view work (viewsFor + diffView,
// what the server does after every action) timed directly.

import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
import type { ClientMessage, RoomSnapshot, ServerMessage } from '../../src/lib/game/protocol';
import { inBounds, type GridPos } from '../../src/lib/game/grid';
import { canStep } from '../../src/lib/game/objects';
import { obstaclesFor } from '../../src/lib/game/props';
import type { SceneFile } from '../../src/lib/game/scene-file';
import { decodeLevels } from '../../src/lib/game/terrain';
import { patrol } from '../adventure/engine';
import { readAdventure } from '../adventure/persist';
import { startGameServer } from '../game-server';
import { RoomManager } from '../rooms';
import { obstacles } from '../scene';
import { applyScene } from '../scene-io';
import { diffView, sentFrom, viewsFor } from '../views';
import { PERF_PLAYERS, perfScenes } from './scenes';

const MOVES = Number(process.argv[2] ?? 20);
const EXTRA_PLAYERS = ['Cy', 'Di', 'Ed'];

class Client {
	readonly ws: WebSocket;
	bytes = 0;
	messages = 0;
	readonly byType = new Map<string, { count: number; bytes: number }>();
	private waiters: { type: string; pass: (m: ServerMessage) => boolean; done: () => void }[] = [];
	playerId = '';
	snapshot: RoomSnapshot | null = null;

	constructor(port: number) {
		this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
		this.ws.on('message', (data: Buffer) => {
			const msg = JSON.parse(data.toString()) as ServerMessage;
			this.bytes += data.length;
			this.messages++;
			const t = this.byType.get(msg.type) ?? { count: 0, bytes: 0 };
			t.count++;
			t.bytes += data.length;
			this.byType.set(msg.type, t);
			if (msg.type === 'welcome') {
				this.playerId = msg.playerId;
				this.snapshot = msg.room;
			}
			if (msg.type === 'room_reset') this.snapshot = msg.room;
			if (msg.type === 'error') console.warn('  server said:', msg.code, msg.message);
			this.waiters = this.waiters.filter((w) => {
				if (w.type !== msg.type || !w.pass(msg)) return true;
				w.done();
				return false;
			});
		});
	}

	opened(): Promise<void> {
		return new Promise((resolve) => this.ws.once('open', () => resolve()));
	}

	send(msg: ClientMessage): void {
		this.ws.send(JSON.stringify(msg));
	}

	until<T extends ServerMessage['type']>(
		type: T,
		pass: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true
	): Promise<void> {
		return new Promise((done, fail) => {
			const timer = setTimeout(() => fail(new Error(`no ${type} within 5 s`)), 5000);
			this.waiters.push({
				type,
				pass: pass as (m: ServerMessage) => boolean,
				done: () => {
					clearTimeout(timer);
					done();
				}
			});
		});
	}

	resetCounts(): void {
		this.bytes = 0;
		this.messages = 0;
		this.byType.clear();
	}
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;
const ms = (n: number) => `${n.toFixed(2)} ms`;

async function overTheWire(name: string, scene: SceneFile): Promise<void> {
	const server = await startGameServer({ port: 0, host: '127.0.0.1', patrolMs: 0 });
	const connect = async () => {
		const c = new Client(server.port);
		await c.opened();
		return c;
	};
	const gm = await connect();
	gm.send({ type: 'create', name: 'Gia' });
	await gm.until('welcome');
	const roomId = gm.snapshot!.id;
	const clients = [gm];
	for (const [who, role] of [
		...[...PERF_PLAYERS, ...EXTRA_PLAYERS].map((n) => [n, 'player'] as const),
		['Sam', 'spectator'] as const
	]) {
		const c = await connect();
		c.send({ type: 'join', roomId, name: who, role });
		await c.until('welcome');
		clients.push(c);
	}
	const ana = clients[1];
	clients.forEach((c) => c.resetCounts());

	// Loading the table: every client gets a fresh snapshot.
	const loadStart = performance.now();
	const loaded = Promise.all(clients.map((c) => c.until('room_reset')));
	gm.send({ type: 'scene_import', file: scene });
	await loaded;
	const loadMs = performance.now() - loadStart;
	const resetBytes = clients.map((c) => c.byType.get('room_reset')?.bytes ?? 0);
	console.log(`\n${name}: ${scene.grid.width}×${scene.grid.height}, ${clients.length} clients`);
	console.log(`  load: ${ms(loadMs)} until every client had it`);
	console.log(
		`  snapshot: GM ${kb(resetBytes[0])}, Ana ${kb(resetBytes[1])}, spectator ${kb(resetBytes.at(-1)!)}`
	);

	// Moving: Ana's character steps back and forth between two free cells.
	const warden = ana.snapshot!.tokens.find((t) => t.ownerId === ana.playerId);
	if (!warden) throw new Error('Ana has no character');
	const home: GridPos = { ...warden.pos };
	const occupied = new Set(ana.snapshot!.tokens.map((t) => `${t.pos.x},${t.pos.y}`));
	const levels = scene.terrain
		? decodeLevels(scene.terrain, scene.grid.width * scene.grid.height)
		: null;
	const blocked = obstaclesFor(scene.grid, scene.objects, scene.props, levels);
	const step = [
		{ x: home.x + 1, y: home.y },
		{ x: home.x - 1, y: home.y },
		{ x: home.x, y: home.y + 1 },
		{ x: home.x, y: home.y - 1 }
	].find((p) => !occupied.has(`${p.x},${p.y}`) && canStep(blocked, home, p))!;
	await new Promise((r) => setTimeout(r, 200));
	clients.forEach((c) => c.resetCounts());
	const elu = performance.eventLoopUtilization();
	const times: number[] = [];
	for (let i = 0; i < MOVES; i++) {
		const to = i % 2 === 0 ? step : home;
		const start = performance.now();
		// Under fog only those who see the character get the move: wait for the GM and Ana.
		const seen = Promise.all(
			[gm, ana].map((c) =>
				c.until(
					'token_moved',
					(m) => m.tokenId === warden.id && m.pos.x === to.x && m.pos.y === to.y
				)
			)
		);
		ana.send({ type: 'token_move', tokenId: warden.id, to });
		await seen;
		times.push(performance.now() - start);
	}
	const used = performance.eventLoopUtilization(elu);
	times.sort((a, b) => a - b);
	const per = (c: Client) => c.bytes / MOVES;
	console.log(
		`  move: median ${ms(times[times.length >> 1])}, p95 ${ms(times[Math.floor(times.length * 0.95)])} until the GM and Ana had it (event loop ${(used.utilization * 100).toFixed(0)}% busy, server and clients together)`
	);
	console.log(
		`  per move: GM ${kb(per(gm))} (${(gm.messages / MOVES).toFixed(1)} msgs), Ana ${kb(per(ana))}, a player without a character ${kb(per(clients[3]))}, spectator ${kb(per(clients.at(-1)!))}`
	);
	const types = [...ana.byType].map(([t, v]) => `${t} ${kb(v.bytes / MOVES)}`).join(', ');
	console.log(`  Ana's per move by message: ${types}`);
	for (const c of clients) c.ws.terminate();
	await server.close();
}

/** The server's work after each action (every viewer's view, then the diff), timed alone. */
function viewWork(name: string, scene: SceneFile): void {
	const rooms = new RoomManager();
	const made = rooms.create('Gia');
	if (!made.ok) throw new Error(made.message);
	const room = made.room;
	for (const n of [...PERF_PLAYERS, ...EXTRA_PLAYERS]) rooms.join(room.id, n, 'player');
	rooms.join(room.id, 'Sam', 'spectator');
	const story = readAdventure(scene.adventure!, scene);
	if (!story.ok) throw new Error(story.error);
	applyScene(room, scene);
	room.adventure = story.adventure;
	const viewers = [...room.players.values()];
	let sent = new Map([...viewsFor(room, viewers)].map(([p, v]) => [p.id, sentFrom(v)]));
	const token = [...room.tokens.values()].find((t) => t.ownerId);
	if (!token) throw new Error('no character on the table');
	// A walk to new cells (a neighbour it can step to, never straight back), so sights are new too.
	const blocked = obstacles(room);
	let prev = { ...token.pos };
	let seed = 7;
	const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
	const runs = 50;
	let views = 0;
	let diffs = 0;
	for (let i = 0; i < runs; i++) {
		const from = { ...token.pos };
		const options = [
			{ x: from.x + 1, y: from.y },
			{ x: from.x - 1, y: from.y },
			{ x: from.x, y: from.y + 1 },
			{ x: from.x, y: from.y - 1 }
		].filter(
			(c) =>
				inBounds(room.grid, c) &&
				canStep(blocked, from, c) &&
				!(c.x === prev.x && c.y === prev.y) &&
				![...room.tokens.values()].some((t) => t.pos.x === c.x && t.pos.y === c.y)
		);
		if (options.length) token.pos = options[Math.floor(random() * options.length)];
		prev = from;
		const a = performance.now();
		const next = viewsFor(room, viewers);
		const b = performance.now();
		for (const [p, v] of next) diffView(sent.get(p.id)!, v);
		sent = new Map([...next].map(([p, v]) => [p.id, sentFrom(v)]));
		diffs += performance.now() - b;
		views += b - a;
	}
	console.log(
		`  view work per action (${viewers.length} viewers): views ${ms(views / runs)}, diffs ${ms(diffs / runs)}`
	);
	// The watch's rounds (every 1.5 s outside a fight): each sentry steps and looks about.
	if (room.adventure?.sentries.size) {
		const start = performance.now();
		const steps = 30;
		for (let i = 0; i < steps; i++) patrol(room);
		console.log(
			`  a patrol step (${room.adventure.sentries.size} sentries): ${ms((performance.now() - start) / steps)}`
		);
	}
}

const scenes = perfScenes();
for (const [name, scene] of Object.entries(scenes)) {
	await overTheWire(name, scene);
	viewWork(name, scene);
}
