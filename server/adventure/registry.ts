// Finding an adventure's content by its id: the engine runs whatever the
// table's story is, and knows nothing of any adventure in particular. The
// built-in adventures are always here; creators' adventures (custom.ts) are
// added as tables start them or load saves of them.

import { ADVENTURES } from '../adventures';
import type { AdventureFile } from '../../src/lib/adventure/file';
import type { AdventureDef } from './define';

/** Adventures added while the server runs (tests, tools), after the built-in ones. */
const added: AdventureDef[] = [];

/** Creators' adventures, by id, oldest first, with the files they came from. */
const custom = new Map<string, { adventure: AdventureDef; file: AdventureFile }>();
/** How many creators' adventures are kept at once. */
export const CUSTOM_KEPT = 64;
/** Which adventures tables are playing right now: those are never let go. */
let inUse: () => ReadonlySet<string> = () => new Set();

/** The adventure a table starts when the GM sets up a story. */
export function defaultAdventure(): AdventureDef {
	return ADVENTURES[0];
}

/** The adventures this server offers GMs, in order. */
export function builtInAdventures(): readonly AdventureDef[] {
	return ADVENTURES;
}

/** An adventure by id, or undefined if this server doesn't have it. */
export function findAdventure(id: string): AdventureDef | undefined {
	return [...ADVENTURES, ...added].find((a) => a.id === id) ?? custom.get(id)?.adventure;
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

/** Keeps a creator's adventure, letting go of the oldest no table plays once there are too many. */
export function addCustom(adventure: AdventureDef, file: AdventureFile): void {
	custom.delete(adventure.id);
	custom.set(adventure.id, { adventure, file });
	if (custom.size <= CUSTOM_KEPT) return;
	const playing = inUse();
	for (const id of custom.keys()) {
		if (custom.size <= CUSTOM_KEPT) break;
		if (!playing.has(id) && id !== adventure.id) custom.delete(id);
	}
}

/** The file a creator's adventure came from, or undefined for a built-in one. */
export function customFile(id: string): AdventureFile | undefined {
	return custom.get(id)?.file;
}

/** Tells the registry which adventures are being played (the game server's rooms). */
export function trackInUse(playing: () => ReadonlySet<string>): void {
	inUse = playing;
}

/** Lets go of a creator's adventure (a save that carries it brings it back). */
export function forgetCustom(id: string): void {
	custom.delete(id);
}
