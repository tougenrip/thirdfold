// What characters own and wield, under rules with equipment (ruleset.ts
// `Equipment`), as the story keeps it: a character whose gear changed is
// restored through its rules' builder and kept on the story (a built one
// replaced among `built`, an adventure's own among `kept`), and things put
// down on the table lie in piles (`AdventureState.piles`), each shown by a
// `gear-pile` prop on its cell. The prop is only a marker: what lies there
// is the rules' data, never a prop's state, and a pile is not a world object.

import type { AdventureDef } from '../../src/lib/adventure/define';
import type { GridPos } from '../../src/lib/game/grid';
import type { Prop } from '../../src/lib/game/props';
import type { Room } from '../rooms';
import type { JsonData, Ruleset } from '../rules/ruleset';
import { withBuilt, type BuiltCharacter } from './built';
import { packsOf } from './packs';
import type { AdventureState, Pile } from './state';

/** The asset that shows a pile. */
export const PILE_ASSET = 'gear-pile';
/** Pile props' ids: pile-1, pile-2, … */
export const PILE_ID = /^pile-[1-9][0-9]{0,3}$/;
/** The most piles a story keeps, and things in one pile. */
export const PILES_MAX = 40;
export const PILE_ITEMS_MAX = 20;

/** The adventure with the characters whose gear changed in play in place of its own. */
export function withKept(
	A: AdventureDef,
	kept: ReadonlyMap<string, BuiltCharacter> | undefined
): AdventureDef {
	return withBuilt(A, kept);
}

/**
 * Keeps a character's changed rules data: restored through the builder
 * (every rule checked again, every number worked out again) and stored in
 * place of what it was. `base` is the adventure's own character, whose look
 * it keeps. Returns the new definition, or why it can't be.
 */
export function keepCharacter(
	adventure: AdventureState,
	rules: Ruleset,
	base: AdventureDef,
	id: string,
	saved: JsonData
): { ok: true; def: BuiltCharacter['def'] } | { ok: false; problems: string[] } {
	if (!rules.builder) return { ok: false, problems: ['these rules keep no characters'] };
	const built = adventure.built?.has(id);
	const own = Object.hasOwn(base.characters, id) ? base.characters[id] : undefined;
	if (!built && !own) return { ok: false, problems: ['no such character'] };
	const restored = rules.builder.restore(saved, id, built ? undefined : own, packsOf(adventure));
	if (!restored.ok) return restored;
	const entry: BuiltCharacter = { def: restored.def, saved: restored.saved };
	if (built) adventure.built = new Map([...adventure.built!, [id, entry]]);
	else adventure.kept = new Map([...(adventure.kept ?? []), [id, entry]]);
	const state = adventure.characters.get(id);
	if (state && state.hp > restored.def.hp) state.hp = restored.def.hp;
	return { ok: true, def: restored.def };
}

/** The prop that shows a pile. */
export function pileProp(id: string, pos: GridPos): Prop {
	return { id, assetId: PILE_ASSET, pos: { ...pos }, rotation: 0, scale: 1 };
}

/** Shows the piles of a table on it (after the table is laid, as the party arrives). */
export function layPiles(room: Room, adventure: AdventureState): void {
	for (const [id, pile] of adventure.piles ?? [])
		if (pile.location === adventure.location) room.props.set(id, pileProp(id, pile.pos));
}

/** The pile on a cell of the current table, if any. */
export function pileAt(adventure: AdventureState, pos: GridPos): [string, Pile] | null {
	for (const entry of adventure.piles ?? [])
		if (
			entry[1].location === adventure.location &&
			entry[1].pos.x === pos.x &&
			entry[1].pos.y === pos.y
		)
			return entry;
	return null;
}

/** Puts an item down on a cell: on the pile there, or a new one. Null when there's no room for it. */
export function putDown(
	room: Room,
	adventure: AdventureState,
	pos: GridPos,
	item: { item: JsonData; name: string }
): string | null {
	const piles = new Map(adventure.piles ?? []);
	const at = pileAt(adventure, pos);
	if (at) {
		if (at[1].items.length >= PILE_ITEMS_MAX) return null;
		piles.set(at[0], { ...at[1], items: [...at[1].items, item] });
		adventure.piles = piles;
		return at[0];
	}
	if (piles.size >= PILES_MAX) return null;
	let n = 1;
	while (piles.has(`pile-${n}`) || room.props.has(`pile-${n}`)) n++;
	const id = `pile-${n}`;
	piles.set(id, { location: adventure.location, pos: { ...pos }, items: [item] });
	adventure.piles = piles;
	room.props.set(id, pileProp(id, pos));
	return id;
}

/** Takes an item off a pile; an empty pile goes, prop and all. */
export function pickUp(room: Room, adventure: AdventureState, id: string, index: number): void {
	const pile = adventure.piles?.get(id);
	if (!pile) return;
	const items = pile.items.filter((_, i) => i !== index);
	const piles = new Map(adventure.piles);
	if (items.length) piles.set(id, { ...pile, items });
	else {
		piles.delete(id);
		room.props.delete(id);
	}
	adventure.piles = piles;
}
