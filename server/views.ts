// Per-viewer views of a room. With fog of war on, each client gets only what
// it may see: players their own tokens' vision plus GM reveals, spectators
// the whole party's, and the GM everything (with the party's visibility
// alongside, to shade the map). Filtering happens here, on the server, so
// hidden tokens and walls never reach a client that should not see them.
//
// After every change the game server recomputes each viewer's view and sends
// only the difference from what that viewer was last sent (diffView).

import type { ChatMessage } from '../src/lib/game/chat';
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
	fog: FogView;
}

const NO_FOG: FogView = { enabled: false, visible: '', explored: '' };

/** Cells a set of players can see right now: their tokens' vision plus the GM's reveals. */
function visionOf(room: Room, playerIds: ReadonlySet<string>): CellMask {
	const mask = room.fog.revealed.slice();
	const blocked = blockingEdges(room.objects.values());
	for (const t of room.tokens.values()) {
		if (t.ownerId && playerIds.has(t.ownerId)) addVision(room.grid, blocked, t.pos, t.vision, mask);
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
export function viewFor(room: Room, viewer: Player): View {
	const allTokens = [...room.tokens.values()];
	const allObjects = [...room.objects.values()];
	if (!room.fog.enabled) return { tokens: allTokens, objects: allObjects, fog: NO_FOG };

	if (viewer.role === 'gm') {
		// The GM sees everything; the fog view shows what the party sees, for shading.
		const party = partyIds(room);
		const explored = emptyMask(room.grid);
		for (const p of room.players.values()) if (party.has(p.id)) mergeInto(explored, p.explored);
		const visible = visionOf(room, party);
		mergeInto(explored, visible);
		return {
			tokens: allTokens,
			objects: allObjects,
			fog: { enabled: true, visible: encodeMask(visible), explored: encodeMask(explored) }
		};
	}

	const visible = visionOf(room, viewer.role === 'player' ? new Set([viewer.id]) : partyIds(room));
	mergeInto(viewer.explored, visible);
	const at = (t: Token) => visible[cellIndex(room.grid, t.pos)] === 1;
	return {
		tokens: allTokens.filter((t) => t.ownerId === viewer.id || at(t)),
		objects: allObjects.filter((o) => touches(room, o, viewer.explored)),
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
		grid: { ...room.grid },
		players: [...room.players.values()].map(toPublicPlayer),
		tokens: view.tokens.map((t) => structuredClone(t)),
		objects: view.objects.map((o) => structuredClone(o)),
		fog: view.fog,
		log: room.log.filter((m) => canSeeLogEntry(viewer, m))
	};
}

/** What a viewer was last sent, by id, as JSON for cheap comparison. */
export interface SentView {
	tokens: Map<string, string>;
	objects: Map<string, string>;
	fog: string;
}

export function sentFrom(view: View): SentView {
	return {
		tokens: new Map(view.tokens.map((t) => [t.id, JSON.stringify(t)])),
		objects: new Map(view.objects.map((o) => [o.id, JSON.stringify(o)])),
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
	return new Map(list.map((p) => [p, viewFor(room, p)]));
}
