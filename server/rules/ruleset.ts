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
//
// The engine tells a ruleset what the table knows (is the tester in the
// dark, is an attacker beside an enemy, can it see its target) in rules-
// neutral words; what that means (disadvantage, or nothing) is the ruleset's.

import type { CharacterCard, RulesInfo } from '../../src/lib/adventure/adventure';
import type { Action, CharacterDef } from '../../src/lib/adventure/characters';
import type { AdventureDef } from '../../src/lib/adventure/define';
import type { RollMode } from '../../src/lib/game/chat';
import { parseDice, rollDice, type DiceRoll, type DieRoller } from '../../src/lib/game/dice';
import type { CharacterState, Statuses } from '../adventure/state';

/** Which rules a story plays by, exactly. */
export interface RulesetRef {
	id: string;
	version: number;
}

/** A d20 test: an ability check, or a saving throw. */
export type TestKind = 'check' | 'save';

/** What the table knows about where a test is made. */
export interface TestSituation {
	/** The tester stands where no light reaches, in the dark. */
	dark: boolean;
	/** The test is a matter of seeing (looking, searching, reading). */
	sight: boolean;
}

/** A d20 test, resolved. */
export interface TestResult {
	roll: DiceRoll;
	success: boolean;
	/** What was rolled, e.g. "Wits" or "Dexterity saving throw". */
	label: string;
	mode?: RollMode;
	/** How it came out, in a line. */
	explain: string;
}

/** What the table knows about an attack as it is made. */
export interface AttackSituation {
	/** A ranged attack (reach beyond the next cell). */
	ranged: boolean;
	/** A foe that can fight stands beside the attacker. */
	hostileBeside: boolean;
	/** The attacker can't see its target (darkness). */
	targetUnseen: boolean;
	/** The target can't see the attacker (darkness). */
	attackerUnseen: boolean;
	/** The target's statuses. */
	targetStatuses: Statuses;
}

/** An attack roll's result: the d20 roll, and the damage when it hit. */
export interface Strike {
	hit: boolean;
	toHit: DiceRoll;
	damage: DiceRoll | null;
	critical?: boolean;
	mode?: RollMode;
	explain?: string;
}

/** What starting its turn does to a downed character. */
export type Downed = { dead: true } | { dead: false; turnsLeft: number };

/** A ruleset's own words about itself: its name, and the credit its sources require. */
export type RulesetInfo = Omit<RulesInfo, 'id' | 'version'>;

export interface Ruleset extends RulesetRef, RulesetInfo {
	// Checks and saves
	/** Whether a check (or save) may name this stat. */
	isStat(stat: string, kind: TestKind): boolean;
	/** The bonus a character adds to a check or save of this stat. */
	bonus(character: CharacterDef, stat: string, kind: TestKind): number;
	/** What such a test is called, e.g. "Wits" or "Wisdom (Perception)". */
	label(stat: string, kind: TestKind): string;
	/** A d20 test against a difficulty, rolled here. */
	test(
		character: CharacterDef,
		stat: string,
		kind: TestKind,
		dc: number,
		situation: TestSituation,
		roller: DieRoller
	): TestResult;
	// Combat resolution
	initiativeBonus(character: CharacterDef): number;
	attackBonus(character: CharacterDef, action: Action): number;
	/** What an attack must reach to hit something with this armor and these statuses. */
	defense(armor: number, statuses: Statuses): number;
	/** An attack roll with a bonus against a defense, and its damage on a hit. */
	strike(
		bonus: number,
		damage: string,
		defense: number,
		situation: AttackSituation,
		roller: DieRoller
	): Strike;
	// Turns
	/** What part of a turn an action takes: "action", or another the rules have (a "bonus" action). */
	actionType(character: CharacterDef, action: Action): string;
	/** A part of a turn, as players read it. */
	actionTypeName(type: string): string;
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
	// Characters
	/** A character's numbers as players see them. */
	card(character: CharacterDef, statuses: Statuses): CharacterCard;
	/** What is wrong with an adventure under these rules: its characters' sheets, its checks' stats. */
	validate(adventure: AdventureDef): string[];
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

/** A ruleset as the table shows it. */
export function rulesInfo(ruleset: Ruleset): RulesInfo {
	return {
		id: ruleset.id,
		version: ruleset.version,
		name: ruleset.name,
		attribution: ruleset.attribution
	};
}

/** A dice expression from rules or adventure data, rolled. */
export function roll(expression: string, roller: DieRoller): DiceRoll {
	const parsed = parseDice(expression);
	if (!parsed.ok) throw new Error(`Bad dice in adventure data: ${expression}`);
	return rollDice(parsed.terms, roller);
}

/** The natural d20 of a roll whose first term is the d20 (the one kept, for two). */
export function naturalOf(roll: DiceRoll): number {
	const first = roll.terms[0];
	return first?.kind === 'dice' ? first.rolls[0] : 0;
}

/** "+3", "-1", "+0". */
export function signed(n: number): string {
	return n >= 0 ? `+${n}` : `${n}`;
}

/**
 * Every check and save an adventure makes, with where it is (verbs' and
 * signs' checks, hazards that hurt, enemies' save attacks), found by walking
 * its data. For rulesets' `validate`.
 */
export function testsOf(A: AdventureDef): { stat: string; kind: TestKind; at: string }[] {
	const tests: { stat: string; kind: TestKind; at: string }[] = [];
	const seen = new Set<object>();
	const isRecord = (v: unknown): v is Record<string, unknown> =>
		typeof v === 'object' && v !== null;
	const walk = (node: unknown, at: string) => {
		if (!isRecord(node) || seen.has(node)) return;
		seen.add(node);
		const check = node.check;
		if (isRecord(check) && typeof check.stat === 'string')
			tests.push({ stat: check.stat, kind: check.save ? 'save' : 'check', at });
		const save = node.save;
		if (isRecord(save) && typeof save.stat === 'string')
			tests.push({ stat: save.stat, kind: 'save', at });
		for (const [k, v] of Object.entries(node)) {
			if (k === 'characters' && at === 'adventure') continue;
			walk(v, Array.isArray(node) ? at : at === 'adventure' ? k : `${at}.${k}`);
		}
	};
	walk(A, 'adventure');
	return tests;
}
