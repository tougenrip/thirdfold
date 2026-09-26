// A fifth edition character at an adventure's table: the adventure's
// `CharacterDef` (what the engine and the rules read) made from a derived
// character. The numbers (hit points, Armor Class, speed, scores,
// proficiencies, initiative) all come from the character; what it looks
// like and does at this table (name, colour, introduction, its actions and
// the ability each attack uses) is the adventure's until equipment and
// spells are modelled (milestones 47 and 48).

import type { CardResource } from '../../../../src/lib/adventure/adventure';
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
	/** The full sheet and its resources (sheetDetails), for a character built from its choices. */
	full?: { details: DndSheetDetails; resources: CardResource[] }
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
						resources: full.resources as unknown as RulesData[]
					}
				: {})
		}
	};
}
