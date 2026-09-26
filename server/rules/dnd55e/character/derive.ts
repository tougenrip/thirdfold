// Everything about a fifth edition character that follows from its choices,
// worked out on the server from the catalog each time it is asked (a
// character stores choices, never these numbers): ability scores and
// modifiers, proficiency, saves, skills, Armor Class, initiative, speed,
// hit points and Hit Point Dice, features, proficiencies, limited-use
// resources from the class table, and spellcasting. The character must be
// valid (validate.ts); this doesn't check it again.

import { ABILITIES, abilityModifier, proficiencyBonus, SKILLS, type Ability } from '../core';
import type { Catalog } from '../catalog';
import type { DndCharacter, FeatChoice } from './model';
import {
	abilitiesNamed,
	armorTraining,
	columnNumber,
	OPTION_SPEED,
	SPELLCASTING_ABILITY,
	type ArmorTraining
} from './options';

export interface DerivedValue {
	bonus: number;
	proficient: boolean;
}

export interface Resource {
	/** Stable across recalculation: `rages`, `spell-slots-1`, `pact-slots`, `lay-on-hands`, … */
	id: string;
	name: string;
	max: number;
	spent: number;
}

export interface Feature {
	name: string;
	/** The record it comes from (a class, subclass, species or feat). */
	source: string;
	/** The class level it is gained at, for class and subclass features. */
	level: number | null;
}

export interface DerivedCharacter {
	id: string;
	name: string;
	level: number;
	/** e.g. "Orc Fighter 1 (Soldier)". */
	title: string;
	species: string;
	background: string;
	class: string;
	subclass: string | null;
	proficiency: number;
	scores: Record<Ability, number>;
	modifiers: Record<Ability, number>;
	saves: Record<Ability, DerivedValue>;
	skills: Record<string, DerivedValue & { expertise: boolean }>;
	armorClass: number;
	initiative: number;
	/** In feet. */
	speed: number;
	passivePerception: number;
	hitPoints: { max: number; current: number; temp: number };
	hitDice: { die: number; total: number; spent: number };
	features: Feature[];
	feats: { id: string; name: string }[];
	proficiencies: { armor: ArmorTraining[]; weapons: string; tools: string[] };
	weaponMasteries: string[];
	resources: Resource[];
	spellcasting: {
		ability: Ability;
		saveDc: number;
		attackBonus: number;
		cantrips: number;
		prepared: number;
		/** Spell slots by level (index 0 is level 1). */
		slots: number[];
		/** Warlock Pact Magic: its slots, all of one level. */
		pact: { slots: number; level: number } | null;
	} | null;
	/** The class table's row for this level, as the SRD prints it. */
	columns: Record<string, string>;
}

/** The feats a character has: its background's, its species', its Fighting Style and its level feats. */
export function featsOf(c: DndCharacter, catalog: Catalog): FeatChoice[] {
	const background = catalog.get('background', c.background.id)!;
	const origin = catalog.named('feat', background.data.feat.replace(/ \(.*\)$/, ''));
	return [
		...(origin ? [{ feat: origin.id }] : []),
		...(c.species.feat ? [c.species.feat] : []),
		...(c.class.fightingStyle ? [{ feat: c.class.fightingStyle }] : []),
		...c.feats
	];
}

/** The six scores: base, plus the background's increases, plus every feat's. */
export function scoresOf(c: DndCharacter, catalog: Catalog): Record<Ability, number> {
	const scores = { ...c.abilities.base };
	const add = (inc: Partial<Record<Ability, number>> | undefined) => {
		for (const [a, n] of Object.entries(inc ?? {})) scores[a as Ability] += n ?? 0;
	};
	add(c.background.increases);
	for (const f of featsOf(c, catalog)) add(f.increases);
	return scores;
}

