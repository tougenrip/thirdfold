// Live rooms kept across game-server restarts. Each room is saved as a
// `LiveRoom`: its seats (with their secret session tokens, so everyone can
// resume the same seat), each player's explored map, the room log, and the
// table and its story as a scene file. Loading validates all of it exactly as
// an uploaded scene is validated (parseSceneFile, readAdventure), so a
// damaged or tampered file is skipped rather than trusted. Server-side only:
// session tokens are secrets and never leave the server.

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { LOG_LIMIT, type ChatMessage } from '../src/lib/game/chat';
import { normalizeName, ROOM_ID_PATTERN, type Role } from '../src/lib/game/protocol';
import { parseSceneFile, type SceneFile } from '../src/lib/game/scene-file';
import { decodeMask, encodeMask } from '../src/lib/game/visibility';
import { readAdventure } from './adventure/persist';
import { newRoom, type Room } from './rooms';
import { applyScene, exportScene } from './scene-io';

export const LIVE_ROOM_VERSION = 1;

export interface LiveRoom {
	version: number;
	id: string;
	savedAt: string;
	scene: SceneFile;
	players: { id: string; name: string; role: Role; sessionToken: string; explored: string }[];
	log: ChatMessage[];
	nextSeq: number;
	/** When the room last had nobody connected; null while someone was. */
	emptySince: number | null;
	paused: boolean;
	/** Paused only because the GM lost their connection (lifted when they are back). */
	pausedForGm: boolean;
}

export interface RoomStore {
	save(room: LiveRoom): Promise<void>;
	remove(id: string): Promise<void>;
	/** Every stored room, raw (still to be validated with `restoreRoom`). */
	loadAll(): Promise<unknown[]>;
}

/** A room as it is now, ready to store. */
export function serializeRoom(room: Room, now = new Date()): LiveRoom {
	return {
		version: LIVE_ROOM_VERSION,
		id: room.id,
		savedAt: now.toISOString(),
		scene: exportScene(room, room.sceneName, now),
		players: [...room.players.values()].map((p) => ({
			id: p.id,
			name: p.name,
			role: p.role,
			sessionToken: p.sessionToken,
			explored: encodeMask(p.explored)
		})),
		log: structuredClone(room.log),
		nextSeq: room.nextSeq,
		emptySince: room.emptySince,
		paused: room.paused,
		pausedForGm: room.pausedForGm === true
	};
}

const SESSION_TOKEN = /^[0-9a-f]{64}$/;
const PLAYER_ID = /^[0-9a-f-]{36}$/;
const ROLES: readonly Role[] = ['gm', 'player', 'spectator'];
const MAX_PLAYERS = 64;

type Restored = { ok: true; room: Room } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A stored room back as a live one, with nobody connected yet (they resume
 * their seats). Anything that doesn't validate rejects the whole room.
 */
export function restoreRoom(raw: unknown, now = Date.now()): Restored {
	const bad = (error: string): Restored => ({ ok: false, error });
	if (!isRecord(raw)) return bad('not a room');
	if (raw.version !== LIVE_ROOM_VERSION) return bad(`unknown version ${String(raw.version)}`);
	if (typeof raw.id !== 'string' || !ROOM_ID_PATTERN.test(raw.id)) return bad('bad room id');
	const parsed = parseSceneFile(raw.scene);
	if (!parsed.ok) return bad(`bad scene: ${parsed.error}`);
	const scene = parsed.scene;
	const story = scene.adventure ? readAdventure(scene.adventure, scene) : null;
	if (story && !story.ok) return bad(`bad story: ${story.error}`);

	if (!Array.isArray(raw.players) || raw.players.length === 0 || raw.players.length > MAX_PLAYERS) {
		return bad('bad players');
	}
	const size = scene.grid.width * scene.grid.height;
	const players: Room['players'] = new Map();
	for (const p of raw.players as unknown[]) {
		if (!isRecord(p)) return bad('bad player');
		const name = normalizeName(p.name);
		const role = ROLES.find((r) => r === p.role);
		if (
			typeof p.id !== 'string' ||
			!PLAYER_ID.test(p.id) ||
			!name ||
			!role ||
			typeof p.sessionToken !== 'string' ||
			!SESSION_TOKEN.test(p.sessionToken) ||
			typeof p.explored !== 'string' ||
			players.has(p.id)
		) {
			return bad('bad player');
		}
		let explored;
		try {
			explored = decodeMask(p.explored, size);
		} catch {
			return bad('bad explored map');
		}
		players.set(p.id, {
			id: p.id,
			name,
			role,
			sessionToken: p.sessionToken,
			connected: false,
			explored
		});
	}
	if ([...players.values()].filter((p) => p.role === 'gm').length !== 1) return bad('no single GM');
	const tokens = new Set([...players.values()].map((p) => p.sessionToken));
	if (tokens.size !== players.size) return bad('shared session token');

	if (!Array.isArray(raw.log) || raw.log.length > LOG_LIMIT) return bad('bad log');
	const log = (raw.log as unknown[]).filter(
		(m): m is ChatMessage =>
			isRecord(m) &&
			typeof m.kind === 'string' &&
			Number.isSafeInteger(m.seq) &&
			typeof m.at === 'number'
	);
	const lastSeq = log.reduce((max, m) => Math.max(max, m.seq), 0);
	const nextSeq =
		Number.isSafeInteger(raw.nextSeq) && (raw.nextSeq as number) > lastSeq
			? (raw.nextSeq as number)
			: lastSeq + 1;

	const room = newRoom(raw.id);
	room.players = players;
	applyScene(room, scene);
	// Each player gets back exactly what they had explored (not the by-name discovery).
	for (const p of players.values()) {
		const saved = (raw.players as { id: string; explored: string }[]).find((x) => x.id === p.id);
		if (saved) p.explored = decodeMask(saved.explored, size);
	}
	room.adventure = story ? story.adventure : null;
	room.log = structuredClone(log);
	room.nextSeq = nextSeq;
	// Nobody is connected after a restart: the room is empty from now, unless it already was.
	room.emptySince =
		typeof raw.emptySince === 'number' && Number.isFinite(raw.emptySince) ? raw.emptySince : now;
	room.paused = raw.paused === true;
	room.pausedForGm = raw.pausedForGm === true;
	return { ok: true, room };
}

