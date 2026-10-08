// The fifth edition's combat rules beyond a single roll (SRD 5.2.1, "Playing
// the Game": Combat, Damage and Healing; the Rules Glossary): death saving
// throws and dying, massive damage, Resistance, Vulnerability and Immunity to
// damage types, cover, and the actions every creature can take (Dash,
// Disengage, Dodge, Help). The Opportunity Attack is a reaction every
// creature has; the engine finds when one is provoked and asks the rules
// whether it is (`opportunityAttacks`). Each rule quotes the SRD in `PHRASES`,
// which a test finds in the pinned source's text.
//
// This work includes material from the SRD 5.2.1; see core.ts.

import type { Action, CharacterDef } from '../../../src/lib/adventure/characters';
import type { DieRoller } from '../../../src/lib/game/dice';
import type { CharacterState } from '../../adventure/state';
import {
	naturalOf,
	roll,
	type Cover,
	type DamageTraits,
	type Downed,
	type Maneuver
} from '../ruleset';
import { sheetOf } from './sheet';

/** A death save succeeds on this or higher. */
export const DEATH_SAVE_DC = 10;
/** Three of a kind: three successes steady, three failures kill. */
export const OF_A_KIND = 3;
/** Most turns counted down (a Stable character can lie a long fight); a save's bound. */
export const DOWNED_LIMIT = 100;

