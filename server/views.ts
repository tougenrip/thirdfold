// Per-viewer views of a room. With fog of war on, each client gets only what
// it may see: players their own tokens' vision plus GM reveals, spectators
// the whole party's, and the GM everything (with the party's visibility
// alongside, to shade the map). Filtering happens here, on the server, so
// hidden tokens and walls never reach a client that should not see them.
//
// After every change the game server recomputes each viewer's view and sends
// only the difference from what that viewer was last sent (diffView).

import type { AdventureView } from '../src/lib/adventure/adventure';
import type { ChatMessage } from '../src/lib/game/chat';
import type { Ambient, Light } from '../src/lib/game/lights';
import { cellsBeside, unitEdges, type Obstacles, type SceneObject } from '../src/lib/game/objects';
import { footprintCells, obstaclesFor, type Prop } from '../src/lib/game/props';
import { roomAround, roomBoundary } from '../src/lib/game/rooms';
import { encodeLevels, knownLevels } from '../src/lib/game/terrain';
import type { RoomSnapshot, ServerMessage } from '../src/lib/game/protocol';
import type { Token } from '../src/lib/game/token';
import {
	cellIndex,
	emptyMask,
	encodeMask,
	type CellMask,
	type FogView,
	type SightCache
} from '../src/lib/game/visibility';
import { hiddenPropIds } from './adventure/engine';
import { lightFor, sightsFor } from './scene';
import { adventureView } from './adventure/view';
import { toPublicPlayer, type Player, type Room } from './rooms';

export interface View {
	tokens: Token[];
	objects: SceneObject[];
	props: Prop[];
	lights: Light[];
	ambient: Ambient;
	fog: FogView;
	adventure: AdventureView | null;
	/** Levels of the ground this viewer knows (explored cells), or null for a flat table. */
	terrain: string | null;
	/** The dark areas this viewer knows (explored cells), or null for none. */
	darkness: string | null;
	paused: boolean;
	/** How the table looks (an environment asset's id): the same for everyone. */
	environment: string | null;
}

type SceneView = Omit<View, 'adventure' | 'terrain' | 'darkness' | 'paused' | 'environment'>;

const noFog = (room: Room): FogView => ({
	enabled: false,
	visible: '',
	explored: '',
	shared: room.fog.shared
});

/** Per-change facts shared by every viewer's view; computed once per sync. */
export interface SceneContext {
	blocked: Obstacles;
	/** Cells lit enough to see, when it matters (the dark, dark areas); null means "everything is lit". */
	lit: CellMask | null;
	/** The room (walled-in space, see rooms.ts) each player-owned token stands in; none on open ground. */
	rooms: Map<string, number[]>;
	/** Each sight worked out once, and kept across syncs while the obstacles stay the same. */
	sights: SightCache;
}

export function sceneContext(room: Room): SceneContext {
	const blocked = obstaclesFor(room.grid, room.objects.values(), room.props.values(), room.terrain);
	const sights = sightsFor(room, blocked);
	const lit = lightFor(room, blocked, Date.now(), sights.add);
	const boundary = roomBoundary(room.objects.values());
	const rooms = new Map<string, number[]>();
	if (room.fog.enabled) {
		for (const t of room.tokens.values()) {
			if (!t.ownerId) continue;
			const cells = roomAround(room.grid, boundary, t.pos);
			if (cells) rooms.set(t.id, cells);
		}
	}
	return { blocked, lit, rooms, sights };
}

/**
 * Cells a set of players can see right now: their tokens' vision plus the
 * GM's reveals. In the dark a token sees only lit cells (and its own).
 */
function visionOf(room: Room, playerIds: ReadonlySet<string>, ctx: SceneContext): CellMask {
	const mask = room.fog.revealed.slice();
	for (const t of room.tokens.values()) {
		if (!t.ownerId || !playerIds.has(t.ownerId)) continue;
		const sight = ctx.sights.sight(room.grid, t.pos, t.vision);
		if (!ctx.lit) {
			for (let i = 0; i < sight.length; i++) if (sight[i]) mask[i] = 1;
			continue;
		}
		const own = cellIndex(room.grid, t.pos);
		for (let i = 0; i < sight.length; i++) if (sight[i] && (ctx.lit[i] || i === own)) mask[i] = 1;
	}
	return mask;
}

function partyIds(room: Room): Set<string> {
	return new Set([...room.players.values()].filter((p) => p.role === 'player').map((p) => p.id));
}

function mergeInto(target: CellMask, source: CellMask): void {
	for (let i = 0; i < target.length; i++) if (source[i]) target[i] = 1;
}

/** Whether a wall or door touches any cell in `mask`, i.e. a viewer could know it is there. */
function touches(room: Room, o: SceneObject, mask: CellMask): boolean {
	return unitEdges(o.a, o.b).some((e) =>
		cellsBeside(room.grid, e).some((c) => mask[cellIndex(room.grid, c)])
	);
}