// ---------------------------------------------------------------------------
// Stores

/** One JSON file per room, written then renamed so a crash never leaves half a room. */
export class FileRoomStore implements RoomStore {
	constructor(private readonly dir: string) {}

	async save(room: LiveRoom): Promise<void> {
		await mkdir(this.dir, { recursive: true });
		const file = this.file(room.id);
		const tmp = `${file}.${process.pid}.tmp`;
		await writeFile(tmp, JSON.stringify(room), 'utf8');
		await rename(tmp, file);
	}

	async remove(id: string): Promise<void> {
		await rm(this.file(id), { force: true });
	}

	async loadAll(): Promise<unknown[]> {
		let names: string[];
		try {
			names = await readdir(this.dir);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
			throw err;
		}
		const rooms: unknown[] = [];
		for (const name of names) {
			const id = name.replace(/\.json$/, '');
			if (!name.endsWith('.json') || !ROOM_ID_PATTERN.test(id)) continue;
			try {
				rooms.push(JSON.parse(await readFile(this.file(id), 'utf8')));
			} catch (err) {
				console.warn(`[rooms] could not read ${name}:`, (err as Error).message);
			}
		}
		return rooms;
	}

	private file(id: string): string {
		if (!ROOM_ID_PATTERN.test(id)) throw new Error('Invalid room id');
		return path.join(this.dir, `${id}.json`);
	}
}

/** For tests and throwaway servers; kept as JSON so nothing is shared by reference. */
export class MemoryRoomStore implements RoomStore {
	readonly rooms = new Map<string, string>();

	async save(room: LiveRoom): Promise<void> {
		this.rooms.set(room.id, JSON.stringify(room));
	}

	async remove(id: string): Promise<void> {
		this.rooms.delete(id);
	}

	async loadAll(): Promise<unknown[]> {
		return [...this.rooms.values()].map((text) => JSON.parse(text));
	}
}

/**
 * Live rooms in Supabase Postgres (table `public.live_rooms`, see
 * supabase/migrations). Needs the service/secret key: the rows hold session
 * tokens, so no browser role can read them (RLS on, no policies or grants).
 */
export class SupabaseRoomStore implements RoomStore {
	constructor(private readonly db: SupabaseClient) {}

	static connect(url: string, serviceKey: string): SupabaseRoomStore {
		return new SupabaseRoomStore(
			createClient(url, serviceKey, {
				auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
			})
		);
	}

	async save(room: LiveRoom): Promise<void> {
		if (!ROOM_ID_PATTERN.test(room.id)) throw new Error('Invalid room id');
		const { error } = await this.db
			.from('live_rooms')
			.upsert({ id: room.id, data: room, updated_at: room.savedAt });
		if (error) throw new Error(`Saving room failed: ${error.message}`);
	}

	async remove(id: string): Promise<void> {
		if (!ROOM_ID_PATTERN.test(id)) return;
		const { error } = await this.db.from('live_rooms').delete().eq('id', id);
		if (error) throw new Error(`Removing room failed: ${error.message}`);
	}

	async loadAll(): Promise<unknown[]> {
		const { data, error } = await this.db.from('live_rooms').select('data');
		if (error) throw new Error(`Loading rooms failed: ${error.message}`);
		return (data ?? []).map((row) => (row as { data: unknown }).data);
	}
}
