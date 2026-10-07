// Rests under the fifth edition rules (milestone 57), as the SRD 5.2.1's
// Rules Glossary and class features say them. A Short Rest spends Hit Point
// Dice while a character is hurt (each die rolled plus its Constitution
// modifier, at least 1 Hit Point) and recharges the features the SRD says
// recharge on one; a Long Rest gives back all Hit Points and all spent Hit
// Point Dice, recharges every feature and lowers Exhaustion by a level.
// `PHRASES` holds the words each rule is read from; a test finds every one
// in the pinned catalog.

import type { CharacterDef } from '../../../src/lib/adventure/characters';
import type { DiceRoll, DieRoller } from '../../../src/lib/game/dice';
import { roll, type RestResult, type Rests, type RulesetRef } from '../ruleset';
import type { Catalog } from './catalog';
import { deriveCharacter } from './character/derive';
import { readCharacter } from './character/validate';
import { sheetOf } from './sheet';

/** The Rules Glossary's words each rest is played from. */
export const REST_PHRASES = {
	'srd-5.2.1:rule:short-rest': [
		'To start a Short Rest, you must have at least 1 Hit Point.',
		'For each Hit Point Die you spend in this way, roll the die and add your Constitution modifier to it. You regain Hit Points equal to the total (minimum of 1 Hit Point).'
	],
	'srd-5.2.1:rule:long-rest': [
		'To start a Long Rest, you must have at least 1 Hit Point.',
		'You regain all lost Hit Points and all spent Hit Point Dice.',
		'If you have the Exhaustion condition, its level decreases by 1.',
		'Some features are recharged by a Long Rest.'
	]
} as const;

/**
 * Features a Short Rest recharges, by the resource the character sheet
 * keeps for them: one expended use, or all of them, as the feature's own
 * words say (class, feature, phrase). A Long Rest recharges every one.
 */
export const SHORT_REST_RECHARGE: Record<
	string,
	{ regain: 1 | 'all'; class: string; feature: string; phrase: string }
> = {
	rages: {
		regain: 1,
		class: 'Barbarian',
		feature: 'Rage',
		phrase: 'You regain one expended use when you finish a Short Rest'
	},
	'second-wind': {
		regain: 1,
		class: 'Fighter',
		feature: 'Second Wind',
		phrase: 'You regain one expended use when you finish a Short Rest'
	},
	'wild-shape': {
		regain: 1,
		class: 'Druid',
		feature: 'Wild Shape',
		phrase: 'You regain one expended use when you finish a Short Rest'
	},
	'channel-divinity': {
		regain: 1,
		class: 'Cleric',
		feature: 'Channel Divinity',
		phrase: 'You regain one of its expended uses when you finish a Short Rest'
	},
	'focus-points': {
		regain: 'all',
		class: 'Monk',
		feature: 'Monk’s Focus',
		phrase: 'at the end of which you regain all your expended points'
	},
	'pact-slots': {
		regain: 'all',
		class: 'Warlock',
		feature: 'Pact Magic',
		phrase: 'You regain all expended Pact Magic spell slots when you finish a Short or Long Rest.'
	}
};

export function dndRests(catalog: () => Catalog, rules: RulesetRef): Rests {
	/** The character a definition carries (written by tableCharacter), worked out by the rules. */
	function derivedOf(def: CharacterDef) {
		const saved = def.sheet ? sheetOf(def).saved : null;
		if (!saved) return null;
		const read = readCharacter(saved.character, catalog(), rules);
		return read.ok ? deriveCharacter(read.character, catalog()) : null;
	}

	return {
		rest(kind, def, state, roller: DieRoller): RestResult {
			const derived = derivedOf(def);
			const max = def.hp;
			const total = derived?.hitDice.total ?? 0;
			if (kind === 'long') {
				const regained = max - state.hp;
				return {
					hp: max,
					hitDiceSpent: 0,
					regain: Object.fromEntries((derived?.resources ?? []).map((r) => [r.id, 'all'])),
					exhaustion: 1,
					rolls: [],
					text:
						regained > 0
							? `${def.name} regains ${regained} HP and every spent Hit Point Die.`
							: `${def.name} is rested: every spent Hit Point Die and feature comes back.`
				};
			}
			// A Short Rest: spend Hit Point Dice while hurt, one at a time.
			let hp = state.hp;
			let spent = state.hitDiceSpent;
			const rolls: DiceRoll[] = [];
			const con = derived?.modifiers.con ?? 0;
			const die = derived?.hitDice.die ?? 0;
			while (die && hp < max && spent < total) {
				const r = roll(`1d${die}`, roller);
				rolls.push(r);
				hp = Math.min(max, hp + Math.max(1, r.total + con));
				spent++;
			}
			const regain: Record<string, number | 'all'> = {};
			for (const r of derived?.resources ?? []) {
				const recharge = SHORT_REST_RECHARGE[r.id];
				if (recharge) regain[r.id] = recharge.regain;
			}
			const healed = hp - state.hp;
			return {
				hp,
				hitDiceSpent: spent,
				regain,
				exhaustion: 0,
				rolls,
				text: rolls.length
					? `${def.name} spends ${rolls.length} Hit Point ${rolls.length === 1 ? 'Die' : 'Dice'} and regains ${healed} HP.`
					: hp < max
						? `${def.name} has no Hit Point Dice left to spend.`
						: `${def.name} catches their breath.`
			};
		}
	};
}
