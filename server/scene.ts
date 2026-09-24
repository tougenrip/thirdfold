// Authoritative scene edits. Every function takes the acting player and
// checks permission and validity before touching the room.

import { randomUUID } from 'node:crypto';
import { inBounds, type GridPos } from '../src/lib/game/grid';
import {
	blockingEdges,
	cutWall,
	edgeKey,
	isReachable,
	isUnitEdge,
	MAX_OBJECTS_PER_ROOM,
	orderCorners,
	segmentProblem,
	unitEdges,
	type Door,
	type SceneObject
} from '../src/lib/game/objects';
import { canEditScene, canMoveToken, canUseDoor } from '../src/lib/game/permissions';
import { normalizeName, type TokenPatch } from '../src/lib/game/protocol';
import { MAX_TOKENS_PER_ROOM, tokenAt, type Token } from '../src/lib/game/token';
import { fail, type Player, type Result, type Room } from './rooms';

export interface NewToken {
	name: string;
	color: string;
	pos: GridPos;
	ownerId: string | null;
}

const FORBIDDEN_EDIT = fail('forbidden', 'Only the GM can change tokens.');

/** Owners must be seated players; spectators and the GM (who moves everything anyway) are not. */
function checkOwner(room: Room, ownerId: string | null): Result<object> {
	if (ownerId === null) return { ok: true };
	return room.players.get(ownerId)?.role === 'player'
		? { ok: true }
		: fail('invalid_owner', 'Tokens can only be assigned to players in this room.');
}

function checkCell(room: Room, pos: GridPos, movingId?: string): Result<object> {
	if (!inBounds(room.grid, pos)) return fail('invalid_position', 'That cell is off the table.');
	const occupant = tokenAt(room.tokens.values(), pos);
	if (occupant && occupant.id !== movingId) {
		return fail('cell_occupied', `${occupant.name} is already on that cell.`);
	}
	return { ok: true };
}

export function createToken(room: Room, actor: Player, input: NewToken): Result<{ token: Token }> {
	if (!canEditScene(actor)) return FORBIDDEN_EDIT;
	if (room.tokens.size >= MAX_TOKENS_PER_ROOM) {
		return fail('limit_reached', `A room can hold at most ${MAX_TOKENS_PER_ROOM} tokens.`);
	}
	const name = normalizeName(input.name);
	if (!name) return fail('invalid_name', 'Token name must be 1-32 characters.');
	const cell = checkCell(room, input.pos);
	if (!cell.ok) return cell;
	const owner = checkOwner(room, input.ownerId);
	if (!owner.ok) return owner;

	const token: Token = {
		id: randomUUID(),
		name,
		color: input.color,
		pos: { x: input.pos.x, y: input.pos.y },
		ownerId: input.ownerId
	};
	room.tokens.set(token.id, token);
	return { ok: true, token };
}

export function moveToken(
	room: Room,
	actor: Player,
	tokenId: string,
	to: GridPos
): Result<{ token: Token; from: GridPos }> {
	const token = room.tokens.get(tokenId);
	if (!token) return fail('token_not_found', 'That token no longer exists.');
	if (!canMoveToken(actor, token)) return fail('forbidden', 'You cannot move that token.');
	const cell = checkCell(room, to, token.id);
	if (!cell.ok) return cell;
	// Players walk: the destination must be reachable without crossing walls or
	// closed doors. The GM places freely.
	if (
		actor.role !== 'gm' &&
		!isReachable(room.grid, blockingEdges(room.objects.values()), token.pos, to)
	) {
		return fail('no_path', "There's no way through to that cell.");
	}
	const from = token.pos;
	token.pos = { x: to.x, y: to.y };
	return { ok: true, token, from };
}

