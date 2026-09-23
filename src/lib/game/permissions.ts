// Who may do what. The server enforces these on every request; the client
// uses the same functions only to decide what UI to offer.

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
