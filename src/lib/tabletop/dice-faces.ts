// The face labels of each die model and the seeded randomness of a throw:
// what the 3D dice need and the room page does not. Kept apart from
// dice-throw.ts, which the room page imports eagerly, so the two never share
// a runtime module and three.js stays out of the page's static imports.

import type { DieKind } from './dice-throw';

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
