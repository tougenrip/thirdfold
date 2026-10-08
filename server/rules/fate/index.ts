// Fate Condensed as ruleset `fate-condensed` v1 (milestone 60,
// docs/SECOND-RULES.md): the second rules system, chosen because it differs
// from the d20 family where the contract was most likely to have leaked.
//
// - Rolls are four Fate dice (`4dF`, each −1, 0 or +1) plus a skill rating,
//   read on the adjective ladder against a difficulty: fail, tie (success at
//   a minor cost), succeed, or succeed with style (three shifts or more).
// - Nobody has an Armor Class: the defender rolls too (Athletics), and a hit
//   is the shifts the attack beat the defence by.
// - Harm is soaked by one-point stress boxes, then consequences (mild 2,
//   moderate 4, severe 6) that stay after the fight; a hit nothing can soak
//   takes the character out. Nobody bleeds or dies by the rules.
// - Turns are elective: no initiative roll; whoever acts picks who goes next.
//
// Rules sentences here are our own words; the SRD's required credit is
// `FATE_ATTRIBUTION`, shown at the table and kept in every save.

import type { CharacterCard } from '../../../src/lib/adventure/adventure';
import type { Action, CharacterDef } from '../../../src/lib/adventure/characters';
import type { AdventureDef } from '../../../src/lib/adventure/define';
import { fudgeFace, type DiceRoll } from '../../../src/lib/game/dice';
import {
	ACTION_NAMES,
	FATE_ATTRIBUTION,
	FATE_PREGENS,
	FATE_RULES,
	FATE_SKILLS,
	isFateSkill,
	ladder,
	OUTCOME_NAMES,
	outcomeOf,
	PYRAMID,
	skillName,
	type FateAction
} from '../../../src/lib/rules/fate/core';
import type { CharacterState } from '../../adventure/state';
import {
	registerRuleset,
	roll,
	signed,
	testsOf,
	type CharacterBuilder,
	type Maneuver,
	type Ruleset
} from '../ruleset';
import { buildFate, readChoices, restoreFate, summaryOf } from './character';
import { ratingFor, readSheet, sheetOf, stuntsFor } from './sheet';

export { FATE_RULES } from '../../../src/lib/rules/fate/core';

/** Four Fate dice and a rating. */
const fate = (rating: number, roller: (sides: number) => number) =>
	roll(`4dF${rating ? signed(rating) : ''}`, roller);

/** The dice as printed: [+ 0 − +]. */
const faces = (r: DiceRoll) => {
	const t = r.terms[0];
	return t?.kind === 'fudge' ? `[${t.rolls.map(fudgeFace).join(' ')}]` : '';
};

/** A weapon rating from an attack's damage ("0", "2"); anything else counts as none. */
const weaponOf = (damage: string) => (/^\d{1,2}$/.test(damage) ? Number(damage) : 0);

/** The four things every character may do beyond its attacks. */
const maneuver = (
	id: string,
	name: string,
	about: string,
	target: Action['target'],
	range: number
): Action => ({ id, name, about, kind: 'maneuver', target, range, uses: null });

export const FATE_MANEUVERS: readonly Maneuver[] = [
	{
		action: maneuver(
			'create-advantage',
			'Create an Advantage',
			'Spot an opening on a foe you can see (Notice against Fair (+2)): the next attack on it gets +2, a free invoke.',
			'enemy',
			6
		),
		check: { stat: 'notice', dc: 2 },
		effect: {
			name: 'An opening',
			mods: { exposed: true },
			ends: { at: 'end', turns: 1 },
			concentration: false
		},
		says: 'creates an advantage on'
	},
	{
		action: maneuver(
			'full-defense',
			'Full Defense',
			'Give up your action to defend: +2 to every defence until your next turn.',
			'self',
			0
		),
		effect: {
			name: 'Full defense',
			mods: { evading: true },
			ends: { at: 'start', turns: 1 },
			concentration: false
		},
		says: 'goes on full defense.'
	}
];

/** Hit points left above the last: the stress boxes still clear. */
const clearBoxes = (state: CharacterState) => Math.max(0, state.hp - 1);

/**
 * Which consequences to take for a hit: none when stress soaks it, else the
 * slots that soak the rest with the least to spare (then the fewest), or
 * null when nothing can.
 */
export function consequencesFor(
	free: number,
	shifts: number,
	slots: readonly { id: string; absorbs: number }[]
): { ids: string[]; absorbs: number } | null {
	if (shifts <= free) return { ids: [], absorbs: 0 };
	let best: { ids: string[]; absorbs: number } | null = null;
	for (let mask = 1; mask < 1 << slots.length; mask++) {
		const picked = slots.filter((_, i) => mask & (1 << i));
		const absorbs = picked.reduce((n, s) => n + s.absorbs, 0);
		if (absorbs + free < shifts) continue;
		if (
			!best ||
			absorbs < best.absorbs ||
			(absorbs === best.absorbs && picked.length < best.ids.length)
		)
			best = { ids: picked.map((s) => s.id), absorbs };
	}
	return best;
}

