import { describe, expect, it } from 'vitest';
import { parseDice, rollDice } from '$lib/game/dice';
import { buildDieModel, landingQuaternion } from './dice-geometry';
import { DIE_LABELS, diceToThrow, MAX_THROWN_DICE, seededRandom, type DieKind } from './dice-throw';

function roll(expression: string, faces: number[]) {
	const parsed = parseDice(expression);
	if (!parsed.ok) throw new Error(parsed.error);
	let i = 0;
	return rollDice(parsed.terms, () => faces[i++]);
}

describe('diceToThrow', () => {
	it('throws one die per rolled die, landing on its result', () => {
		expect(diceToThrow(roll('2d6+1d20+3', [4, 1, 17]))).toEqual([
			{ kind: 'd6', face: 3 },
			{ kind: 'd6', face: 0 },
			{ kind: 'd20', face: 16 }
		]);
	});

	it('splits a d100 into tens and units, with 100 as 00 + 0', () => {
		const show = (v: number) =>
			diceToThrow(roll('d100', [v]))
				.map((d) => DIE_LABELS[d.kind][d.face])
				.join('+');
		expect(show(47)).toBe('40+7');
		expect(show(5)).toBe('00+5');
		expect(show(100)).toBe('00+0');
		expect(show(90)).toBe('90+0');
	});

	it('skips dice with no physical model and caps the pile', () => {
		expect(diceToThrow(roll('1d7', [3]))).toEqual([]);
		expect(diceToThrow(roll('20d6', Array(20).fill(2)))).toHaveLength(MAX_THROWN_DICE);
	});

	it('throws identically everywhere for the same seed', () => {
		const a = seededRandom(42);
		const b = seededRandom(42);
		const seq = Array.from({ length: 5 }, () => a());
		expect(Array.from({ length: 5 }, () => b())).toEqual(seq);
		expect(seq.every((v) => v >= 0 && v < 1)).toBe(true);
	});
});

describe('die models', () => {
	const kinds: DieKind[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100tens', 'd100units'];

	it.each(kinds)('%s has one flat face per label', (kind) => {
		const model = buildDieModel(kind, 1);
		expect(model.faces).toHaveLength(DIE_LABELS[kind].length);
	});

	it.each(kinds)('%s is symmetric enough to rest on any face at the same height', (kind) => {
		const model = buildDieModel(kind, 1);
		for (const f of model.faces) expect(f.centroid.dot(f.normal)).toBeCloseTo(model.inradius, 3);
	});

	it.each(kinds)('%s lands with the chosen face up (d4: down, its vertex up)', (kind) => {
		const model = buildDieModel(kind, 1);
		model.faces.forEach((face, i) => {
			const q = landingQuaternion(model, i, 1.234);
			const n = face.normal.clone().applyQuaternion(q);
			expect(n.y).toBeCloseTo(model.readsAtVertex ? -1 : 1, 5);
			if (model.readsAtVertex) {
				const apex = model.apexes![i].clone().applyQuaternion(q);
				// The labelled vertex is the highest point.
				expect(apex.y).toBeGreaterThan(0);
				expect(apex.x).toBeCloseTo(0, 5);
				expect(apex.z).toBeCloseTo(0, 5);
			}
		});
	});
});
