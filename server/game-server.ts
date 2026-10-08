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
import { builtInAdventures, trackInUse } from './adventure/registry';
import { findRuleset, trackPacksInUse, type RulesetRef } from './rules/ruleset';
import { RateLimiter } from './rate-limit';
import { createHash } from 'node:crypto';
import { ADVENTURE_FILE_MAX_BYTES } from '../src/lib/adventure/file';
import { loadServerAdventure, previewOf } from './adventure/rules-content';
import {
	LIBRARY_LIMITS,
	normalizeCreatorName,
	normalizeQuery,
	type LibraryKind,
	type PublicGame
} from '../src/lib/game/library';
import { parseCollectionFile, type CollectionFile } from '../src/lib/game/collection';
import { COLLECTION_FILE_MAX_BYTES, CONTENT_PACK_MAX_BYTES } from '../src/lib/game/file-limits';
import { creatorIdOf, LibraryError, MemoryLibraryStore, type LibraryStore } from './library-store';
import {
	CAMPAIGN_RULES,
	campaignSummary,
	campaignView,
	changeRoster,
	closeStory,
	newCampaign,
	type CampaignStore
} from './campaigns';
import { MemoryCampaignStore } from './campaign-store';
import { MemoryLicenceStore, type LicenceStore } from './licensed/licence-store';
import {
	exportRefused,
	mayUse,
	openRefused,
	referenceRefused,
	savedLicences,
	type MayUse
} from './licensed/policy';
import { installedSource, installedSources, type InstalledSource } from './licensed/sources';
import type { LicensedSourceView } from '../src/lib/content/licence';
import { CAMPAIGN_LIMITS } from '../src/lib/game/campaign';
import { problemsOf, reportOf, resolveCollection, withRules, type Shelves } from './collections';
import { decide, entitlementOf, stillHolds, type Subject } from './library-access';
import {
	diagnostic,
	firstError,
	fromProblem,
	type Diagnostic
} from '../src/lib/validation/diagnostics';
import { saveCode, savedEntitlements, validateContent } from './validation';
import type { Entitlement } from '../src/lib/game/access';
import { prepareMove, type MoveTarget } from './adventure/upgrade';
import type { AdventureState } from './adventure/state';
import { applyScene, catchUpLights, exportScene, reclaim } from './scene-io';
import { restoreRoom, serializeRoom, type RoomStore } from './room-store';
import { keyOwner, newGmKey } from './gm-keys';
import { newSceneId } from './scene-store';
import { storySummary } from './adventure/view';
import { builtInStory, openingOf, storyFacts } from './adventure/facts';
import { MemorySceneStore, type SceneStore } from './scene-store';
import { fail, RoomManager, toPublicPlayer, type Player, type Room } from './rooms';
import type { Ambient } from '../src/lib/game/lights';
import { applyWorldPatch, DEFAULT_WORLD } from '../src/lib/game/world';
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
	setWorld,
	setFog,
	setFogShared,
	setDarkness,
	setInterior,
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
	/** The adventure library (see library-store.ts). Defaults to memory. */
	libraryStore?: LibraryStore;
	/** Campaigns (see campaigns.ts and campaign-store.ts). Defaults to memory. */
	campaignStore?: CampaignStore;
	/**
	 * Who may use which installed licensed source, and which are withdrawn
	 * (licensed/licence-store.ts). Defaults to memory. The sources themselves
	 * are installed with `installSources` (server/index.ts, from LICENSED_DIR).
	 */
	licenceStore?: LicenceStore;
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
	'adventure_share',
	'adventure_gear'
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
		if (!result.ok) {
			console.warn(`[rooms] skipped a stored room: ${result.error}`);
			continue;
		}
		restored.push(result.room);
		// A licensed source withdrawn under terms that stop its stories, or no longer granted to
		// this GM, sets the story aside (milestone 59); the table stays, and so do the GM's saves.
		const story = result.room.adventure;
		const licences = (story?.packs ?? []).flatMap((p) => (p.licence ? [p.licence] : []));
		if (story && licences.length) {
			const refused = await openRefused(
				options.licenceStore ?? new MemoryLicenceStore(),
				licences,
				result.room.gmOwner ? creatorIdOf(result.room.gmOwner) : null
			).catch(() => null);
			if (refused) {
				result.room.adventure = null;
				postSystem(result.room, `The story was set aside: ${refused.message}`, 'gm');
			}
		}
		// The campaign open at the table, read again (it is its GM's, or it stays closed).
		const campaignId = (raw as { campaignId?: unknown }).campaignId;
		if (options.campaignStore && typeof campaignId === 'string') {
			const record = await options.campaignStore.get(campaignId).catch(() => null);
			if (record && record.owner === result.room.gmOwner) result.room.campaign = record;
		}
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
	/** A character creator asks for its options and previews as the player chooses. */
	const creatorLimiter = new RateLimiter(20, 4);
	// The GM's look edits (the world, the roof, dark areas): bursts of 10, then two a second.
	const lookLimiter = new RateLimiter(10, 2);
	// Creators' adventures a table is playing are kept while it plays them.
	trackInUse(() => new Set([...rooms.all()].flatMap((r) => (r.adventure ? [r.adventure.id] : []))));
	trackPacksInUse(
		() => new Set([...rooms.all()].flatMap((r) => r.adventure?.packs?.map((p) => p.id) ?? []))
	);
	const sceneStore = options.sceneStore ?? new MemorySceneStore();
	const libraryStore = options.libraryStore ?? new MemoryLibraryStore();
	const campaignStore = options.campaignStore ?? new MemoryCampaignStore();
	const licenceStore = options.licenceStore ?? new MemoryLicenceStore();
	// Browsing the library and the open games: a few asks a second per connection.
	const browseLimiter = new RateLimiter(10, 2);
	// Publishing to the library: a handful, then one every 20 s per creator.
	const publishLimiter = new RateLimiter(5, 0.05);
	// Managing what is published (access, grants, removal) and listing one's own: a creator's
	// round of changes, then one a second.
	const manageLimiter = new RateLimiter(20, 1);
	/** Each connection's key for the browse limit (connections are not seated when browsing). */
	const connectionIds = new WeakMap<WebSocket, string>();
	let nextConnection = 0;
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

	function sendError(
		ws: WebSocket,
		code: ErrorCode,
		message: string,
		diagnostics?: readonly Diagnostic[]
	): void {
		send(ws, {
			type: 'error',
			code,
			message,
			...(diagnostics?.length ? { diagnostics: diagnostics.map((d) => ({ ...d })) } : {})
		});
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
			case 'library_list':
			case 'library_story':
			case 'library_mine':
			case 'library_publish':
			case 'library_manage':
			case 'library_grant':
			case 'library_revoke':
			case 'collection_check':
			case 'content_validate':
			case 'bestiary_search':
			case 'games_list':
				// The library and the open games: at a table or not.
				void handleLibrary(ws, msg);
				return;
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
						// And its lights as the party remembers them, not as they are now.
						catchUpLights(player, other);
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
			const refused = await withdrawn(saved, owner);
			if (refused) return sendError(ws, 'forbidden', refused.message, [refused]);
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
				if (err instanceof SceneError) return sendError(ws, err.code, err.message, err.diagnostics);
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

	/** One public notice when the rules band changed (ambient_set, world_set); none within a band. */
	function bandNotice(room: Room, player: Player, before: Ambient): void {
		if (room.ambient === before) return;
		const described = { day: 'daylight', dusk: 'dusk', dark: 'darkness' }[room.ambient];
		announce(room, postSystem(room, `${player.name} changed the lighting to ${described}.`));
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
		if (!parsed.ok)
			throw new SceneError('invalid_scene', parsed.error, [
				fromProblem(parsed.error, 'save.invalid')
			]);
		// A story saved with the table comes back with it, checked before anything changes.
		const saved = parsed.scene.adventure;
		const story = saved ? readAdventure(saved, parsed.scene) : null;
		if (story && !story.ok)
			throw new SceneError('invalid_scene', story.error, [
				diagnostic(saveCode(story.error), 'adventure', story.error)
			]);
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
		// A story played for a campaign opens it again, when the campaign is this GM's.
		if (resumed.campaign && resumed.campaign.id !== room.campaign?.id)
			void reopenCampaign(room, resumed.campaign.id);
		// What the load migrated and checked, for the GM.
		for (const note of story!.ok ? story!.notes : []) announce(room, postSystem(room, note, 'gm'));
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
		// The library is storage: these two answer when it has.
		if (msg.type === 'adventure_start' && msg.collectionId !== undefined) {
			void startFromCollection(ws, room, player, msg.collectionId, msg.version, msg.entry ?? 0);
			return;
		}
		if (msg.type === 'adventure_start' && msg.libraryId !== undefined) {
			void startFromLibrary(ws, room, player, msg.libraryId, msg.version);
			return;
		}
		if (msg.type === 'adventure_rate') {
			void rate(ws, room, player, msg.stars);
			return;
		}
		if (msg.type === 'adventure_upgrade') {
			void moveStory(ws, room, player, msg);
			return;
		}
		if (msg.type === 'adventure_pack' && msg.op === 'licensed') {
			void attachSource(ws, room, player, msg.source);
			return;
		}
		// Talking, narration and picking characters add to the log, so they share the chat rate limit.
		const chatty =
			msg.type === 'adventure_interact' ||
			msg.type === 'adventure_decide' ||
			msg.type === 'adventure_sense' ||
			msg.type === 'adventure_share' ||
			msg.type === 'adventure_narrate' ||
			msg.type === 'adventure_cue' ||
			msg.type === 'adventure_claim' ||
			msg.type === 'adventure_build' ||
			msg.type === 'adventure_sheet' ||
			msg.type === 'adventure_gear' ||
			msg.type === 'adventure_release';
		if (chatty && !chatLimiter.take(player.id)) {
			return sendError(ws, 'rate_limited', 'Give it a moment before the next change.');
		}
		const result = (() => {
			switch (msg.type) {
				case 'adventure_start': {
					if (msg.file === undefined) {
						// Only the server's own adventures start by id; a creator's comes as its file.
						const id = msg.adventureId;
						if (id !== undefined && !builtInAdventures().some((a) => a.id === id)) {
							return fail('invalid_message', 'There is no such adventure on this server.');
						}
						return adventure.startAdventure(room, player, id, room.campaign);
					}
					if (player.role !== 'gm') return fail('forbidden', 'Only the GM can do that.');
					if (!sceneLimiter.take(player.id)) {
						return fail('rate_limited', 'Give it a moment before trying again.');
					}
					// A creator's adventure: checked in full, then played like any other.
					const custom = loadCustomAdventure(msg.file);
					if (!custom.ok)
						return void sendError(ws, 'invalid_message', custom.error, custom.diagnostics);
					return adventure.startAdventure(room, player, custom.adventure.id, room.campaign);
				}
				case 'adventure_claim':
					return adventure.claimCharacter(room, player, msg.characterId);
				case 'adventure_pack':
					if (msg.op === 'detach') return adventure.detachPack(room, player, msg.id);
					if (player.role === 'gm' && !sceneLimiter.take(player.id))
						return fail('rate_limited', 'Give it a moment before trying again.');
					return adventure.attachPack(room, player, msg.pack);
				case 'adventure_build':
					return adventure.buildCharacter(room, player, msg.choices);
				case 'adventure_sheet':
					return adventure.editSheet(room, player, msg.characterId, msg.edit);
				case 'adventure_gear':
					return adventure.changeGear(room, player, msg.characterId, msg.change);
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
					return adventure.act(room, player, msg.actionId, msg.targetId, rollDie, msg.cast);
				case 'adventure_end_turn':
					return adventure.endTurn(room, player);
				case 'adventure_effect':
					return adventure.ruleEffect(room, player, msg.op);
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
		if (!result) return;
		if (!result.ok) return sendError(ws, result.code, result.message);
		applyOutcome(room, result);
		if (msg.type === 'adventure_start') campaignBegun(room);
	}

	/** The GM's campaign view goes to the GM's sockets only. */
	function sendCampaign(room: Room): void {
		const view = room.campaign ? campaignView(room.campaign) : null;
		for (const [playerId, socket] of sockets.get(room.id) ?? [])
			if (room.players.get(playerId)?.role === 'gm')
				send(socket, { type: 'campaign', campaign: view });
	}

	/** The campaign open at another live table, if it is. */
	function openElsewhere(room: Room, id: string): Room | null {
		for (const other of rooms.all()) if (other !== room && other.campaign?.id === id) return other;
		return null;
	}

	/** Why the table's campaign can't change now: a story played for it isn't back in it yet. */
	function unreturned(room: Room): string | null {
		const story = room.adventure;
		const open = story?.campaign;
		if (!story || !open || open.closed || story.stage === 'choosing') return null;
		return `Return ${adventure.content(story).title} to ${open.name} first.`;
	}

	/** A story set up for the table's campaign: the campaign notes what it is playing. */
	function campaignBegun(room: Room): void {
		const story = room.adventure;
		const record = room.campaign;
		if (!story?.campaign || !record || story.campaign.id !== record.id) return;
		const next = {
			...record,
			playing: {
				room: room.id,
				title: adventure.content(story).title,
				since: story.campaign.since
			}
		};
		room.campaign = next;
		touch(room);
		sendCampaign(room);
		campaignStore
			.save(next)
			.catch((err) => console.error(`[campaigns] noting a story failed`, err));
	}

	async function reopenCampaign(room: Room, id: string): Promise<void> {
		try {
			const record = await campaignStore.get(id);
			if (!record || record.owner !== room.gmOwner || openElsewhere(room, id)) return;
			if (rooms.get(room.id) !== room || room.adventure?.campaign?.id !== id) return;
			room.campaign = record;
			touch(room);
			sendCampaign(room);
		} catch (err) {
			console.error('[campaigns] reopening failed', err);
		}
	}

	/** Campaigns (milestone 58): the GM's, kept by their key, opened at a table and returned to. */
	async function handleCampaign(
		ws: WebSocket,
		room: Room,
		player: Player,
		msg: Extract<ClientMessage, { type: `campaign_${string}` }>
	): Promise<void> {
		if (player.role !== 'gm') return sendError(ws, 'forbidden', 'Only the GM keeps campaigns.');
		const owner = room.gmOwner;
		if (!owner) return sendError(ws, 'forbidden', 'This table has no GM key to keep campaigns by.');
		// Beginning a campaign writes a new record; the rest change one the GM already has.
		const limiter = msg.type === 'campaign_create' ? sceneLimiter : creatorLimiter;
		if (!limiter.take(player.id)) return sendError(ws, 'rate_limited', 'Give it a moment.');
		const here = () => rooms.get(room.id) === room;
		const listing = async () => ({
			type: 'campaigns' as const,
			campaigns: (await campaignStore.list(owner)).map(campaignSummary),
			current: room.campaign ? campaignView(room.campaign) : null
		});
		try {
			switch (msg.type) {
				case 'campaign_list':
					return send(ws, await listing());
				case 'campaign_create': {
					const busy = unreturned(room);
					if (busy) return sendError(ws, 'forbidden', busy);
					if ((await campaignStore.list(owner)).length >= CAMPAIGN_LIMITS.perOwner)
						return sendError(
							ws,
							'limit_reached',
							`A GM keeps at most ${CAMPAIGN_LIMITS.perOwner} campaigns.`
						);
					const made = newCampaign(owner, msg.name, CAMPAIGN_RULES);
					if (!made.ok) return sendError(ws, 'invalid_name', made.message);
					await campaignStore.save(made.record);
					if (!here()) return;
					room.campaign = made.record;
					touch(room);
					sendCampaign(room);
					return announce(
						room,
						postSystem(room, `${player.name} begins the campaign ${made.record.name}.`)
					);
				}
				case 'campaign_open': {
					const busy = unreturned(room);
					if (busy && msg.campaignId !== room.campaign?.id) return sendError(ws, 'forbidden', busy);
					if (msg.campaignId === null) {
						const was = room.campaign;
						room.campaign = undefined;
						touch(room);
						sendCampaign(room);
						return was
							? announce(room, postSystem(room, `${player.name} puts ${was.name} away.`))
							: undefined;
					}
					const record = await campaignStore.get(msg.campaignId);
					if (!record || record.owner !== owner)
						return sendError(ws, 'scene_not_found', 'That campaign is not one of yours.');
					if (!here()) return;
					if (openElsewhere(room, record.id))
						return sendError(ws, 'forbidden', `${record.name} is open at another table.`);
					room.campaign = record;
					touch(room);
					sendCampaign(room);
					return announce(
						room,
						postSystem(room, `${player.name} opens the campaign ${record.name}.`)
					);
				}
				case 'campaign_close': {
					const record = room.campaign;
					if (!record) return sendError(ws, 'forbidden', 'Open the story’s campaign first.');
					const story = adventure.campaignStory(room, player);
					if (!story.ok) return sendError(ws, story.code, story.message);
					if (story.campaign !== record.id)
						return sendError(ws, 'forbidden', 'This story is played for another campaign.');
					const played = room.adventure;
					const fresh = await campaignStore.get(record.id);
					if (!fresh || fresh.owner !== owner)
						return sendError(ws, 'scene_not_found', 'That campaign no longer exists.');
					const closed = closeStory(fresh, story.story, msg.advance);
					if (!closed.ok) return sendError(ws, 'invalid_message', closed.message);
					if (!here() || room.adventure !== played || played?.campaign?.closed) return;
					await campaignStore.save(closed.returned.record);
					if (!here() || room.adventure !== played || played?.campaign?.closed) return;
					room.campaign = closed.returned.record;
					const returned = adventure.campaignReturned(room, closed.returned.lines);
					if (!returned.ok) return sendError(ws, returned.code, returned.message);
					applyOutcome(room, returned);
					return sendCampaign(room);
				}
				case 'campaign_roster': {
					const record = room.campaign;
					if (!record) return sendError(ws, 'forbidden', 'Open a campaign first.');
					const fresh = await campaignStore.get(record.id);
					if (!fresh || fresh.owner !== owner)
						return sendError(ws, 'scene_not_found', 'That campaign no longer exists.');
					const changed = changeRoster(fresh, msg.op);
					if (!changed.ok) return sendError(ws, 'invalid_message', changed.message);
					await campaignStore.save(changed.record);
					if (!here() || room.campaign?.id !== record.id) return;
					room.campaign = changed.record;
					touch(room);
					return sendCampaign(room);
				}
				case 'campaign_delete': {
					if (room.campaign?.id === msg.campaignId || openElsewhere(room, msg.campaignId))
						return sendError(ws, 'forbidden', 'Put the campaign away at its table first.');
					if (!(await campaignStore.remove(msg.campaignId, owner)))
						return sendError(ws, 'scene_not_found', 'That campaign is not one of yours.');
					return send(ws, await listing());
				}
			}
		} catch (err) {
			console.error(`[room ${room.id}] ${msg.type} failed`, err);
			sendError(ws, 'persistence_failed', 'The campaign could not be reached. Try again.');
		}
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
					if (msg.type === 'scene_export') {
						const refused = await unexportable(room);
						if (refused) return sendError(ws, 'forbidden', refused.message, [refused]);
						return send(ws, { type: 'scene_exported', file });
					}
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
					const refused = await withdrawn(data, room.gmOwner ?? null);
					if (refused) return sendError(ws, 'forbidden', refused.message, [refused]);
					// The room may have closed while storage was busy.
					if (rooms.get(room.id) !== room) return;
					return loadIntoRoom(room, player, data, 'loaded');
				}
				case 'scene_import': {
					const refused = await withdrawn(msg.file, room.gmOwner ?? null);
					if (refused) return sendError(ws, 'forbidden', refused.message, [refused]);
					if (rooms.get(room.id) !== room) return;
					return loadIntoRoom(room, player, msg.file, 'imported');
				}
				case 'scene_list':
					if (!room.gmOwner) return send(ws, { type: 'scene_list', scenes: [] });
					return send(ws, { type: 'scene_list', scenes: await sceneStore.list(room.gmOwner) });
				case 'scene_new': {
					const name = normalizeSceneName(msg.name);
					if (!name) return sendError(ws, 'invalid_name', 'Scene names are 1-48 characters.');
					return loadIntoRoom(
						room,
						player,
						blankScene(
							name,
							msg.width,
							msg.height,
							msg.environment,
							new Date(),
							msg.world && applyWorldPatch(DEFAULT_WORLD, msg.world, Date.now())
						),
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
			if (err instanceof SceneError) return sendError(ws, err.code, err.message, err.diagnostics);
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
				return applyOutcome(
					room,
					adventure.afterMove(room, token, allowed.cost, Date.now(), allowed.walk),
					player.id
				);
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
				if (!lookLimiter.take(player.id)) {
					return sendError(ws, 'rate_limited', 'Give it a moment before the next change.');
				}
				const result = setDarkness(room, player, msg.from, msg.to, msg.dark);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return syncRoom(room);
			}
			case 'interior_set': {
				if (!lookLimiter.take(player.id)) {
					return sendError(ws, 'rate_limited', 'Give it a moment before the next change.');
				}
				const result = setInterior(room, player, msg.from, msg.to, msg.roofed);
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
				// Kept for older bundles: the hour snaps into the band (world_update with ambient_update).
				const before = room.ambient;
				const result = setAmbient(room, player, msg.ambient);
				if (!result.ok) return sendError(ws, result.code, result.message);
				if (!result.changed) return;
				syncRoom(room);
				return bandNotice(room, player, before);
			}
			case 'world_set': {
				if (!lookLimiter.take(player.id)) {
					return sendError(ws, 'rate_limited', 'Slow down a little.');
				}
				const before = room.ambient;
				const result = setWorld(room, player, msg.patch);
				if (!result.ok) return sendError(ws, result.code, result.message);
				if (!result.changed) return;
				syncRoom(room);
				return bandNotice(room, player, before);
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
			case 'content_sources':
				void contentSources(ws, room, player);
				return;
			case 'campaign_list':
			case 'campaign_create':
			case 'campaign_open':
			case 'campaign_close':
			case 'campaign_roster':
			case 'campaign_delete':
				void handleCampaign(ws, room, player, msg);
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
			case 'character_options': {
				if (!creatorLimiter.take(player.id))
					return sendError(ws, 'rate_limited', 'Slow down a little.');
				const result = adventure.creatorOptions(room);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return send(ws, {
					type: 'character_options',
					rules: result.rules,
					options: result.options
				});
			}
			case 'monster_search': {
				if (!creatorLimiter.take(player.id))
					return sendError(ws, 'rate_limited', 'Slow down a little.');
				const result = adventure.searchMonsters(room, player, msg.query);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return send(ws, { type: 'monster_search', query: msg.query, monsters: result.monsters });
			}
			case 'character_sheet': {
				if (!creatorLimiter.take(player.id))
					return sendError(ws, 'rate_limited', 'Slow down a little.');
				const result = adventure.sheetDetails(room, msg.characterId);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return send(ws, {
					type: 'character_sheet',
					characterId: msg.characterId,
					rules: result.rules,
					details: result.details
				});
			}
			case 'character_preview': {
				if (!creatorLimiter.take(player.id))
					return sendError(ws, 'rate_limited', 'Slow down a little.');
				const result = adventure.previewCharacter(room, msg.choices);
				if (!result.ok) return sendError(ws, result.code, result.message);
				return send(ws, { type: 'character_preview', preview: result.preview });
			}
			case 'adventure_start':
			case 'adventure_claim':
			case 'adventure_build':
			case 'adventure_sheet':
			case 'adventure_gear':
			case 'adventure_release':
			case 'adventure_begin':
			case 'adventure_interact':
			case 'adventure_act':
			case 'adventure_override':
			case 'adventure_effect':
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
			case 'adventure_rate':
			case 'adventure_pack':
			case 'adventure_upgrade':
				return handleAdventure(ws, room, player, msg);
			case 'room_listing': {
				if (player.role !== 'gm') return sendError(ws, 'forbidden', 'Only the GM can do that.');
				if (room.listed === msg.listed) return;
				room.listed = msg.listed;
				touch(room);
				broadcast(room.id, { type: 'listing_update', listed: room.listed });
				return announce(
					room,
					postSystem(
						room,
						room.listed
							? `${player.name} listed the game: anyone can find it and join.`
							: `${player.name} made the game invite-only.`
					)
				);
			}
		}
	}

	// -------------------------------------------------------------------
	// The adventure library and the open games (see library-store.ts).

	function connectionKey(ws: WebSocket): string {
		let id = connectionIds.get(ws);
		if (!id) connectionIds.set(ws, (id = `ws:${++nextConnection}`));
		return id;
	}

	/** The games GMs listed, with somebody at them, most players first. */
	function publicGames(): PublicGame[] {
		const games: PublicGame[] = [];
		for (const room of rooms.all()) {
			if (!room.listed || !sockets.get(room.id)?.size) continue;
			const people = [...room.players.values()];
			const story = room.adventure;
			const A = story && adventure.content(story);
			games.push({
				roomId: room.id,
				title: A ? A.title : room.sceneName,
				gm: people.find((p) => p.role === 'gm')?.name ?? '',
				players: people.filter((p) => p.role === 'player').length,
				status: !story
					? null
					: story.stage === 'choosing'
						? 'Choosing characters'
						: story.stage === 'playing'
							? `Chapter ${adventure.chapterNumber(A!, story.chapter)} of ${Object.keys(A!.chapters).length}`
							: 'Finished'
			});
		}
		return games.sort((a, b) => b.players - a.players).slice(0, LIBRARY_LIMITS.games);
	}

	async function handleLibrary(
		ws: WebSocket,
		msg: Extract<
			ClientMessage,
			{
				type:
					| 'library_list'
					| 'library_story'
					| 'library_mine'
					| 'library_publish'
					| 'library_manage'
					| 'library_grant'
					| 'library_revoke'
					| 'collection_check'
					| 'content_validate'
					| 'bestiary_search'
					| 'games_list';
			}
		>
	): Promise<void> {
		const browsing =
			msg.type === 'library_list' ||
			msg.type === 'library_story' ||
			msg.type === 'collection_check' ||
			msg.type === 'content_validate' ||
			msg.type === 'bestiary_search' ||
			msg.type === 'games_list';
		const creatorKey = 'gmKey' in msg && msg.gmKey ? keyOwner(msg.gmKey) : connectionKey(ws);
		const limited = browsing
			? browseLimiter.take(connectionKey(ws))
			: msg.type === 'library_publish'
				? publishLimiter.take(creatorKey)
				: manageLimiter.take(creatorKey);
		if (!limited) return sendError(ws, 'rate_limited', 'Give it a moment before asking again.');
		try {
			switch (msg.type) {
				case 'games_list':
					return send(ws, { type: 'games_list', games: publicGames() });
				case 'content_validate': {
					// The same checks a publish, start or load makes, changing nothing.
					const validation = await validateContent(msg.kind, msg.file, {
						shelves,
						owner: msg.gmKey ? keyOwner(msg.gmKey) : null,
						collection: msg.collection ?? null,
						licences: licenceStore
					});
					// An adventure that reads: what it comes to under its rules, for the builder.
					const loaded =
						msg.kind === 'adventure' && validation.ok
							? loadServerAdventure(msg.file, 'custom-validate')
							: null;
					const preview = loaded?.ok ? previewOf(loaded.file, loaded.adventure) : null;
					return send(ws, { type: 'validation', validation, ...(preview ? { preview } : {}) });
				}
				case 'bestiary_search': {
					const bestiary = findRuleset(msg.rules)?.bestiary;
					return send(ws, {
						type: 'monster_search',
						query: msg.query,
						monsters: bestiary ? bestiary.search(msg.query, adventure.MONSTER_RESULTS) : []
					});
				}
				case 'library_list': {
					const kind = msg.kind ?? 'adventure';
					const found = await libraryStore.list({
						query: normalizeQuery(msg.query),
						creator: msg.creator ?? null,
						sort: msg.sort ?? 'top',
						kind
					});
					// The whole library also shows the adventures that come with thirdfold.
					const builtIn =
						msg.creator || kind !== 'adventure' ? [] : builtInAdventures().map(builtInStory);
					return send(ws, { type: 'library_list', ...found, builtIn });
				}
				case 'collection_check': {
					const copy = await libraryStore.get(msg.id, msg.version);
					if (!copy || copy.listing.kind !== 'collection')
						return send(ws, { type: 'collection_report', report: null });
					const asker: Subject = { owner: msg.gmKey ? keyOwner(msg.gmKey) : null };
					const may = decide(copy, asker, 'read');
					if (!may.ok)
						return send(ws, {
							type: 'collection_report',
							report: null,
							...(may.visible ? { locked: true } : {})
						});
					const parsed = parseCollectionFile(copy.file);
					if (!parsed.ok || !parsed.file.rules)
						return send(ws, { type: 'collection_report', report: null });
					const file = parsed.file as CollectionFile;
					const { items } = await resolveCollection(shelves, file, copy.owner, copy.listing.id);
					return send(ws, { type: 'collection_report', report: reportOf(copy, file, items) });
				}
				case 'library_story': {
					const copy = await libraryStore.get(msg.id, msg.version);
					if (!copy || copy.listing.kind !== 'adventure')
						return send(ws, { type: 'library_story', story: null });
					const may = decide(copy, { owner: msg.gmKey ? keyOwner(msg.gmKey) : null }, 'read');
					if (!may.ok)
						return send(ws, {
							type: 'library_story',
							story: null,
							...(may.visible ? { locked: true } : {})
						});
					const loaded = loadServerAdventure(copy.file, `library-${msg.id}`);
					if (!loaded.ok) return send(ws, { type: 'library_story', story: null });
					return send(ws, {
						type: 'library_story',
						story: {
							// That version's own words (an older one reads as it was published).
							listing: {
								...copy.listing,
								title: loaded.file.title,
								about: loaded.file.about ?? ''
							},
							opening: openingOf(loaded.adventure),
							facts: storyFacts(loaded.adventure)
						}
					});
				}
				case 'library_mine':
					return send(ws, await mine(keyOwner(msg.gmKey)));
				case 'library_manage': {
					const owner = keyOwner(msg.gmKey);
					const done =
						msg.op === 'remove'
							? await libraryStore.remove(msg.adventureId, owner)
							: await libraryStore.setAccess(
									msg.adventureId,
									owner,
									msg.op === 'list' ? 'public' : msg.op === 'restrict' ? 'restricted' : 'private'
								);
					if (!done) return sendError(ws, 'forbidden', 'That is not one of yours.');
					return send(ws, await mine(owner));
				}
				case 'library_grant': {
					const owner = keyOwner(msg.gmKey);
					const granted = await libraryStore.grant(msg.adventureId, owner, msg.grant);
					if (!granted) return sendError(ws, 'forbidden', 'That is not one of yours.');
					return send(ws, await mine(owner));
				}
				case 'library_revoke': {
					const owner = keyOwner(msg.gmKey);
					if (!(await libraryStore.revoke(msg.adventureId, owner, msg.grantId)))
						return sendError(ws, 'forbidden', 'There is no such grant in force on one of yours.');
					return send(ws, await mine(owner));
				}
				case 'library_publish': {
					const creator = normalizeCreatorName(msg.creator);
					if (!creator) {
						return sendError(
							ws,
							'invalid_name',
							`Creator names are 1-${LIBRARY_LIMITS.creatorName} characters.`
						);
					}
					const issued = msg.gmKey ? null : newGmKey();
					const publisher = keyOwner(msg.gmKey ?? issued!);
					// A new version is its owner's to add, or a collaborator's (under the owner's name).
					let owner = publisher;
					let name = creator;
					if (msg.adventureId !== undefined) {
						const current = await libraryStore.get(msg.adventureId);
						const may = current && decide(current, { owner: publisher }, 'publish');
						if (!current || !may!.ok) {
							return may && !may.ok && may.visible
								? sendError(ws, 'forbidden', 'That belongs to someone else.')
								: sendError(ws, 'adventure_not_found', 'There is no such item in the library.');
						}
						owner = current.owner;
						if (may!.ok && may!.as === 'grant') name = current.listing.creator.name;
					}
					const checked = await publishable(
						msg.kind ?? 'adventure',
						msg.file,
						owner,
						msg.adventureId ?? null
					);
					if (!checked.ok)
						return sendError(ws, 'invalid_message', checked.error, checked.diagnostics);
					const published = await libraryStore.publish(
						{ kind: msg.kind ?? 'adventure', owner, creatorName: name, ...checked.item },
						msg.adventureId
					);
					send(ws, {
						type: 'library_published',
						adventureId: published.id,
						version: published.version,
						...(issued ? { gmKey: issued } : {})
					});
					return send(ws, await mine(publisher));
				}
			}
		} catch (err) {
			if (err instanceof LibraryError) {
				const code =
					err.code === 'too_many'
						? 'limit_reached'
						: err.code === 'forbidden'
							? 'forbidden'
							: 'adventure_not_found';
				return sendError(ws, code, err.message);
			}
			console.error('[library] failed', err);
			sendError(ws, 'persistence_failed', 'The library could not be reached. Try again.');
		}
	}

	/** Where collections find what they name. */
	const shelves: Shelves = { library: libraryStore, scenes: sceneStore };

	/** Who asks from a table: its GM (by key) at this room. */
	function tableSubject(room: Room): Subject {
		return { owner: room.gmOwner ?? null, room: room.id };
	}

	/** A creator's own items, what others shared with them, and the id others grant to. */
	async function mine(owner: string): Promise<Extract<ServerMessage, { type: 'library_mine' }>> {
		const creatorId = creatorIdOf(owner);
		return {
			type: 'library_mine',
			adventures: await libraryStore.mine(owner),
			shared: await libraryStore.shared(creatorId),
			creatorId
		};
	}

	/**
	 * Why a saved story can't be opened, when a grant its library content was
	 * played by has been revoked, has run out, or its item is gone; null when
	 * all still hold (or it rests on none).
	 */
	/** A refusal on access, as a diagnostic. */
	function accessDenied(message: string): Diagnostic[] {
		return [diagnostic('access.denied', 'adventure.entitlements', message)];
	}

	/**
	 * Why a saved story can't be opened by the GM of `owner` (a GM key's
	 * hash): a library grant it rests on no longer holds (milestone 54), or a
	 * licensed source it uses can't be used by them now (milestone 59).
	 */
	async function withdrawn(data: unknown, owner: string | null): Promise<Diagnostic | null> {
		const licence = await openRefused(
			licenceStore,
			savedLicences(data),
			owner ? creatorIdOf(owner) : null
		);
		if (licence) return licence;
		const library = await libraryWithdrawn(data);
		return library ? accessDenied(library)[0] : null;
	}

	async function libraryWithdrawn(data: unknown): Promise<string | null> {
		for (const e of savedEntitlements(data)) {
			const copy = await libraryStore.get(e.item);
			if (!stillHolds(copy, e))
				return copy
					? `${copy.listing.title} is no longer shared with you, so this story can't be opened.`
					: 'Something this story plays is no longer in the library, so it can’t be opened.';
		}
		return null;
	}

	/**
	 * Why a table's story can't be exported: content played by a grant that
	 * isn't a collaborator's (theirs to take away) goes no further than this
	 * server's saves.
	 */
	async function unexportable(room: Room): Promise<Diagnostic | null> {
		// A licensed source's terms may keep its stories on this server (milestone 59).
		const licence = exportRefused(
			(room.adventure?.packs ?? []).flatMap((p) => (p.licence ? [p.licence] : []))
		);
		if (licence) return licence;
		const creator = room.gmOwner ? creatorIdOf(room.gmOwner) : null;
		for (const e of room.adventure?.entitlements ?? []) {
			const copy = await libraryStore.get(e.item);
			const grant = stillHolds(copy, e);
			if (
				!grant ||
				grant.role !== 'collaborator' ||
				grant.target.kind !== 'creator' ||
				grant.target.id !== creator
			)
				return accessDenied(
					`${copy?.listing.title ?? 'This story'} was shared with you to play, not to take away: save it here instead.`
				)[0];
		}
		return null;
	}

	/**
	 * A file checked in full as what it says it is, before it goes into the
	 * library: an adventure as it would be played, a homebrew pack as its
	 * rules hold it, a collection with everything it names found and fitting.
	 */
	async function publishable(
		kind: LibraryKind,
		raw: unknown,
		owner: string,
		id: string | null
	): Promise<
		| { ok: true; item: { title: string; about: string; file: unknown } }
		| { ok: false; error: string; diagnostics: Diagnostic[] }
	> {
		// Every check the builder's content_validate makes, as the publisher.
		const validation = await validateContent(kind, raw, {
			shelves,
			owner,
			collection: id,
			licences: licenceStore
		});
		if (!validation.ok) {
			const what = kind === 'pack' ? 'homebrew' : kind;
			return {
				ok: false,
				error: `That ${what} can't be published: ${firstError(validation.diagnostics)}`,
				diagnostics: validation.diagnostics
			};
		}
		// Licensed content may be named only where its licence allows references (milestone 59).
		const reference = referenceRefused(raw, packOfSource);
		if (reference)
			return {
				ok: false,
				error: `That ${kind === 'pack' ? 'homebrew' : kind} can't be published: ${reference.message}`,
				diagnostics: [reference]
			};
		const refused = (error: string) => ({ ok: false as const, error, diagnostics: [] });
		const size = JSON.stringify(raw).length;
		if (kind === 'adventure') {
			if (size > ADVENTURE_FILE_MAX_BYTES) return refused('That adventure is too large.');
			// Checked in full, as it would be to play it: only playable adventures are published.
			const loaded = loadServerAdventure(raw, 'custom-publish');
			if (!loaded.ok) return { ok: false, error: loaded.error, diagnostics: loaded.diagnostics };
			const { title, about } = loaded.file;
			return { ok: true, item: { title, about: about ?? '', file: loaded.file } };
		}
		if (kind === 'pack') {
			if (size > CONTENT_PACK_MAX_BYTES) return refused('That homebrew is too large.');
			const declared = (raw as { rules?: unknown }).rules as RulesetRef | undefined;
			const packs =
				declared && typeof declared === 'object' ? findRuleset(declared)?.packs : undefined;
			if (!packs) return refused('That homebrew is for rules that take none here.');
			const held = packs.hold(raw);
			if (!held.ok)
				return refused(`That homebrew can't be used: ${held.problems.slice(0, 4).join('; ')}.`);
			const listing = packs.listing(held.id, { owner: creatorIdOf(owner), visibility: 'table' })!;
			return {
				ok: true,
				item: {
					title: `${listing.name} ${listing.version}`,
					about: listing.about ?? '',
					file: packs.content(held.id)
				}
			};
		}
		if (size > COLLECTION_FILE_MAX_BYTES) return refused('That collection is too large.');
		const parsed = parseCollectionFile(raw);
		if (!parsed.ok)
			return refused(`That is not a valid collection: ${parsed.problems.slice(0, 4).join('; ')}.`);
		const file = await withRules(shelves, parsed.file, owner, id);
		if (!file) return refused('The collection’s first adventure could not be found.');
		const { items } = await resolveCollection(shelves, file, owner, id);
		if (items.some((i) => i.status !== 'ok'))
			return refused(`That collection can't be published: ${problemsOf(items)}`);
		return { ok: true, item: { title: file.title, about: file.about, file } };
	}

	/**
	 * GM: sets up a collection from the library (its latest version, or
	 * `version`): everything it names is found and checked first, then its
	 * adventure `entry` starts with its homebrew, and the story keeps the
	 * collection and the versions it found.
	 */
	async function startFromCollection(
		ws: WebSocket,
		room: Room,
		player: Player,
		id: string,
		version: number | undefined,
		entry: number
	): Promise<void> {
		if (player.role !== 'gm') return sendError(ws, 'forbidden', 'Only the GM can do that.');
		if (!sceneLimiter.take(player.id)) {
			return sendError(ws, 'rate_limited', 'Give it a moment before trying again.');
		}
		let copy;
		let found;
		let may;
		try {
			copy = await libraryStore.get(id, version);
			may = copy && decide(copy, tableSubject(room), 'use');
			if (!copy || copy.listing.kind !== 'collection' || !may!.ok)
				return may && !may.ok && may.visible
					? sendError(
							ws,
							'forbidden',
							`${copy!.listing.title} is shared only with those its creator chooses.`
						)
					: sendError(ws, 'adventure_not_found', 'That collection is not in the library.');
			const parsed = parseCollectionFile(copy.file);
			if (!parsed.ok || !parsed.file.rules)
				return sendError(ws, 'invalid_message', 'That collection no longer reads.');
			// What it carries, as its creator put it in this collection.
			found = await resolveCollection(shelves, parsed.file as CollectionFile, copy.owner, id);
		} catch (err) {
			console.error('[library] reading failed', err);
			return sendError(ws, 'persistence_failed', 'The library could not be reached. Try again.');
		}
		const resolved = found.resolved;
		if (!resolved)
			return sendError(
				ws,
				'invalid_message',
				`This collection can't be started: ${problemsOf(found.items)}`
			);
		const pick = resolved.adventures[entry];
		if (!pick) return sendError(ws, 'invalid_message', 'The collection has no such adventure.');
		if (rooms.get(room.id) !== room) return;
		let started;
		if ('copy' in pick) {
			const custom = loadCustomAdventure(pick.copy.file);
			if (!custom.ok) return sendError(ws, 'invalid_message', custom.error, custom.diagnostics);
			started = adventure.startAdventure(room, player, custom.adventure.id, room.campaign);
			if (started.ok)
				room.adventure!.library = {
					id: pick.ref.library,
					version: pick.ref.version,
					creator: { ...pick.copy.listing.creator }
				};
		} else started = adventure.startAdventure(room, player, pick.ref.builtIn, room.campaign);
		if (!started.ok) return sendError(ws, started.code, started.message);
		applyOutcome(room, started);
		const begun = adventure.beginCollection(
			room,
			{
				id,
				version: copy.listing.version,
				title: resolved.file.title,
				creator: { ...copy.listing.creator },
				entry,
				adventures: resolved.adventures.map((a) => ({ ref: { ...a.ref }, title: a.title })),
				packs: resolved.packs.map((p) => ({ ref: { ...p.ref }, title: p.title, packId: p.packId })),
				tables: resolved.tables
			},
			resolved.packs.map((p) => ({ id: p.packId, owner: p.creator.id }))
		);
		if (!begun.ok) return sendError(ws, begun.code, begun.message);
		// The grants it all rests on, the collection's own and those of what it carries.
		const entitlements = [
			entitlementOf(id, may!),
			'copy' in pick ? pick.entitlement : null,
			...resolved.packs.map((p) => p.entitlement)
		].filter((e): e is Entitlement => e !== null);
		if (entitlements.length) room.adventure!.entitlements = entitlements;
		applyOutcome(room, begun);
		campaignBegun(room);
		const counted = [id, ...('copy' in pick ? [pick.ref.library] : [])];
		for (const item of counted)
			libraryStore
				.played(item)
				.catch((err) => console.error('[library] counting a play failed', err));
	}

	/** A GM's public creator id at this table, or null without a GM key. */
	const creatorOf = (room: Room) => (room.gmOwner ? creatorIdOf(room.gmOwner) : null);

	/** The id an installed source's content is held under (it is held as its rules read it). */
	function packOfSource(source: InstalledSource): string | null {
		const held = findRuleset(source.file.rules)?.packs?.holdLicensed?.({
			file: source.file,
			content: source.content
		});
		return held?.ok ? held.id : null;
	}

	/**
	 * GM: the licensed sources installed here that they may use (milestone 59):
	 * a source granted to nobody here, or withdrawn, isn't listed.
	 */
	async function contentSources(ws: WebSocket, room: Room, player: Player): Promise<void> {
		if (player.role !== 'gm') return sendError(ws, 'forbidden', 'Only the GM brings content.');
		if (!creatorLimiter.take(player.id))
			return sendError(ws, 'rate_limited', 'Slow down a little.');
		try {
			const sources: LicensedSourceView[] = [];
			for (const source of installedSources()) {
				const may = await mayUse(licenceStore, source, creatorOf(room));
				if (!may.ok) continue;
				const { file } = source;
				const records = (source.content as { records?: { kind?: unknown }[] }).records ?? [];
				const counts: Record<string, number> = {};
				for (const r of records)
					if (typeof r.kind === 'string') counts[r.kind] = (counts[r.kind] ?? 0) + 1;
				sources.push({
					id: file.id,
					name: file.name,
					publisher: file.publisher,
					version: file.version,
					about: file.about,
					attribution: file.attribution,
					terms: structuredClone(file.terms),
					hypothetical: file.provenance.hypothetical,
					counts,
					usable:
						!!room.adventure &&
						room.adventure.rules.id === file.rules.id &&
						room.adventure.rules.version === file.rules.version
				});
			}
			send(ws, { type: 'content_sources', sources });
		} catch (err) {
			console.error('[licensed] listing failed', err);
			sendError(ws, 'persistence_failed', 'The licence records could not be read. Try again.');
		}
	}

	/** GM: brings an installed licensed source to the story, when they may use it. */
	async function attachSource(
		ws: WebSocket,
		room: Room,
		player: Player,
		id: string
	): Promise<void> {
		if (player.role !== 'gm') return sendError(ws, 'forbidden', 'Only the GM can do that.');
		if (!sceneLimiter.take(player.id))
			return sendError(ws, 'rate_limited', 'Give it a moment before trying again.');
		const source = installedSource(id);
		if (!source) return sendError(ws, 'invalid_message', 'There is no such licensed source here.');
		let may: MayUse;
		try {
			may = await mayUse(licenceStore, source, creatorOf(room));
		} catch (err) {
			console.error('[licensed] checking failed', err);
			return sendError(
				ws,
				'persistence_failed',
				'The licence records could not be read. Try again.'
			);
		}
		if (!may.ok) return sendError(ws, 'forbidden', may.diagnostic.message, [may.diagnostic]);
		if (rooms.get(room.id) !== room) return;
		const result = adventure.attachLicensed(room, player, source, may.grant);
		if (!result.ok) return sendError(ws, result.code, result.message);
		applyOutcome(room, result);
	}

	/** GM: sets up an adventure from the library (its latest version, or `version`). */
	async function startFromLibrary(
		ws: WebSocket,
		room: Room,
		player: Player,
		id: string,
		version?: number
	): Promise<void> {
		if (player.role !== 'gm') return sendError(ws, 'forbidden', 'Only the GM can do that.');
		if (!sceneLimiter.take(player.id)) {
			return sendError(ws, 'rate_limited', 'Give it a moment before trying again.');
		}
		let copy;
		try {
			copy = await libraryStore.get(id, version);
		} catch (err) {
			console.error('[library] reading failed', err);
			return sendError(ws, 'persistence_failed', 'The library could not be reached. Try again.');
		}
		// Its owner plays it whatever its access; anyone else as it allows, or by a grant.
		const may = copy && decide(copy, tableSubject(room), 'use');
		if (!copy || copy.listing.kind !== 'adventure' || !may!.ok) {
			return may && !may.ok && may.visible
				? sendError(
						ws,
						'forbidden',
						`${copy!.listing.title} is shared only with those its creator chooses.`
					)
				: sendError(ws, 'adventure_not_found', 'That adventure is not in the library.');
		}
		if (rooms.get(room.id) !== room) return;
		const custom = loadCustomAdventure(copy.file);
		if (!custom.ok) return sendError(ws, 'invalid_message', custom.error, custom.diagnostics);
		const result = adventure.startAdventure(room, player, custom.adventure.id, room.campaign);
		if (!result.ok) return sendError(ws, result.code, result.message);
		room.adventure!.library = {
			id,
			version: copy.listing.version,
			creator: { ...copy.listing.creator }
		};
		const entitlement = entitlementOf(id, may!);
		if (entitlement) room.adventure!.entitlements = [entitlement];
		applyOutcome(room, result);
		campaignBegun(room);
		libraryStore.played(id).catch((err) => console.error('[library] counting a play failed', err));
	}

	/** The story's homebrew as written, with whoever brought each. */
	function packsAsWritten(story: AdventureState) {
		const packs = findRuleset(story.rules)?.packs;
		return (story.packs ?? []).map((p) => ({ pack: packs!.content(p.id), owner: p.owner }));
	}

	/**
	 * Where the story would go: its library adventure or its collection at
	 * `version` (the latest without one), found, allowed and resolved as a
	 * start would, as a move for the engine to try.
	 */
	async function moveTarget(
		room: Room,
		story: AdventureState,
		what: 'adventure' | 'collection',
		version: number | undefined
	): Promise<MoveTarget | string> {
		const asker = tableSubject(room);
		if (what === 'adventure') {
			const source = story.library;
			if (!source || story.collection)
				return story.collection
					? 'This story’s adventure comes with its collection: move the collection instead.'
					: 'This story’s adventure isn’t from the library.';
			const copy = await libraryStore.get(source.id, version);
			const may = copy && decide(copy, asker, 'use');
			if (!copy || copy.listing.kind !== 'adventure' || !may!.ok)
				return 'That version of the adventure is not in the library.';
			const entitlement = entitlementOf(source.id, may!);
			return {
				what,
				item: source.id,
				title: copy.listing.title,
				from: source.version,
				to: copy.listing.version,
				file: copy.file,
				library: {
					id: source.id,
					version: copy.listing.version,
					creator: { ...copy.listing.creator }
				},
				collection: null,
				packs: packsAsWritten(story),
				entitlements: [
					...(story.entitlements ?? []).filter((e) => e.item !== source.id),
					...(entitlement ? [entitlement] : [])
				]
			};
		}
		const source = story.collection;
		if (!source) return 'This story wasn’t started from a collection.';
		const copy = await libraryStore.get(source.id, version);
		const may = copy && decide(copy, asker, 'use');
		if (!copy || copy.listing.kind !== 'collection' || !may!.ok)
			return 'That version of the collection is not in the library.';
		const parsed = parseCollectionFile(copy.file);
		if (!parsed.ok || !parsed.file.rules) return 'That version of the collection no longer reads.';
		const base: MoveTarget = {
			what,
			item: source.id,
			title: copy.listing.title,
			from: source.version,
			to: copy.listing.version,
			file: null,
			library: story.library ?? null,
			collection: null,
			packs: packsAsWritten(story),
			entitlements: story.entitlements ?? []
		};
		const found = await resolveCollection(
			shelves,
			parsed.file as CollectionFile,
			copy.owner,
			source.id
		);
		const resolved = found.resolved;
		if (!resolved) return { ...base, problems: [problemsOf(found.items)] };
		// This story's adventure in that version: the same built-in, or the same library adventure.
		const entry = resolved.adventures.findIndex((a) =>
			'copy' in a
				? a.ref.library === story.library?.id
				: !story.library && a.ref.builtIn === story.id
		);
		if (entry < 0)
			return {
				...base,
				problems: [
					`Version ${copy.listing.version} of the collection no longer has this adventure.`
				]
			};
		const pick = resolved.adventures[entry];
		const packs = findRuleset(story.rules)?.packs;
		const theirs = new Set(source.packs.map((p) => p.packId));
		return {
			...base,
			file: 'copy' in pick ? pick.copy.file : null,
			library:
				'copy' in pick
					? {
							id: pick.ref.library,
							version: pick.ref.version,
							creator: { ...pick.copy.listing.creator }
						}
					: null,
			collection: {
				id: source.id,
				version: copy.listing.version,
				title: resolved.file.title,
				creator: { ...copy.listing.creator },
				entry,
				adventures: resolved.adventures.map((a) => ({ ref: { ...a.ref }, title: a.title })),
				packs: resolved.packs.map((p) => ({ ref: { ...p.ref }, title: p.title, packId: p.packId })),
				tables: resolved.tables
			},
			// The GM's own homebrew stays; the collection's is what this version names.
			packs: [
				...packsAsWritten(story).filter((_, i) => !theirs.has(story.packs![i].id)),
				...resolved.packs.map((p) => ({ pack: packs!.content(p.packId), owner: p.creator.id }))
			],
			entitlements: [
				entitlementOf(source.id, may!),
				'copy' in pick ? pick.entitlement : null,
				...resolved.packs.map((p) => p.entitlement)
			].filter((e): e is Entitlement => e !== null)
		};
	}

	/** GM: reviews or makes a move of the story's library content to another version (milestone 55). */
	async function moveStory(
		ws: WebSocket,
		room: Room,
		player: Player,
		msg: Extract<ClientMessage, { type: 'adventure_upgrade' }>
	): Promise<void> {
		if (player.role !== 'gm') return sendError(ws, 'forbidden', 'Only the GM can do that.');
		// A review only reads; moving the story is a whole-room change, like a load.
		const limiter = msg.op === 'apply' ? sceneLimiter : creatorLimiter;
		if (!limiter.take(player.id))
			return sendError(ws, 'rate_limited', 'Give it a moment before trying again.');
		const story = room.adventure;
		if (!story) return sendError(ws, 'invalid_message', 'No story is being played.');
		let target: MoveTarget | string;
		try {
			target = await moveTarget(room, story, msg.what, msg.version);
		} catch (err) {
			console.error('[library] reading failed', err);
			return sendError(ws, 'persistence_failed', 'The library could not be reached. Try again.');
		}
		if (typeof target === 'string') return sendError(ws, 'invalid_message', target);
		// The room may have moved on while the library was busy.
		if (rooms.get(room.id) !== room || room.adventure !== story) return;
		const { review, next } = prepareMove(room, target);
		if (msg.op === 'review' || !next)
			return send(ws, { type: 'upgrade_review', review, applied: false });
		room.adventure = next;
		resetRoom(room);
		announce(
			room,
			postSystem(
				room,
				`${player.name} moved the story ${review.rollback ? 'back ' : ''}to version ${review.to} of ${review.title}.`
			)
		);
		send(ws, { type: 'upgrade_review', review, applied: true });
	}

	/** Someone who played a library adventure rates it, once the story is over. */
	async function rate(ws: WebSocket, room: Room, player: Player, stars: number): Promise<void> {
		const reason = adventure.cannotRate(room, player);
		if (reason) return sendError(ws, 'forbidden', reason);
		if (!chatLimiter.take(player.id)) return sendError(ws, 'rate_limited', 'Slow down a little.');
		const story = room.adventure!;
		const source = story.library!;
		// One rating per GM (by their key), and per player at this table.
		const rater =
			player.role === 'gm' && room.gmOwner
				? room.gmOwner
				: createHash('sha256').update(`thirdfold-rater:${room.id}:${player.id}`).digest('hex');
		try {
			await libraryStore.rate(source.id, rater, stars);
		} catch (err) {
			if (err instanceof LibraryError) return sendError(ws, 'adventure_not_found', err.message);
			console.error('[library] rating failed', err);
			return sendError(ws, 'persistence_failed', 'Your rating could not be kept. Try again.');
		}
		if (room.adventure !== story) return;
		(story.rated ??= new Map()).set(player.id, stars);
		syncRoom(room);
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
		message: string,
		readonly diagnostics: Diagnostic[] = []
	) {
		super(message);
	}
}