/** Where the table reads each rule: the SRD's own words. */
export const PHRASES = [
	// Death Saving Throws
	'Whenever you start your turn with 0 Hit Points, you must make a Death Saving Throw',
	'Roll 1d20. If the roll is 10 or higher, you succeed. Otherwise, you fail.',
	'On your third success, you become Stable',
	'On your third failure, you die.',
	'The number of both is reset to zero when you regain any Hit Points or become Stable.',
	'When you roll a 1 on the d20 for a Death Saving Throw, you suffer two failures.',
	'If you roll a 20 on the d20, you regain 1 Hit Point.',
	'If you take any damage while you have 0 Hit Points, you suffer a Death Saving Throw failure.',
	'If the damage is from a Critical Hit, you suffer two failures instead.',
	'If the damage equals or exceeds your Hit Point maximum, you die.',
	'If the creature takes damage, it stops being Stable and starts making Death Saving Throws again.',
	'requires a successful DC 10 Wisdom (Medicine) check',
	// Massive damage
	'the character dies if the remainder equals or exceeds their Hit Point maximum',
	// Resistance, Vulnerability, Immunity
	'damage of that type is halved against you (round down)',
	'damage of that type is doubled against you',
	'If you have Immunity to a damage type or a condition, it doesn’t affect you in any way.',
	// Cover
	'Half Cover (+2 bonus to AC and Dexterity saving throws), Three-Quarters Cover (+5 bonus to AC and Dexterity saving throws)',
	'A target can benefit from cover only when an attack or other effect originates on the opposite side of the cover.',
	'only the most protective degree of cover applies',
	// Reactions and Opportunity Attacks
	'Once you take a Reaction, you can’t take another one until the start of your next turn.',
	'You can make an Opportunity Attack when a creature that you can see leaves your reach',
	'take a Reaction to make one melee attack with a weapon or an Unarmed Strike',
	'The attack occurs right before it leaves your reach.',
	'You can avoid provoking an Opportunity Attack by taking the Disengage action.',
	// Actions
	'The increase equals your Speed after applying any modifiers.',
	'your movement doesn’t provoke Opportunity Attacks for the rest of the current turn',
	'any attack roll made against you has Disadvantage if you can see the attacker, and you make Dexterity saving throws with Advantage',
	'giving Advantage to the next attack roll by one of your allies against that enemy. This benefit expires at the start of your next turn.'
];

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 'es'}`;
const tally = (s: { successes: number; failures: number }) =>
	`${plural(s.successes, 'success')}, ${s.failures} ${s.failures === 1 ? 'failure' : 'failures'}`;

/** A downed character's turn starts: it rolls its death save (none while Stable). */
export function deathSave(state: CharacterState, roller: DieRoller): Downed {
	state.downedFor = Math.min(DOWNED_LIMIT, state.downedFor + 1);
	const saves = state.deathSaves ?? { successes: 0, failures: 0 };
	if (saves.stable) return { dead: false, turnsLeft: OF_A_KIND, stable: true };
	const d20 = roll('1d20', roller);
	const n = naturalOf(d20);
	if (n === 20) {
		state.hp = 1;
		state.deathSaves = undefined;
		state.downedFor = 0;
		return {
			dead: false,
			turnsLeft: OF_A_KIND,
			roll: d20,
			test: { label: 'Death saving throw', dc: DEATH_SAVE_DC, success: true },
			revived: true,
			explain: 'Death save: a 20, and 1 Hit Point back'
		};
	}
	const next = { ...saves };
	if (n === 1) next.failures += 2;
	else if (n >= DEATH_SAVE_DC) next.successes++;
	else next.failures++;
	const what =
		n === 1 ? 'a 1: two failures' : n >= DEATH_SAVE_DC ? `${n}: success` : `${n}: failure`;
	const test = { label: 'Death saving throw', dc: DEATH_SAVE_DC, success: n >= DEATH_SAVE_DC };
	if (next.failures >= OF_A_KIND) {
		state.deathSaves = undefined;
		return { dead: true, roll: d20, test, explain: `Death save: ${what}, the third failure` };
	}
	if (next.successes >= OF_A_KIND) {
		state.deathSaves = { successes: 0, failures: 0, stable: true };
		return {
			dead: false,
			turnsLeft: OF_A_KIND,
			roll: d20,
			test,
			stable: true,
			explain: `Death save: ${what}, the third success: Stable`
		};
	}
	state.deathSaves = next;
	return {
		dead: false,
		turnsLeft: OF_A_KIND - next.failures,
		roll: d20,
		test,
		explain: `Death save: ${what} (${tally(next)})`
	};
}

/**
 * Damage that drops a character to 0 HP, or lands on one already there:
 * massive damage kills outright; at 0 it is a failed death save (two from a
 * Critical Hit), and a Stable character starts dying again.
 */
export function downedDamage(
	state: CharacterState,
	damage: { overflow: number; max: number; critical: boolean; already: boolean }
): Downed | null {
	if (damage.overflow >= damage.max)
		return {
			dead: true,
			explain: damage.already
				? `${damage.overflow} damage at 0 HP, at least its Hit Point maximum of ${damage.max}`
				: `Massive damage: ${damage.overflow} left over, at least its Hit Point maximum of ${damage.max}`
		};
	if (!damage.already) {
		state.deathSaves = { successes: 0, failures: 0 };
		return null;
	}
	const saves = state.deathSaves ?? { successes: 0, failures: 0 };
	const failures = Math.min(OF_A_KIND, saves.failures + (damage.critical ? 2 : 1));
	const what = damage.critical
		? 'two death save failures (a Critical Hit)'
		: 'a death save failure';
	if (failures >= OF_A_KIND) {
		state.deathSaves = undefined;
		return { dead: true, explain: `Damage at 0 HP: ${what}, the third` };
	}
	state.deathSaves = { successes: saves.stable ? 0 : saves.successes, failures };
	return {
		dead: false,
		turnsLeft: OF_A_KIND - failures,
		explain: `Damage at 0 HP: ${what} (${tally(state.deathSaves)})`
	};
}

/** Steadied by a check (the Help action's first aid): Stable, its saves reset. */
export function stabilize(state: CharacterState): void {
	state.deathSaves = { successes: 0, failures: 0, stable: true };
}

/** Damage against what its target shrugs off (Immunity), halves (Resistance, round down) or doubles (Vulnerability). */
export function damageTaken(
	amount: number,
	type: string | undefined,
	traits: DamageTraits
): { amount: number; note?: string } {
	const t = type?.toLowerCase();
	if (!t) return { amount };
	const has = (list: readonly string[]) => list.some((x) => x.toLowerCase() === t);
	if (has(traits.immune)) return { amount: 0, note: `immune to ${t} damage` };
	let taken = amount;
	const notes: string[] = [];
	if (has(traits.resist)) {
		taken = Math.floor(taken / 2);
		notes.push(`resistant to ${t}: halved`);
	}
	if (has(traits.vulnerable)) {
		taken *= 2;
		notes.push(`vulnerable to ${t}: doubled`);
	}
	return notes.length ? { amount: taken, note: notes.join(', ') } : { amount };
}

/** A character's resistances, from its sheet (its species' traits). */
export function damageTraits(character: CharacterDef): DamageTraits {
	return { immune: [], resist: sheetOf(character).resistances, vulnerable: [] };
}

/**
 * Cover by degree: things (walls, doors, props) blocking three or four of
 * the lines cover at least three-quarters of the target; one or two, or
 * other creatures (which cover at most half), give Half Cover.
 */
export function coverBonus(cover: Cover): { bonus: number; name: string } | null {
	if (cover.objects >= 3) return { bonus: 5, name: 'Three-Quarters Cover' };
	if (cover.blocked >= 1) return { bonus: 2, name: 'Half Cover' };
	return null;
}

const action = (
	id: string,
	name: string,
	about: string,
	target: Action['target'],
	range: number
): Action => ({ id, name, about, kind: 'maneuver', target, range, uses: null });

/** What every creature can do with its action: the Rules Glossary's Dash, Disengage, Dodge and Help. */
export const MANEUVERS: readonly Maneuver[] = [
	{
		action: action(
			'dash',
			'Dash',
			'Extra movement for this turn, equal to your Speed after its modifiers.',
			'self',
			0
		),
		move: true,
		says: 'dashes.'
	},
	{
		action: action(
			'disengage',
			'Disengage',
			'Your movement doesn’t provoke Opportunity Attacks for the rest of this turn.',
			'self',
			0
		),
		effect: {
			name: 'Disengage',
			mods: { disengaged: true },
			ends: { at: 'end', turns: 0 },
			concentration: false
		},
		says: 'disengages.'
	},
	{
		action: action(
			'dodge',
			'Dodge',
			'Until the start of your next turn, attacks against you have Disadvantage if you can see the attacker, and you make Dexterity saving throws with Advantage.',
			'self',
			0
		),
		effect: {
			name: 'Dodge',
			mods: { evading: true },
			ends: { at: 'start', turns: 1 },
			concentration: false
		},
		says: 'takes the Dodge action.'
	},
	{
		action: action(
			'help',
			'Help',
			'Distract a foe within 5 feet: an ally’s next attack roll against it has Advantage (until the start of your next turn).',
			'enemy',
			1
		),
		effect: {
			name: 'Help',
			mods: { exposed: true },
			ends: { at: 'start', turns: 1 },
			concentration: false
		},
		says: 'distracts'
	},
	{
		action: action(
			'first-aid',
			'Help: first aid',
			'Try to stabilize an ally at 0 Hit Points within 5 feet: a DC 10 Wisdom (Medicine) check.',
			'ally',
			1
		),
		check: { stat: 'medicine', dc: 10 },
		stabilize: true,
		says: 'tends to'
	}
];
