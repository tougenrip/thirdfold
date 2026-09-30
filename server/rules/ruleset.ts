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
import type { Cover } from '../../src/lib/game/cover';
import type { CharacterState, Statuses } from '../adventure/state';

export type { Cover };

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
	/** Dice a lasting effect adds to the tester's saving throws (a blessing; "-1d4" takes away). */
	boon?: string;
	/** The conditions the tester holds. */
	conditions?: readonly HeldCondition[];
	/** Why the test has the upper hand, if something gives it one (a save against a spell when hurt). */
	advantage?: string;
	/** How much of the tester is hidden from where what it saves against comes from. */
	cover?: Cover;
	/** The tester spends its turn evading (a Dodge): what that is worth to a save is the rules'. */
	evading?: boolean;
}

/**
 * A condition a creature holds, as the engine tells the rules: its id (the
 * rules' own), the token it came from (a charmer, the source of a fear) and
 * whether that source is in the bearer's sight; `level` for one that counts
 * levels (Exhaustion).
 */
export interface HeldCondition {
	id: string;
	source: string | null;
	sourceSeen: boolean;
	level?: number;
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
	/** A lasting effect gives the next attack against the target the upper hand. */
	exposed?: boolean;
	/** Dice a lasting effect adds to the attacker's attack rolls (a blessing; "-1d4" takes away). */
	boon?: string;
	/** The conditions attacker and target hold, whether they stand within 5 feet, and the target's token. */
	attackerConditions?: readonly HeldCondition[];
	targetConditions?: readonly HeldCondition[];
	within5?: boolean;
	targetToken?: string;
	/** How much of the target obstacles and others hide from the attacker (see cover.ts). */
	cover?: Cover;
	/** The target spends its turn evading attacks (a Dodge), and sees its attacker. */
	evading?: boolean;
}

/** An attack roll's result: the d20 roll, and the damage when it hit. */
export interface Strike {
	hit: boolean;
	toHit: DiceRoll;
	damage: DiceRoll | null;
	critical?: boolean;
	mode?: RollMode;
	explain?: string;
	/** The defense it was rolled against, when the situation changed it (cover). */
	defense?: number;
}

/**
 * What starting its turn (or taking damage) does to a downed character:
 * it dies, or it hangs on (`turnsLeft` of the rules' count), comes to with
 * 1 HP (`revived`), or is `stable`; with the roll that decided it, if one
 * did, and the rules' account of it.
 */
export type Downed =
	| { dead: true; roll?: DiceRoll; test?: DownedTest; explain?: string }
	| {
			dead: false;
			turnsLeft: number;
			roll?: DiceRoll;
			test?: DownedTest;
			explain?: string;
			revived?: boolean;
			stable?: boolean;
	  };

/** A roll a downed character made (a death save): what it is called, its difficulty and whether it succeeded. */
export interface DownedTest {
	label: string;
	dc: number;
	success: boolean;
}

/** What harm a creature shrugs off, halves or takes double, by damage type (the rules' ids). */
export interface DamageTraits {
	immune: readonly string[];
	resist: readonly string[];
	vulnerable: readonly string[];
}

/**
 * Something every character can do on its turn beyond its own actions
 * (under rules that have them: Dash, Disengage, Dodge, Help): the action as
 * the table offers it (its target and reach say at whom), whether it adds
 * the turn's movement again, an effect it leaves on the character or its
 * target (counted on the character's turns), and a check it takes to
 * steady a downed ally (`stabilize`).
 */
