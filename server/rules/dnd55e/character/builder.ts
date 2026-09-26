// Building a level 1 fifth edition character for the table: the options a
// creation page may offer (from the catalog), a preview of what choices come
// to, and the build itself. The page's choices are read field by field into
// a character (level 1, hit points by the average, no subclass, no feats
// but those its origin gives) and checked by readCharacter like any other,
// so a page can't grant an option, a level or a number. Only the standard
// array and point buy are accepted: a roll the server didn't make is not a
// roll. The character then plays with its weapons as its attacks and, where
// its class has them at level 1, Second Wind or Lay On Hands; spells come
// with milestone 48.

import type { Action, CharacterDef } from '../../../../src/lib/adventure/characters';
import type {
	AbilityId,
	CreatorOptions,
	CreatorSummary,
	FeatOption
} from '../../../../src/lib/rules/dnd55e/creator';
import type { Built, CharacterBuilder, JsonData, RulesetRef } from '../../ruleset';
import type { Catalog } from '../catalog';
import { ABILITIES, abilityName, SKILLS, type Ability } from '../core';
import type { WeaponData } from '../srd/records';
import { characterDefOf } from './adventure';
import { deriveCharacter, type DerivedCharacter } from './derive';
import { sheetDetails } from './details';
import type { CharacterChoices, DndCharacter } from './model';
import {
	abilitiesNamed,
	armorTraining,
	classSkills,
	featSkills,
	SPECIES_FEAT,
	SPECIES_OPTIONS,
	SPELLCASTING_ABILITY,
	trainedWith,
	weaponMastery
} from './options';
import { migrateCharacter } from './persist';
import {
	createCharacter,
	POINT_COST,
	POINTS,
	readCharacter,
	STANDARD_ARRAY,
	WEAPONS_MAX
} from './validate';

/** The level a new character starts at. */
export const START_LEVEL = 1;
/** Token colours a player picks from. */
export const COLORS = [
	'#2e86c1',
	'#8e44ad',
	'#c0392b',
	'#d68910',
	'#1e8449',
	'#17a589',
	'#7f8c8d',
	'#a04000'
];
const COLOR = /^#[0-9a-f]{6}$/i;
const NAME_MAX = 40;
/** Cells a built character sees by, and the light it carries (a torch). */
const VISION = 6;
const TORCH = 2;
const FEET_PER_CELL = 5;

/** The figure a built character stands on the table as, by class. */
const FIGURES: Readonly<Record<string, string>> = {
	barbarian: 'warden',
	fighter: 'warden',
	paladin: 'warden',
	monk: 'veil',
	ranger: 'veil',
	rogue: 'veil',
	bard: 'ember',
	sorcerer: 'ember',
	warlock: 'ember',
	wizard: 'ember',
	cleric: 'saint',
	druid: 'saint'
};

const OPTION_LABELS: Readonly<Record<string, string>> = {
	ancestry: 'Ancestry',
	lineage: 'Lineage',
	legacy: 'Legacy',
	spellcasting: 'Spellcasting ability',
	'keen-senses': 'Keen Senses',
	skillful: 'Skillful',
	size: 'Size'
};

const slug = (id: string) => id.slice(id.lastIndexOf(':') + 1);
const titled = (value: string) =>
	value
		.split('-')
		.map((w) => w[0].toUpperCase() + w.slice(1))
		.join(' ');
const signed = (n: number) => (n < 0 ? `${n}` : `+${n}`);
const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');
const firstParagraph = (text: string) => text.split('\n\n')[0].slice(0, 600);

