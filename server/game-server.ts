// WebSocket transport around RoomManager: parses and validates client frames,
// applies them to authoritative state, and fans the results out to the room.

import { WebSocketServer, type WebSocket } from 'ws';
import {
	parseClientMessage,
	type ClientMessage,
	type ErrorCode,
	type ServerMessage
} from '../src/lib/game/protocol';
import type { ChatMessage } from '../src/lib/game/chat';
import type { DieRoller } from '../src/lib/game/dice';
import { gridDistance } from '../src/lib/game/grid';
import { heardOnly, type Motion } from '../src/lib/game/motion';
import { postChat, postRoll, postSystem, secureRoller } from './chat';
import { canEditScene } from '../src/lib/game/permissions';
import {
	blankScene,
	normalizeSceneName,
	parseSceneFile,
	sharedScene,
	SCENE_FILE_MAX_BYTES
} from '../src/lib/game/scene-file';
import * as adventure from './adventure/engine';
import { loadCustomAdventure } from './adventure/custom';
import { readAdventure } from './adventure/persist';
import { trackInUse } from './adventure/registry';
import { RateLimiter } from './rate-limit';
import { applyScene, exportScene, reclaim } from './scene-io';
import { restoreRoom, serializeRoom, type RoomStore } from './room-store';
import { keyOwner, newGmKey } from './gm-keys';
import { newSceneId } from './scene-store';
import { storySummary } from './adventure/view';
import { MemorySceneStore, type SceneStore } from './scene-store';
import { fail, RoomManager, toPublicPlayer, type Player, type Room } from './rooms';
import {
	createObject,
	createToken,
	deleteObject,
	deleteToken,
	moveToken,
	toggleDoor,
	createLight,
	createProp,
	deleteLight,
	deleteProp,
	fogArea,
	fogRoom,
	setAmbient,
	setEnvironment,
	setFog,
	setFogShared,
	setDarkness,
	setFloor,
	setTerrain,
	updateLight,
	updateProp,
	updateToken
} from './scene';
import {
	canSeeLogEntry,
	diffView,
	sentFrom,
	snapshotFor,
	viewFor,
	viewsFor,
	type SentView
} from './views';

export interface GameServerOptions {
	port: number;
	host?: string;
	/** How long a room survives with nobody connected. */
	emptyRoomTtlMs?: number;
	heartbeatMs?: number;
	/** Die roller for dice_roll; defaults to crypto randomness. Tests inject a fixed one. */
	rollDie?: DieRoller;
	/** Where saved scenes go. Defaults to memory (lost on exit); server/index.ts passes a file store. */
	sceneStore?: SceneStore;
	/** Pause before enemies act in an adventure fight, so players can follow the dice. */
	enemyTurnDelayMs?: number;
	/** Multiplies the pauses between a mechanism's steps (tests pass 0 to run them at once). */
	mechanismDelayScale?: number;
	/** How often sentries outside a fight take a step on their rounds; 0 turns patrols off. */
	patrolMs?: number;
	/**
	 * Where live rooms are kept so a restart doesn't end a game (see room-store.ts).
	 * Rooms in it are restored at startup; without one, rooms live only in memory.
	 */
	roomStore?: RoomStore;
	/** How long after a change a room is saved to the room store (changes in between go together). */
	roomSaveMs?: number;
	/** How long a fight waits for a character whose player is away before their turn passes. */
	awayTurnMs?: number;
	/** How long after a change a story in play is autosaved to its GM's saves. */
	autosaveMs?: number;
}

export interface GameServer {
	port: number;
	rooms: RoomManager;
	close(): Promise<void>;
}

/** Close code sent to a socket whose session was taken over by a newer connection. */
export const CLOSE_SESSION_REPLACED = 4001;

// Large enough for an uploaded scene file plus framing; everything else is far smaller.
const MAX_PAYLOAD_BYTES = SCENE_FILE_MAX_BYTES + 64 * 1024;
/** While the game is paused, players can't do these (chat, dice and picking characters still work). */
const PAUSED_ACTIONS = new Set<ClientMessage['type']>([
	'token_move',
	'door_toggle',
	'adventure_interact',
	'adventure_act',
	'adventure_end_turn',
	'adventure_decide',
	'adventure_sense',
	'adventure_share'
]);
/** How often a paused mechanism looks again whether the game has carried on. */
const PAUSED_RETRY_MS = 250;
const ROLE_NAMES = { gm: 'GM', player: 'a player', spectator: 'a spectator' } as const;

interface Seat {
	roomId: string;
	playerId: string;
}

/** Starts the game server, first bringing back the live rooms in `options.roomStore`, if any. */
export async function startGameServer(options: GameServerOptions): Promise<GameServer> {
	const restored: Room[] = [];
	for (const raw of options.roomStore ? await options.roomStore.loadAll() : []) {
		const result = restoreRoom(raw);
		if (result.ok) restored.push(result.room);
		else console.warn(`[rooms] skipped a stored room: ${result.error}`);
	}
	return serve(options, restored);
}