export interface Maneuver {
	action: Action;
	move?: boolean;
	effect?: EffectSpec;
	check?: { stat: string; dc: number };
	stabilize?: boolean;
	/** What the table hears, after the character's name ("dashes."). */
	says: string;
}

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
	turnDamage(statuses: Statuses): { dice: string; cause: string; type?: string } | null;
	/** Statuses count down as their bearer's turn starts. */
	tick(statuses: Statuses): void;
	/** The turn of a character at 0 HP: it bleeds (or, under rules that have them, rolls a death save), and may die. */
	downedTurn(state: CharacterState, roller: DieRoller): Downed;
	/**
	 * Damage that drops a character to 0 HP (`overflow`: what was left over)
	 * or lands on one already there: whether it dies of it (massive damage, a
	 * third failed death save), for rules that say so; null when it changes
	 * nothing but the fall.
	 */
	downedDamage?(
		state: CharacterState,
		damage: { overflow: number; max: number; critical: boolean; already: boolean }
	): Downed | null;
	/** Most turns a character can spend down (a save's bound). */
	downedLimit: number;
	// Characters
	/** A character's numbers as players see them. */
	card(character: CharacterDef, statuses: Statuses): CharacterCard;
	/** What is wrong with an adventure under these rules: its characters' sheets, its checks' stats. */
	validate(adventure: AdventureDef): string[];
	// Advancement: none of the rulesets so far advance characters; the contract grows when one does.
	/** A character's full sheet in the rules' own shape, for rules with one (and characters that have one). */
	details?(character: CharacterDef): Record<string, unknown> | null;
	/** How players build their own characters under these rules, where the rules let them. */
	builder?: CharacterBuilder;
	/** What characters own and wield, under rules that keep an inventory (and the builder to restore them). */
	equipment?: Equipment;
	/** How characters cast spells, under rules that have them. */
	spells?: Spellcasting;
	/** The conditions these rules have, and what they do beyond rolls (acting, moving, concentration). */
	conditions?: ConditionRules;
	/** Damage of a type against what its target shrugs off, halves or doubles: what it takes, and why. */
	damageTaken?(
		amount: number,
		type: string | undefined,
		traits: DamageTraits
	): { amount: number; note?: string };
	/** What harm a character shrugs off or halves, from its sheet. */
	damageTraits?(character: CharacterDef): DamageTraits;
	/** What cover is worth to a defense (and to the saves it helps): a bonus and its name, or null for none. */
	coverBonus?(cover: Cover): { bonus: number; name: string } | null;
	/** Leaving a foe's reach lets it strike as the creature goes (an opportunity attack, a reaction). */
	opportunityAttacks?: boolean;
	/** What every character may do on its turn beyond its own actions. */
	maneuvers?: readonly Maneuver[];
	/** A downed character is steadied: it stops dying (Stable), for rules where that is a state. */
	stabilize?(state: CharacterState): void;
	/** A saving throw by something that isn't a character (an enemy), from its bonus. */
	saveWith?(
		bonus: number,
		stat: string,
		dc: number,
		situation: TestSituation,
		roller: DieRoller,
		advantage?: string
	): TestResult;
}

/** A condition as the table shows it. */
export interface ConditionInfo {
	id: string;
	name: string;
	/** Its rules text, as its source gives it. */
	text: string;
	/** What its text says that the table doesn't play yet. */
	notPlayed: string[];
	/** It counts levels (Exhaustion). */
	levels: boolean;
}

/**
 * Conditions, for rules that have them. The engine keeps who holds which
 * (as effects) and asks here what they mean for acting and moving; what they
 * do to rolls the rules work out from the situations' `conditions`.
 */
export interface ConditionRules {
	list(): ConditionInfo[];
	known(id: string): boolean;
	/** The condition that keeps its bearer from acting, by name, or null. */
	incapacitatedBy(held: readonly HeldCondition[]): string | null;
	/** Cells it may move this turn, from what it could without conditions. */
	speed(held: readonly HeldCondition[], cells: number): number;
	/** Whether it lies Prone and must spend half its movement to stand before moving. */
	prone(held: readonly HeldCondition[]): boolean;
	/** Tokens it can't attack (a charmer), and tokens it can't move closer to (the source of its fear). */
	spared(held: readonly HeldCondition[]): string[];
	feared(held: readonly HeldCondition[]): string[];
	breaksConcentration(held: readonly HeldCondition[]): boolean;
	/** The conditions a condition leaves behind when it ends (Unconscious leaves Prone). */
	leaves(id: string): string[];
	/** Whether its conditions kill it (six levels of Exhaustion). */
	deadly(held: readonly HeldCondition[]): boolean;
}

