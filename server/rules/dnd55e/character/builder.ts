// Building a level 1 fifth edition character for the table: the options a
// creation page may offer (from the catalog), a preview of what choices come
// to, and the build itself. The page's choices are read field by field into
// a character (level 1, hit points by the average, no subclass, no feats
// but those its origin gives) and checked by readCharacter like any other,
// so a page can't grant an option, a level or a number. Only the standard
// array and point buy are accepted: a roll the server didn't make is not a
// roll. The character then plays with its weapons as its attacks and, where
// its class has them at level 1, Second Wind or Lay On Hands, and with the
// spells it chose that the table casts (spells/actions.ts).

import type { Action, CharacterDef, RulesData } from '../../../../src/lib/adventure/characters';
import type {
	AbilityId,
	ClassOption,
	CreatorOptions,
	CreatorSummary,
	FeatOption
} from '../../../../src/lib/rules/dnd55e/creator';
import type { Built, CharacterBuilder, JsonData, RulesetRef } from '../../ruleset';
import { packOfId } from '../../../../src/lib/rules/dnd55e/homebrew';
import { withHomebrew, type Catalog } from '../catalog';
import { heldLicence, heldPack } from '../homebrew/registry';
import { ABILITIES, abilityName, SKILLS, type Ability } from '../core';
import type { ClassData, WeaponData } from '../srd/records';
import { unsupported } from '../spells/mechanics';
import { casterActions, type CasterActions } from '../spells/actions';
import { characterDefOf } from './adventure';
import { deriveCharacter, type DerivedCharacter } from './derive';
import { sheetDetails } from './details';
import { ammunitionFor, gearOf, inventoryCard, startingInventory } from './inventory';
import type { CharacterChoices, DndCharacter } from './model';
import {
	abilitiesNamed,
	armorTraining,
	classSkills,
	columnNumber,
	highestSlot,
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

/**
 * Where a content pack's record comes from, for a creation page: a homebrew
 * pack by name and version, or a licensed source by name, version and
 * publisher (milestone 59), so the two are never confused.
 */
function homebrewOf(id: string): { homebrew?: string; licensed?: string } {
	const pack = packOfId(id);
	const held = pack ? heldPack(pack) : undefined;
	if (!held) return {};
	const licence = heldLicence(pack!);
	return licence
		? { licensed: `${licence.name} ${licence.version}, ${licence.publisher}` }
		: { homebrew: `${held.pack.name} ${held.pack.version}` };
}

/** What a creation page may offer, from the catalog. */
export function creatorOptions(catalog: Catalog, attribution: string): CreatorOptions {
	/** A class's level 1 spell choices: how many, from its list up to its highest slot. */
	const spellOptions = (data: ClassData, name: string): ClassOption['spells'] => {
		const columns = data.levels[START_LEVEL - 1]?.columns ?? {};
		const cantrips = columnNumber(columns.Cantrips);
		const prepared = columnNumber(columns['Prepared Spells']);
		if (!cantrips && !prepared) return null;
		const highest = highestSlot(columns);
		const list = catalog
			.all('spell')
			.filter(
				(s) =>
					s.data.classes.includes(name) &&
					(s.data.level === 0 ? cantrips > 0 : s.data.level <= highest)
			)
			.sort((a, b) => a.data.level - b.data.level || a.name.localeCompare(b.name))
			.map((s) => ({
				id: s.id,
				name: s.name,
				level: s.data.level,
				school: s.data.school,
				castingTime: s.data.castingTime,
				range: s.data.range,
				concentration: s.data.concentration,
				text: firstParagraph(s.text),
				why: unsupported(s.id, s.data),
				...homebrewOf(s.id)
			}));
		return { cantrips, prepared, list };
	};
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
				spells: spellOptions(c.data, c.name),
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
			mastery: w.data.mastery,
			...homebrewOf(w.id)
		})),
		armor: catalog.all('armor').map((a) => ({
			id: a.id,
			name: a.name,
			category: a.data.category,
			armorClass: a.data.armorClass,
			strength: a.data.strength,
			...homebrewOf(a.id)
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
	id: string,
	catalog: Catalog
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
	const weapons = Array.isArray(raw.weapons) ? raw.weapons : [];
	if (weapons.length === 0) problems.push('choose a weapon');
	if (weapons.length > WEAPONS_MAX) problems.push(`at most ${WEAPONS_MAX} weapons`);
	// A new character starts with weapons its class is trained with (a found one may be anything).
	const klassRecord = typeof klass.id === 'string' ? catalog.get('class', klass.id) : undefined;
	for (const w of weapons) {
		const weapon = typeof w === 'string' ? catalog.get('weapon', w) : undefined;
		if (!weapon) problems.push(`no weapon "${String(w).slice(0, 80)}"`);
		else if (klassRecord && !trainedWith(klassRecord.data, weapon.data))
			problems.push(`${klassRecord.name} isn't trained with ${weapon.name}`);
	}
	const armor = isObject(raw.armor) ? raw.armor : {};
	if (
		(armor.worn !== null && typeof armor.worn !== 'string') ||
		typeof armor.shield !== 'boolean' ||
		(typeof armor.worn === 'string' && catalog.get('armor', armor.worn)?.data.category === 'shield')
	)
		problems.push('armor: a suit of armor or none, and a Shield or not');
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
			inventory: startingInventory(
				{
					armor: armor.worn as string | null,
					shield: armor.shield as boolean,
					weapons: weapons as string[]
				},
				catalog
			),
			spells: {
				cantrips: stringsOf(isObject(raw.spells) ? raw.spells.cantrips : []),
				prepared: stringsOf(isObject(raw.spells) ? raw.spells.prepared : [])
			},
			notes: {}
		}
	};
}

