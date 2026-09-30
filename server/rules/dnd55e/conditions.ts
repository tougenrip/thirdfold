// The SRD 5.2.1's fifteen conditions, as the table plays them. The catalog
// (content/srd, the Rules Glossary) holds each condition's text; this table
// says what that text does at the table, in terms the rules resolve: whether
// its bearer can act, its speed, what it does to attack rolls by and against
// it, to its saving throws and ability checks, the conditions it brings with
// it, and what is not played yet (named, never approximated). `phrases` are
// the SRD's own words each entry stands on: a test finds them in the text.
//
// The engine keeps who has which condition (an effect: server/adventure/
// effects.ts) and tells the rules each one a creature holds, with its
// source and whether that source is in sight (`HeldCondition`); everything
// a condition changes is worked out here.

import type { ConditionRules, HeldCondition } from '../ruleset';
import type { Catalog } from './catalog';
import type { Ability } from './core';

export interface ConditionDef {
	id: string;
	name: string;
	/** Conditions it brings with it (Paralyzed is also Incapacitated). */
	includes?: readonly string[];
	/** No action, Bonus Action or Reaction; concentration breaks. */
	incapacitated?: boolean;
	/** Speed 0, and it can't increase. */
	speedZero?: boolean;
	/** Attack rolls against its bearer. `near`: Advantage within 5 feet, else Disadvantage (Prone). */
	against?: 'advantage' | 'disadvantage' | 'near';
	/** Its bearer's own attack rolls. */
	attacks?: 'advantage' | 'disadvantage';
	/** Its bearer's ability checks. */
	checks?: 'disadvantage';
	/** Only while the condition's source is in its bearer's sight (Frightened). */
	whileSourceSeen?: boolean;
	/** Only against targets other than the source (Grappled). */
	exceptSource?: boolean;
	/** Saving throws it fails without rolling. */
	failSaves?: readonly Ability[];
	/** Saving throws it makes at Disadvantage. */
	saveDisadvantage?: readonly Ability[];
	/** A hit on its bearer from within 5 feet is a Critical Hit. */
	critWithin5?: boolean;
	/** Checks that need sight fail. */
	blind?: boolean;
	/** Checks that need hearing fail. */
	deaf?: boolean;
	/** It can't attack its source (Charmed). */
	spareSource?: boolean;
	/** It can't willingly move closer to its source (Frightened). */
	keepAway?: boolean;
	/** Righting itself costs half its Speed (Prone). */
	standUp?: boolean;
	/** Cumulative levels: d20 tests −2 a level, Speed −5 feet a level, death at 6 (Exhaustion). */
	levels?: boolean;
	/** Conditions its bearer keeps when it ends (Unconscious leaves it Prone). */
	leaves?: readonly string[];
	/** What its text says that the table doesn't play yet. */
	notPlayed?: readonly string[];
	/** The SRD's words this entry is read from. */
	phrases: readonly string[];
}

const ALL_PHYSICAL: readonly Ability[] = ['str', 'dex'];

