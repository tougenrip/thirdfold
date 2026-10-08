// Characters players build for a story under its rules (the ruleset's
// builder), kept on the story beside the adventure's own characters and
// played exactly like them: `withBuilt` is the adventure with them added,
// which is what the engine reads as the story's content.

import type { CharacterDef } from '../../src/lib/adventure/characters';
import type { AdventureDef } from '../../src/lib/adventure/define';
import type { JsonData } from '../rules/ruleset';

export interface BuiltCharacter {
	def: CharacterDef;
	/** What the ruleset's builder saved it as, to restore it with. */
	saved: JsonData;
}

/** The most characters players may build for one story. */
export const BUILT_MAX = 8;
/** Built characters' ids: pc-1, pc-2, … */
export const BUILT_ID = /^pc-[1-9][0-9]?$/;

const merged = new WeakMap<
	ReadonlyMap<string, BuiltCharacter>,
	{ base: AdventureDef; def: AdventureDef }
>();

/** The adventure with its built characters among its characters (the same object when there are none). */
export function withBuilt(
	A: AdventureDef,
	built: ReadonlyMap<string, BuiltCharacter> | undefined
): AdventureDef {
	if (!built?.size) return A;
	const known = merged.get(built);
	if (known && known.base === A) return known.def;
	const def: AdventureDef = {
		...A,
		characters: {
			...A.characters,
			...Object.fromEntries([...built].map(([id, b]) => [id, b.def]))
		}
	};
	merged.set(built, { base: A, def });
	return def;
}

/** The first free id for a built character. */
export function nextBuiltId(A: AdventureDef): string | null {
	for (let n = 1; n <= 99; n++) {
		const id = `pc-${n}`;
		if (!Object.hasOwn(A.characters, id)) return id;
	}
	return null;
}
