// What each kind of fifth edition record holds, as imported from the SRD
// 5.2.1. Fields the rules will compute with are parsed into numbers and
// lists; the rest stays the SRD's own words (a record's `text` always has
// all of it). Plain JSON, the same on every import.

import type { CatalogRecord } from '../../../../src/lib/content/catalog';

/** A named run of rules text inside a record ("Darkvision.", "Multiattack."). */
export interface Block {
	name: string;
	text: string;
}

export interface SpellData {
	/** 0 for a cantrip. */
	level: number;
	school: string;
	classes: string[];
	castingTime: string;
	ritual: boolean;
	range: string;
	components: { verbal: boolean; somatic: boolean; material: string | null };
	duration: string;
	concentration: boolean;
	/** "Using a Higher-Level Spell Slot." */
	higherLevels: string | null;
	/** "Cantrip Upgrade." */
	cantripUpgrade: string | null;
}

export interface WeaponData {
	category: 'simple' | 'martial';
	type: 'melee' | 'ranged';
	/** e.g. "1d8", or "1" for a flat amount. */
	damage: string;
	damageType: string;
	properties: string[];
	/** Normal and long range in feet, for Thrown and Ammunition weapons. */
	range: { normal: number; long: number } | null;
	/** The damage used two-handed, for Versatile weapons. */
	versatile: string | null;
	ammunition: string | null;
	mastery: string;
	weight: string;
	cost: string;
}

export interface ArmorData {
	category: 'light' | 'medium' | 'heavy' | 'shield';
	/** As the SRD writes it, e.g. "11 + Dex modifier (max 2)". */
	armorClass: string;
	/** The base (or, for a Shield, the bonus). */
	base: number;
	/** How much of the Dexterity modifier counts: all of it (null), up to a cap, or none (0). */
	dexCap: number | null;
	/** Strength score needed to move freely in it, if any. */
	strength: number | null;
	stealthDisadvantage: boolean;
	weight: string;
	cost: string;
	/** Time to put on and take off. */
	don: string;
}

export interface SpeciesData {
	creatureType: string;
	size: string;
	/** In feet. */
	speed: number;
	traits: Block[];
}

export interface BackgroundData {
	abilities: string[];
	feat: string;
	skills: string[];
	tool: string;
	equipment: string;
}

export interface FeatData {
	category: 'origin' | 'general' | 'fighting-style' | 'epic-boon';
	prerequisite: string | null;
	repeatable: boolean;
	benefits: Block[];
}

export interface ClassLevel {
	level: number;
	proficiencyBonus: number;
	features: string[];
	/** The class's own columns (Rages, Cantrips, spell slots…), by column heading. */
	columns: Record<string, string>;
}

export interface ClassData {
	primaryAbility: string;
	hitDie: string;
	savingThrows: string[];
	skills: string;
	weapons: string;
	tools: string | null;
	armor: string;
	equipment: string;
	levels: ClassLevel[];
	features: (Block & { level: number })[];
}

export interface SubclassData {
	class: string;
	features: (Block & { level: number })[];
}

export interface RuleData {
	/** The glossary's tag, e.g. "Condition", "Action", "Hazard"; null for none. */
	tag: string | null;
}

export interface AbilityLine {
	score: number;
	modifier: number;
	save: number;
}

export interface MonsterData {
	/** The group it is listed under ("Black Dragons"), or null. */
	group: string | null;
	size: string;
	type: string;
	alignment: string;
	armorClass: number;
	initiative: { bonus: number; score: number };
	hitPoints: { average: number; formula: string | null };
	speed: string;
	abilities: Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', AbilityLine>;
	/** The stat block's other lines as written (Skills, Senses, Languages, Immunities, Gear, …). */
	details: Record<string, string>;
	challenge: { rating: string; xp: number; xpInLair: number | null; proficiencyBonus: number };
	traits: Block[];
	actions: Block[];
	bonusActions: Block[];
	reactions: Block[];
	legendaryActions: Block[];
	/** Text before a section's blocks (e.g. "Legendary Action Uses: 3 …"). */
	notes: Record<string, string>;
}

export type SrdRecord =
	| CatalogRecord<'spell', SpellData>
	| CatalogRecord<'weapon', WeaponData>
	| CatalogRecord<'armor', ArmorData>
	| CatalogRecord<'species', SpeciesData>
	| CatalogRecord<'background', BackgroundData>
	| CatalogRecord<'feat', FeatData>
	| CatalogRecord<'class', ClassData>
	| CatalogRecord<'subclass', SubclassData>
	| CatalogRecord<'rule', RuleData>
	| CatalogRecord<'monster', MonsterData>;

export type SrdKind = SrdRecord['kind'];

export const SRD_KINDS: readonly SrdKind[] = [
	'rule',
	'species',
	'background',
	'feat',
	'class',
	'subclass',
	'weapon',
	'armor',
	'spell',
	'monster'
];