export const CONDITIONS: readonly ConditionDef[] = [
	{
		id: 'blinded',
		name: 'Blinded',
		blind: true,
		against: 'advantage',
		attacks: 'disadvantage',
		phrases: [
			'automatically fail any ability check that requires sight',
			'Attack rolls against you have Advantage, and your attack rolls have Disadvantage'
		]
	},
	{
		id: 'charmed',
		name: 'Charmed',
		spareSource: true,
		notPlayed: ['the charmer’s Advantage on social checks'],
		phrases: [
			'can’t attack the charmer or target the charmer with damaging abilities or magical effects',
			'Advantage on any ability check to interact with you socially'
		]
	},
	{
		id: 'deafened',
		name: 'Deafened',
		deaf: true,
		phrases: ['automatically fail any ability check that requires hearing']
	},
	{
		id: 'exhaustion',
		name: 'Exhaustion',
		levels: true,
		notPlayed: ['losing a level on a Long Rest (rests come with a later milestone)'],
		phrases: [
			'Each time you receive it, you gain 1 Exhaustion level',
			'You die if your Exhaustion level is 6',
			'the roll is reduced by 2 times your Exhaustion level',
			'reduced by a number of feet equal to 5 times your Exhaustion level'
		]
	},
	{
		id: 'frightened',
		name: 'Frightened',
		checks: 'disadvantage',
		attacks: 'disadvantage',
		whileSourceSeen: true,
		keepAway: true,
		phrases: [
			'Disadvantage on ability checks and attack rolls while the source of fear is within line of sight',
			'can’t willingly move closer to the source of fear'
		]
	},
	{
		id: 'grappled',
		name: 'Grappled',
		speedZero: true,
		attacks: 'disadvantage',
		exceptSource: true,
		notPlayed: ['being dragged by the grappler'],
		phrases: [
			'Your Speed is 0 and can’t increase',
			'Disadvantage on attack rolls against any target other than the grappler'
		]
	},
	{
		id: 'incapacitated',
		name: 'Incapacitated',
		incapacitated: true,
		notPlayed: ['Disadvantage on Initiative when surprised'],
		phrases: [
			'You can’t take any action, Bonus Action, or Reaction',
			'Your Concentration is broken'
		]
	},
	{
		id: 'invisible',
		name: 'Invisible',
		against: 'disadvantage',
		attacks: 'advantage',
		notPlayed: [
			'Advantage on Initiative',
			'being hidden from effects that need their target seen',
			'creatures that can see the invisible'
		],
		phrases: ['Attack rolls against you have Disadvantage, and your attack rolls have Advantage']
	},
	{
		id: 'paralyzed',
		name: 'Paralyzed',
		includes: ['incapacitated'],
		speedZero: true,
		failSaves: ALL_PHYSICAL,
		against: 'advantage',
		critWithin5: true,
		phrases: [
			'You have the Incapacitated condition',
			'Your Speed is 0 and can’t increase',
			'You automatically fail Strength and Dexterity saving throws',
			'Attack rolls against you have Advantage',
			'Any attack roll that hits you is a Critical Hit if the attacker is within 5 feet of you'
		]
	},
	{
		id: 'petrified',
		name: 'Petrified',
		includes: ['incapacitated'],
		speedZero: true,
		against: 'advantage',
		failSaves: ALL_PHYSICAL,
		notPlayed: [
			'Resistance to all damage',
			'Immunity to the Poisoned condition',
			'the added weight'
		],
		phrases: [
			'You have the Incapacitated condition',
			'Your Speed is 0 and can’t increase',
			'Attack rolls against you have Advantage',
			'You automatically fail Strength and Dexterity saving throws'
		]
	},
	{
		id: 'poisoned',
		name: 'Poisoned',
		attacks: 'disadvantage',
		checks: 'disadvantage',
		phrases: ['You have Disadvantage on attack rolls and ability checks']
	},
	{
		id: 'prone',
		name: 'Prone',
		attacks: 'disadvantage',
		against: 'near',
		standUp: true,
		notPlayed: ['crawling'],
		phrases: [
			'spend an amount of movement equal to half your Speed (round down) to right yourself',
			'You have Disadvantage on attack rolls',
			'An attack roll against you has Advantage if the attacker is within 5 feet of you. Otherwise, that attack roll has Disadvantage'
		]
	},
	{
		id: 'restrained',
		name: 'Restrained',
		speedZero: true,
		against: 'advantage',
		attacks: 'disadvantage',
		saveDisadvantage: ['dex'],
		phrases: [
			'Your Speed is 0 and can’t increase',
			'Attack rolls against you have Advantage, and your attack rolls have Disadvantage',
			'You have Disadvantage on Dexterity saving throws'
		]
	},
	{
		id: 'stunned',
		name: 'Stunned',
		includes: ['incapacitated'],
		failSaves: ALL_PHYSICAL,
		against: 'advantage',
		phrases: [
			'You have the Incapacitated condition',
			'You automatically fail Strength and Dexterity saving throws',
			'Attack rolls against you have Advantage'
		]
	},
	{
		id: 'unconscious',
		name: 'Unconscious',
		includes: ['incapacitated', 'prone'],
		speedZero: true,
		against: 'advantage',
		failSaves: ALL_PHYSICAL,
		critWithin5: true,
		leaves: ['prone'],
		notPlayed: ['dropping what it holds'],
		phrases: [
			'You have the Incapacitated and Prone conditions',
			'When this condition ends, you remain Prone',
			'Your Speed is 0 and can’t increase',
			'Attack rolls against you have Advantage',
			'You automatically fail Strength and Dexterity saving throws',
			'Any attack roll that hits you is a Critical Hit if the attacker is within 5 feet of you'
		]
	}
];

const BY_ID = new Map(CONDITIONS.map((c) => [c.id, c]));

export const conditionDef = (id: string): ConditionDef | undefined => BY_ID.get(id);

/** Most Exhaustion levels: at 6 its bearer dies. */
export const EXHAUSTION_DEATH = 6;

/** What a creature holds, with the conditions each brings: Paralyzed brings Incapacitated from the same source. */
export function expand(held: readonly HeldCondition[]): HeldCondition[] {
	const out: HeldCondition[] = [];
	const add = (h: HeldCondition, seen: Set<string>) => {
		if (seen.has(h.id)) return;
		seen.add(h.id);
		out.push(h);
		for (const inc of conditionDef(h.id)?.includes ?? [])
			add({ ...h, id: inc, level: undefined }, seen);
	};
	for (const h of held) add(h, new Set());
	return out;
}

const has = (held: readonly HeldCondition[], test: (c: ConditionDef) => boolean | undefined) =>
	expand(held).filter((h) => {
		const c = conditionDef(h.id);
		return !!c && !!test(c);
	});

