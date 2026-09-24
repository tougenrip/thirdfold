import { describe, expect, it } from 'vitest';
import {
	DICE_LIMITS,
	formatBreakdown,
	parseDice,
	rollDice,
	STANDARD_DICE,
	type DiceTerm
} from './dice';

function terms(input: string): DiceTerm[] {
	const r = parseDice(input);
	if (!r.ok) throw new Error(r.error);
	return r.terms;
}

/** Roller that always returns the given faces in order, then repeats the last one. */
function fixed(...faces: number[]) {
	let i = 0;
	return () => faces[Math.min(i++, faces.length - 1)];
}

describe('parseDice', () => {
	it.each([
		['1d20', '1d20'],
		['d20', '1d20'],
		['2d6', '2d6'],
		['1d20+5', '1d20+5'],
		['2d6+3', '2d6+3'],
		[' 2 d 6 - 1 ', '2d6-1'],
		['D8', '1d8'],
		['d%', '1d100'],
		['4d6+1d4+2', '4d6+1d4+2'],
		['-1d4', '-1d4'],
		['7', '7']
	])('reads %j as %s', (input, expression) => {
		const r = parseDice(input);
		expect(r.ok && r.expression).toBe(expression);
	});

	it('supports every standard die', () => {
		for (const sides of STANDARD_DICE) expect(parseDice(`1d${sides}`).ok).toBe(true);
	});

	it.each([
		'',
		'   ',
		'd',
		'1d',
		'0d6',
		'1d1',
		'1d0',
		`1d${DICE_LIMITS.sides + 1}`,
		`${DICE_LIMITS.dice + 1}d6`,
		'60d6+60d6',
		'1d20+',
		'1d20 5',
		'2d6*3',
		'1d20;alert(1)',
		'constructor',
		'1d20+999999',
		'x'.repeat(DICE_LIMITS.inputLength + 1)
	])('rejects %j with a readable error', (input) => {
		const r = parseDice(input);
		expect(r.ok).toBe(false);
		expect(!r.ok && r.error.length).toBeGreaterThan(0);
	});

	it('rejects non-strings', () => {
		expect(parseDice(20).ok).toBe(false);
		expect(parseDice({ toString: () => '1d20' }).ok).toBe(false);
	});

	it('rejects too many terms', () => {
		expect(
			parseDice(
				Array(DICE_LIMITS.terms + 1)
					.fill('1')
					.join('+')
			).ok
		).toBe(false);
	});
});

describe('rollDice', () => {
	it('adds dice and modifiers with signs', () => {
		const roll = rollDice(terms('2d6+1d4-3'), fixed(5, 2, 4));
		expect(roll.total).toBe(5 + 2 + 4 - 3);
		expect(roll.expression).toBe('2d6+1d4-3');
		expect(formatBreakdown(roll)).toBe('[5, 2] + [4] - 3');
	});

	it('subtracts negative dice terms', () => {
		expect(rollDice(terms('1d20-1d4'), fixed(10, 3)).total).toBe(7);
	});

	it('asks the roller for the right die size each time', () => {
		const asked: number[] = [];
		rollDice(terms('2d8+1d100'), (sides) => (asked.push(sides), 1));
		expect(asked).toEqual([8, 8, 100]);
	});

	it('stays within bounds with a real random source', () => {
		const random = (sides: number) => 1 + Math.floor(Math.random() * sides);
		for (let i = 0; i < 500; i++) {
			const { total } = rollDice(terms('3d6+2'), random);
			expect(total).toBeGreaterThanOrEqual(5);
			expect(total).toBeLessThanOrEqual(20);
		}
	});
});