/** What a creation page may offer, from the catalog. */
export function creatorOptions(catalog: Catalog, attribution: string): CreatorOptions {
	const weapons = catalog.all('weapon');
	const feat = (id: string): FeatOption => {
		const f = catalog.get('feat', id)!;
		return {
			id: f.id,
			name: f.name,
			text: f.data.benefits.length
				? f.data.benefits.map((b) => `${b.name}. ${b.text}`).join('\n\n')
				: f.text.split('\n\n').slice(1).join('\n\n'),
			skills: featSkills(f.name)
		};
	};
	return {
		rules: 'dnd-5.5e',
		attribution,
		level: START_LEVEL,
		abilities: ABILITIES.map((a) => ({ id: a.id, name: a.name })),
		skills: SKILLS.map((s) => ({ id: s.id, name: s.name, ability: s.ability })),
		methods: ['standard-array', 'point-buy'],
		standardArray: [...STANDARD_ARRAY],
		pointCost: Object.fromEntries(Object.entries(POINT_COST)),
		points: POINTS,
		species: catalog.all('species').map((s) => ({
			id: s.id,
			name: s.name,
			size: s.data.size,
			speed: s.data.speed,
			traits: s.data.traits.map((t) => ({ name: t.name, text: firstParagraph(t.text) })),
			options: Object.entries(SPECIES_OPTIONS[s.id] ?? {}).map(([key, spec]) => ({
				key,
				label: OPTION_LABELS[key] ?? titled(key),
				kind: spec.kind,
				values:
					spec.kind === 'skill'
						? SKILLS.filter((k) => !spec.values || spec.values.includes(k.id)).map((k) => ({
								id: k.id,
								name: k.name
							}))
						: spec.values.map((v) => ({
								id: v,
								name: key === 'spellcasting' ? abilityName(v as Ability) : titled(v)
							}))
			})),
			feat: SPECIES_FEAT.has(s.id)
		})),
		backgrounds: catalog.all('background').map((b) => {
			const origin = catalog.named('feat', b.data.feat.replace(/ \(.*\)$/, ''));
			return {
				id: b.id,
				name: b.name,
				abilities: abilitiesNamed(b.data.abilities),
				skills: b.data.skills.map((n) => SKILLS.find((k) => k.name === n)?.id ?? n),
				feat: b.data.feat,
				featText: origin ? feat(origin.id).text : '',
				tool: b.data.tool
			};
		}),
		classes: catalog.all('class').map((c) => {
			const first = c.data.features.filter((f) => f.level === START_LEVEL);
			return {
				id: c.id,
				name: c.name,
				hitDie: Number(c.data.hitDie.slice(1)),
				primary: c.data.primaryAbility,
				saves: abilitiesNamed(c.data.savingThrows),
				skills: classSkills(c.data),
				armor: [...armorTraining(c.data)],
				weapons: c.data.weapons,
				features: first.map((f) => ({ name: f.name, text: firstParagraph(f.text) })),
				fightingStyle: first.some((f) => f.name === 'Fighting Style'),
				expertise: 2 * first.filter((f) => f.name === 'Expertise').length,
				weaponMastery: weaponMastery(c.data, START_LEVEL),
				spellcasting: SPELLCASTING_ABILITY[c.id] ?? null,
				trainedWeapons: weapons.filter((w) => trainedWith(c.data, w.data)).map((w) => w.id)
			};
		}),
		originFeats: catalog
			.all('feat')
			.filter((f) => f.data.category === 'origin')
			.map((f) => feat(f.id)),
		fightingStyles: catalog
			.all('feat')
			.filter((f) => f.data.category === 'fighting-style')
			.map((f) => feat(f.id)),
		weapons: weapons.map((w) => ({
			id: w.id,
			name: w.name,
			category: w.data.category,
			type: w.data.type,
			damage: w.data.damage,
			damageType: w.data.damageType,
			properties: w.data.properties,
			mastery: w.data.mastery
		})),
		armor: catalog.all('armor').map((a) => ({
			id: a.id,
			name: a.name,
			category: a.data.category,
			armorClass: a.data.armorClass,
			strength: a.data.strength
		})),
		weaponsMax: WEAPONS_MAX,
		colors: [...COLORS]
	};
}

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A page's choices as a level 1 character's, taking only the fields a page
 * may choose: everything else (level, hit points, subclass, feats) is set
 * here, and readCharacter checks every field it is given.
 */