/** The Exhaustion level a creature has (0 for none). */
export function exhaustionOf(held: readonly HeldCondition[]): number {
	return Math.min(
		EXHAUSTION_DEATH,
		held.filter((h) => h.id === 'exhaustion').reduce((n, h) => n + (h.level ?? 1), 0)
	);
}

/** The condition that keeps a creature from acting, by name, or null. */
export function incapacitatedBy(held: readonly HeldCondition[]): string | null {
	const top = held.find((h) => has([h], (c) => c.incapacitated).length);
	return top ? (conditionDef(top.id)?.name ?? null) : null;
}

/** Cells a creature may move this turn, from what it could without conditions. */
export function speedWith(held: readonly HeldCondition[], cells: number): number {
	if (has(held, (c) => c.speedZero).length) return 0;
	return Math.max(0, cells - exhaustionOf(held));
}

/** What a d20 test takes off for Exhaustion (2 a level). */
export const exhaustionPenalty = (held: readonly HeldCondition[]) => 2 * exhaustionOf(held);

/** Advantages and disadvantages its conditions give an attack, and whether a hit is a critical one. */
export function attackReasons(
	attacker: readonly HeldCondition[],
	target: readonly HeldCondition[],
	within5: boolean,
	targetToken: string | null
): { advantages: string[]; disadvantages: string[]; autoCrit: boolean } {
	const advantages: string[] = [];
	const disadvantages: string[] = [];
	for (const h of expand(attacker)) {
		const c = conditionDef(h.id);
		if (!c?.attacks) continue;
		if (c.whileSourceSeen && !h.sourceSeen) continue;
		if (c.exceptSource && h.source && h.source === targetToken) continue;
		(c.attacks === 'advantage' ? advantages : disadvantages).push(
			`${c.name.toLowerCase()} attacker`
		);
	}
	let autoCrit = false;
	for (const h of expand(target)) {
		const c = conditionDef(h.id);
		if (!c) continue;
		const mode = c.against === 'near' ? (within5 ? 'advantage' : 'disadvantage') : c.against;
		if (mode)
			(mode === 'advantage' ? advantages : disadvantages).push(`${c.name.toLowerCase()} target`);
		if (c.critWithin5 && within5) autoCrit = true;
	}
	return {
		advantages: [...new Set(advantages)],
		disadvantages: [...new Set(disadvantages)],
		autoCrit
	};
}

/** What its conditions do to a creature's check or save of an ability. */
export function testReasons(
	held: readonly HeldCondition[],
	kind: 'check' | 'save',
	ability: Ability | null,
	sight: boolean
): { fail: string | null; disadvantages: string[] } {
	const disadvantages: string[] = [];
	for (const h of expand(held)) {
		const c = conditionDef(h.id);
		if (!c) continue;
		if (kind === 'save' && ability && c.failSaves?.includes(ability))
			return { fail: `${c.name}: fails Strength and Dexterity saving throws`, disadvantages };
		if (kind === 'check' && sight && c.blind)
			return { fail: `${c.name}: a check that needs sight fails`, disadvantages };
		if (kind === 'save' && ability && c.saveDisadvantage?.includes(ability))
			disadvantages.push(c.name.toLowerCase());
		if (kind === 'check' && c.checks && (!c.whileSourceSeen || h.sourceSeen))
			disadvantages.push(c.name.toLowerCase());
	}
	return { fail: null, disadvantages: [...new Set(disadvantages)] };
}

/** Tokens its conditions keep a creature from attacking (a charmer). */
export function spared(held: readonly HeldCondition[]): string[] {
	return has(held, (c) => c.spareSource).flatMap((h) => (h.source ? [h.source] : []));
}

/** Tokens it can't willingly move closer to (the source of its fear). */
export function feared(held: readonly HeldCondition[]): string[] {
	return has(held, (c) => c.keepAway).flatMap((h) => (h.source ? [h.source] : []));
}

/** Whether it lies Prone and must spend half its Speed to stand (not while something holds it down). */
export const proneOf = (held: readonly HeldCondition[]) =>
	expand(held).some((h) => conditionDef(h.id)?.standUp);

/** Whether its concentration breaks (it is Incapacitated). */
export const breaksConcentration = (held: readonly HeldCondition[]) =>
	has(held, (c) => c.incapacitated).length > 0;

/** The conditions' part of the ruleset contract, with each one's text from the catalog. */
export function dndConditions(catalog: () => Catalog): ConditionRules {
	const text = (c: ConditionDef) => catalog().named('rule', c.name)?.text ?? '';
	return {
		list: () =>
			CONDITIONS.map((c) => ({
				id: c.id,
				name: c.name,
				text: text(c),
				notPlayed: [...(c.notPlayed ?? [])],
				levels: !!c.levels
			})),
		known: (id) => BY_ID.has(id),
		incapacitatedBy,
		speed: speedWith,
		prone: proneOf,
		spared,
		feared,
		breaksConcentration,
		leaves: (id) => [...(conditionDef(id)?.leaves ?? [])],
		deadly: (held) => exhaustionOf(held) >= EXHAUSTION_DEATH
	};
}