function serve(options: GameServerOptions, restored: Room[]): Promise<GameServer> {
	const {
		emptyRoomTtlMs = 10 * 60_000,
		heartbeatMs = 30_000,
		rollDie = secureRoller,
		enemyTurnDelayMs = 2500,
		mechanismDelayScale = 1,
		patrolMs = 1500,
		roomSaveMs = 1000,
		awayTurnMs = 20_000,
		autosaveMs = 30_000
	} = options;
	const rooms = new RoomManager();
	const roomStore = options.roomStore ?? null;
	// Chat and dice: bursts of 8, then one every 750 ms per player.
	const chatLimiter = new RateLimiter(8, 4 / 3);
	// Saving, loading, importing and exporting touch storage or whole-room state: a few at a time.
	const sceneLimiter = new RateLimiter(4, 0.25);
	// Creators' adventures a table is playing are kept while it plays them.
	trackInUse(() => new Set([...rooms.all()].flatMap((r) => (r.adventure ? [r.adventure.id] : []))));
	const sceneStore = options.sceneStore ?? new MemorySceneStore();
	/** roomId -> playerId -> the socket currently holding that seat. */
	const sockets = new Map<string, Map<string, WebSocket>>();
	const seats = new WeakMap<WebSocket, Seat>();
	const alive = new WeakSet<WebSocket>();
	/** What each socket was last sent of the (fog-filtered) scene, to diff against. */
	const sentViews = new WeakMap<WebSocket, SentView>();
	/** Scheduled enemy turns, cleared on shutdown. */
	const timers = new Set<ReturnType<typeof setTimeout>>();
	/** Rooms with a flash going, and when the sync that ends it is scheduled for. */
	const flashEnds = new Map<Room, number>();

	const wss = new WebSocketServer({
		port: options.port,
		host: options.host,
		maxPayload: MAX_PAYLOAD_BYTES
	});

	function send(ws: WebSocket, msg: ServerMessage): void {
		if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
	}

	function sendError(ws: WebSocket, code: ErrorCode, message: string): void {
		send(ws, { type: 'error', code, message });
	}

	function broadcast(roomId: string, msg: ServerMessage, exceptPlayerId?: string): void {
		const frame = JSON.stringify(msg);
		for (const [playerId, ws] of sockets.get(roomId) ?? []) {
			if (playerId !== exceptPlayerId && ws.readyState === ws.OPEN) ws.send(frame);
		}
	}

	function seat(ws: WebSocket, room: Room, player: Player, gmKey?: string): void {
		touch(room);
		let roomSockets = sockets.get(room.id);
		if (!roomSockets) sockets.set(room.id, (roomSockets = new Map()));
		const previous = roomSockets.get(player.id);
		roomSockets.set(player.id, ws);
		seats.set(ws, { roomId: room.id, playerId: player.id });
		if (previous && previous !== ws) {
			seats.delete(previous);
			previous.close(CLOSE_SESSION_REPLACED, 'Session opened elsewhere');
		}
		const view = viewFor(room, player);
		sentViews.set(ws, sentFrom(view));
		send(ws, {
			type: 'welcome',
			playerId: player.id,
			sessionToken: player.sessionToken,
			room: snapshotFor(room, player, view),
			...(gmKey ? { gmKey } : {})
		});
	}

	/**
	 * After any scene change: recompute every connected viewer's view and send
	 * each the difference from what they had. Hidden things never go out.
	 */
	function syncRoom(room: Room, movedBy?: string): void {
		touch(room);
		const roomSockets = sockets.get(room.id);
		if (!roomSockets) return;
		const viewers = [...roomSockets.keys()]
			.map((id) => room.players.get(id))
			.filter((p): p is Player => !!p);
		for (const [player, view] of viewsFor(room, viewers)) {
			const ws = roomSockets.get(player.id);
			const prev = ws && sentViews.get(ws);
			if (!ws || !prev) continue;
			for (const msg of diffView(prev, view, movedBy)) send(ws, msg);
			sentViews.set(ws, sentFrom(view));
		}
		// A flash lights the table for a moment: look again once it has faded.
		const until = room.flashUntil ?? 0;
		if (until > Date.now() && flashEnds.get(room) !== until) {
			flashEnds.set(room, until);
			const timer = setTimeout(
				() => {
					timers.delete(timer);
					if (flashEnds.get(room) === until) flashEnds.delete(room);
					syncRoom(room);
				},
				until - Date.now() + 20
			);
			timers.add(timer);
		}
	}

	function handle(ws: WebSocket, msg: ClientMessage): void {
		const s = seats.get(ws);
		const room = s && rooms.get(s.roomId);
		const player = s && room?.players.get(s.playerId);
		switch (msg.type) {
			case 'create':
			case 'join':
			case 'resume':
				if (s) return sendError(ws, 'already_joined', 'This connection is already in a room.');
				return handleEntry(ws, msg);
			case 'scene_list':
				// Before joining a table (the landing page), a GM lists their saves by their key.
				if (!room || !player) {
					if (!msg.gmKey) return sendError(ws, 'not_joined', 'Join a room first.');
					void listSaves(ws, keyOwner(msg.gmKey), `key:${keyOwner(msg.gmKey)}`);
					return;
				}
				return handleInRoom(ws, room, player, msg);
			default:
				if (!room || !player) return sendError(ws, 'not_joined', 'Join a room first.');
				return handleInRoom(ws, room, player, msg);
		}
	}

	function handleEntry(
		ws: WebSocket,
		msg: Extract<ClientMessage, { type: 'create' | 'join' | 'resume' }>
	): void {
		switch (msg.type) {
			case 'create':
				void create(ws, msg);
				return;
			case 'join': {
				const result = rooms.join(msg.roomId, msg.name, msg.role);
				if (!result.ok) return sendError(ws, result.code, result.message);
				const { room, player } = result;
				// Back at a continued table under their old name: their character is theirs again.
				const back = reclaim(room, player);
				// Joining a story under way: they catch up on the ground the party has explored.
				if (room.adventure && room.adventure.stage !== 'choosing' && player.role === 'player') {
					for (const other of room.players.values()) {
						if (other.role !== 'player' || other === player) continue;
						for (let i = 0; i < player.explored.length; i++) {
							if (other.explored[i]) player.explored[i] = 1;
						}
					}
				}
				// Logged before seating so the joiner's snapshot already contains it.
				const notice = postSystem(room, `${player.name} joined as ${ROLE_NAMES[player.role]}.`);
				seat(ws, room, player);
				if (back.length) syncRoom(room);
				broadcast(room.id, { type: 'player_joined', player: toPublicPlayer(player) }, player.id);
				broadcast(room.id, { type: 'chat', message: notice }, player.id);
				return;
			}
			case 'resume': {
				const result = rooms.resume(msg.roomId, msg.sessionToken);
				if (!result.ok) return sendError(ws, result.code, result.message);
				seat(ws, result.room, result.player);
				broadcast(
					result.room.id,
					{ type: 'player_presence', playerId: result.player.id, connected: true },
					result.player.id
				);
				if (result.player.role === 'gm') gmBack(result.room);
				return;
			}
		}
	}

	// -------------------------------------------------------------------
	// Keeping live rooms (see room-store.ts): a changed room is saved a moment later.

	const dirty = new Set<Room>();
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	function touch(room: Room): void {
		scheduleAutosave(room);
		if (!roomStore) return;
		dirty.add(room);
		saveTimer ??= setTimeout(() => void saveDirty(), roomSaveMs);
	}

	async function saveDirty(): Promise<void> {
		saveTimer = null;
		const pending = [...dirty];
		dirty.clear();
		for (const room of pending) {
			if (rooms.get(room.id) !== room) continue;
			try {
				await roomStore?.save(serializeRoom(room));
			} catch (err) {
				console.error(`[room ${room.id}] could not be kept`, err);
				touch(room);
			}
		}
	}

	// -------------------------------------------------------------------
	// People coming and going

	/** The GM's connection dropped mid-story: the game waits for them. */
	function gmAway(room: Room): void {
		if (room.adventure?.stage !== 'playing' || room.paused) return;
		room.paused = true;
		room.pausedForGm = true;
		syncRoom(room);
		announce(room, postSystem(room, 'The GM lost their connection. The game waits for them.'));
	}

	/** The GM is back: a pause the GM's absence caused is lifted. */
	function gmBack(room: Room): void {
		if (!room.pausedForGm) return;
		room.paused = false;
		room.pausedForGm = false;
		syncRoom(room);
		announce(room, postSystem(room, 'The GM is back.'));
		resumeTimers(room);
	}

	/** Enemy turns and away turns that waited (for a pause, or a restart) go on. */
	function resumeTimers(room: Room): void {
		const story = room.adventure;
		if (!story) return;
		const enemyTurn = adventure.pendingEnemyTurn(story);
		if (enemyTurn !== null) scheduleEnemyTurn(room, enemyTurn);
		watchAwayTurn(room);
	}

	/** Whether a player has a socket at the table now. */
	const isHere = (room: Room, playerId: string) => !!sockets.get(room.id)?.has(playerId);

	/** A fight waits a while for a character whose player is away, then their turn passes. */
	function watchAwayTurn(room: Room): void {
		const turn = adventure.awayTurn(room, (id) => isHere(room, id));
		if (turn === null) return;
		const timer = setTimeout(() => {
			timers.delete(timer);
			if (rooms.get(room.id) !== room || room.paused) return;
			if (adventure.awayTurn(room, (id) => isHere(room, id)) !== turn) return;
			const outcome = adventure.passAwayTurn(room, turn);
			if (outcome) applyOutcome(room, outcome);
		}, awayTurnMs);
		timers.add(timer);
	}

	/**
	 * Opens a table for a GM: under their lasting key (a new one if they have
	 * none), and on one of their saves if they are continuing a story.
	 */
	async function create(ws: WebSocket, msg: Extract<ClientMessage, { type: 'create' }>) {
		const key = msg.gmKey ?? newGmKey();
		const owner = keyOwner(key);
		let saved: unknown = null;
		let auto = false;
		let shared = false;
		if (msg.continueFrom) {
			try {
				// A GM continues their own saves, and opens shared tables (which belong to nobody).
				const savedBy = await sceneStore.ownerOf(msg.continueFrom);
				if (savedBy === undefined || (savedBy !== null && savedBy !== owner)) {
					return sendError(ws, 'scene_not_found', 'That save is not one of yours.');
				}
				shared = savedBy === null;
				saved = await sceneStore.load(msg.continueFrom);
				auto = (await sceneStore.list(owner)).some((x) => x.id === msg.continueFrom && x.auto);
			} catch (err) {
				console.error('[game-server] continue failed', err);
				return sendError(ws, 'persistence_failed', 'That save could not be opened. Try again.');
			}
			if (saved === null) return sendError(ws, 'scene_not_found', 'That save no longer exists.');
		}
		// The socket may have gone, or been seated, while storage was busy.
		if (ws.readyState !== ws.OPEN || seats.has(ws)) return;
		const result = rooms.create(msg.name);
		if (!result.ok) return sendError(ws, result.code, result.message);
		const { room, player } = result;
		// The story's own rolls (initiative) use the server's dice too.
		room.dice = rollDie;
		room.gmOwner = owner;
		postSystem(room, `${player.name} opened the table as GM.`);
		if (saved !== null) {
			try {
				loadIntoRoom(room, player, saved, shared ? 'opened' : 'continued');
			} catch (err) {
				rooms.remove(room.id);
				if (err instanceof SceneError) return sendError(ws, err.code, err.message);
				throw err;
			}
			// Continuing from the table's own save keeps saving into it.
			if (auto) room.autosaveId = msg.continueFrom;
		}
		seat(ws, room, player, key);
		console.info(`[room ${room.id}] created by ${player.name}`);
	}

	/** Sends a GM their saves, newest first. */
	async function listSaves(ws: WebSocket, owner: string, limitKey: string): Promise<void> {
		if (!sceneLimiter.take(limitKey)) {
			return sendError(ws, 'rate_limited', 'Give it a moment before asking again.');
		}
		try {
			send(ws, { type: 'scene_list', scenes: await sceneStore.list(owner) });
		} catch (err) {
			console.error('[game-server] listing saves failed', err);
			sendError(ws, 'persistence_failed', 'Your saves could not be listed. Try again.');
		}
	}

	// -------------------------------------------------------------------
	// Autosave: a story in play is kept among its GM's saves as it goes on.

	const autosaves = new Map<Room, ReturnType<typeof setTimeout>>();

	function scheduleAutosave(room: Room): void {
		if (!room.gmOwner || !room.adventure || room.adventure.stage === 'choosing') return;
		if (autosaves.has(room)) return;
		const timer = setTimeout(() => {
			autosaves.delete(room);
			void autosave(room);
		}, autosaveMs);
		autosaves.set(room, timer);
	}

	async function autosave(room: Room): Promise<void> {
		if (!room.gmOwner || !room.adventure || rooms.get(room.id) !== room) return;
		room.autosaveId ??= newSceneId();
		try {
			const file = exportScene(room, room.sceneName);
			await sceneStore.save(
				file,
				{ owner: room.gmOwner, auto: true, story: storySummary(room) },
				room.autosaveId
			);
		} catch (err) {
			console.error(`[room ${room.id}] autosave failed`, err);
		}
	}

	function announce(room: Room, message: ChatMessage): void {
		touch(room);
		const frame = JSON.stringify({ type: 'chat', message } satisfies ServerMessage);
		for (const [playerId, ws] of sockets.get(room.id) ?? []) {
			const viewer = room.players.get(playerId);
			if (viewer && canSeeLogEntry(viewer, message) && ws.readyState === ws.OPEN) ws.send(frame);
		}
	}

	/** The whole table was replaced: give every viewer a fresh snapshot and restart their diffs. */
	function resetRoom(room: Room): void {
		touch(room);
		const roomSockets = sockets.get(room.id);
		if (!roomSockets) return;
		const viewers = [...roomSockets.keys()]
			.map((id) => room.players.get(id))
			.filter((p): p is Player => !!p);
		for (const [player, view] of viewsFor(room, viewers)) {
			const ws = roomSockets.get(player.id);
			if (!ws) continue;
			sentViews.set(ws, sentFrom(view));
			send(ws, { type: 'room_reset', room: snapshotFor(room, player, view) });
		}
	}

	function loadIntoRoom(room: Room, player: Player, data: unknown, verb: string): void {
		const parsed = parseSceneFile(data);
		if (!parsed.ok) throw new SceneError('invalid_scene', parsed.error);
		// A story saved with the table comes back with it, checked before anything changes.
		const saved = parsed.scene.adventure;
		const story = saved ? readAdventure(saved, parsed.scene) : null;
		if (story && !story.ok) throw new SceneError('invalid_scene', story.error);
		applyScene(room, parsed.scene);
		const ended = room.adventure !== null && !story;
		room.adventure = story ? story.adventure : null;
		resetRoom(room);
		announce(room, postSystem(room, `${player.name} ${verb} the scene “${parsed.scene.name}”.`));
		// A different table without a story ends the one that was being played on this one.
		if (ended) announce(room, postSystem(room, 'The adventure ended with the old table.'));
		const resumed = room.adventure;
		if (!resumed) return;
		announce(room, postSystem(room, adventure.resumeNotice(resumed)));
		// A save made on an enemy's turn picks up with it.
		const enemyTurn = adventure.pendingEnemyTurn(resumed);
		if (enemyTurn !== null) scheduleEnemyTurn(room, enemyTurn);
		// So does a mechanism that was playing out.
		for (const next of adventure.pendingMechanisms(resumed)) scheduleMechanism(room, next);
	}

	/** Relays what an adventure action did: new views (or a fresh table), its log, and the enemies' turn. */
	function applyOutcome(room: Room, outcome: adventure.Outcome, movedBy?: string): void {
		if (outcome.reset) resetRoom(room);
		else syncRoom(room, movedBy);
		for (const message of outcome.log) announce(room, message);
		if (outcome.motions) showMotions(room, outcome.motions);
		if (outcome.enemyTurn !== undefined) scheduleEnemyTurn(room, outcome.enemyTurn);
		for (const next of outcome.mechanisms ?? []) scheduleMechanism(room, next);
		watchAwayTurn(room);
	}

	/**
	 * Motions go to the viewers who can see the prop that moves (so its id
	 * never reaches anyone else); the rest only hear it, if it makes a sound.
	 */
	function showMotions(room: Room, motions: readonly Motion[]): void {
		for (const [playerId, ws] of sockets.get(room.id) ?? []) {
			const sent = sentViews.get(ws);
			if (!room.players.has(playerId) || !sent) continue;
			const seen = motions.flatMap((m) =>
				m.propId === null || sent.props.has(m.propId) ? [m] : (heardOnly(m) ?? [])
			);
			if (seen.length) send(ws, { type: 'motion', motions: seen });
		}
	}

	/** Runs a mechanism's next step after its pause (see `MechanismDef` in server/adventure/define.ts). */
	function scheduleMechanism(
		room: Room,
		next: { id: string; step: number; delay: number },
		wait = next.delay * mechanismDelayScale
	): void {
		const timer = setTimeout(() => {
			timers.delete(timer);
			if (rooms.get(room.id) !== room) return;
			// Paused: the mechanism holds where it is, and tries again after the same pause.
			if (room.paused) return scheduleMechanism(room, next, PAUSED_RETRY_MS);
			try {
				const outcome = adventure.runMechanism(room, next.id, next.step);
				if (outcome) applyOutcome(room, outcome);
			} catch (err) {
				console.error(`[room ${room.id}] mechanism failed`, err);
			}
		}, wait);
		timers.add(timer);
	}

	function scheduleEnemyTurn(room: Room, turn: number): void {
		const timer = setTimeout(() => {
			timers.delete(timer);
			if (rooms.get(room.id) !== room) return;
			// Paused: the turn waits, and is scheduled again when the game carries on.
			if (room.paused) return;
			try {
				const outcome = adventure.runEnemyTurn(room, turn, rollDie);
				if (outcome) applyOutcome(room, outcome);
			} catch (err) {
				console.error(`[room ${room.id}] enemy turn failed`, err);
			}
		}, enemyTurnDelayMs);
		timers.add(timer);
	}

	function handleAdventure(
		ws: WebSocket,
		room: Room,
		player: Player,
		msg: Extract<ClientMessage, { type: `adventure_${string}` }>
	): void {
		// Talking, narration and picking characters add to the log, so they share the chat rate limit.
		const chatty =
			msg.type === 'adventure_interact' ||
			msg.type === 'adventure_decide' ||
			msg.type === 'adventure_sense' ||
			msg.type === 'adventure_share' ||
			msg.type === 'adventure_narrate' ||
			msg.type === 'adventure_cue' ||
			msg.type === 'adventure_claim' ||
			msg.type === 'adventure_release';
		if (chatty && !chatLimiter.take(player.id)) {
			return sendError(ws, 'rate_limited', 'Slow down a little.');
		}
		const result = (() => {
			switch (msg.type) {
				case 'adventure_start': {
					if (msg.file === undefined) return adventure.startAdventure(room, player);
					if (player.role !== 'gm') return fail('forbidden', 'Only the GM can do that.');
					if (!sceneLimiter.take(player.id)) {
						return fail('rate_limited', 'Give it a moment before trying again.');
					}
					// A creator's adventure: checked in full, then played like any other.
					const custom = loadCustomAdventure(msg.file);
					if (!custom.ok) return fail('invalid_message', custom.error);
					return adventure.startAdventure(room, player, custom.adventure.id);
				}
				case 'adventure_claim':
					return adventure.claimCharacter(room, player, msg.characterId);
				case 'adventure_release':
					return adventure.releaseCharacter(room, player);
				case 'adventure_begin':
					return adventure.beginAdventure(room, player);
				case 'adventure_interact':
					return adventure.interact(room, player, msg.targetId, msg.verb, rollDie);
				case 'adventure_sense':
					return adventure.sense(room, player, msg.sense, rollDie);
				case 'adventure_share':
					return adventure.share(room, player, msg.clueId);
				case 'adventure_object':
					return adventure.setObject(room, player, msg.objectId, msg.state);
				case 'adventure_act':
					return adventure.act(room, player, msg.actionId, msg.targetId, rollDie);
				case 'adventure_end_turn':
					return adventure.endTurn(room, player);
				case 'adventure_narrate':
					return adventure.narrate(room, player, msg.text);
				case 'adventure_cue':
					return adventure.readCue(room, player, msg.cueId);
				case 'adventure_decide':
					return adventure.decide(room, player, msg.decisionId, msg.optionId);
				case 'adventure_control':
					return adventure.control(room, player, msg.op);
				case 'adventure_again':
					return adventure.askAgain(room, player);
				case 'adventure_direct':
					return adventure.direct(room, player, msg.direction);
				case 'adventure_override':
					return adventure.override(room, player, msg.characterId, msg.patch);
			}
		})();
		if (!result.ok) return sendError(ws, result.code, result.message);
		applyOutcome(room, result);
	}

	/** Save/load/import/export. Storage is async, so errors come back as messages, never throws. */
	async function handleScene(
		ws: WebSocket,
		room: Room,
		player: Player,
		msg: Extract<ClientMessage, { type: `scene_${string}` }>
	): Promise<void> {
		if (!canEditScene(player)) return sendError(ws, 'forbidden', 'Only the GM manages scenes.');
		if (!sceneLimiter.take(player.id)) {
			return sendError(ws, 'rate_limited', 'Give it a moment before the next save or load.');
		}
		try {
			switch (msg.type) {
				case 'scene_save':
				case 'scene_export': {
					const name = normalizeSceneName(msg.name);
					if (!name) return sendError(ws, 'invalid_name', 'Scene names are 1-48 characters.');
					const file = exportScene(room, name);
					if (JSON.stringify(file).length > SCENE_FILE_MAX_BYTES) {
						return sendError(ws, 'invalid_scene', 'This scene is too large to save.');
					}
					if (msg.type === 'scene_export') return send(ws, { type: 'scene_exported', file });
					const sceneId = await sceneStore.save(file, {
						owner: room.gmOwner ?? null,
						story: storySummary(room)
					});
					room.sceneName = name;
					send(ws, { type: 'scene_saved', sceneId, name, savedAt: file.savedAt });
					return announce(room, postSystem(room, `${player.name} saved the scene “${name}”.`));
				}
				case 'scene_load': {
					// A GM loads their own saves (and saves from before GM keys, by their id).
					const owner = await sceneStore.ownerOf(msg.sceneId);
					if (owner === undefined || (owner !== null && owner !== room.gmOwner)) {
						return sendError(ws, 'scene_not_found', 'That saved scene no longer exists.');
					}
					const data = await sceneStore.load(msg.sceneId);
					if (data === null) {
						return sendError(ws, 'scene_not_found', 'That saved scene no longer exists.');
					}
					// The room may have closed while storage was busy.
					if (rooms.get(room.id) !== room) return;
					return loadIntoRoom(room, player, data, 'loaded');
				}
				case 'scene_import':
					return loadIntoRoom(room, player, msg.file, 'imported');
				case 'scene_list':
					if (!room.gmOwner) return send(ws, { type: 'scene_list', scenes: [] });
					return send(ws, { type: 'scene_list', scenes: await sceneStore.list(room.gmOwner) });
				case 'scene_new': {
					const name = normalizeSceneName(msg.name);
					if (!name) return sendError(ws, 'invalid_name', 'Scene names are 1-48 characters.');
					return loadIntoRoom(
						room,
						player,
						blankScene(name, msg.width, msg.height, msg.environment),
						'created'
					);
				}
				case 'scene_share': {
					const name = normalizeSceneName(msg.name);
					if (!name) return sendError(ws, 'invalid_name', 'Scene names are 1-48 characters.');
					const file = sharedScene(exportScene(room, name));
					if (JSON.stringify(file).length > SCENE_FILE_MAX_BYTES) {
						return sendError(ws, 'invalid_scene', 'This scene is too large to share.');
					}
					// Shared tables belong to nobody: anyone with the code opens a copy of their own.
					const code = await sceneStore.save(file, { owner: null });
					send(ws, { type: 'scene_shared', code, name });
					return announce(
						room,
						postSystem(room, `${player.name} shared the table “${name}”.`, 'gm')
					);
				}
				case 'scene_delete':
					if (!room.gmOwner || !(await sceneStore.remove(msg.sceneId, room.gmOwner))) {
						return sendError(ws, 'scene_not_found', 'That save is not one of yours.');
					}
					if (room.autosaveId === msg.sceneId) room.autosaveId = undefined;
					return send(ws, { type: 'scene_list', scenes: await sceneStore.list(room.gmOwner) });
			}
		} catch (err) {
			if (err instanceof SceneError) return sendError(ws, err.code, err.message);
			console.error(`[room ${room.id}] ${msg.type} failed`, err);
			sendError(
				ws,
				'persistence_failed',
				msg.type === 'scene_save'
					? 'The scene could not be saved. Try again.'
					: 'The scene could not be loaded. Try again.'
			);
		}
	}

	/** Notices naming a GM-only token stay with the GM: it may be hidden from the players. */
	function tokenNotice(room: Room, text: string, ownerId: string | null): void {
		announce(room, postSystem(room, text, ownerId ? undefined : 'gm'));
	}

	function tokenName(room: Room, name: string, ownerId: string | null): string {
		const owner = ownerId && room.players.get(ownerId);
		return owner ? `${name} (${owner.name})` : name;
	}

	/** In-room actions: the scene and chat modules decide; this only relays the outcome. */
	function handleInRoom(
		ws: WebSocket,
		room: Room,
		player: Player,
		msg: Exclude<ClientMessage, { type: 'create' | 'join' | 'resume' }>
	): void {
		if (room.paused && player.role !== 'gm' && PAUSED_ACTIONS.has(msg.type)) {
			return sendError(
				ws,
				'paused',
				room.pausedForGm ? 'The game waits for the GM to reconnect.' : 'The GM has paused the game.'
			);
		}
		switch (msg.type) {
			case 'pause_set': {
				if (!canEditScene(player)) return sendError(ws, 'forbidden', 'Only the GM can pause.');
				if (room.paused === msg.paused) return;
				room.paused = msg.paused;
				syncRoom(room);
				announce(
					room,
					postSystem(
						room,
						msg.paused
							? `${player.name} paused the game.`
							: `${player.name} carried on with the game.`
					)
				);
				// The enemy whose turn was waiting takes it now.
				const waiting = !msg.paused && room.adventure && adventure.pendingEnemyTurn(room.adventure);
				if (typeof waiting === 'number') scheduleEnemyTurn(room, waiting);
				return;
			}
			case 'token_create': {
				const result = createToken(room, player, msg);
				if (!result.ok) return sendError(ws, result.code, result.message);
				const { token } = result;
				syncRoom(room);
				return tokenNotice(
					room,
					`${player.name} placed ${tokenName(room, token.name, token.ownerId)}.`,
					token.ownerId
				);
			}
			case 'token_move': {
				const allowed = adventure.checkMove(room, player, msg.tokenId, msg.to);
				if (!allowed.ok) return sendError(ws, allowed.code, allowed.message);
				const result = moveToken(room, player, msg.tokenId, msg.to);
				if (!result.ok) return sendError(ws, result.code, result.message);
				const { token, from } = result;
				const cells = gridDistance(from, token.pos);
				// The notice goes first: the log is announced in order, and clients drop
				// entries older than one they already have.
				tokenNotice(
					room,
					`${player.name} moved ${token.name} ${cells} ${cells === 1 ? 'cell' : 'cells'}.`,
					token.ownerId
				);
				// Walking somewhere can move the story on, even to another table.
				return applyOutcome(room, adventure.afterMove(room, token, allowed.cost), player.id);
			}
			case 'token_update': {
				const result = updateToken(room, player, msg.tokenId, msg.patch);
				if (!result.ok) return sendError(ws, result.code, result.message);
				const { token, previousOwnerId } = result;
				syncRoom(room);
				if (token.ownerId !== previousOwnerId) {
					const owner = token.ownerId && room.players.get(token.ownerId);
					announce(
						room,
						postSystem(
							room,
							owner
								? `${player.name} gave ${token.name} to ${owner.name}.`
								: `${player.name} took back ${token.name}.`
						)
					);
				}
				return;
			}
			case 'token_delete': {
				const result = deleteToken(room, player, msg.tokenId);
				if (!result.ok) return sendError(ws, result.code, result.message);
				// Notice first, so the story it may set off is announced after it, in log order.
				tokenNotice(room, `${player.name} removed ${result.token.name}.`, result.token.ownerId);
				return applyOutcome(room, adventure.afterTokenDeleted(room, msg.tokenId, result.token.pos));
			}
			case 'object_create': {
				const result = createObject(room, player, msg.kind, msg.a, msg.b);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return syncRoom(room);
			}
			case 'object_delete': {
				const result = deleteObject(room, player, msg.objectId);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return syncRoom(room);
			}
			case 'door_toggle': {
				const door = room.objects.get(msg.objectId);
				const locked = door?.kind === 'door' && adventure.doorLock(room, player, door);
				if (locked) return sendError(ws, 'forbidden', locked);
				const result = toggleDoor(room, player, msg.objectId);
				if (!result.ok) return sendError(ws, result.code, result.message);
				adventure.afterDoorToggle(room, result.door);
				syncRoom(room);
				return announce(
					room,
					postSystem(room, `${player.name} ${result.door.open ? 'opened' : 'closed'} a door.`)
				);
			}
			case 'fog_set': {
				const result = setFog(room, player, msg.enabled);
				if (!result.ok) return sendError(ws, result.code, result.message);
				if (!result.changed) return;
				syncRoom(room);
				return announce(
					room,
					postSystem(room, `${player.name} turned fog of war ${msg.enabled ? 'on' : 'off'}.`)
				);
			}
			case 'darkness_set': {
				const result = setDarkness(room, player, msg.from, msg.to, msg.dark);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return syncRoom(room);
			}
			case 'terrain_set': {
				const result = setTerrain(room, player, msg.from, msg.to, msg.level);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return syncRoom(room);
			}
			case 'floor_set': {
				const result = setFloor(room, player, msg.from, msg.to, msg.floor);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return syncRoom(room);
			}
			case 'fog_area': {
				const result = fogArea(room, player, msg.from, msg.to, msg.reveal);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return syncRoom(room);
			}
			case 'fog_room': {
				const result = fogRoom(room, player, msg.cell, msg.reveal);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return syncRoom(room);
			}
			case 'fog_share': {
				const result = setFogShared(room, player, msg.shared);
				if (!result.ok) return sendError(ws, result.code, result.message);
				if (!result.changed) return;
				syncRoom(room);
				announce(
					room,
					postSystem(
						room,
						msg.shared
							? `${player.name} let the party share what it sees.`
							: `${player.name} made each player see only through their own tokens.`
					)
				);
				return;
			}
			case 'prop_create': {
				const result = createProp(room, player, msg);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return syncRoom(room);
			}
			case 'prop_update': {
				const result = updateProp(room, player, msg.propId, msg.patch);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return syncRoom(room);
			}
			case 'prop_delete': {
				const result = deleteProp(room, player, msg.propId);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return syncRoom(room);
			}
			case 'light_create': {
				const result = createLight(room, player, msg);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return syncRoom(room);
			}
			case 'light_update': {
				const result = updateLight(room, player, msg.lightId, msg.patch);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return syncRoom(room);
			}
			case 'light_delete': {
				const result = deleteLight(room, player, msg.lightId);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return syncRoom(room);
			}
			case 'environment_set': {
				const result = setEnvironment(room, player, msg.environment);
				if (!result.ok) return sendError(ws, result.code, result.message);
				if (result.changed) syncRoom(room);
				return;
			}
			case 'ambient_set': {
				const result = setAmbient(room, player, msg.ambient);
				if (!result.ok) return sendError(ws, result.code, result.message);
				if (!result.changed) return;
				syncRoom(room);
				const described = { day: 'daylight', dusk: 'dusk', dark: 'darkness' }[msg.ambient];
				return announce(
					room,
					postSystem(room, `${player.name} changed the lighting to ${described}.`)
				);
			}
			case 'scene_save':
			case 'scene_load':
			case 'scene_export':
			case 'scene_import':
			case 'scene_list':
			case 'scene_delete':
			case 'scene_new':
			case 'scene_share':
				void handleScene(ws, room, player, msg);
				return;
			case 'chat_send':
			case 'dice_roll': {
				if (!chatLimiter.take(player.id)) {
					return sendError(ws, 'rate_limited', 'Slow down a little before sending more.');
				}
				const result =
					msg.type === 'chat_send'
						? postChat(room, player, msg.text)
						: postRoll(room, player, msg.expression, rollDie, msg.secret === true);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return announce(room, result.message);
			}
			case 'adventure_start':
			case 'adventure_claim':
			case 'adventure_release':
			case 'adventure_begin':
			case 'adventure_interact':
			case 'adventure_act':
			case 'adventure_override':
			case 'adventure_object':
			case 'adventure_end_turn':
			case 'adventure_narrate':
			case 'adventure_cue':
			case 'adventure_decide':
			case 'adventure_sense':
			case 'adventure_share':
			case 'adventure_control':
			case 'adventure_again':
			case 'adventure_direct':
				return handleAdventure(ws, room, player, msg);
		}
	}

	function onClose(ws: WebSocket): void {
		const s = seats.get(ws);
		if (!s) return;
		seats.delete(ws);
		const roomSockets = sockets.get(s.roomId);
		// A replaced socket no longer owns the seat; its close must not mark the player offline.
		if (roomSockets?.get(s.playerId) !== ws) return;
		roomSockets.delete(s.playerId);
		if (roomSockets.size === 0) sockets.delete(s.roomId);
		const room = rooms.get(s.roomId);
		const player = room?.players.get(s.playerId);
		if (!room || !player) return;
		rooms.setConnected(room, player, false);
		touch(room);
		broadcast(room.id, { type: 'player_presence', playerId: player.id, connected: false });
		if (player.role === 'gm') gmAway(room);
		else watchAwayTurn(room);
	}

	wss.on('connection', (ws) => {
		alive.add(ws);
		ws.on('pong', () => alive.add(ws));
		ws.on('message', (data, isBinary) => {
			let parsed: unknown;
			try {
				parsed = isBinary ? undefined : JSON.parse(data.toString());
			} catch {
				parsed = undefined;
			}
			const msg = parseClientMessage(parsed);
			if (!msg) return sendError(ws, 'invalid_message', 'Malformed message.');
			try {
				handle(ws, msg);
			} catch (err) {
				console.error('[game-server] handler failed', err);
				sendError(ws, 'server_error', 'Something went wrong on the server.');
			}
		});
		ws.on('close', () => onClose(ws));
		ws.on('error', (err) => console.warn('[game-server] socket error', err.message));
	});

	// Rooms kept from before a restart: nobody is connected yet, so a story waits for its GM.
	for (const room of restored) {
		if (!rooms.adopt(room)) continue;
		room.dice = rollDie;
		if (room.adventure?.stage === 'playing' && !room.paused) {
			room.paused = true;
			room.pausedForGm = true;
		}
		for (const next of room.adventure ? adventure.pendingMechanisms(room.adventure) : []) {
			scheduleMechanism(room, next);
		}
		console.info(`[room ${room.id}] restored`);
	}

	// Outside fights, sentries walk their rounds and look about, a step at a time.
	const patrols =
		patrolMs > 0
			? setInterval(() => {
					for (const room of rooms.all()) {
						try {
							const outcome = adventure.patrol(room);
							if (outcome) applyOutcome(room, outcome);
						} catch (err) {
							console.error(`[room ${room.id}] patrol failed`, err);
						}
					}
				}, patrolMs)
			: null;

	const heartbeat = setInterval(() => {
		for (const ws of wss.clients) {
			if (!alive.has(ws)) {
				ws.terminate();
				continue;
			}
			alive.delete(ws);
			ws.ping();
		}
		// A table closing (nobody back for a while) keeps its story among its GM's saves.
		for (const room of rooms.all()) {
			if (room.emptySince !== null && Date.now() - room.emptySince >= emptyRoomTtlMs) {
				clearTimeout(autosaves.get(room));
				autosaves.delete(room);
				void autosave(room);
			}
		}
		for (const id of rooms.prune(emptyRoomTtlMs)) {
			console.info(`[room ${id}] closed (empty)`);
			roomStore?.remove(id).catch((err) => console.error(`[room ${id}] could not be removed`, err));
		}
	}, heartbeatMs);

	return new Promise((resolve, reject) => {
		wss.once('error', reject);
		wss.once('listening', () => {
			wss.off('error', reject);
			const address = wss.address();
			resolve({
				port: address && typeof address === 'object' ? address.port : options.port,
				rooms,
				close: async () => {
					clearInterval(heartbeat);
					if (patrols) clearInterval(patrols);
					for (const timer of timers) clearTimeout(timer);
					timers.clear();
					if (saveTimer) clearTimeout(saveTimer);
					// Stories in play are saved once more for their GMs.
					for (const [room, timer] of autosaves) {
						clearTimeout(timer);
						await autosave(room);
					}
					autosaves.clear();
					// Every room is kept as it stands, so a restart picks up where this left off.
					for (const room of rooms.all()) dirty.add(room);
					await saveDirty();
					for (const ws of wss.clients) ws.terminate();
					await new Promise<void>((done) => wss.close(() => done()));
				}
			});
		});
	});
}

class SceneError extends Error {
	constructor(
		readonly code: ErrorCode,
		message: string
	) {
		super(message);
	}
}
