// Authoritative room state. Pure logic with no sockets, so it can be tested
// directly and the transport can change without touching the rules.

import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { DEFAULT_GRID, type SquareGrid } from '../src/lib/game/grid';
import type { ChatMessage } from '../src/lib/game/chat';
import type { DieRoller } from '../src/lib/game/dice';
import type { Ambient, Light } from '../src/lib/game/lights';
import type { SceneObject } from '../src/lib/game/objects';
import type { Prop } from '../src/lib/game/props';
import type { Token } from '../src/lib/game/token';
import type { LevelMap } from '../src/lib/game/terrain';
import type { AdventureState } from './adventure/state';
import { emptyMask, type CellMask } from '../src/lib/game/visibility';
import {
	normalizeName,
	type ErrorCode,
	type JoinRole,
	type PublicPlayer,
	type Role
} from '../src/lib/game/protocol';

export interface Player {
	id: string;
	name: string;
	role: Role;
	/** Secret proving identity on reconnect. Never broadcast. */
	sessionToken: string;
	connected: boolean;
	/** Cells this player has ever seen while fog was on; kept across reconnects. */
	explored: CellMask;
}

export interface Room {
	id: string;
	grid: SquareGrid;
	players: Map<string, Player>;
	tokens: Map<string, Token>;
	objects: Map<string, SceneObject>;
	props: Map<string, Prop>;
	lights: Map<string, Light>;
	ambient: Ambient;
	/** Each cell's level (elevation), or null for a flat table. */
	terrain: LevelMap | null;
	/** Name of the scene on the table: set when it is saved, loaded or imported. */
	sceneName: string;
	fog: {
		enabled: boolean;
		/** Cells the GM has revealed to everyone. */
		revealed: CellMask;
	};
	/** Recent room log, oldest first, capped at LOG_LIMIT. */
	log: ChatMessage[];
	nextSeq: number;
	/** When the last player disconnected, or null while anyone is connected. */
	emptySince: number | null;
	/** The adventure being played at this table, or null for a free table. */
	adventure: AdventureState | null;
	/** The dice the story rolls when no action brings its own (initiative); secure dice if unset. */
	dice?: DieRoller;
}

export type Result<T> = ({ ok: true } & T) | { ok: false; code: ErrorCode; message: string };

const ROOM_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function fail(
	code: ErrorCode,
	message: string
): { ok: false; code: ErrorCode; message: string } {
	return { ok: false, code, message };
}

export function toPublicPlayer(p: Player): PublicPlayer {
	return { id: p.id, name: p.name, role: p.role, connected: p.connected };
}

export class RoomManager {
	private rooms = new Map<string, Room>();

	get(roomId: string): Room | undefined {
		return this.rooms.get(roomId);
	}

	get size(): number {
		return this.rooms.size;
	}

	/** Creates a room whose creator becomes its GM. */
	create(rawName: unknown): Result<{ room: Room; player: Player }> {
		const name = normalizeName(rawName);
		if (!name) return fail('invalid_name', 'Name must be 1-32 characters.');
		const room: Room = {
			id: this.newRoomId(),
			grid: { ...DEFAULT_GRID },
			players: new Map(),
			tokens: new Map(),
			objects: new Map(),
			props: new Map(),
			lights: new Map(),
			ambient: 'day',
			terrain: null,
			sceneName: 'Untitled scene',
			fog: { enabled: false, revealed: emptyMask(DEFAULT_GRID) },
			log: [],
			nextSeq: 1,
			emptySince: null,
			adventure: null
		};
		const player = this.addPlayer(room, name, 'gm');
		this.rooms.set(room.id, room);
		return { ok: true, room, player };
	}

	join(roomId: string, rawName: unknown, role: JoinRole): Result<{ room: Room; player: Player }> {
		const room = this.rooms.get(roomId);
		if (!room) return fail('room_not_found', `Room ${roomId} does not exist.`);
		const name = normalizeName(rawName);
		if (!name) return fail('invalid_name', 'Name must be 1-32 characters.');
		// Role comes from the parsed message, which only admits player/spectator,
		// but guard here too: the GM seat is never granted by request.
		if (role !== 'player' && role !== 'spectator') {
			return fail('invalid_message', 'Invalid role.');
		}
		return { ok: true, room, player: this.addPlayer(room, name, role) };
	}

	resume(roomId: string, sessionToken: string): Result<{ room: Room; player: Player }> {
		const room = this.rooms.get(roomId);
		if (!room) return fail('room_not_found', `Room ${roomId} does not exist.`);
		const player = [...room.players.values()].find((p) => p.sessionToken === sessionToken);
		if (!player) return fail('session_not_found', 'Session expired. Join the room again.');
		this.setConnected(room, player, true);
		return { ok: true, room, player };
	}

	setConnected(room: Room, player: Player, connected: boolean, now = Date.now()): void {
		player.connected = connected;
		const anyoneConnected = [...room.players.values()].some((p) => p.connected);
		room.emptySince = anyoneConnected ? null : (room.emptySince ?? now);
	}

	/** Drops rooms nobody has been connected to for `ttlMs`. Returns the removed ids. */
	prune(ttlMs: number, now = Date.now()): string[] {
		const removed: string[] = [];
		for (const room of this.rooms.values()) {
			if (room.emptySince !== null && now - room.emptySince >= ttlMs) {
				this.rooms.delete(room.id);
				removed.push(room.id);
			}
		}
		return removed;
	}

	private addPlayer(room: Room, name: string, role: Role): Player {
		const player: Player = {
			id: randomUUID(),
			name,
			role,
			sessionToken: randomBytes(32).toString('hex'),
			connected: true,
			explored: emptyMask(room.grid)
		};
		room.players.set(player.id, player);
		room.emptySince = null;
		return player;
	}

	private newRoomId(): string {
		for (;;) {
			let id = '';
			for (let i = 0; i < 6; i++) id += ROOM_ID_ALPHABET[randomInt(ROOM_ID_ALPHABET.length)];
			if (!this.rooms.has(id)) return id;
		}
	}
}
