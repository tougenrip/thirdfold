// Authoritative scene edits. Every function takes the acting player and
// checks permission and validity before touching the room.

import { randomUUID } from 'node:crypto';
import { inBounds, type GridPos } from '../src/lib/game/grid';
import { canEditScene, canMoveToken } from '../src/lib/game/permissions';
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
): Result<{ token: Token }> {
	const token = room.tokens.get(tokenId);
	if (!token) return fail('token_not_found', 'That token no longer exists.');
	if (!canMoveToken(actor, token)) return fail('forbidden', 'You cannot move that token.');
	const cell = checkCell(room, to, token.id);
	if (!cell.ok) return cell;
	token.pos = { x: to.x, y: to.y };
	return { ok: true, token };
}

export function updateToken(
	room: Room,
	actor: Player,
	tokenId: string,
	patch: TokenPatch
): Result<{ token: Token }> {
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

	token.name = name;
	if (patch.color !== undefined) token.color = patch.color;
	if (patch.ownerId !== undefined) token.ownerId = patch.ownerId;
	return { ok: true, token };
}

export function deleteToken(room: Room, actor: Player, tokenId: string): Result<object> {
	if (!canEditScene(actor)) return FORBIDDEN_EDIT;
	if (!room.tokens.delete(tokenId)) return fail('token_not_found', 'That token no longer exists.');
	return { ok: true };
}
