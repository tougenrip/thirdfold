import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DieRoller } from '../src/lib/game/dice';
import { beginAdventure, claimCharacter, direct, startAdventure } from './adventure/engine';
import { postChat } from './chat';
import {
	FileRoomStore,
	MemoryRoomStore,
	restoreRoom,
	serializeRoom,
	SupabaseRoomStore,
	type LiveRoom
} from './room-store';
import { RoomManager, type Player, type Room } from './rooms';

const max: DieRoller = (sides) => sides;

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}

let room: Room;
let gm: Player;
let ana: Player;

/** A room mid-story: The Hollow Bell begun, a fight on, a line of chat. */
beforeEach(() => {
	const rooms = new RoomManager();
	const created = ok(rooms.create('Gia'));
	room = created.room;
	gm = created.player;
	ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
	room.dice = max;
	ok(startAdventure(room, gm));
	ok(claimCharacter(room, ana, 'warden'));
	ok(beginAdventure(room, gm, 1000));
	ok(direct(room, gm, { op: 'encounter_start', encounter: 'well' }));
	ok(postChat(room, ana, 'Behind you!'));
	ana.explored[5] = 1;
});

const copy = (live: LiveRoom): LiveRoom => JSON.parse(JSON.stringify(live));

describe('a live room kept across a restart', () => {
	it('comes back with the same seats, tokens, story, log and explored maps, nobody connected', () => {
		const back = ok(restoreRoom(copy(serializeRoom(room)), 5000)).room;
		expect(back.id).toBe(room.id);
		expect([...back.players.values()].map((p) => [p.id, p.name, p.role, p.connected])).toEqual([
			[gm.id, 'Gia', 'gm', false],
			[ana.id, 'Ana', 'player', false]
		]);
		expect(back.players.get(ana.id)!.sessionToken).toBe(ana.sessionToken);
		expect(back.players.get(ana.id)!.explored[5]).toBe(1);
		const warden = [...back.tokens.values()].find((t) => t.name === 'The Warden')!;
		expect(warden.ownerId).toBe(ana.id);
		expect(back.adventure).toMatchObject({ stage: 'playing', chapter: room.adventure!.chapter });
		expect(back.adventure!.encounter?.id).toBe('well');
		expect(back.log.map((m) => ('text' in m ? m.text : m.kind))).toEqual(
			room.log.map((m) => ('text' in m ? m.text : m.kind))
		);
		expect(back.nextSeq).toBe(room.nextSeq);
		// Empty from the restart on, so it is still pruned if nobody comes back.
		expect(back.emptySince).toBe(5000);
	});

	it('stays listed for anyone to join, as its GM listed it', () => {
		expect(ok(restoreRoom(copy(serializeRoom(room)), 5000)).room.listed).toBe(false);
		room.listed = true;
		expect(ok(restoreRoom(copy(serializeRoom(room)), 5000)).room.listed).toBe(true);
		const older = copy(serializeRoom(room));
		delete older.listed;
		expect(ok(restoreRoom(older, 5000)).room.listed).toBe(false);
	});

	it('never trusts what it reads back: a damaged room is rejected whole', () => {
		const good = serializeRoom(room);
		const broken = (patch: (r: LiveRoom) => void) => {
			const r = copy(good);
			patch(r);
			return restoreRoom(r);
		};
		expect(restoreRoom('nope').ok).toBe(false);
		expect(broken((r) => (r.version = 99)).ok).toBe(false);
		expect(broken((r) => (r.id = '../etc')).ok).toBe(false);
		expect(broken((r) => (r.players[0].sessionToken = 'guess')).ok).toBe(false);
		expect(broken((r) => (r.players[1].role = 'gm')).ok).toBe(false);
		expect(broken((r) => (r.players[1].sessionToken = r.players[0].sessionToken)).ok).toBe(false);
		expect(broken((r) => ((r.scene as { version: number }).version = 999)).ok).toBe(false);
		expect(broken((r) => (r.scene.adventure!.id = 'another-story')).ok).toBe(false);
		// Odd log entries are dropped, not trusted.
		const odd = broken((r) => r.log.push({ kind: 'chat' } as unknown as LiveRoom['log'][number]));
		expect(odd.ok && odd.room.log.length).toBe(room.log.length);
	});
});

describe('room stores', () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), 'thirdfold-rooms-'));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('keeps rooms as files, one each, and forgets them when asked', async () => {
		const store = new FileRoomStore(dir);
		await store.save(serializeRoom(room));
		await writeFile(path.join(dir, 'notes.txt'), 'not a room');
		await writeFile(path.join(dir, 'ABCDEF.json'), '{broken');
		expect(await readdir(dir)).toContain(`${room.id}.json`);
		const all = await store.loadAll();
		expect(all).toHaveLength(1);
		expect(restoreRoom(all[0]).ok).toBe(true);
		await store.remove(room.id);
		expect(await store.loadAll()).toEqual([]);
		await expect(store.remove('../../etc')).rejects.toThrow(/Invalid room id/);
	});

	it('keeps nothing shared by reference in memory', async () => {
		const store = new MemoryRoomStore();
		const live = serializeRoom(room);
		await store.save(live);
		live.nextSeq = 0;
		expect(((await store.loadAll())[0] as LiveRoom).nextSeq).toBe(room.nextSeq);
	});

	it('keeps rooms in Supabase by id, and only the rooms’ own ids', async () => {
		const calls: unknown[][] = [];
		const builder = {
			upsert: (row: unknown) => (calls.push(['upsert', row]), Promise.resolve({ error: null })),
			delete: () => (calls.push(['delete']), builder),
			eq: (c: string, v: unknown) => (calls.push(['eq', c, v]), Promise.resolve({ error: null })),
			select: (c: string) => (calls.push(['select', c]), Promise.resolve({ data: [], error: null }))
		};
		const client = { from: (t: string) => (calls.push(['from', t]), builder) };
		const store = new SupabaseRoomStore(client as unknown as SupabaseClient);
		const live = serializeRoom(room);
		await store.save(live);
		await store.remove(room.id);
		await store.remove("x' or 1=1");
		expect(await store.loadAll()).toEqual([]);
		expect(calls).toEqual([
			['from', 'live_rooms'],
			['upsert', { id: room.id, data: live, updated_at: live.savedAt }],
			['from', 'live_rooms'],
			['delete'],
			['eq', 'id', room.id],
			['from', 'live_rooms'],
			['select', 'data']
		]);
	});
});
