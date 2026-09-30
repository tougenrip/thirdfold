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
	/** Whether it is in hand now. */
	held: boolean;
	/** Whether the class is trained with it (else no Proficiency Bonus). */
	trained: boolean;
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
	/** The catalog's weapons, armor and ammunition, for the GM to hand out (plain SRD data). */
	gear: { id: string; name: string; kind: string }[];
	/** What is equipped (worn armor, a Shield) and every weapon owned; the rest is the card's inventory. */
	equipment: { armor: string | null; shield: boolean; weapons: SheetWeapon[] };
	spellcasting: {
		ability: string;
		saveDc: number;
		attackBonus: number;
		cantrips: number;
		prepared: number;
		/** Its cantrips and prepared spells. */
		spells: SheetSpell[];
	} | null;
}

/** A spell a character knows or has prepared, as the SRD gives it. */
export interface SheetSpell {
	id: string;
	name: string;
	/** 0 for a cantrip. */
	level: number;
	school: string;
	castingTime: string;
	range: string;
	/** "V, S, M (a Holy Symbol worth 5+ GP)". */
	components: string;
	duration: string;
	concentration: boolean;
	text: string;
	/** The action that casts it at the table, or null when it isn't cast here. */
	action: string | null;
	/** Why it isn't cast at the table. */
	why: string | null;
}
