// A character's fifth edition sheet, read from the rules-neutral data on its
// definition (`CharacterDef.sheet`) and checked field by field. Milestone 44
// replaces these pregenerated sheets with characters players build; the
// shape here is what the rules need to resolve checks, saves and attacks.
//
//   sheet: {
//     level: 1,
//     abilities: { str: 17, dex: 12, con: 15, int: 8, wis: 13, cha: 10 },
//     saves: ['str', 'con'],             // saving throw proficiencies
//     skills: ['athletics', 'perception'],
//     attacks: { longsword: 'str' },     // the ability each attack action uses
//     bonusActions: ['second-wind']      // actions that take a bonus action
//   }
//
// Armor Class is the definition's `armor`.

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

export interface Sheet {
	level: number;
	abilities: Record<Ability, number>;
	saves: Ability[];
	skills: string[];
	attacks: Record<string, Ability>;
	bonusActions: string[];
}

type Read = { ok: true; sheet: Sheet } | { ok: false; problems: string[] };

const isRecord = (v: RulesValue | undefined): v is RulesData =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const KEYS = ['level', 'abilities', 'saves', 'skills', 'attacks', 'bonusActions'];

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

	if (problems.length) return { ok: false, problems };
	return {
		ok: true,
		sheet: {
			level: level as number,
			abilities,
			saves: saves as Ability[],
			skills,
			attacks,
			bonusActions
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
