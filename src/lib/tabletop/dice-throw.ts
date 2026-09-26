// Which physical dice to show for a server-rolled result, and which face of
// each must land up. Pure data, no three.js: the renderer turns this into a
// tumbling animation that ends on exactly these faces. The server's roll is
// the truth; this only chooses how to show it.

import type { DiceRoll } from '$lib/game/dice';

export type DieKind = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100tens' | 'd100units';

export interface ThrownDie {
	kind: DieKind;
	/** Index into DIE_LABELS[kind] (dice-faces.ts) of the face that shows the result. */
	face: number;
}

/** More than this and the table turns into a ball pit; the log and card still show every die. */
export const MAX_THROWN_DICE = 12;

const MODELLED: Record<number, DieKind> = {
	4: 'd4',
	6: 'd6',
	8: 'd8',
	10: 'd10',
	12: 'd12',
	20: 'd20'
};

/**
 * The dice to throw for a roll: one model per die rolled, d100 as a tens die
 * plus a units die (100 shows as "00" + "0"). Dice without a physical model
 * (d3, d7, …) are left out.
 */
export function diceToThrow(roll: DiceRoll): ThrownDie[] {
	const dice: ThrownDie[] = [];
	for (const term of roll.terms) {
		if (term.kind !== 'dice') continue;
		for (const value of term.rolls) {
			if (term.sides === 100) {
				const r = value % 100;
				dice.push({ kind: 'd100tens', face: Math.floor(r / 10) });
				dice.push({ kind: 'd100units', face: r % 10 });
				continue;
			}
			const kind = MODELLED[term.sides];
			if (kind) dice.push({ kind, face: value - 1 });
		}
	}
	return dice.slice(0, MAX_THROWN_DICE);
}