/**
 * What a lasting effect changes while it lasts, in words the engine applies
 * (milestone 49 grows this into conditions). Effects are the engine's:
 * it keeps them on the fight, ends them on time, and reads them where it
 * works out a defense, a speed, an attack or a save.
 */
export interface EffectMods {
	/** Dice added to its bearer's attack rolls and saving throws. */
	boon?: string;
	/** Added to its bearer's defense. */
	defense?: number;
	/** Cells off its bearer's speed. */
	slow?: number;
	/** The next attack against its bearer has the upper hand; then the effect ends. */
	exposed?: boolean;
	/** Its bearer can't regain hit points. */
	noHealing?: boolean;
	/** Conditions its bearer has while it lasts (the rules' ids). */
	conditions?: string[];
	/** Its bearer spends its turn evading attacks (Dodge): attacks against it it sees, and its saves, are the rules'. */
	evading?: boolean;
	/** Its bearer moves without drawing strikes as it leaves a foe's reach (Disengage). */
	disengaged?: boolean;
}

/**
 * A lasting effect the rules put on a target. It ends at the start or the
 * end of its source's turn, `turns` of that source's turns from now (1: its
 * next turn), sooner if its source loses concentration, and with the fight.
 */
export interface EffectSpec {
	name: string;
	mods: EffectMods;
	/** Counted on its source's turns; null for until it is removed (or saved against). */
	ends: { at: 'start' | 'end'; turns: number } | null;
	concentration: boolean;
	/** Its bearer repeats a save at the end of each of its turns (and, with `onDamage`, when it takes damage), ending it on a success. */
	repeat?: { stat: string; dc: number; onDamage?: boolean };
	/**
	 * What comes of a failed repeat save instead of carrying on (Sleep: the
	 * Incapacitated sleeper, failing again, falls Unconscious for the rest).
	 */
	worsens?: EffectSpec;
	/** It ends when its bearer takes damage (Sleep). */
	endsOnDamage?: boolean;
}

/** A target of a spell, as the engine tells the rules about it. */
export interface SpellTarget {
	/** Its token. */
	id: string;
	name: string;
	/** A character of the party (not a foe). */
	ally: boolean;
	/** The number an attack must reach (its defense, counting its effects). */
	defense: number;
	/** Its bonus to a saving throw of a stat. */
	saveBonus(stat: string): number;
	/** Dice its effects add to its saves. */
	boon?: string;
	/** The conditions it holds. */
	conditions?: readonly HeldCondition[];
	/** It doesn't sleep (Immunity to Exhaustion); a character's own traits the rules read from `character`. */
	sleepless?: boolean;
	/** A character of the party, for what its rules say of it. */
	character?: CharacterDef;
	/** How many of the spell's darts, beams or blessings are aimed at it. */
	times: number;
	situation: AttackSituation;
}

/** What a spell did to one target. */
export interface SpellHit {
	targetId: string;
	/** Each attack roll made at it (one per beam). */
	strikes: Strike[];
	/** Its saving throw, for a spell that calls for one, and the difficulty. */
	save: TestResult | null;
	dc: number | null;
	/** Damage it takes (after a save), and the dice. */
	damage: { roll: DiceRoll; amount: number; type: string } | null;
	/** Hit points it regains, and the dice. */
	heal: DiceRoll | null;
	/** Cells it is pushed away from the caster. */
	push: number;
	/** What lingers on it. */
	effect: EffectSpec | null;
	/** Something the table should hear about it, said after its name ("doesn't sleep"). */
	note?: string;
}

/**
 * Casting spells, for rules that have them. A spell is one of a
 * character's actions, with its aim (`Action.cast`); the rules say what it
 * costs and what it does, the engine where it lands and what that changes.
 */