export function updateToken(
	room: Room,
	actor: Player,
	tokenId: string,
	patch: TokenPatch
): Result<{ token: Token; previousOwnerId: string | null }> {
	if (!canEditScene(actor)) return FORBIDDEN_EDIT;
	const token = room.tokens.get(tokenId);
	if (!token) return fail('token_not_found', 'That token no longer exists.');

	// Validate everything before applying anything, so a bad field leaves the token untouched.
	const name = patch.name === undefined ? token.name : normalizeName(patch.name);
	if (!name) return fail('invalid_name', 'Token name must be 1-32 characters.');
	if (patch.ownerId !== undefined) {
		const owner = checkOwner(room, patch.ownerId);
		if (!owner.ok) return owner;
	}

	const previousOwnerId = token.ownerId;
	token.name = name;
	if (patch.color !== undefined) token.color = patch.color;
	if (patch.ownerId !== undefined) token.ownerId = patch.ownerId;
	return { ok: true, token, previousOwnerId };
}

export function deleteToken(room: Room, actor: Player, tokenId: string): Result<{ token: Token }> {
	if (!canEditScene(actor)) return FORBIDDEN_EDIT;
	const token = room.tokens.get(tokenId);
	if (!token) return fail('token_not_found', 'That token no longer exists.');
	room.tokens.delete(tokenId);
	return { ok: true, token };
}

export interface ObjectChanges {
	upserted: SceneObject[];
	removed: string[];
}

export function createObject(
	room: Room,
	actor: Player,
	kind: 'wall' | 'door',
	a: GridPos,
	b: GridPos
): Result<ObjectChanges> {
	if (!canEditScene(actor)) return fail('forbidden', 'Only the GM can build walls and doors.');
	if (room.objects.size >= MAX_OBJECTS_PER_ROOM) {
		return fail(
			'limit_reached',
			`A room can hold at most ${MAX_OBJECTS_PER_ROOM} walls and doors.`
		);
	}
	const problem = segmentProblem(room.grid, a, b);
	if (problem) return fail('invalid_object', problem);
	if (kind === 'door' && !isUnitEdge(a, b)) {
		return fail('invalid_object', 'A door spans exactly one grid square.');
	}
	const ends = orderCorners({ x: a.x, y: a.y }, { x: b.x, y: b.y });

	// Nothing may overlap an existing door.
	const doorEdges = new Set<string>();
	for (const o of room.objects.values()) if (o.kind === 'door') doorEdges.add(edgeKey(o));
	if (unitEdges(ends.a, ends.b).some((e) => doorEdges.has(edgeKey(e)))) {
		return fail('edge_occupied', 'There is already a door there.');
	}

	if (kind === 'wall') {
		const wall: SceneObject = { id: randomUUID(), kind: 'wall', ...ends };
		room.objects.set(wall.id, wall);
		return { ok: true, upserted: [wall], removed: [] };
	}

	// A door placed in a wall cuts a doorway: split every wall covering that edge.
	const door: Door = { id: randomUUID(), kind: 'door', ...ends, open: false };
	const changes: ObjectChanges = { upserted: [], removed: [] };
	for (const o of [...room.objects.values()]) {
		if (o.kind !== 'wall') continue;
		const pieces = cutWall(o, door, randomUUID);
		if (pieces.length === 1 && pieces[0] === o) continue;
		room.objects.delete(o.id);
		for (const piece of pieces) room.objects.set(piece.id, piece);
		changes.upserted.push(...pieces);
		if (!pieces.some((p) => p.id === o.id)) changes.removed.push(o.id);
	}
	room.objects.set(door.id, door);
	changes.upserted.push(door);
	return { ok: true, ...changes };
}

export function deleteObject(
	room: Room,
	actor: Player,
	objectId: string
): Result<{ object: SceneObject }> {
	if (!canEditScene(actor)) return fail('forbidden', 'Only the GM can remove walls and doors.');
	const object = room.objects.get(objectId);
	if (!object) return fail('object_not_found', 'That wall or door no longer exists.');
	room.objects.delete(objectId);
	return { ok: true, object };
}

export function toggleDoor(room: Room, actor: Player, objectId: string): Result<{ door: Door }> {
	const door = room.objects.get(objectId);
	if (!door || door.kind !== 'door') return fail('object_not_found', 'That door no longer exists.');
	if (!canUseDoor(actor, door, room.tokens.values(), room.grid)) {
		return fail(
			'forbidden',
			actor.role === 'player'
				? 'Move one of your tokens next to the door first.'
				: 'You cannot open doors.'
		);
	}
	door.open = !door.open;
	return { ok: true, door };
}
