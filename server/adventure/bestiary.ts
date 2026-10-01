// Monsters the GM brought into a story from its rules' bestiary (the SRD's,
// under the fifth edition rules): kept on the story by kind
// (`AdventureState.bestiary`) and played like the adventure's own enemies,
// so a fight, a save and a restart treat them alike. Only kinds the rules
// can play are ever added; a save naming one they can't is refused.

import type { AdventureDef, EnemyDef } from './define';
import type { Ruleset } from '../rules/ruleset';

/** Most monster kinds one story brings in. */
export const BESTIARY_MAX = 32;

const merged = new WeakMap<readonly string[], { base: AdventureDef; def: AdventureDef }>();

/** The adventure with the monsters brought into the story among its enemies. */
export function withBestiary(
	A: AdventureDef,
	kinds: readonly string[] | undefined,
	rules: Ruleset | undefined
): AdventureDef {
	if (!kinds?.length || !rules?.bestiary) return A;
	const known = merged.get(kinds);
	if (known && known.base === A) return known.def;
	const enemies: Record<string, EnemyDef> = { ...A.enemies };
	for (const kind of kinds) {
		const enemy = Object.hasOwn(A.enemies, kind) ? undefined : rules.bestiary.enemy(kind);
		if (enemy) enemies[kind] = enemy;
	}
	const def: AdventureDef = { ...A, enemies };
	merged.set(kinds, { base: A, def });
	return def;
}
