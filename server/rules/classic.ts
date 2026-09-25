// thirdfold's own rules, the ones The Hollow Bell and The Last Train to
// Blackwater were written for: four stats, d20 + stat checks, 10 + armor
// defense, guarded/slowed/burning, and bleeding out over three turns. Every
// story saved before rulesets existed plays by these. Nothing about the
// table (the dark, a foe beside an archer) changes a roll here.

import {
	BLEED_OUT_ROUNDS,
	defenseFor,
	STATS,
	STATUSES,
	summarizeAction,
	toHitFor,
	type StatId
} from '../../src/lib/adventure/characters';
import { registerRuleset, roll, testsOf, type Ruleset, type RulesetRef } from './ruleset';

export const CLASSIC: RulesetRef = { id: 'thirdfold-classic', version: 1 };

const isStat = (stat: string): stat is StatId => STATS.some((s) => s.id === stat);
const statName = (stat: string) => STATS.find((s) => s.id === stat)?.name ?? stat;
const bonusOf = (character: { stats: Record<StatId, number> }, stat: string) =>
	isStat(stat) ? character.stats[stat] : 0;

export const classic: Ruleset = {
	...CLASSIC,
	name: 'Thirdfold Classic',
	attribution: null,
	isStat,
	// A save is the same d20 + stat as a check.
	bonus: (character, stat) => bonusOf(character, stat),
	label: (stat, kind) => (kind === 'save' ? `${statName(stat)} save` : statName(stat)),
	test(character, stat, kind, dc, _situation, roller) {
		const bonus = this.bonus(character, stat, kind);
		const rolled = roll(bonus ? `1d20+${bonus}` : '1d20', roller);
		const success = rolled.total >= dc;
		return {
			roll: rolled,
			success,
			label: this.label(stat, kind),
			explain: `${rolled.total} vs ${dc}: ${success ? 'success' : 'failure'}`
		};
	},
	initiativeBonus: (character) => character.stats.agility,
	attackBonus: toHitFor,
	defense: (armor, statuses) => defenseFor(armor + (statuses.has('guarded') ? 2 : 0)),
	// A natural 20 always hits, a natural 1 never does.
	strike(bonus, damage, defense, _situation, roller) {
		const toHit = roll(`1d20+${bonus}`, roller);
		const natural = toHit.terms[0].kind === 'dice' ? toHit.terms[0].rolls[0] : 0;
		const hit = natural === 20 || (natural !== 1 && toHit.total >= defense);
		return { hit, toHit, damage: hit ? roll(damage, roller) : null };
	},
	// One action a turn, whatever it is.
	actionType: () => 'action',
	actionTypeName: () => 'Action',
	speed: (base, statuses) => (statuses.has('slowed') ? Math.floor(base / 2) : base),
	turnDamage: (statuses) =>
		statuses.has('burning') ? { dice: '1d4', cause: STATUSES.burning.name } : null,
	tick(statuses) {
		for (const [id, rounds] of statuses) {
			if (rounds <= 1) statuses.delete(id);
			else statuses.set(id, rounds - 1);
		}
	},
	downedTurn(state) {
		state.downedFor++;
		if (state.downedFor >= BLEED_OUT_ROUNDS) return { dead: true };
		return { dead: false, turnsLeft: BLEED_OUT_ROUNDS - state.downedFor };
	},
	downedLimit: BLEED_OUT_ROUNDS,
	card(character, statuses) {
		return {
			defense: { name: 'Defense', value: this.defense(character.armor, statuses) },
			level: null,
			proficiency: null,
			stats: STATS.map((s) => ({
				id: s.id,
				name: s.name,
				bonus: character.stats[s.id],
				score: null,
				proficient: false
			})),
			saves: [],
			skills: [],
			actions: character.actions.map((a) => ({
				id: a.id,
				summary: summarizeAction(a, toHitFor(character, a)),
				part: 'action',
				partName: 'Action'
			}))
		};
	},
	validate(A) {
		return testsOf(A)
			.filter((t) => !isStat(t.stat))
			.map((t) => `${t.at}: the classic rules have no stat "${t.stat}"`);
	}
};

registerRuleset(classic);
