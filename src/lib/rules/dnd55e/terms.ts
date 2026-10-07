// The abilities and skills of the fifth edition rules (SRD 5.2.1), by id and
// name, for the builder to offer (milestone 57); a test matches them to the
// rules' own. Kept apart from the pregens so a page loads only these.

/**
 * The abilities and skills a fifth edition check or save names (the SRD's),
 * for the builder to offer: a check takes either, a saving throw an ability.
 */
export const DND_ABILITIES = [
	{ id: 'str', name: 'Strength' },
	{ id: 'dex', name: 'Dexterity' },
	{ id: 'con', name: 'Constitution' },
	{ id: 'int', name: 'Intelligence' },
	{ id: 'wis', name: 'Wisdom' },
	{ id: 'cha', name: 'Charisma' }
] as const;

export const DND_SKILLS = [
	{ id: 'acrobatics', name: 'Acrobatics' },
	{ id: 'animal-handling', name: 'Animal Handling' },
	{ id: 'arcana', name: 'Arcana' },
	{ id: 'athletics', name: 'Athletics' },
	{ id: 'deception', name: 'Deception' },
	{ id: 'history', name: 'History' },
	{ id: 'insight', name: 'Insight' },
	{ id: 'intimidation', name: 'Intimidation' },
	{ id: 'investigation', name: 'Investigation' },
	{ id: 'medicine', name: 'Medicine' },
	{ id: 'nature', name: 'Nature' },
	{ id: 'perception', name: 'Perception' },
	{ id: 'performance', name: 'Performance' },
	{ id: 'persuasion', name: 'Persuasion' },
	{ id: 'religion', name: 'Religion' },
	{ id: 'sleight-of-hand', name: 'Sleight of Hand' },
	{ id: 'stealth', name: 'Stealth' },
	{ id: 'survival', name: 'Survival' }
] as const;