export function choicesOf(
	raw: unknown,
	id: string
): { choices: CharacterChoices; color: string } | { problems: string[] } {
	if (!isObject(raw)) return { problems: ['choices must be an object'] };
	const problems: string[] = [];
	const color =
		typeof raw.color === 'string' && COLOR.test(raw.color) ? raw.color.toLowerCase() : null;
	if (!color) problems.push('choose a colour');
	const name = typeof raw.name === 'string' ? raw.name.trim() : '';
	if (!name || name.length > NAME_MAX) problems.push(`a name of 1 to ${NAME_MAX} characters`);
	const klass = isObject(raw.class) ? raw.class : {};
	const abilities = isObject(raw.abilities) ? raw.abilities : {};
	if (abilities.method !== 'standard-array' && abilities.method !== 'point-buy')
		problems.push('ability scores by the standard array or point buy');
	if (!Array.isArray(raw.weapons) || raw.weapons.length === 0) problems.push('choose a weapon');
	if (problems.length) return { problems };
	return {
		color: color!,
		choices: {
			id,
			name,
			level: START_LEVEL,
			species: raw.species as CharacterChoices['species'],
			background: raw.background as CharacterChoices['background'],
			class: {
				id: klass.id,
				subclass: null,
				skills: klass.skills,
				expertise: klass.expertise,
				fightingStyle: klass.fightingStyle ?? null,
				weaponMasteries: klass.weaponMasteries
			} as CharacterChoices['class'],
			abilities: abilities as CharacterChoices['abilities'],
			feats: [],
			hitPoints: { method: 'average' },
			armor: raw.armor as CharacterChoices['armor'],
			weapons: raw.weapons as string[],
			notes: {}
		}
	};
}

/** The ability an attack with this weapon uses: Dexterity at range, the better for Finesse, else Strength. */
function weaponAbility(weapon: WeaponData, derived: DerivedCharacter): Ability {
	if (weapon.type === 'ranged') return 'dex';
	if (weapon.properties.some((p) => p.startsWith('Finesse')))
		return derived.modifiers.dex > derived.modifiers.str ? 'dex' : 'str';
	return 'str';
}

/** The character's actions at the table: its weapons, then its class's level 1 healing. */
export function actionsOf(
	character: DndCharacter,
	derived: DerivedCharacter,
	catalog: Catalog
): { actions: Action[]; attacks: Record<string, Ability>; bonusActions: string[] } {
	const actions: Action[] = [];
	const attacks: Record<string, Ability> = {};
	const bonusActions: string[] = [];
	for (const id of character.weapons) {
		const w = catalog.get('weapon', id)!;
		const ability = weaponAbility(w.data, derived);
		const reach = w.data.properties.some((p) => p === 'Reach');
		const range =
			w.data.range && w.data.type === 'ranged'
				? w.data.range.normal / FEET_PER_CELL
				: reach
					? 2
					: 1;
		const mod = derived.modifiers[ability];
		const damage = /^\d+$/.test(w.data.damage)
			? w.data.damage
			: `${w.data.damage}${mod ? signed(mod) : ''}`;
		const action = slug(id);
		attacks[action] = ability;
		actions.push({
			id: action,
			name: w.name,
			about: `${w.name}: ${w.data.damage} ${w.data.damageType.toLowerCase()} damage${
				w.data.properties.length ? ` (${w.data.properties.join(', ')})` : ''
			}.${w.data.type === 'ranged' ? ' Hard to aim with a foe beside you.' : ''}`,
			kind: 'attack',
			target: 'enemy',
			range,
			stat: ability === 'dex' ? 'agility' : 'might',
			dice: damage,
			uses: null
		});
	}
	const secondWind = derived.resources.find((r) => r.id === 'second-wind');
	if (secondWind) {
		actions.push({
			id: 'second-wind',
			name: 'Second Wind',
			about: 'Draw on your stamina to heal yourself. A bonus action.',
			kind: 'heal',
			target: 'self',
			range: 0,
			stat: 'might',
			dice: `1d10+${character.level}`,
			uses: secondWind.max
		});
		bonusActions.push('second-wind');
	}
	if (derived.resources.some((r) => r.id === 'lay-on-hands')) {
		actions.push({
			id: 'lay-on-hands',
			name: 'Lay On Hands',
			about: `Touch an ally (or yourself) to restore ${5 * character.level} hit points. A bonus action.`,
			kind: 'heal',
			target: 'ally',
			range: 1,
			stat: 'spirit',
			dice: `${5 * character.level}`,
			uses: 1
		});
		bonusActions.push('lay-on-hands');
	}
	return { actions, attacks, bonusActions };
}

/** A character as the table plays it. */
export function tableCharacter(
	character: DndCharacter,
	color: string,
	catalog: Catalog
): CharacterDef {
	const derived = deriveCharacter(character, catalog);
	const { actions, attacks, bonusActions } = actionsOf(character, derived, catalog);
	const klass = slug(character.class.id);
	const full = sheetDetails(character, derived, catalog, actions);
	return characterDefOf(
		derived,
		{
			id: character.id,
			name: character.name,
			tagline: derived.title,
			intro: `${character.name} joins the party: ${article(derived.species)} ${derived.species} ${derived.class}, once ${article(derived.background)} ${derived.background.toLowerCase()}. A torch in hand, and ${actions[0].name.toLowerCase()} ready.`,
			color,
			vision: VISION,
			light: TORCH,
			stats: { might: 0, agility: 0, wits: 0, spirit: 0 },
			model: FIGURES[klass] ?? 'warden',
			actions,
			attacks,
			bonusActions
		},
		full
	);
}

