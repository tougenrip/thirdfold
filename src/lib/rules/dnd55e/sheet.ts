// The fifth edition character sheet's details, as the server sends them in a
// character's card (`CharacterCard.details` with rules "dnd-5.5e"): who the
// character is (its choices), what the rules work out from them, and the
// rules text of its features. Every number here is the server's; the page
// only lays it out. Live values (hit points, conditions, resources spent)
// come beside it in the character's status. Plain data, relative imports only.

export interface SheetText {
	name: string;
	text: string;
}

export interface SheetFeature extends SheetText {
	/** Where it comes from: "Species", "Class", "Subclass", "Feat". */
	from: string;
	/** The class level it is gained at, for class and subclass features. */
	level: number | null;
}

export interface SheetWeapon {
	name: string;
	/** e.g. "1d8 slashing". */
	damage: string;
	properties: string[];
	mastery: string;
	/** Whether the character uses its mastery property. */
	mastered: boolean;
}

export interface DndSheetDetails {
	/** The player's choices, as the sheet names them. */
	choices: {
		species: string;
		/** A species' own options, e.g. "Lineage: High Elf". */
		speciesOptions: { label: string; value: string }[];
		background: string;
		class: string;
		subclass: string | null;
		level: number;
		/** How the base scores were set, e.g. "Standard array". */
		scores: string;
		/** The base scores before increases, and what raised them. */
		base: { id: string; name: string; score: number; increase: number }[];
		skills: string[];
		expertise: string[];
		fightingStyle: string | null;
		weaponMasteries: string[];
		/** Choices kept but not yet played by the rules (spells, tools), by name. */
		kept: { name: string; value: string }[];
	};
	/** Numbers the rules work out, beyond the card's. */
	derived: {
		initiative: number;
		/** In feet. */
		speed: number;
		passivePerception: number;
		hitDie: number;
		hitDice: number;
	};
	features: SheetFeature[];
	feats: SheetText[];
	proficiencies: { armor: string[]; weapons: string; tools: string[] };
	equipment: { armor: string | null; shield: boolean; weapons: SheetWeapon[] };
	spellcasting: {
		ability: string;
		saveDc: number;
		attackBonus: number;
		cantrips: number;
		prepared: number;
	} | null;
}