export interface Spellcasting {
	/**
	 * A cast checked before anything is spent: the level it is cast at (a
	 * cantrip's 0; else `slot`, or the lowest the caster has left), the
	 * resource it spends (null for none), and how many targets it takes at
	 * that level; or why it can't be cast.
	 */
	plan(
		character: CharacterDef,
		action: Action,
		slot: number | null,
		spent: (resource: string) => number
	): { ok: true; level: number; resource: string | null; targets: number } | Refused;
	/** A cast at a level on its targets, resolved: what it does to each. */
	resolve(
		character: CharacterDef,
		action: Action,
		level: number,
		targets: readonly SpellTarget[],
		roller: DieRoller
	): SpellHit[];
	/** The saving throw that keeps concentration after taking damage: its stat and difficulty. */
	concentration(damage: number): { stat: string; dc: number };
}

type Refused = { ok: false; problems: string[] };

/** Where something a character takes came from, in the table's words. */
export type ItemOrigin =
	{ how: 'found'; where: string } | { how: 'given'; by: string } | { how: 'granted' };

/**
 * Inventory and equipment, for rules that keep them. Every change works on
 * a character's definition and returns the character's next saved form
 * (`Built.saved`); the engine restores that through the rules' builder, so
 * every rule is checked again and every number (Armor Class, attacks) comes
 * back from the rules. An item taken out of an inventory (put down on the
 * table, handed to another) is plain data only these rules read; the engine
 * keeps it and shows it as a prop, never as a prop's state.
 */
export interface Equipment {
	/** Whether this character keeps an inventory under these rules. */
	has(character: CharacterDef): boolean;
	/** Equips an entry (on) or takes it off; `weapon` says whether it was a weapon in hand. */
	wield(
		character: CharacterDef,
		entry: string,
		on: boolean
	): { ok: true; saved: JsonData; text: string; weapon: boolean } | Refused;
	/** Takes `quantity` of an entry out of the inventory. */
	remove(
		character: CharacterDef,
		entry: string,
		quantity: number
	): { ok: true; saved: JsonData; item: JsonData; name: string } | Refused;
	/** Puts an item in the inventory, if the character can carry it. */
	add(
		character: CharacterDef,
		item: JsonData,
		origin: ItemOrigin
	): { ok: true; saved: JsonData; name: string } | Refused;
	/** An item of the rules' own catalog, as `remove` would give it. */
	grant(id: string, quantity: number): { ok: true; item: JsonData; name: string } | Refused;
	/** An item's name, or null if it isn't one of these rules' items. */
	nameOf(item: unknown): string | null;
	/**
	 * What an attack with this action spends as it is made (a piece of
	 * ammunition): null when nothing, else the next saved form, or why the
	 * attack can't be made.
	 */
	use(
		character: CharacterDef,
		action: Action
	): null | { ok: true; saved: JsonData; text: string | null } | Refused;
	/** After a fight is won, what comes back (half the ammunition expended): null when nothing. */
	recover(character: CharacterDef): { saved: JsonData; text: string } | null;
}

/** A built character: the table's definition of it, and the plain data it is saved as. */
export type Built =
	{ ok: true; def: CharacterDef; saved: JsonData } | { ok: false; problems: string[] };

/** Plain JSON: what a builder sends to a creator and saves with a story. */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonData;
export type JsonData = { [key: string]: JsonValue };

/**
 * Character creation under a ruleset. Every choice is checked here, on the
 * server: a creation page may guide a player, but only what `build` accepts
 * reaches the table, and every number comes from the rules.
 */
export interface CharacterBuilder {
	/** What a player may choose from, as plain data for a creation page. */
	options(): JsonData;
	/** What the choices come to (the numbers the rules give them), or what is wrong with them. */
	preview(choices: unknown): { ok: true; summary: JsonData } | { ok: false; problems: string[] };
	/** A new character from a player's choices, with the id it will have at the table. */
	build(choices: unknown, id: string): Built;
	/**
	 * A built character back from what `build` saved. With `base` (an
	 * adventure's own character, whose inventory changed in play), it keeps
	 * the adventure's presentation of it.
	 */
	restore(saved: unknown, id: string, base?: CharacterDef): Built;
	/** A built character under a new name, where the rules let a name change. */
	rename?(saved: unknown, id: string, name: string): Built;
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
