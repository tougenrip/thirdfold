// Who may do what. The server enforces these on every request; the client
// uses the same functions only to decide what UI to offer.

import type { SquareGrid } from './grid';
import { cellsBeside, type Door } from './objects';
import type { Role } from './protocol';
import type { Token } from './token';

export interface Actor {
	id: string;
	role: Role;
}

/** The GM moves anything; a player moves only tokens assigned to them; spectators move nothing. */
export function canMoveToken(actor: Actor, token: Token): boolean {
	if (actor.role === 'gm') return true;
	return actor.role === 'player' && token.ownerId === actor.id;
}

/** Creating, editing, assigning and deleting tokens and scene content. */
export function canEditScene(actor: Actor): boolean {
	return actor.role === 'gm';
}

/**
 * The GM opens and closes any door. A player needs one of their tokens on a
 * cell beside it, as if reaching for the handle. Spectators never can.
 */
export function canUseDoor(
	actor: Actor,
	door: Door,
	tokens: Iterable<Token>,
	grid: SquareGrid
): boolean {
	if (actor.role === 'gm') return true;
	if (actor.role !== 'player') return false;
	const beside = cellsBeside(grid, door);
	for (const t of tokens) {
		if (t.ownerId !== actor.id) continue;
		if (beside.some((c) => c.x === t.pos.x && c.y === t.pos.y)) return true;
	}
	return false;
}