/** Every skill the character is proficient in: background, class, species and feats. */
export function skillsOf(c: DndCharacter, catalog: Catalog): Set<string> {
	const background = catalog.get('background', c.background.id)!;
	const out = new Set<string>();
	for (const name of background.data.skills) {
		const s = SKILLS.find((k) => k.name === name);
		if (s) out.add(s.id);
	}
	for (const s of c.class.skills) out.add(s);
	for (const [key, value] of Object.entries(c.species.options))
		if (key === 'keen-senses' || key === 'skillful') out.add(value);
	for (const f of featsOf(c, catalog)) for (const s of f.skills ?? []) out.add(s);
	return out;
}

const dieOf = (hitDie: string) => Number(hitDie.replace(/^D/i, ''));

export function deriveCharacter(c: DndCharacter, catalog: Catalog): DerivedCharacter {
	const species = catalog.get('species', c.species.id)!;
	const background = catalog.get('background', c.background.id)!;
	const klass = catalog.get('class', c.class.id)!;
	const subclass = c.class.subclass ? catalog.get('subclass', c.class.subclass)! : null;
	const row = klass.data.levels[c.level - 1];
	const pb = proficiencyBonus(c.level);

	const scores = scoresOf(c, catalog);
	const modifiers = Object.fromEntries(
		ABILITIES.map((a) => [a.id, abilityModifier(scores[a.id])])
	) as Record<Ability, number>;

	const saveProficient = new Set(abilitiesNamed(klass.data.savingThrows));
	const saves = Object.fromEntries(
		ABILITIES.map((a) => {
			const proficient = saveProficient.has(a.id);
			return [a.id, { bonus: modifiers[a.id] + (proficient ? pb : 0), proficient }];
		})
	) as Record<Ability, DerivedValue>;

	const proficientSkills = skillsOf(c, catalog);
	const skills = Object.fromEntries(
		SKILLS.map((s) => {
			const proficient = proficientSkills.has(s.id);
			const expertise = proficient && c.class.expertise.includes(s.id);
			return [
				s.id,
				{
					bonus: modifiers[s.ability] + (expertise ? 2 * pb : proficient ? pb : 0),
					proficient,
					expertise
				}
			];
		})
	) as DerivedCharacter['skills'];

	const classFeatures = klass.data.features.filter((f) => f.level <= c.level);
	const has = (name: string) => classFeatures.some((f) => f.name === name);
	const feats = featsOf(c, catalog).map((f) => catalog.get('feat', f.feat)!);
	const hasFeat = (name: string) => feats.some((f) => f.name === name);

	// Armor Class: worn armor's base plus Dexterity up to its cap, else an
	// Unarmored Defense, else 10 + Dexterity; a Shield adds its bonus.
	const armor = c.armor.worn ? catalog.get('armor', c.armor.worn)!.data : null;
	const shield = c.armor.shield ? catalog.named('armor', 'Shield')!.data.base : 0;
	let armorClass: number;
	if (armor)
		armorClass =
			armor.base + (armor.dexCap === null ? modifiers.dex : Math.min(modifiers.dex, armor.dexCap));
	else if (has('Unarmored Defense') && klass.name === 'Barbarian')
		armorClass = 10 + modifiers.dex + modifiers.con;
	else if (has('Unarmored Defense') && klass.name === 'Monk' && !c.armor.shield)
		armorClass = 10 + modifiers.dex + modifiers.wis;
	else armorClass = 10 + modifiers.dex;
	armorClass += shield;
	if (armor && hasFeat('Defense')) armorClass += 1;

	// Speed: the species' (or its lineage's), with the class's movement
	// features, and 10 feet less in heavy armor too heavy for the character.
	let speed = species.data.speed;
	for (const [key, value] of Object.entries(c.species.options))
		speed = OPTION_SPEED[`${key}:${value}`] ?? speed;
	if (klass.name === 'Monk' && !armor && !c.armor.shield)
		speed += columnNumber(row.columns['Unarmored Movement']);
	if (has('Fast Movement') && armor?.category !== 'heavy') speed += 10;
	if (armor?.strength && scores.str < armor.strength) speed -= 10;

	// Hit points: the die's maximum at level 1, then the average or the roll
	// each level, each with the Constitution modifier (at least 1 a level).
	const die = dieOf(klass.data.hitDie);
	const perLevel = (gain: number) => Math.max(1, gain + modifiers.con);
	let max = perLevel(die);
	for (let l = 2; l <= c.level; l++)
		max += perLevel(c.hitPoints.method === 'average' ? die / 2 + 1 : c.hitPoints.rolls[l - 2]);
	if (species.data.traits.some((t) => t.name === 'Dwarven Toughness')) max += c.level;

	const resources: Resource[] = [];
	const resource = (id: string, name: string, n: number) => {
		if (n > 0) resources.push({ id, name, max: n, spent: Math.min(n, c.state.spent[id] ?? 0) });
	};
	for (const name of [
		'Rages',
		'Second Wind',
		'Channel Divinity',
		'Wild Shape',
		'Focus Points',
		'Sorcery Points'
	])
		resource(name.toLowerCase().replace(/ /g, '-'), name, columnNumber(row.columns[name]));
	if (has('Lay On Hands')) resource('lay-on-hands', 'Lay On Hands', 5 * c.level);
	if (has('Bardic Inspiration'))
		resource('bardic-inspiration', 'Bardic Inspiration', Math.max(1, modifiers.cha));
	const slots: number[] = [];
	for (let l = 1; l <= 9; l++) {
		const n = columnNumber(row.columns[`Spell Slots ${l}`]);
		if (n) slots[l - 1] = n;
		resource(`spell-slots-${l}`, `Level ${l} spell slots`, n);
	}
	const pact = row.columns['Slot Level']
		? {
				slots: columnNumber(row.columns['Spell Slots']),
				level: columnNumber(row.columns['Slot Level'])
			}
		: null;
	if (pact) resource('pact-slots', `Pact Magic slots (level ${pact.level})`, pact.slots);

	const castWith = SPELLCASTING_ABILITY[klass.id];
	const spellcasting = castWith
		? {
				ability: castWith,
				saveDc: 8 + pb + modifiers[castWith],
				attackBonus: pb + modifiers[castWith],
				cantrips: columnNumber(row.columns.Cantrips),
				prepared: columnNumber(row.columns['Prepared Spells']),
				slots: Array.from({ length: slots.length }, (_, i) => slots[i] ?? 0),
				pact
			}
		: null;

	const features: Feature[] = [
		...species.data.traits.map((t) => ({ name: t.name, source: species.id, level: null })),
		...classFeatures.map((f) => ({ name: f.name, source: klass.id, level: f.level })),
		...(subclass?.data.features ?? [])
			.filter((f) => f.level <= c.level)
			.map((f) => ({ name: f.name, source: subclass!.id, level: f.level }))
	];

	const initiative = modifiers.dex + (hasFeat('Alert') ? pb : 0);
	const perception = skills.perception.bonus;
	const tools = [background.data.tool, ...(klass.data.tools ? [klass.data.tools] : [])];

	return {
		id: c.id,
		name: c.name,
		level: c.level,
		title: `${species.name} ${klass.name} ${c.level} (${background.name})`,
		species: species.name,
		background: background.name,
		class: klass.name,
		subclass: subclass?.name ?? null,
		proficiency: pb,
		scores,
		modifiers,
		saves,
		skills,
		armorClass,
		initiative,
		speed,
		passivePerception: 10 + perception,
		hitPoints: { max, current: Math.min(c.state.hp, max), temp: c.state.tempHp },
		hitDice: { die, total: c.level, spent: c.state.hitDiceSpent },
		features,
		feats: feats.map((f) => ({ id: f.id, name: f.name })),
		proficiencies: {
			armor: [...armorTraining(klass.data)],
			weapons: klass.data.weapons,
			tools
		},
		weaponMasteries: c.class.weaponMasteries,
		resources,
		spellcasting,
		columns: row.columns
	};
}
