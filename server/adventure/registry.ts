// Finding an adventure's content by its id: the engine runs whatever the
// table's story is, and knows nothing of any adventure in particular.

import { ADVENTURES } from '../adventures';
import type { AdventureDef } from './define';

/** Adventures added while the server runs (tests, tools), after the built-in ones. */
const added: AdventureDef[] = [];

/** The adventure a table starts when the GM sets up a story. */
export function defaultAdventure(): AdventureDef {
	return ADVENTURES[0];
}

/** An adventure by id, or undefined if this server doesn't have it. */
export function findAdventure(id: string): AdventureDef | undefined {
	return [...ADVENTURES, ...added].find((a) => a.id === id);
}

/** An adventure by id; a story can only be running if its adventure is here. */
export function contentOf(id: string): AdventureDef {
	const found = findAdventure(id);
	if (!found) throw new Error(`No adventure "${id}" on this server.`);
	return found;
}

/** Makes another adventure playable here, by its id (which must be new). */
export function addAdventure(adventure: AdventureDef): void {
	if (findAdventure(adventure.id)) throw new Error(`Adventure "${adventure.id}" is already here.`);
	added.push(adventure);
}
