// A ruleset: how characters check, fight and take their turns. The adventure
// engine (server/adventure/engine.ts) keeps the story, the table, transport
// and turn order; whenever it needs a rules answer (a check's bonus, whether
// an attack hits, how far a character moves this turn, what a downed one
// does) it asks the story's ruleset. Server-only and code, never content:
// creators pick a ruleset by id in data, they never supply one.
//
// Stories are pinned to a ruleset's exact id and version (`RulesetRef`,
// saved with the story); a save naming a ruleset this server doesn't have is
// refused rather than played under different rules.

import type { Action, CharacterDef } from '../../src/lib/adventure/characters';
import { parseDice, rollDice, type DiceRoll, type DieRoller } from '../../src/lib/game/dice';
import type { CharacterState, Statuses } from '../adventure/state';

/** Which rules a story plays by, exactly. */
export interface RulesetRef {
	id: string;
	version: number;
}

/** An attack roll's result: the d20 roll, and the damage when it hit. */
export interface Strike {
	hit: boolean;
	toHit: DiceRoll;
	damage: DiceRoll | null;
}

/** What starting its turn does to a downed character. */
export type Downed = { dead: true } | { dead: false; turnsLeft: number };

export interface Ruleset extends RulesetRef {
	name: string;
	// Checks
	/** The bonus a character adds to a check of this stat. */
	checkBonus(character: CharacterDef, stat: string): number;
	/** A stat's name, as a check shows it. */
	statName(stat: string): string;
	// Combat resolution
	initiativeBonus(character: CharacterDef): number;
	attackBonus(character: CharacterDef, action: Action): number;
	/** What an attack must reach to hit something with this armor and these statuses. */
	defense(armor: number, statuses: Statuses): number;
	/** An attack roll with a bonus against a defense, and its damage on a hit. */
	strike(bonus: number, damage: string, defense: number, roller: DieRoller): Strike;
	// Turns
	/** Cells something may move this turn, from its base speed and its statuses as the turn starts. */
	speed(base: number, statuses: Statuses): number;
	/** Damage something takes as its turn starts (a burn): dice and cause, or null. */
	turnDamage(statuses: Statuses): { dice: string; cause: string } | null;
	/** Statuses count down as their bearer's turn starts. */
	tick(statuses: Statuses): void;
	/** The turn of a character at 0 HP: it bleeds, and may die. */
	downedTurn(state: CharacterState): Downed;
	/** Most turns a character can spend down (a save's bound). */
	downedLimit: number;
	// Advancement: none of the rulesets so far advance characters; the contract grows when one does.
}

const rulesets = new Map<string, Ruleset>();
const key = (ref: RulesetRef) => `${ref.id}@${ref.version}`;

/** Makes a ruleset available to stories. Registering the same id and version twice is a mistake. */
export function registerRuleset(ruleset: Ruleset): void {
	if (rulesets.has(key(ruleset))) throw new Error(`Ruleset ${key(ruleset)} is already registered`);
	rulesets.set(key(ruleset), ruleset);
}

/** The ruleset of exactly this id and version, if this server has it. */
export function findRuleset(ref: RulesetRef): Ruleset | undefined {
	return rulesets.get(key(ref));
}

/** A dice expression from rules or adventure data, rolled. */
export function roll(expression: string, roller: DieRoller): DiceRoll {
	const parsed = parseDice(expression);
	if (!parsed.ok) throw new Error(`Bad dice in adventure data: ${expression}`);
	return rollDice(parsed.terms, roller);
}
