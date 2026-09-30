// A fifth edition character at an adventure's table: the adventure's
// `CharacterDef` (what the engine and the rules read) made from a derived
// character. The numbers (hit points, Armor Class, speed, scores,
// proficiencies, initiative) all come from the character; what it looks
// like at this table (name, colour, introduction) is the adventure's; its
// actions come from what it holds (builder.ts `actionsOf`).

import type { CardItem, CardResource } from '../../../../src/lib/adventure/adventure';
import type { CharacterDef, RulesData } from '../../../../src/lib/adventure/characters';
import type { DndSheetDetails } from '../../../../src/lib/rules/dnd55e/sheet';
import { ABILITIES, type Ability } from '../core';
import type { DerivedCharacter } from './derive';

/** Feet per cell of the table's grid. */
export const FEET_PER_CELL = 5;

export type Presentation = Omit<CharacterDef, 'hp' | 'armor' | 'speed' | 'sheet'> & {
	/** The ability each attack action uses. */
	attacks: Record<string, Ability>;
	/** Actions that take a bonus action. */
	bonusActions: string[];
};

export function characterDefOf(
	derived: DerivedCharacter,
	presentation: Presentation,
	/**
	 * What a character built from its choices adds: the full sheet and its
	 * resources (sheetDetails), its inventory as the card shows it, attacks
	 * without proficiency, and the character itself as saved (for the rules
	 * to change what it carries).
	 */
	full?: {
		details: DndSheetDetails;
		resources: CardResource[];
		inventory?: CardItem[];
		unproficient?: string[];
		saved?: RulesData;
		/** A caster's spellcasting ability, the spell each action casts, and its slot resources' levels. */
		casting?: Ability;
		spells?: Record<string, string>;
		slots?: Record<string, number>;
	}
): CharacterDef {
	const { attacks, bonusActions, ...def } = presentation;
	const skills = Object.entries(derived.skills);
	return {
		...def,
		hp: derived.hitPoints.max,
		armor: derived.armorClass,
		speed: Math.floor(derived.speed / FEET_PER_CELL),
		sheet: {
			title: derived.title,
			level: derived.level,
			abilities: { ...derived.scores },
			saves: ABILITIES.filter((a) => derived.saves[a.id].proficient).map((a) => a.id),
			skills: skills.filter(([, s]) => s.proficient).map(([id]) => id),
			expertise: skills.filter(([, s]) => s.expertise).map(([id]) => id),
			initiative: derived.initiative,
			attacks: { ...attacks },
			bonusActions: [...bonusActions],
			...(full
				? {
						details: full.details as unknown as RulesData,
						resources: full.resources as unknown as RulesData[],
						...(full.inventory
							? {
									inventory: full.inventory as unknown as RulesData[],
									carrying: { ...derived.carrying }
								}
							: {}),
						...(full.unproficient?.length ? { unproficient: [...full.unproficient] } : {}),
						...(full.saved ? { saved: full.saved } : {}),
						...(full.casting
							? { casting: full.casting, spells: { ...full.spells }, slots: { ...full.slots } }
							: {})
					}
				: {})
		}
	};
}
