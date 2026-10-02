// The homebrew packs this server holds (milestone 52), by id. A pack comes in
// when a GM attaches it to a story or a save that carries it is loaded, and
// stays while any table uses it; once there are more than `PACKS_KEPT`, the
// oldest no table uses are let go (a save carries its packs and brings them
// back). Records are looked up by id only: a record's id starts with its
// pack's, which comes from the pack's content, so knowing it means having
// the pack, and what a table may choose from is always scoped to the packs
// its story has (catalog.ts `withHomebrew`).

import { packOfId } from '../../../../src/lib/rules/dnd55e/homebrew';
import { packsInUse } from '../../ruleset';
import type { Monster } from '../monsters';
import type { SpellMechanics } from '../spells/mechanics';
import type { SrdRecord } from '../srd/records';
import type { LoadedPack } from './pack';

interface Held {
	loaded: LoadedPack;
	byId: Map<string, SrdRecord>;
}

const packs = new Map<string, Held>();
/** How many packs are held at once. */
export const PACKS_KEPT = 256;

/** Holds a checked pack (again: the newest last). */
export function holdPack(loaded: LoadedPack): void {
	packs.delete(loaded.id);
	packs.set(loaded.id, { loaded, byId: new Map(loaded.records.map((r) => [r.id, r])) });
	if (packs.size <= PACKS_KEPT) return;
	const used = packsInUse();
	for (const id of packs.keys()) {
		if (packs.size <= PACKS_KEPT) break;
		if (!used.has(id) && id !== loaded.id) packs.delete(id);
	}
}

export function heldPack(id: string): LoadedPack | undefined {
	return packs.get(id)?.loaded;
}

/** A homebrew record by id, of any held pack. */
export function homebrewRecord(id: string): SrdRecord | undefined {
	const pack = packOfId(id);
	return pack ? packs.get(pack)?.byId.get(id) : undefined;
}

/** A held homebrew spell's mechanics. */
export function homebrewMechanics(id: string): SpellMechanics | undefined {
	const pack = packOfId(id);
	return pack ? packs.get(pack)?.loaded.mechanics.get(id) : undefined;
}

/** Homebrew monsters' kinds: `hb-<pack hash>-<slug>`. */
export const HOMEBREW_KIND = /^(hb-[0-9a-f]{16})-[a-z0-9-]+$/;

/** A held homebrew monster by its kind. */
export function homebrewMonster(kind: string): Monster | undefined {
	const pack = HOMEBREW_KIND.exec(kind)?.[1];
	return pack ? packs.get(pack)?.loaded.monsters.get(kind) : undefined;
}

/** Lets go of a pack (tests). */
export function forgetPack(id: string): void {
	packs.delete(id);
}
