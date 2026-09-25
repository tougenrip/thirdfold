// The core of the fifth edition rules as the SRD 5.2.1 states them: six
// abilities and their modifiers, proficiency by level, skills, d20 tests
// (ability checks, saving throws and attack rolls) with advantage and
// disadvantage, and critical hits. Pure: dice come from the roller passed in.
//
// This work includes material from the System Reference Document 5.2.1
// ("SRD 5.2.1") by Wizards of the Coast LLC, available at
// https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative
// Commons Attribution 4.0 International License, available at
// https://creativecommons.org/licenses/by/4.0/legalcode.

import type { RollMode } from '../../../src/lib/game/chat';
import {
	formatExpression,
	parseDice,
	rollDice,
	type DiceRoll,
	type DieRoller
} from '../../../src/lib/game/dice';

export const ATTRIBUTION =
	'This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.';

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export const ABILITIES: readonly { id: Ability; name: string }[] = [
	{ id: 'str', name: 'Strength' },
	{ id: 'dex', name: 'Dexterity' },
	{ id: 'con', name: 'Constitution' },
	{ id: 'int', name: 'Intelligence' },
	{ id: 'wis', name: 'Wisdom' },
	{ id: 'cha', name: 'Charisma' }
];

export const SKILLS: readonly { id: string; name: string; ability: Ability }[] = [
	{ id: 'acrobatics', name: 'Acrobatics', ability: 'dex' },
	{ id: 'animal-handling', name: 'Animal Handling', ability: 'wis' },
	{ id: 'arcana', name: 'Arcana', ability: 'int' },
	{ id: 'athletics', name: 'Athletics', ability: 'str' },
	{ id: 'deception', name: 'Deception', ability: 'cha' },
	{ id: 'history', name: 'History', ability: 'int' },
	{ id: 'insight', name: 'Insight', ability: 'wis' },
	{ id: 'intimidation', name: 'Intimidation', ability: 'cha' },
	{ id: 'investigation', name: 'Investigation', ability: 'int' },
	{ id: 'medicine', name: 'Medicine', ability: 'wis' },
	{ id: 'nature', name: 'Nature', ability: 'int' },
	{ id: 'perception', name: 'Perception', ability: 'wis' },
	{ id: 'performance', name: 'Performance', ability: 'cha' },
	{ id: 'persuasion', name: 'Persuasion', ability: 'cha' },
	{ id: 'religion', name: 'Religion', ability: 'int' },
	{ id: 'sleight-of-hand', name: 'Sleight of Hand', ability: 'dex' },
	{ id: 'stealth', name: 'Stealth', ability: 'dex' },
	{ id: 'survival', name: 'Survival', ability: 'wis' }
];

export const MIN_SCORE = 1;
export const MAX_SCORE = 30;
export const MAX_LEVEL = 20;

export function isAbility(id: string): id is Ability {
	return ABILITIES.some((a) => a.id === id);
}

export function skillOf(id: string) {
	return SKILLS.find((s) => s.id === id);
}

export function abilityName(id: Ability): string {
	return ABILITIES.find((a) => a.id === id)!.name;
}

/** An ability score's modifier: (score − 10) / 2, rounded down. */
export function abilityModifier(score: number): number {
	return Math.floor((score - 10) / 2);
}

/** The proficiency bonus by character level: +2 at 1–4, rising by 1 every four levels to +6. */
export function proficiencyBonus(level: number): number {
	return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

/**
 * Advantage and disadvantage from their sources: any number of either
 * cancel out if both are present; otherwise one of them applies, however
 * many sources it has.
 */
export function modeOf(advantages: readonly string[], disadvantages: readonly string[]) {
	if (advantages.length > 0 && disadvantages.length === 0) return 'advantage';
	if (disadvantages.length > 0 && advantages.length === 0) return 'disadvantage';
	return undefined;
}

export interface D20 {
	/** The d20 (both when rolled twice, the kept one first) and the modifier, as a roll. */
	roll: DiceRoll;
	/** The d20 that counts. */
	natural: number;
	/** The other d20, when rolled twice. */
	other: number | null;
	total: number;
	mode?: RollMode;
}

/** A d20 plus a modifier, rolled twice keeping the higher (advantage) or lower (disadvantage). */
export function rollD20(modifier: number, mode: RollMode | undefined, roller: DieRoller): D20 {
	const first = roller(20);
	const second = mode ? roller(20) : null;
	const natural =
		second === null
			? first
			: mode === 'advantage'
				? Math.max(first, second)
				: Math.min(first, second);
	const other = second === null ? null : natural === first ? second : first;
	const total = natural + modifier;
	const flat =
		modifier === 0
			? []
			: [
					{
						kind: 'flat' as const,
						sign: modifier < 0 ? (-1 as const) : (1 as const),
						value: Math.abs(modifier)
					}
				];
	const keep = mode === 'advantage' ? 'kh1' : mode === 'disadvantage' ? 'kl1' : '';
	const dice = { kind: 'dice' as const, sign: 1 as const, count: mode ? 2 : 1, sides: 20 };
	const expression = `${dice.count}d20${keep}${formatExpression(flat).replace(/^(?=\d)/, '+')}`;
	return {
		roll: {
			expression,
			terms: [{ ...dice, rolls: other === null ? [natural] : [natural, other] }, ...flat],
			total
		},
		natural,
		other,
		total,
		...(mode ? { mode } : {})
	};
}

/** How a d20 came out, e.g. "d20 17 (advantage; the other 4) +5 = 22". */
export function describeD20(d20: D20, modifier: number): string {
	const twice = d20.mode && d20.other !== null ? ` (${d20.mode}; the other ${d20.other})` : '';
	const mod = modifier === 0 ? '' : ` ${modifier > 0 ? '+' : '−'}${Math.abs(modifier)}`;
	return `d20 ${d20.natural}${twice}${mod} = ${d20.total}`;
}

/** Damage dice rolled for a hit; a critical hit rolls the damage dice twice (modifiers once). */
export function rollDamage(expression: string, critical: boolean, roller: DieRoller): DiceRoll {
	const parsed = parseDice(expression);
	if (!parsed.ok) throw new Error(`Bad dice in adventure data: ${expression}`);
	const terms = critical
		? parsed.terms.map((t) => (t.kind === 'dice' ? { ...t, count: t.count * 2 } : t))
		: parsed.terms;
	return rollDice(terms, roller);
}