export function summaryOf(character: DndCharacter, catalog: Catalog): CreatorSummary {
	const d = deriveCharacter(character, catalog);
	const { actions, attacks } = actionsOf(character, d, catalog);
	return {
		title: d.title,
		level: d.level,
		hp: d.hitPoints.max,
		armorClass: d.armorClass,
		speed: d.speed,
		initiative: d.initiative,
		proficiency: d.proficiency,
		scores: ABILITIES.map((a) => ({
			id: a.id as AbilityId,
			name: a.name,
			score: d.scores[a.id],
			modifier: d.modifiers[a.id]
		})),
		saves: ABILITIES.map((a) => ({
			id: a.id as AbilityId,
			name: a.name,
			bonus: d.saves[a.id].bonus,
			proficient: d.saves[a.id].proficient
		})),
		skills: SKILLS.map((s) => ({ id: s.id, name: s.name, ...d.skills[s.id] })),
		features: d.features.map((f) => f.name),
		feats: d.feats.map((f) => f.name),
		resources: d.resources.map((r) => ({ name: r.name, max: r.max })),
		spellcasting: d.spellcasting
			? {
					ability: d.spellcasting.ability as AbilityId,
					saveDc: d.spellcasting.saveDc,
					attackBonus: d.spellcasting.attackBonus
				}
			: null,
		actions: actions.map((a) => ({
			name: a.name,
			summary:
				a.kind === 'attack'
					? `${signed(d.modifiers[attacks[a.id]] + d.proficiency)} to hit, ${a.dice} damage${a.range > 1 ? `, range ${a.range}` : ''}`
					: `heals ${a.dice}${a.uses ? `, ${a.uses} use${a.uses === 1 ? '' : 's'}` : ''}`
		}))
	};
}

/** The builder the fifth edition rules offer the engine. */
export function dndBuilder(
	catalog: () => Catalog,
	rules: RulesetRef,
	attribution: string
): CharacterBuilder {
	const make = (raw: unknown, id: string) => {
		const read = choicesOf(raw, id);
		if ('problems' in read) return { ok: false as const, problems: read.problems };
		const made = createCharacter(read.choices, catalog(), rules);
		return made.ok ? { ok: true as const, character: made.character, color: read.color } : made;
	};
	const table = (character: DndCharacter, color: string): Built => ({
		ok: true,
		def: tableCharacter(character, color, catalog()),
		saved: { color, character: JSON.parse(JSON.stringify(character)) } as JsonData
	});
	return {
		options: () => creatorOptions(catalog(), attribution) as unknown as JsonData,
		preview(raw) {
			const made = make(raw, 'preview');
			return made.ok
				? { ok: true, summary: summaryOf(made.character, catalog()) as unknown as JsonData }
				: made;
		},
		build(raw, id) {
			const made = make(raw, id);
			return made.ok ? table(made.character, made.color) : made;
		},
		restore: (saved, id) => restore(saved, id),
		rename(saved, id, name) {
			const trimmed = name.trim();
			if (!trimmed || trimmed.length > NAME_MAX)
				return { ok: false, problems: [`a name of 1 to ${NAME_MAX} characters`] };
			return restore(saved, id, trimmed);
		}
	};

	/** A saved character back, checked in full; under a new name when one is given. */
	function restore(saved: unknown, id: string, name?: string): Built {
		if (!isObject(saved) || typeof saved.color !== 'string' || !COLOR.test(saved.color))
			return { ok: false, problems: ['a built character must have its colour'] };
		const migrated = migrateCharacter(saved.character);
		if (!migrated.ok) return migrated;
		const raw = name === undefined ? migrated.raw : { ...(migrated.raw as object), name };
		const read = readCharacter(raw, catalog(), rules);
		if (!read.ok) return read;
		if (read.character.id !== id)
			return { ok: false, problems: ['a built character under another id'] };
		return table(read.character, saved.color);
	}
}
