// A character's fifth edition sheet, read from the rules-neutral data on its
// definition (`CharacterDef.sheet`) and checked field by field: what the
// rules need to resolve checks, saves and attacks. A character built from
// the catalog (character/) writes its sheet with `characterDefOf`; the
// optional fields are what such a character knows beyond the basics.
//
//   sheet: {
//     title: 'Orc Fighter 1 (Soldier)',  // optional
//     level: 1,
//     abilities: { str: 17, dex: 12, con: 15, int: 8, wis: 13, cha: 10 },
//     saves: ['str', 'con'],             // saving throw proficiencies
//     skills: ['athletics', 'perception'],
//     expertise: ['perception'],         // optional: skills whose proficiency counts twice
//     initiative: 3,                     // optional: the initiative bonus (Dexterity by default)
//     attacks: { longsword: 'str' },     // the ability each attack action uses
//     bonusActions: ['second-wind'],     // actions that take a bonus action
//     unproficient: ['greataxe'],        // optional: attacks without the Proficiency Bonus
//     casting: 'int',                    // optional: the spellcasting ability
//     spells: { 'fire-bolt': 'srd-5.2.1:spell:fire-bolt' },  // optional: the spell each action casts
//     slots: { 'spell-slots-1': 1 },     // optional: the level of each resource that is spell slots
//     resistances: ['poison'],           // optional: damage types it has Resistance to
//   }
//
// A character built from its choices (character/) also carries its full
// sheet (`details`), `resources`, its `inventory` and `carrying` as the card
// shows them, and itself as `saved`, which the equipment rules change.
//
// Armor Class is the definition's `armor`.

import type { CardItem, CardResource } from '../../../src/lib/adventure/adventure';
import type { CharacterDef, RulesData, RulesValue } from '../../../src/lib/adventure/characters';
import {
	ABILITIES,
	isAbility,
	MAX_LEVEL,
	MAX_SCORE,
	MIN_SCORE,
	skillOf,
	type Ability
} from './core';

/** The SRD's damage types, as sheets and adventures name them. */
export const DAMAGE_TYPES = [
	'acid',
	'bludgeoning',
	'cold',
	'fire',
	'force',
	'lightning',
	'necrotic',
	'piercing',
	'poison',
	'psychic',
	'radiant',
	'slashing',
	'thunder'
];

export interface Sheet {
	/** The full sheet (character/details.ts), for a character built from its choices. */
	details: Record<string, unknown> | null;
	resources: CardResource[];
	title: string | null;
	level: number;
	abilities: Record<Ability, number>;
	saves: Ability[];
	skills: string[];
	expertise: string[];
	initiative: number | null;
	attacks: Record<string, Ability>;
	bonusActions: string[];
	unproficient: string[];
	inventory: CardItem[] | null;
	carrying: { weight: number; capacity: number } | null;
	/** The character as its rules save it (character/builder.ts `savedOf`). */
	saved: RulesData | null;
	/** The spellcasting ability, for a caster. */
	casting: Ability | null;
	/** The catalog spell each action casts, by action id. */
	spells: Record<string, string>;
	/** The slot level of each resource that is spell slots, by resource id. */
	slots: Record<string, number>;
	/** Damage types it has Resistance to (lower case: "poison"). */
	resistances: string[];
}

type Read = { ok: true; sheet: Sheet } | { ok: false; problems: string[] };

const isRecord = (v: RulesValue | undefined): v is RulesData =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const KEYS = [
	'title',
	'level',
	'abilities',
	'saves',
	'skills',
	'expertise',
	'initiative',
	'attacks',
	'bonusActions',
	'details',
	'resources',
	'unproficient',
	'inventory',
	'carrying',
	'saved',
	'casting',
	'spells',
	'slots',
	'resistances'
];

