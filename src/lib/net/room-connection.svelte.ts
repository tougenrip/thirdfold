// Browser side of the game connection: opens the socket, enters a room,
// reconnects with the session token after drops, and exposes reactive state.

import { GAME_SERVER_URL } from '$lib/api';
import {
	parseServerMessage,
	type ClientMessage,
	type ErrorCode,
	type JoinRole,
	type RoomSnapshot
} from '$lib/game/protocol';
import { applyRoomUpdate } from './room-state';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export type EnterIntent =
	| { type: 'create'; name: string }
	| { type: 'join'; roomId: string; name: string; role: JoinRole }
	| { type: 'resume'; roomId: string; sessionToken: string };

/** Messages sent once seated: everything that is not an entry intent. */
export type RoomAction = Exclude<ClientMessage, EnterIntent>;

/** A rejected action (e.g. an illegal move). The connection itself is fine. */
export interface ActionError {
	code: ErrorCode | 'offline';
	message: string;
	/** Increments per error, so repeated identical errors still re-trigger UI. */
	seq: number;
}

export interface ConnectionError {
	code: ErrorCode | 'unreachable' | 'replaced' | 'closed';
	message: string;
}

/** Must match CLOSE_SESSION_REPLACED in server/game-server.ts. */
const CLOSE_SESSION_REPLACED = 4001;
const MAX_BACKOFF_MS = 10_000;
/** Errors that make retrying the same entry pointless. */
const FATAL: ReadonlySet<string> = new Set([
	'room_not_found',
	'session_not_found',
	'invalid_name',
	'invalid_message'
]);

const sessionKey = (roomId: string) => `thirdfold:session:${roomId}`;

function storage(): Storage | null {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

export function savedSession(roomId: string): string | null {
	try {
		return storage()?.getItem(sessionKey(roomId)) ?? null;
	} catch {
		return null;
	}
}

function saveSession(roomId: string, token: string | null): void {
	try {
		if (token) storage()?.setItem(sessionKey(roomId), token);
		else storage()?.removeItem(sessionKey(roomId));
	} catch {
		// Storage can be unavailable (private mode); reconnect then only works within this page.
	}
}

export class RoomConnection {
	status = $state<ConnectionStatus>('connecting');
	room = $state<RoomSnapshot | null>(null);
	playerId = $state<string | null>(null);
	error = $state<ConnectionError | null>(null);
	actionError = $state<ActionError | null>(null);
	me = $derived(this.room?.players.find((p) => p.id === this.playerId) ?? null);

	private ws: WebSocket | null = null;
	private intent: EnterIntent;
	private attempt = 0;
	private retryTimer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;
	private errorSeq = 0;
	private welcomeWaiters: { resolve: () => void; reject: (e: ConnectionError) => void }[] = [];

	constructor(
		intent: EnterIntent,
		private url = GAME_SERVER_URL
	) {
		this.intent = intent;
		this.open();
	}

	/** Resolves once the server has seated this client in a room. */
	ready(): Promise<void> {
		if (this.status === 'connected') return Promise.resolve();
		if (this.status === 'closed') {
			return Promise.reject(this.error ?? { code: 'closed', message: 'Connection closed.' });
		}
		return new Promise((resolve, reject) => this.welcomeWaiters.push({ resolve, reject }));
	}

	/** Sends an in-room action. The server's broadcast, not this call, updates `room`. */
	send(action: RoomAction): boolean {
		if (this.status !== 'connected' || this.ws?.readyState !== WebSocket.OPEN) {
			this.reportActionError('offline', 'Not connected to the table right now.');
			return false;
		}
		this.ws.send(JSON.stringify(action));
		return true;
	}

	close(reason: ConnectionError = { code: 'closed', message: 'Connection closed.' }): void {
		this.disposed = true;
		clearTimeout(this.retryTimer);
		this.ws?.close(1000);
		this.ws = null;
		this.status = 'closed';
		for (const w of this.welcomeWaiters.splice(0)) w.reject(reason);
	}

	private open(): void {
		const ws = new WebSocket(this.url);
		this.ws = ws;
		ws.onopen = () => {
			const msg: ClientMessage = this.intent;
			ws.send(JSON.stringify(msg));
		};
		ws.onmessage = (event) => this.onMessage(event.data);
		ws.onclose = (event) => this.onClose(ws, event.code);
	}

	private onMessage(data: unknown): void {
		let parsed: unknown;
		try {
			parsed = typeof data === 'string' ? JSON.parse(data) : null;
		} catch {
			parsed = null;
		}
		const msg = parseServerMessage(parsed);
		if (!msg) {
			console.error('[room] unexpected server message', data);
			return;
		}
		switch (msg.type) {
			case 'welcome':
				this.room = msg.room;
				this.playerId = msg.playerId;
				this.status = 'connected';
				this.error = null;
				this.attempt = 0;
				saveSession(msg.room.id, msg.sessionToken);
				// Any later reconnect must resume this seat rather than create or join again.
				this.intent = { type: 'resume', roomId: msg.room.id, sessionToken: msg.sessionToken };
				for (const w of this.welcomeWaiters.splice(0)) w.resolve();
				return;
			case 'error':
				console.warn(`[room] server error ${msg.code}: ${msg.message}`);
				if (this.status === 'connected') {
					this.reportActionError(msg.code, msg.message);
					return;
				}
				this.error = { code: msg.code, message: msg.message };
				if (FATAL.has(msg.code)) {
					if (msg.code === 'session_not_found' && this.intent.type === 'resume') {
						saveSession(this.intent.roomId, null);
					}
					this.fail(this.error);
				}
				return;
			default:
				if (this.room) applyRoomUpdate(this.room, msg);
		}
	}

	private onClose(ws: WebSocket, code: number): void {
		if (ws !== this.ws || this.disposed) return;
		this.ws = null;
		if (code === CLOSE_SESSION_REPLACED) {
			this.fail({ code: 'replaced', message: 'This seat was opened in another tab or window.' });
			return;
		}
		// Keep the last snapshot on screen; the welcome on resume replaces it.
		this.status = this.room ? 'reconnecting' : 'connecting';
		if (!this.room && this.attempt >= 2) {
			this.error = { code: 'unreachable', message: 'Cannot reach the game server. Retrying…' };
		}
		const delay = Math.min(500 * 2 ** this.attempt, MAX_BACKOFF_MS);
		this.attempt++;
		this.retryTimer = setTimeout(() => this.open(), delay);
	}

	private reportActionError(code: ActionError['code'], message: string): void {
		this.actionError = { code, message, seq: ++this.errorSeq };
	}

	private fail(error: ConnectionError): void {
		this.error = error;
		this.close(error);
	}
}

/**
 * The connection that created or joined a room is handed to the room page
 * across navigation, so entering a room never costs a second handshake.
 */
let handoff: RoomConnection | null = null;

export function handOff(conn: RoomConnection): void {
	handoff = conn;
}

export function takeHandoff(roomId: string): RoomConnection | null {
	const conn = handoff?.room?.id === roomId && handoff.status !== 'closed' ? handoff : null;
	handoff = null;
	return conn;
}
