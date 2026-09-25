// thirdfold's own rules, the ones The Hollow Bell and The Last Train to
// Blackwater were written for: four stats, d20 + stat checks, 10 + armor
// defense, guarded/slowed/burning, and bleeding out over three turns. Every
// story saved before rulesets existed plays by these.

import {
	BLEED_OUT_ROUNDS,
	defenseFor,
	STATS,
	STATUSES,
	toHitFor,
	type StatId
} from '../../src/lib/adventure/characters';
import { registerRuleset, roll, type Ruleset, type RulesetRef } from './ruleset';

export const CLASSIC: RulesetRef = { id: 'thirdfold-classic', version: 1 };

export const classic: Ruleset = {
	...CLASSIC,
	name: 'Thirdfold Classic',
	checkBonus: (character, stat) => character.stats[stat as StatId] ?? 0,
	statName: (stat) => STATS.find((s) => s.id === stat)?.name ?? stat,
	initiativeBonus: (character) => character.stats.agility,
	attackBonus: toHitFor,
	defense: (armor, statuses) => defenseFor(armor + (statuses.has('guarded') ? 2 : 0)),
	// A natural 20 always hits, a natural 1 never does.
	strike(bonus, damage, defense, roller) {
		const toHit = roll(`1d20+${bonus}`, roller);
		const natural = toHit.terms[0].kind === 'dice' ? toHit.terms[0].rolls[0] : 0;
		const hit = natural === 20 || (natural !== 1 && toHit.total >= defense);
		return { hit, toHit, damage: hit ? roll(damage, roller) : null };
	},
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
	downedLimit: BLEED_OUT_ROUNDS
};

registerRuleset(classic);
