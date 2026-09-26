// The fifth edition character creator's wire shapes: what the server sends a
// creation page to choose from (`CreatorOptions`), what the page sends back
// (`CreatorChoices`, checked in full on the server) and what the server says
// the choices come to (`CreatorSummary`). The page only guides: it never
// works out a number, and nothing it sends is taken on trust.
// Plain data, relative imports only.

export type AbilityId = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type ArmorKind = 'light' | 'medium' | 'heavy' | 'shield';
export type ScoreMethod = 'standard-array' | 'point-buy';

export interface Named {
	id: string;
	name: string;
}

/** A named piece of rules text: a trait, a feature, a feat's benefit. */
export interface RulesText {
	name: string;
	text: string;
}

export interface SpeciesChoiceSpec {
	/** The option's key in `CreatorChoices.species.options`. */
	key: string;
	label: string;
	/** A skill proficiency, or one of a list. */
	kind: 'one-of' | 'skill';
	values: Named[];
}

export interface SpeciesOption extends Named {
	size: string;
	/** In feet. */
	speed: number;
	traits: RulesText[];
	options: SpeciesChoiceSpec[];
	/** Whether it gives an Origin feat of the player's choice (Human: Versatile). */
	feat: boolean;
}

export interface BackgroundOption extends Named {
	/** The three abilities its +2/+1 (or +1/+1/+1) may raise. */
	abilities: AbilityId[];
	skills: string[];
	feat: string;
	featText: string;
	tool: string;
}

export interface ClassOption extends Named {
	hitDie: number;
	primary: string;
	saves: AbilityId[];
	/** How many skills it chooses, and from which (null: any). */
	skills: { count: number; from: string[] | null };
	armor: ArmorKind[];
	weapons: string;
	/** Its level 1 features. */
	features: RulesText[];
	fightingStyle: boolean;
	/** How many skills get Expertise at level 1. */
	expertise: number;
	weaponMastery: { count: number; melee: boolean };
	spellcasting: AbilityId | null;
	/** Weapon ids it is trained with. */
	trainedWeapons: string[];
}

export interface FeatOption extends Named {
	text: string;
	/** Skills it lets the player choose (Skilled: 3). */
	skills: number;
}

export interface WeaponOption extends Named {
	category: 'simple' | 'martial';
	type: 'melee' | 'ranged';
	damage: string;
	damageType: string;
	properties: string[];
	mastery: string;
}

export interface ArmorOption extends Named {
	category: ArmorKind;
	armorClass: string;
	strength: number | null;
}

export interface CreatorOptions {
	rules: string;
	/** The credit the rules' source requires, shown on the page. */
	attribution: string;
	level: number;
	abilities: Named[];
	skills: (Named & { ability: AbilityId })[];
	methods: ScoreMethod[];
	standardArray: number[];
	/** Point buy: what each score costs, and the points to spend. */
	pointCost: Record<string, number>;
	points: number;
	species: SpeciesOption[];
	backgrounds: BackgroundOption[];
	classes: ClassOption[];
	originFeats: FeatOption[];
	fightingStyles: FeatOption[];
	weapons: WeaponOption[];
	armor: ArmorOption[];
	/** How many weapons a character may carry in. */
	weaponsMax: number;
	colors: string[];
}

/** A player's choices for a level 1 character. The server fills in the rest (level, hit points by the average). */
export interface CreatorChoices {
	name: string;
	/** Token colour, `#rrggbb`. */
	color: string;
	species: {
		id: string;
		options: Record<string, string>;
		feat: { feat: string; skills?: string[] } | null;
	};
	background: { id: string; increases: Partial<Record<AbilityId, number>> };
	class: {
		id: string;
		skills: string[];
		expertise: string[];
		fightingStyle: string | null;
		weaponMasteries: string[];
	};
	abilities: { method: ScoreMethod; base: Record<AbilityId, number> };
	armor: { worn: string | null; shield: boolean };
	weapons: string[];
}

/** What choices come to, by the rules, as the server works it out. */
export interface CreatorSummary {
	title: string;
	level: number;
	hp: number;
	armorClass: number;
	/** In feet. */
	speed: number;
	initiative: number;
	proficiency: number;
	scores: { id: AbilityId; name: string; score: number; modifier: number }[];
	saves: { id: AbilityId; name: string; bonus: number; proficient: boolean }[];
	skills: { id: string; name: string; bonus: number; proficient: boolean; expertise: boolean }[];
	features: string[];
	feats: string[];
	resources: { name: string; max: number }[];
	spellcasting: { ability: AbilityId; saveDc: number; attackBonus: number } | null;
	actions: { name: string; summary: string }[];
}

export type CreatorPreview =
	{ ok: true; summary: CreatorSummary } | { ok: false; problems: string[] };
