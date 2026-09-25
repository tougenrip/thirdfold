// What a character's choices may be, read from the catalog where the SRD's
// text states it plainly ("Choose 2: Athletics, …", "Light and Medium armor
// and Shields", "Increase your Strength or Dexterity score by 1, to a
// maximum of 20.") and listed here where it is a table or a name the SRD
// only describes (a species' lineages and ancestries, each class's
// spellcasting ability).

import { ABILITIES, SKILLS, type Ability } from '../core';
import type { ClassData, FeatData } from '../srd/records';

export type OptionSpec =
	| { kind: 'one-of'; values: readonly string[] }
	/** A skill proficiency, from `values` or (when absent) any skill. */
	| { kind: 'skill'; values?: readonly string[] };

const SPELLCASTING: OptionSpec = { kind: 'one-of', values: ['int', 'wis', 'cha'] };
const SIZE: OptionSpec = { kind: 'one-of', values: ['medium', 'small'] };

/** Each species' choices, by option key, keyed by the species record's id. */
export const SPECIES_OPTIONS: Readonly<Record<string, Readonly<Record<string, OptionSpec>>>> = {
	'srd-5.2.1:species:dragonborn': {
		ancestry: {
			kind: 'one-of',
			values: [
				'black',
				'blue',
				'brass',
				'bronze',
				'copper',
				'gold',
				'green',
				'red',
				'silver',
				'white'
			]
		}
	},
	'srd-5.2.1:species:elf': {
		lineage: { kind: 'one-of', values: ['drow', 'high-elf', 'wood-elf'] },
		spellcasting: SPELLCASTING,
		'keen-senses': { kind: 'skill', values: ['insight', 'perception', 'survival'] }
	},
	'srd-5.2.1:species:gnome': {
		lineage: { kind: 'one-of', values: ['forest-gnome', 'rock-gnome'] },
		spellcasting: SPELLCASTING
	},
	'srd-5.2.1:species:goliath': {
		ancestry: { kind: 'one-of', values: ['cloud', 'fire', 'frost', 'hill', 'stone', 'storm'] }
	},
	'srd-5.2.1:species:human': { size: SIZE, skillful: { kind: 'skill' } },
	'srd-5.2.1:species:tiefling': {
		legacy: { kind: 'one-of', values: ['abyssal', 'chthonic', 'infernal'] },
		spellcasting: SPELLCASTING,
		size: SIZE
	}
};

/** Species whose traits give an Origin feat of the player's choice (Human: Versatile). */
export const SPECIES_FEAT = new Set(['srd-5.2.1:species:human']);

/** Speed in feet a species option changes (Wood Elf: 35 feet). */
export const OPTION_SPEED: Readonly<Record<string, number>> = { 'lineage:wood-elf': 35 };

/** The ability each spellcasting class casts with (SRD: each class's Spellcasting feature). */
export const SPELLCASTING_ABILITY: Readonly<Record<string, Ability>> = {
	'srd-5.2.1:class:bard': 'cha',
	'srd-5.2.1:class:cleric': 'wis',
	'srd-5.2.1:class:druid': 'wis',
	'srd-5.2.1:class:paladin': 'cha',
	'srd-5.2.1:class:ranger': 'wis',
	'srd-5.2.1:class:sorcerer': 'cha',
	'srd-5.2.1:class:warlock': 'cha',
	'srd-5.2.1:class:wizard': 'int'
};

const abilityByName = (name: string) =>
	ABILITIES.find((a) => a.name.toLowerCase() === name.trim().toLowerCase())?.id;
const skillByName = (name: string) =>
	SKILLS.find((s) => s.name.toLowerCase() === name.trim().toLowerCase())?.id;

export const abilitiesNamed = (names: readonly string[]): Ability[] =>
	names.map(abilityByName).filter((a): a is Ability => !!a);

/** A class's skill choice: how many, and from which skills (null: any). */
export function classSkills(data: ClassData): { count: number; from: string[] | null } {
	const any = /^Choose any (\d+) skills/.exec(data.skills);
	if (any) return { count: Number(any[1]), from: null };
	const m = /^Choose (\d+): (.*)$/.exec(data.skills);
	if (!m) return { count: 0, from: [] };
	const from = m[2]
		.replace(/,? or /, ', ')
		.split(',')
		.map(skillByName)
		.filter((s): s is string => !!s);
	return { count: Number(m[1]), from };
}

export type ArmorTraining = 'light' | 'medium' | 'heavy' | 'shield';

/** The armor a class trains with, from its "Armor Training" line. */
export function armorTraining(data: ClassData): Set<ArmorTraining> {
	const text = data.armor.toLowerCase();
	const out = new Set<ArmorTraining>();
	for (const kind of ['light', 'medium', 'heavy'] as const) if (text.includes(kind)) out.add(kind);
	if (text.includes('shield')) out.add('shield');
	return out;
}

/** What a feat's Ability Score Increase allows: how much in all, to which abilities, up to what score. */
export interface FeatIncrease {
	total: number;
	/** The most any one ability may rise. */
	each: number;
	from: Ability[];
	max: number;
}

export function featIncrease(name: string, data: FeatData): FeatIncrease | null {
	// "Increase one ability score of your choice by 2, or increase two ability scores of your choice by 1."
	if (name === 'Ability Score Improvement')
		return { total: 2, each: 2, from: ABILITIES.map((a) => a.id), max: 20 };
	const block = data.benefits.find((b) => b.name === 'Ability Score Increase');
	if (!block) return null;
	const m = /^Increase (.+?) by (\d+), to a maximum of (\d+)\./.exec(block.text);
	if (!m) return null;
	const named = /one ability score of your choice/.test(m[1])
		? ABILITIES.map((a) => a.id)
		: abilitiesNamed(
				m[1]
					.replace(/^your /, '')
					.replace(/ score$/, '')
					.split(/, or |, | or /)
			);
	return { total: Number(m[2]), each: Number(m[2]), from: named, max: Number(m[3]) };
}

/** Skills a feat lets the player choose (Skilled: "any combination of three skills or tools"). */
export function featSkills(name: string): number {
	return name === 'Skilled' ? 3 : 0;
}

/** A class table column's value as a number ("—" is none). */
export function columnNumber(value: string | undefined): number {
	if (!value) return 0;
	const m = /^\+?(\d+)/.exec(value);
	return m ? Number(m[1]) : 0;
}

const COUNT_WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4 };

/**
 * How many kinds of weapon a class masters at a level: its table's Weapon
 * Mastery column where it has one, else the number its Weapon Mastery
 * feature names ("two kinds of weapons"); and whether they must be melee.
 */
export function weaponMastery(data: ClassData, level: number): { count: number; melee: boolean } {
	const feature = data.features.find((f) => f.name === 'Weapon Mastery' && f.level <= level);
	if (!feature) return { count: 0, melee: false };
	const melee = /Martial Melee weapons/.test(feature.text);
	const column = data.levels[level - 1].columns['Weapon Mastery'];
	if (column) return { count: columnNumber(column), melee };
	const m = /mastery properties of (\w+) kinds/.exec(feature.text);
	return { count: m ? (COUNT_WORDS[m[1]] ?? 0) : 0, melee };
}
