// Content packs a story has (homebrew, milestone 52): the GM brings a pack
// under the story's rules to the table, and from then on what those rules
// offer this story (the character creator's options, the bestiary) includes
// it, and only this story's. The story keeps each pack's id and who brought
// it (`AdventureState.packs`, replaced, never changed in place); a save
// carries the packs as written, so loading it brings them back, checked
// again, before anything that uses them is read (persist.ts). A pack stays
// while anything in the story uses it.

import type { ContentPackListing } from '../../src/lib/adventure/adventure';
import { findRuleset, type Ruleset } from '../rules/ruleset';
import type { AdventureState, StoryPack } from './state';

/** The most packs one story has. */
export const PACKS_MAX = 8;

/** The ids of the packs a story has, the scope of what its rules offer it. */
export function packsOf(adventure: AdventureState): readonly string[] {
	return adventure.packs?.map((p) => p.id) ?? [];
}

/** Whether an id (a record's, an enemy kind's) is from a pack this story doesn't have. */
export function outsidePacks(adventure: AdventureState, rules: Ruleset, id: string): boolean {
	const pack = rules.packs?.packOf(id);
	return !!pack && !packsOf(adventure).includes(pack);
}

/** The packs as the table lists them; null under rules that take none. */
export function packsView(adventure: AdventureState): ContentPackListing[] | null {
	const packs = findRuleset(adventure.rules)?.packs;
	if (!packs) return null;
	return (adventure.packs ?? []).flatMap(
		(p) => packs.listing(p.id, { owner: p.owner, visibility: 'table' }) ?? []
	);
}

/** What in the story uses a pack, in a few words, or null when nothing does. */
export function packInUse(adventure: AdventureState, pack: string): string | null {
	const uses = (data: unknown) => JSON.stringify(data).includes(`"${pack}:`);
	for (const [, c] of [...(adventure.built ?? []), ...(adventure.kept ?? [])])
		if (uses(c.saved)) return `${c.def.name} carries or knows something from it`;
	for (const [, pile] of adventure.piles ?? [])
		if (uses(pile.items)) return 'something from it lies on the table';
	if (adventure.bestiary?.some((k) => k.startsWith(`${pack}-`)))
		return 'its monsters have been brought into the story';
	return null;
}

/** A story's packs with one more. */
export function withPack(adventure: AdventureState, pack: StoryPack): void {
	adventure.packs = [...(adventure.packs ?? []), pack];
}