/**
 * Computes what `viewer` may see now. For players and spectators this also
 * records newly seen cells as explored, so call it once per viewer per change.
 */
export function viewFor(room: Room, viewer: Player, ctx: SceneContext = sceneContext(room)): View {
	const scene = sceneViewFor(room, viewer, ctx);
	// Secret things (the GM's hidden tokens and props, the story's unfound objects) stay off
	// players' and spectators' tables, fog or not. A player still sees their own tokens.
	if (viewer.role !== 'gm') {
		const hidden = hiddenPropIds(room);
		scene.props = scene.props.filter((p) => !p.hidden && !hidden.has(p.id));
		scene.tokens = scene.tokens.filter((t) => !t.hidden || t.ownerId === viewer.id);
	}
	const known = room.fog.enabled && viewer.role !== 'gm' ? viewer.explored : null;
	const tokenIds = new Set(scene.tokens.map((t) => t.id));
	// The ground's shape is scenery like walls: known where explored.
	const terrain = room.terrain && encodeLevels(knownLevels(room.terrain, known));
	const darkness = room.darkness && knownDarkness(room.darkness, known);
	return {
		...scene,
		adventure: adventureView(room, viewer, tokenIds, known),
		terrain,
		darkness,
		paused: room.paused,
		environment: room.environment
	};
}

/** The dark areas among the cells a viewer knows (all of them for null), or null if it knows none. */
function knownDarkness(darkness: CellMask, known: CellMask | null): string | null {
	if (!known) return encodeMask(darkness);
	const mask = darkness.map((v, i) => (v && known[i] ? 1 : 0));
	return mask.some((v) => v) ? encodeMask(mask) : null;
}

function sceneViewFor(room: Room, viewer: Player, ctx: SceneContext): SceneView {
	const allTokens = [...room.tokens.values()];
	const allObjects = [...room.objects.values()];
	const allLights = [...room.lights.values()];
	const allProps = [...room.props.values()];
	const ambient = room.ambient;
	if (!room.fog.enabled) {
		return {
			tokens: allTokens,
			objects: allObjects,
			props: allProps,
			lights: allLights,
			ambient,
			fog: noFog(room)
		};
	}

	if (viewer.role === 'gm') {
		// The GM sees everything; the fog view shows what the party sees, for shading.
		const party = partyIds(room);
		const explored = emptyMask(room.grid);
		for (const p of room.players.values()) if (party.has(p.id)) mergeInto(explored, p.explored);
		const visible = visionOf(room, party, ctx);
		mergeInto(explored, visible);
		return {
			tokens: allTokens,
			objects: allObjects,
			props: allProps,
			lights: allLights,
			ambient,
			fog: {
				enabled: true,
				visible: encodeMask(visible),
				explored: encodeMask(explored),
				shared: room.fog.shared
			}
		};
	}

	// A player sees through their own tokens, or the whole party's when sight is shared;
	// a spectator always through the party's.
	const eyes = viewer.role === 'player' && !room.fog.shared ? new Set([viewer.id]) : partyIds(room);
	const visible = visionOf(room, eyes, ctx);
	mergeInto(viewer.explored, visible);
	// Standing in a room, you learn its layout: walls, doors and furniture, not who is in it.
	for (const t of room.tokens.values()) {
		const cells = t.ownerId && eyes.has(t.ownerId) ? ctx.rooms.get(t.id) : undefined;
		if (cells) for (const i of cells) viewer.explored[i] = 1;
	}
	const at = (t: Token) => visible[cellIndex(room.grid, t.pos)] === 1;
	return {
		tokens: allTokens.filter((t) => t.ownerId === viewer.id || at(t)),
		objects: allObjects.filter((o) => touches(room, o, viewer.explored)),
		// Props and light fixtures are like walls: known once their cells have been seen.
		props: allProps.filter((p) =>
			footprintCells(p).some((c) => viewer.explored[cellIndex(room.grid, c)] === 1)
		),
		lights: allLights.filter((l) => viewer.explored[cellIndex(room.grid, l.pos)] === 1),
		ambient,
		fog: {
			enabled: true,
			visible: encodeMask(visible),
			explored: encodeMask(viewer.explored),
			shared: room.fog.shared
		}
	};
}

export function canSeeLogEntry(viewer: Player, message: ChatMessage): boolean {
	const audience = 'audience' in message ? message.audience : undefined;
	if (!audience || viewer.role === 'gm') return true;
	return audience !== 'gm' && audience.players.includes(viewer.id);
}

export function snapshotFor(room: Room, viewer: Player, view: View): RoomSnapshot {
	return {
		id: room.id,
		sceneName: room.sceneName,
		grid: { ...room.grid },
		players: [...room.players.values()].map(toPublicPlayer),
		tokens: view.tokens.map((t) => structuredClone(t)),
		objects: view.objects.map((o) => structuredClone(o)),
		props: view.props.map((p) => structuredClone(p)),
		lights: view.lights.map((l) => structuredClone(l)),
		ambient: view.ambient,
		fog: view.fog,
		log: room.log.filter((m) => canSeeLogEntry(viewer, m)),
		adventure: view.adventure && structuredClone(view.adventure),
		terrain: view.terrain,
		darkness: view.darkness,
		paused: view.paused,
		environment: view.environment
	};
}

