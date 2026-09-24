// Which physical dice to show for a server-rolled result, and which face of
// each must land up. Pure data, no three.js: the renderer turns this into a
// tumbling animation that ends on exactly these faces. The server's roll is
// the truth; this only chooses how to show it.

import type { DiceRoll } from '$lib/game/dice';

export type DieKind = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100tens' | 'd100units';

/** Faces per model and the label on each face, in face order. */
export const DIE_LABELS: Record<DieKind, readonly string[]> = {
	d4: ['1', '2', '3', '4'],
	d6: ['1', '2', '3', '4', '5', '6'],
	d8: ['1', '2', '3', '4', '5', '6', '7', '8'],
	d10: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
	d12: Array.from({ length: 12 }, (_, i) => String(i + 1)),
	d20: Array.from({ length: 20 }, (_, i) => String(i + 1)),
	d100tens: ['00', '10', '20', '30', '40', '50', '60', '70', '80', '90'],
	d100units: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
};

export interface ThrownDie {
	kind: DieKind;
	/** Index into DIE_LABELS[kind] of the face that shows the result. */
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

/** Small seeded PRNG (mulberry32), so every client throws a given roll identically. */
export function seededRandom(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