/** The sheet of a character, or everything wrong with it. */
export function readSheet(character: CharacterDef): Read {
	const problems: string[] = [];
	const bad = (msg: string) => problems.push(`character ${character.id}: ${msg}`);
	const raw = character.sheet;
	if (!raw) return { ok: false, problems: [`character ${character.id}: no fifth edition sheet`] };
	for (const k of Object.keys(raw)) if (!KEYS.includes(k)) bad(`unknown sheet field "${k}"`);

	const level = raw.level;
	if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > MAX_LEVEL)
		bad(`level must be a whole number from 1 to ${MAX_LEVEL}`);

	const abilities = {} as Record<Ability, number>;
	if (!isRecord(raw.abilities)) bad('abilities missing');
	else {
		for (const k of Object.keys(raw.abilities)) if (!isAbility(k)) bad(`unknown ability "${k}"`);
		for (const { id } of ABILITIES) {
			const score = raw.abilities[id];
			if (
				typeof score !== 'number' ||
				!Number.isInteger(score) ||
				score < MIN_SCORE ||
				score > MAX_SCORE
			)
				bad(`${id} must be a score from ${MIN_SCORE} to ${MAX_SCORE}`);
			else abilities[id] = score;
		}
	}

	const strings = (v: RulesValue | undefined, what: string): string[] => {
		if (v === undefined) return [];
		if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
			bad(`${what} must be a list of ids`);
			return [];
		}
		if (new Set(v).size !== v.length) bad(`${what} lists something twice`);
		return v as string[];
	};
	const saves = strings(raw.saves, 'saves');
	for (const s of saves) if (!isAbility(s)) bad(`no ability "${s}" to be proficient in saving`);
	const skills = strings(raw.skills, 'skills');
	for (const s of skills) if (!skillOf(s)) bad(`no skill "${s}"`);
	const expertise = strings(raw.expertise, 'expertise');
	for (const s of expertise)
		if (!skills.includes(s)) bad(`expertise in "${s}", not a skill it has`);
	const initiative = raw.initiative;
	if (
		initiative !== undefined &&
		(typeof initiative !== 'number' || !Number.isInteger(initiative) || Math.abs(initiative) > 30)
	)
		bad('initiative must be a whole number');
	const title = raw.title;
	if (title !== undefined && (typeof title !== 'string' || !title.trim() || title.length > 80))
		bad('title must be 1 to 80 characters');

	const actionIds = new Set(character.actions.map((a) => a.id));
	const attacks: Record<string, Ability> = {};
	if (raw.attacks !== undefined && !isRecord(raw.attacks))
		bad('attacks must map actions to abilities');
	const listed = isRecord(raw.attacks) ? raw.attacks : {};
	for (const [id, ability] of Object.entries(listed)) {
		if (!actionIds.has(id)) bad(`attacks: no action "${id}"`);
		if (typeof ability !== 'string' || !isAbility(ability))
			bad(`attacks: "${id}" needs an ability`);
		else attacks[id] = ability;
	}
	for (const a of character.actions)
		if (a.kind === 'attack' && !listed[a.id]) bad(`attacks: which ability does "${a.id}" use?`);
	const bonusActions = strings(raw.bonusActions, 'bonusActions');
	for (const b of bonusActions) if (!actionIds.has(b)) bad(`bonusActions: no action "${b}"`);
	const unproficient = strings(raw.unproficient, 'unproficient');
	for (const u of unproficient) if (!listed[u]) bad(`unproficient: no attack "${u}"`);

	// What the character rules write about gear travels as it is.
	if (raw.inventory !== undefined && !Array.isArray(raw.inventory)) bad('inventory must be a list');
	const carrying = isRecord(raw.carrying) ? raw.carrying : null;
	if (
		raw.carrying !== undefined &&
		(!carrying || typeof carrying.weight !== 'number' || typeof carrying.capacity !== 'number')
	)
		bad('carrying must give a weight and a capacity');
	if (raw.saved !== undefined && !isRecord(raw.saved)) bad('saved must be an object');

	// The full sheet, written by the character rules (character/details.ts), travels as it is.
	if (raw.details !== undefined && !isRecord(raw.details)) bad('details must be an object');
	const resources: CardResource[] = [];
	if (raw.resources !== undefined) {
		if (!Array.isArray(raw.resources)) bad('resources must be a list');
		else
			for (const r of raw.resources as readonly RulesValue[]) {
				if (
					!isRecord(r) ||
					typeof r.id !== 'string' ||
					typeof r.name !== 'string' ||
					typeof r.max !== 'number' ||
					!Number.isInteger(r.max) ||
					r.max < 0 ||
					(r.trackedBy !== null && (typeof r.trackedBy !== 'string' || !actionIds.has(r.trackedBy)))
				)
					bad(
						'resources: each needs an id, a name, a maximum and the action that tracks it, if any'
					);
				else
					resources.push({
						id: r.id,
						name: r.name,
						max: r.max,
						trackedBy: r.trackedBy as string | null
					});
			}
	}

	// Spells: the casting ability, the spell each action casts, and which resources are slots.
	const casting = raw.casting;
	if (casting !== undefined && (typeof casting !== 'string' || !isAbility(casting)))
		bad('casting must be an ability');
	const spells: Record<string, string> = {};
	if (raw.spells !== undefined && !isRecord(raw.spells)) bad('spells must map actions to spells');
	for (const [id, spell] of Object.entries(isRecord(raw.spells) ? raw.spells : {})) {
		if (!actionIds.has(id)) bad(`spells: no action "${id}"`);
		if (typeof spell !== 'string') bad(`spells: "${id}" needs a spell`);
		else spells[id] = spell;
	}
	if (Object.keys(spells).length && casting === undefined) bad('spells without a casting ability');
	const slots: Record<string, number> = {};
	if (raw.slots !== undefined && !isRecord(raw.slots)) bad('slots must map resources to levels');
	for (const [id, level] of Object.entries(isRecord(raw.slots) ? raw.slots : {})) {
		if (!resources.some((r) => r.id === id)) bad(`slots: no resource "${id}"`);
		if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 9)
			bad(`slots: "${id}" needs a level from 1 to 9`);
		else slots[id] = level;
	}

	const resistances = strings(raw.resistances, 'resistances');
	for (const r of resistances)
		if (!DAMAGE_TYPES.includes(r)) bad(`resistances: no damage type "${r}"`);

	if (problems.length) return { ok: false, problems };
	return {
		ok: true,
		sheet: {
			details: isRecord(raw.details) ? (raw.details as Record<string, unknown>) : null,
			resources,
			title: typeof title === 'string' ? title : null,
			level: level as number,
			abilities,
			saves: saves as Ability[],
			skills,
			expertise,
			initiative: typeof initiative === 'number' ? initiative : null,
			attacks,
			bonusActions,
			unproficient,
			inventory: Array.isArray(raw.inventory) ? (raw.inventory as unknown as CardItem[]) : null,
			carrying: carrying
				? { weight: carrying.weight as number, capacity: carrying.capacity as number }
				: null,
			saved: isRecord(raw.saved) ? raw.saved : null,
			casting: typeof casting === 'string' ? (casting as Ability) : null,
			spells,
			slots,
			resistances
		}
	};
}

const cache = new WeakMap<CharacterDef, Sheet>();

/** A character's sheet; its adventure was validated when it was registered, so it reads. */
export function sheetOf(character: CharacterDef): Sheet {
	const known = cache.get(character);
	if (known) return known;
	const read = readSheet(character);
	if (!read.ok) throw new Error(read.problems.join('; '));
	cache.set(character, read.sheet);
	return read.sheet;
}