/** What a viewer was last sent, by id, as JSON for cheap comparison. */
export interface SentView {
	tokens: Map<string, string>;
	objects: Map<string, string>;
	props: Map<string, string>;
	lights: Map<string, string>;
	ambient: Ambient;
	fog: string;
	adventure: string;
	terrain: string | null;
	darkness: string | null;
	paused: boolean;
	environment: string | null;
}

export function sentFrom(view: View): SentView {
	return {
		tokens: new Map(view.tokens.map((t) => [t.id, JSON.stringify(t)])),
		objects: new Map(view.objects.map((o) => [o.id, JSON.stringify(o)])),
		props: new Map(view.props.map((p) => [p.id, JSON.stringify(p)])),
		lights: new Map(view.lights.map((l) => [l.id, JSON.stringify(l)])),
		ambient: view.ambient,
		fog: JSON.stringify(view.fog),
		adventure: JSON.stringify(view.adventure),
		terrain: view.terrain,
		darkness: view.darkness,
		paused: view.paused,
		environment: view.environment
	};
}

/**
 * Messages that bring a client from `prev` to `view`. A token that only
 * changed position is sent as a move (so it animates); one that left the
 * viewer's sight is sent as deleted, one that came into sight as upserted.
 */
export function diffView(prev: SentView, view: View, movedBy = ''): ServerMessage[] {
	const messages: ServerMessage[] = [];

	const upserted = view.objects.filter((o) => prev.objects.get(o.id) !== JSON.stringify(o));
	const ids = new Set(view.objects.map((o) => o.id));
	const removed = [...prev.objects.keys()].filter((id) => !ids.has(id));
	if (upserted.length || removed.length) {
		messages.push({ type: 'objects_changed', upserted: structuredClone(upserted), removed });
	}

	const propsUp = view.props.filter((p) => prev.props.get(p.id) !== JSON.stringify(p));
	const propIds = new Set(view.props.map((p) => p.id));
	const propsGone = [...prev.props.keys()].filter((id) => !propIds.has(id));
	if (propsUp.length || propsGone.length) {
		messages.push({
			type: 'props_changed',
			upserted: structuredClone(propsUp),
			removed: propsGone
		});
	}

	const lightsUp = view.lights.filter((l) => prev.lights.get(l.id) !== JSON.stringify(l));
	const lightIds = new Set(view.lights.map((l) => l.id));
	const lightsGone = [...prev.lights.keys()].filter((id) => !lightIds.has(id));
	if (lightsUp.length || lightsGone.length) {
		messages.push({
			type: 'lights_changed',
			upserted: structuredClone(lightsUp),
			removed: lightsGone
		});
	}
	if (prev.ambient !== view.ambient)
		messages.push({ type: 'ambient_update', ambient: view.ambient });

	if (prev.fog !== JSON.stringify(view.fog)) messages.push({ type: 'fog_update', fog: view.fog });
	if (prev.terrain !== view.terrain) {
		messages.push({ type: 'terrain_update', terrain: view.terrain });
	}
	if (prev.darkness !== view.darkness) {
		messages.push({ type: 'darkness_update', darkness: view.darkness });
	}
	if (prev.paused !== view.paused) messages.push({ type: 'pause_update', paused: view.paused });
	if (prev.environment !== view.environment) {
		messages.push({ type: 'environment_update', environment: view.environment });
	}

	const tokenIds = new Set(view.tokens.map((t) => t.id));
	for (const id of prev.tokens.keys()) {
		if (!tokenIds.has(id)) messages.push({ type: 'token_deleted', tokenId: id });
	}
	for (const t of view.tokens) {
		const before = prev.tokens.get(t.id);
		const now = JSON.stringify(t);
		if (before === now) continue;
		const old = before ? (JSON.parse(before) as Token) : null;
		if (old && JSON.stringify({ ...old, pos: t.pos }) === now) {
			messages.push({ type: 'token_moved', tokenId: t.id, pos: { ...t.pos }, byPlayerId: movedBy });
		} else {
			messages.push({ type: 'token_upserted', token: structuredClone(t) });
		}
	}
	// Last, so the tokens it refers to have arrived.
	if (prev.adventure !== JSON.stringify(view.adventure)) {
		messages.push({ type: 'adventure_update', adventure: structuredClone(view.adventure) });
	}
	return messages;
}

/** Views for every viewer, computing players and spectators before the GM (whose shading merges their explored cells). */
export function viewsFor(room: Room, viewers: Iterable<Player>): Map<Player, View> {
	const list = [...viewers].sort((a, b) => Number(a.role === 'gm') - Number(b.role === 'gm'));
	const ctx = sceneContext(room);
	return new Map(list.map((p) => [p, viewFor(room, p, ctx)]));
}