/** A page's list of ids, as strings (readCharacter checks each). */
const stringsOf = (v: unknown): string[] =>
	Array.isArray(v) ? v.slice(0, 30).map((x) => String(x).slice(0, 120)) : [];

/** The ability an attack with this weapon uses: Dexterity at range, the better for Finesse, else Strength. */
function weaponAbility(weapon: WeaponData, derived: DerivedCharacter): Ability {
	if (weapon.type === 'ranged') return 'dex';
	if (weapon.properties.some((p) => p.startsWith('Finesse')))
		return derived.modifiers.dex > derived.modifiers.str ? 'dex' : 'str';
	return 'str';
}

/**
 * The character's actions at the table: an attack with each weapon in hand
 * (a Versatile weapon alone in the hands deals its two-handed damage; a
 * weapon that fires ammunition says how much is left), or an Unarmed Strike
 * with empty hands; then its class's level 1 healing. `unproficient` lists
 * the attacks with weapons its class isn't trained with: no Proficiency
 * Bonus to hit (SRD: Weapon Proficiency).
 */
export function actionsOf(
	character: DndCharacter,
	derived: DerivedCharacter,
	catalog: Catalog
): {
	actions: Action[];
	attacks: Record<string, Ability>;
	bonusActions: string[];
	unproficient: string[];
	weapons: Record<string, string>;
	/** Its spells (spells/actions.ts): the spell each action casts, its slots, and the sheet's list. */
	caster: CasterActions;
} {
	const actions: Action[] = [];
	const attacks: Record<string, Ability> = {};
	const bonusActions: string[] = [];
	const unproficient: string[] = [];
	const weaponOf: Record<string, string> = {};
	const klass = catalog.get('class', character.class.id)!;
	const held = character.inventory.filter((e) => e.equipped === 'hand');
	const shield = character.inventory.some((e) => e.equipped === 'shield');
	for (const e of held) {
		const w = catalog.get('weapon', e.item)!;
		const ability = weaponAbility(w.data, derived);
		const reach = w.data.properties.some((p) => p === 'Reach');
		const range =
			w.data.range && w.data.type === 'ranged'
				? w.data.range.normal / FEET_PER_CELL
				: reach
					? 2
					: 1;
		const twoHanded = !!w.data.versatile && held.length === 1 && !shield;
		const die = twoHanded ? w.data.versatile! : w.data.damage;
		const mod = derived.modifiers[ability];
		const damage = /^\d+$/.test(die) ? die : `${die}${mod ? signed(mod) : ''}`;
		let action = slug(e.item);
		for (let n = 2; actions.some((a) => a.id === action); n++) action = `${slug(e.item)}-${n}`;
		attacks[action] = ability;
		weaponOf[action] = e.item;
		if (!trainedWith(klass.data, w.data)) unproficient.push(action);
		const g = gearOf(catalog, e.item);
		const ammo = g?.kind === 'weapon' ? ammunitionFor(g, catalog) : null;
		const left = ammo
			? character.inventory.filter((x) => x.item === ammo).reduce((n, x) => n + x.quantity, 0)
			: 0;
		const ammoName = ammo ? catalog.get('ammunition', ammo)!.name : '';
		actions.push({
			id: action,
			name: w.name,
			about: `${w.name}: ${die} ${w.data.damageType.toLowerCase()} damage${
				twoHanded ? ', held in both hands' : ''
			}${w.data.properties.length ? ` (${w.data.properties.join(', ')})` : ''}.${
				ammo ? (left ? ` ${ammoName}: ${left} left.` : ` No ${ammoName} left.`) : ''
			}${w.data.type === 'ranged' ? ' Hard to aim with a foe beside you.' : ''}${
				unproficient.includes(action) ? ' Not trained with it: no Proficiency Bonus.' : ''
			}`,
			kind: 'attack',
			target: 'enemy',
			range,
			stat: ability === 'dex' ? 'agility' : 'might',
			dice: damage,
			damageType: w.data.damageType.toLowerCase(),
			uses: null
		});
	}
	if (!held.length) {
		// SRD Unarmed Strike: Strength modifier plus Proficiency Bonus to hit, 1 + Strength modifier Bludgeoning.
		attacks['unarmed-strike'] = 'str';
		actions.push({
			id: 'unarmed-strike',
			name: 'Unarmed Strike',
			about: `A punch, kick or headbutt: ${Math.max(0, 1 + derived.modifiers.str)} bludgeoning damage. Nothing in hand.`,
			kind: 'attack',
			target: 'enemy',
			range: 1,
			stat: 'might',
			dice: `${Math.max(0, 1 + derived.modifiers.str)}`,
			damageType: 'bludgeoning',
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
	const caster = casterActions(character, derived, catalog, new Set(actions.map((a) => a.id)));
	actions.push(...caster.actions);
	Object.assign(attacks, caster.attacks);
	bonusActions.push(...caster.bonusActions);
	return { actions, attacks, bonusActions, unproficient, weapons: weaponOf, caster };
}

/** How a character looks at the table where the adventure says (its own characters). */
export type Look = Partial<Pick<CharacterDef, 'intro' | 'tagline' | 'model' | 'light' | 'vision'>>;

/** A character as the table plays it; `look` keeps an adventure's own presentation of it. */
export function tableCharacter(
	character: DndCharacter,
	color: string,
	catalog: Catalog,
	look: Look = {}
): CharacterDef {
	const derived = deriveCharacter(character, catalog);
	const { actions, attacks, bonusActions, unproficient, caster } = actionsOf(
		character,
		derived,
		catalog
	);
	const klass = slug(character.class.id);
	const full = sheetDetails(character, derived, catalog, actions, caster.list);
	return characterDefOf(
		derived,
		{
			id: character.id,
			name: character.name,
			tagline: look.tagline ?? derived.title,
			intro:
				look.intro ??
				`${character.name} joins the party: ${article(derived.species)} ${derived.species} ${derived.class}, once ${article(derived.background)} ${derived.background.toLowerCase()}. A torch in hand, and ${actions[0].name.toLowerCase()} ready.`,
			color,
			vision: look.vision ?? VISION,
			light: look.light ?? TORCH,
			stats: { might: 0, agility: 0, wits: 0, spirit: 0 },
			model: look.model ?? FIGURES[klass] ?? 'warden',
			actions,
			attacks,
			bonusActions
		},
		{
			...full,
			inventory: inventoryCard(character, catalog),
			unproficient,
			saved: savedOf(character, color),
			...(derived.spellcasting
				? { casting: derived.spellcasting.ability, spells: caster.spells, slots: caster.slots }
				: {})
		}
	);
}

/** What a built character is saved as: its colour and the character itself. */
export const savedOf = (character: DndCharacter, color: string) =>
	({ color, character: JSON.parse(JSON.stringify(character)) }) as JsonData & RulesData;

export function summaryOf(character: DndCharacter, catalog: Catalog): CreatorSummary {
	const d = deriveCharacter(character, catalog);
	const { actions, attacks, unproficient } = actionsOf(character, d, catalog);
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
			summary: a.cast
				? a.cast.resolves
				: a.kind === 'attack'
					? `${signed(d.modifiers[attacks[a.id]] + (unproficient.includes(a.id) ? 0 : d.proficiency))} to hit, ${a.dice} damage${a.range > 1 ? `, range ${a.range}` : ''}`
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
	/** The catalog as a story with these packs sees it; every pack's ids by id without. */
	const seen = (packs?: readonly string[]) => (packs ? withHomebrew(catalog(), packs) : catalog());
	const make = (raw: unknown, id: string, scope: Catalog) => {
		const read = choicesOf(raw, id, scope);
		if ('problems' in read) return { ok: false as const, problems: read.problems };
		const made = createCharacter(read.choices, scope, rules);
		return made.ok ? { ok: true as const, character: made.character, color: read.color } : made;
	};
	const table = (character: DndCharacter, color: string, scope: Catalog, look?: Look): Built => ({
		ok: true,
		def: tableCharacter(character, color, scope, look),
		saved: savedOf(character, color)
	});
	return {
		options: (packs) => creatorOptions(seen(packs), attribution) as unknown as JsonData,
		preview(raw, packs) {
			const scope = seen(packs);
			const made = make(raw, 'preview', scope);
			return made.ok
				? { ok: true, summary: summaryOf(made.character, scope) as unknown as JsonData }
				: made;
		},
		build(raw, id, packs) {
			const scope = seen(packs);
			const made = make(raw, id, scope);
			return made.ok ? table(made.character, made.color, scope) : made;
		},
		restore: (saved, id, base, packs) =>
			restore(saved, id, seen(packs), undefined, base && lookOf(base)),
		rename(saved, id, name, packs) {
			const trimmed = name.trim();
			if (!trimmed || trimmed.length > NAME_MAX)
				return { ok: false, problems: [`a name of 1 to ${NAME_MAX} characters`] };
			return restore(saved, id, seen(packs), trimmed);
		}
	};

	/** A saved character back, checked in full; under a new name when one is given. */
	function restore(saved: unknown, id: string, scope: Catalog, name?: string, look?: Look): Built {
		if (!isObject(saved) || typeof saved.color !== 'string' || !COLOR.test(saved.color))
			return { ok: false, problems: ['a built character must have its colour'] };
		const migrated = migrateCharacter(saved.character, scope);
		if (!migrated.ok) return migrated;
		const raw = name === undefined ? migrated.raw : { ...(migrated.raw as object), name };
		const read = readCharacter(raw, scope, rules);
		if (!read.ok) return read;
		if (read.character.id !== id)
			return { ok: false, problems: ['a built character under another id'] };
		return table(read.character, saved.color, scope, look);
	}
}

/** An adventure's own presentation of one of its characters. */
export const lookOf = (def: CharacterDef): Look => ({
	intro: def.intro,
	tagline: def.tagline,
	model: def.model,
	light: def.light,
	vision: def.vision
});
