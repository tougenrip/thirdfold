// Per-viewer views of a room. With fog of war on, each client gets only what
// it may see: players their own tokens' vision plus GM reveals, spectators
// the whole party's, and the GM everything (with the party's visibility
// alongside, to shade the map). Filtering happens here, on the server, so
// hidden tokens and walls never reach a client that should not see them.
//
// After every change the game server recomputes each viewer's view and sends
// only the difference from what that viewer was last sent (diffView).

import type { ChatMessage } from '../src/lib/game/chat';
import { lightSources, litMask, type Ambient, type Light } from '../src/lib/game/lights';
import { blockingEdges, cellsBeside, unitEdges, type SceneObject } from '../src/lib/game/objects';
import type { RoomSnapshot, ServerMessage } from '../src/lib/game/protocol';
import type { Token } from '../src/lib/game/token';
import {
	addVision,
	cellIndex,
	emptyMask,
	encodeMask,
	type CellMask,
	type FogView
} from '../src/lib/game/visibility';
import { toPublicPlayer, type Player, type Room } from './rooms';

export interface View {
	tokens: Token[];
	objects: SceneObject[];
	lights: Light[];
	ambient: Ambient;
	fog: FogView;
}

const NO_FOG: FogView = { enabled: false, visible: '', explored: '' };

/** Per-change facts shared by every viewer's view; computed once per sync. */
export interface SceneContext {
	blocked: ReadonlySet<string>;
	/** Cells light reaches, when it matters (dark ambient); null means "everything is lit". */
	lit: CellMask | null;
}

export function sceneContext(room: Room): SceneContext {
	const blocked = blockingEdges(room.objects.values());
	const lit =
		room.ambient === 'dark'
			? litMask(room.grid, blocked, lightSources(room.lights.values(), room.tokens.values()))
			: null;
	return { blocked, lit };
}

/**
 * Cells a set of players can see right now: their tokens' vision plus the
 * GM's reveals. In the dark a token sees only lit cells (and its own).
 */
function visionOf(room: Room, playerIds: ReadonlySet<string>, ctx: SceneContext): CellMask {
	const mask = room.fog.revealed.slice();
	for (const t of room.tokens.values()) {
		if (!t.ownerId || !playerIds.has(t.ownerId)) continue;
		if (!ctx.lit) {
			addVision(room.grid, ctx.blocked, t.pos, t.vision, mask);
			continue;
		}
		const sight = emptyMask(room.grid);
		addVision(room.grid, ctx.blocked, t.pos, t.vision, sight);
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
	const allTokens = [...room.tokens.values()];
	const allObjects = [...room.objects.values()];
	const allLights = [...room.lights.values()];
	const ambient = room.ambient;
	if (!room.fog.enabled) {
		return { tokens: allTokens, objects: allObjects, lights: allLights, ambient, fog: NO_FOG };
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
			lights: allLights,
			ambient,
			fog: { enabled: true, visible: encodeMask(visible), explored: encodeMask(explored) }
		};
	}

	const visible = visionOf(
		room,
		viewer.role === 'player' ? new Set([viewer.id]) : partyIds(room),
		ctx
	);
	mergeInto(viewer.explored, visible);
	const at = (t: Token) => visible[cellIndex(room.grid, t.pos)] === 1;
	return {
		tokens: allTokens.filter((t) => t.ownerId === viewer.id || at(t)),
		objects: allObjects.filter((o) => touches(room, o, viewer.explored)),
		// Light fixtures are like walls: known once their cell has been seen.
		lights: allLights.filter((l) => viewer.explored[cellIndex(room.grid, l.pos)] === 1),
		ambient,
		fog: {
			enabled: true,
			visible: encodeMask(visible),
			explored: encodeMask(viewer.explored)
		}
	};
}

export function canSeeLogEntry(viewer: Player, message: ChatMessage): boolean {
	return !(message.kind === 'system' && message.audience === 'gm' && viewer.role !== 'gm');
}

export function snapshotFor(room: Room, viewer: Player, view: View): RoomSnapshot {
	return {
		id: room.id,
		sceneName: room.sceneName,
		grid: { ...room.grid },
		players: [...room.players.values()].map(toPublicPlayer),
		tokens: view.tokens.map((t) => structuredClone(t)),
		objects: view.objects.map((o) => structuredClone(o)),
		lights: view.lights.map((l) => structuredClone(l)),
		ambient: view.ambient,
		fog: view.fog,
		log: room.log.filter((m) => canSeeLogEntry(viewer, m))
	};
}

/** What a viewer was last sent, by id, as JSON for cheap comparison. */
export interface SentView {
	tokens: Map<string, string>;
	objects: Map<string, string>;
	lights: Map<string, string>;
	ambient: Ambient;
	fog: string;
}

export function sentFrom(view: View): SentView {
	return {
		tokens: new Map(view.tokens.map((t) => [t.id, JSON.stringify(t)])),
		objects: new Map(view.objects.map((o) => [o.id, JSON.stringify(o)])),
		lights: new Map(view.lights.map((l) => [l.id, JSON.stringify(l)])),
		ambient: view.ambient,
		fog: JSON.stringify(view.fog)
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
	return messages;
}

/** Views for every viewer, computing players and spectators before the GM (whose shading merges their explored cells). */
export function viewsFor(room: Room, viewers: Iterable<Player>): Map<Player, View> {
	const list = [...viewers].sort((a, b) => Number(a.role === 'gm') - Number(b.role === 'gm'));
	const ctx = sceneContext(room);
	return new Map(list.map((p) => [p, viewFor(room, p, ctx)]));
}