const builder: CharacterBuilder = {
	options: () => ({
		rules: { ...FATE_RULES },
		skills: FATE_SKILLS.map((s) => ({ ...s })),
		pyramid: Object.fromEntries(Object.entries(PYRAMID).map(([k, v]) => [k, v])),
		actions: Object.entries(ACTION_NAMES).map(([id, name]) => ({ id, name })),
		pregens: FATE_PREGENS.map((p) => ({ id: p.id, name: p.choices.name }))
	}),
	preview(choices) {
		const read = readChoices(choices);
		return read.ok ? { ok: true, summary: summaryOf(read.choices) } : read;
	},
	build: (choices, id) => buildFate(choices, id),
	restore: (saved, id, base) => restoreFate(saved, id, base),
	rename(saved, id, name) {
		const s = saved as { choices?: Record<string, unknown> } | null;
		if (!s || typeof s !== 'object' || typeof s.choices !== 'object')
			return { ok: false, problems: ['saved character: no choices'] };
		return restoreFate({ ...s, choices: { ...s.choices, name } }, id);
	}
};

export const fateCondensed: Ruleset = {
	...FATE_RULES,
	name: 'Fate Condensed',
	attribution: FATE_ATTRIBUTION,
	// Checks are overcome actions with a skill; Fate has no saving throws.
	isStat: (stat, kind) => kind === 'check' && isFateSkill(stat),
	bonus: (character, stat) => ratingFor(sheetOf(character), stat, 'overcome'),
	label: (stat) => skillName(stat),
	test(character, stat, kind, dc, _situation, roller) {
		const rating = this.bonus(character, stat, kind);
		const rolled = fate(rating, roller);
		const shifts = rolled.total - dc;
		const outcome = outcomeOf(shifts);
		const stunts = stuntsFor(sheetOf(character), stat, 'overcome');
		return {
			roll: rolled,
			// A tie is success at a minor cost.
			success: shifts >= 0,
			label: skillName(stat),
			explain: `${skillName(stat)} ${ladder(rating)}${stunts.length ? ` (${stunts.join(', ')})` : ''}, ${faces(rolled)}: ${ladder(rolled.total)} against ${ladder(dc)}, ${OUTCOME_NAMES[outcome]}${outcome === 'tie' ? ' (success at a minor cost)' : shifts > 0 ? ` by ${shifts}` : ''}`
		};
	},
	// Who has the moment goes first, by Notice; nobody rolls for it.
	turnOrder: 'elective',
	initiativeBonus: (character) => ratingFor(sheetOf(character), 'notice', 'overcome'),
	initiative: (bonus, roller) => fate(bonus, roller),
	attackBonus: (character, action) =>
		action.stat ? ratingFor(sheetOf(character), action.stat, 'attack') : 0,
	// A character defends with Athletics (and its defend stunts); a foe with its rating.
	defense: (armor, _statuses, character) =>
		character ? ratingFor(sheetOf(character), 'athletics', 'defend') : armor,
	strike(bonus, damage, defense, situation, roller) {
		// An opening created on the target is a free invoke: +2; full defense is +2 to the defence.
		const invoke = situation.exposed ? 2 : 0;
		const full = situation.evading ? 2 : 0;
		const attack = fate(bonus + invoke, roller);
		const defend = fate(defense + full, roller);
		const shifts = attack.total - defend.total;
		const outcome = outcomeOf(shifts);
		const hit = shifts >= 1;
		const weapon = weaponOf(damage);
		return {
			hit,
			toHit: attack,
			damage: hit ? roll(`${shifts + weapon}`, roller) : null,
			defense: defend.total,
			explain: `${ladder(attack.total)} attack ${faces(attack)}${invoke ? ' with a free invoke (+2)' : ''} against ${ladder(defend.total)} defence ${faces(defend)}${full ? ' on full defense (+2)' : ''}: ${
				outcome === 'fail'
					? 'it misses'
					: outcome === 'tie'
						? 'a tie, a near miss'
						: `a ${shifts}-shift hit${weapon ? ` and ${weapon} for the weapon` : ''}${outcome === 'style' ? ', with style' : ''}`
			}`
		};
	},
	// One action a turn (overcome, create an advantage or attack); defending is free.
	actionType: () => 'action',
	actionTypeName: () => 'Action',
	speed: (base) => base,
	turnDamage: () => null,
	tick(statuses) {
		for (const [id, rounds] of statuses) {
			if (rounds <= 1) statuses.delete(id);
			else statuses.set(id, rounds - 1);
		}
	},
	// Taken out is out of the conflict, not dying: nothing happens on its turns.
	downedTurn: () => ({ dead: false, turnsLeft: 1, stable: true }),
	downedLimit: 1,
	downedWords: 'Taken out: out of this conflict until it ends, not dying.',
	absorb(state, character, amount) {
		const free = clearBoxes(state);
		const sheet = sheetOf(character);
		const open = sheet.consequences.filter((c) => !(state.resources?.get(c.id) ?? 0));
		const take = consequencesFor(free, amount, open);
		if (!take)
			return { amount: state.hp, note: `can't soak a ${amount}-shift hit and is taken out.` };
		if (!take.ids.length) return { amount };
		state.resources ??= new Map();
		for (const id of take.ids) state.resources.set(id, 1);
		const names = open.filter((c) => take.ids.includes(c.id)).map((c) => c.name.toLowerCase());
		const marked = Math.max(0, amount - take.absorbs);
		return {
			amount: marked,
			note: `takes a ${names.join(' and a ')}${marked ? ` and marks ${marked} stress` : ''}.`
		};
	},
	health: (state, character) => ({
		name: 'Stress boxes clear',
		value: clearBoxes(state),
		max: Math.max(0, character.hp - 1)
	}),
	conflictEnds(state, character) {
		if (state.hp >= character.hp) return null;
		state.hp = character.hp;
		return 'stress clears.';
	},
	maneuvers: FATE_MANEUVERS,
	builder,
	card(character): CharacterCard {
		const sheet = sheetOf(character);
		const rated = FATE_SKILLS.filter((s) => (sheet.skills[s.id] ?? 0) !== 0).sort(
			(a, b) =>
				(sheet.skills[b.id] ?? 0) - (sheet.skills[a.id] ?? 0) || a.name.localeCompare(b.name)
		);
		const summary = (a: Action): string => {
			if (a.kind === 'maneuver') return a.target === 'self' ? 'Yourself' : `Range ${a.range}`;
			const rating = a.stat ? ratingFor(sheet, a.stat, 'attack') : 0;
			return `${skillName(a.stat ?? '')} ${ladder(rating)} · ${a.range <= 1 ? 'Melee' : `Range ${a.range}`} · a hit is the shifts it beats the defence by`;
		};
		return {
			title: sheet.highConcept,
			defense: { name: 'Defend (Athletics)', value: ratingFor(sheet, 'athletics', 'defend') },
			level: null,
			proficiency: null,
			stats: rated.map((s) => ({
				id: s.id,
				name: s.name,
				bonus: sheet.skills[s.id] ?? 0,
				score: null,
				proficient: false
			})),
			saves: [],
			skills: [],
			actions: [...character.actions, ...FATE_MANEUVERS.map((m) => m.action)].map((a) => ({
				id: a.id,
				summary: summary(a),
				part: 'action',
				partName: 'Action'
			})),
			resources: sheet.consequences.map((c) => ({
				id: c.id,
				name: `${c.name} (soaks ${c.absorbs})`,
				max: 1,
				trackedBy: null
			})),
			traits: [
				{ kind: 'High concept', name: sheet.highConcept },
				{ kind: 'Trouble', name: sheet.trouble },
				...sheet.aspects.map((name) => ({ kind: 'Aspect', name })),
				...sheet.stunts.map((s) => ({
					kind: 'Stunt',
					name: s.name,
					text: `+2 to ${skillName(s.skill)} to ${ACTION_NAMES[s.action as FateAction]} when ${s.when}.`
				})),
				{
					kind: 'Stress',
					name: `${sheet.stress} physical stress boxes`,
					text: 'Each soaks one shift; they clear when the fight ends.'
				}
			]
		};
	},
	validate(A: AdventureDef) {
		const problems = testsOf(A).flatMap((t) =>
			t.kind === 'save'
				? [`${t.at}: Fate Condensed has no saving throws`]
				: isFateSkill(t.stat)
					? []
					: [`${t.at}: Fate Condensed has no skill "${t.stat}"`]
		);
		for (const def of Object.values(A.characters)) {
			const read = readSheet(def as CharacterDef);
			if ('problem' in read) problems.push(read.problem);
		}
		for (const [kind, e] of Object.entries(A.enemies)) {
			if (!Number.isInteger(e.armor) || e.armor < -2 || e.armor > 8)
				problems.push(`enemy ${kind}: its defence must be a rating from −2 to +8`);
			for (const a of e.attacks) {
				if (!Number.isInteger(a.toHit) || a.toHit < -2 || a.toHit > 8)
					problems.push(`enemy ${kind}: ${a.name} must attack at a rating from −2 to +8`);
				if (!/^\d{1,2}$/.test(a.damage))
					problems.push(`enemy ${kind}: ${a.name}'s damage is a weapon rating (0 for none)`);
				if (a.save) problems.push(`enemy ${kind}: ${a.name}: Fate Condensed has no saving throws`);
			}
		}
		return problems;
	}
};

registerRuleset(fateCondensed);
