// Dice expressions such as `1d20+5`, `2d6 - 1`, `d%`, `4d6+1d4+2`.
// Parsed by a small hand-written tokenizer: input is never evaluated as code.
// Rolling takes the random source as a parameter so the server can supply a
// secure one and tests a deterministic one.

export type Sign = 1 | -1;

export type DiceTerm =
	| { kind: 'dice'; sign: Sign; count: number; sides: number }
	| { kind: 'flat'; sign: Sign; value: number };

export type RolledTerm =
	| { kind: 'dice'; sign: Sign; count: number; sides: number; rolls: number[] }
	| { kind: 'flat'; sign: Sign; value: number };

export interface DiceRoll {
	/** Canonical form of what was rolled, e.g. `2d6+3`. */
	expression: string;
	terms: RolledTerm[];
	total: number;
}

export type ParseResult =
	{ ok: true; expression: string; terms: DiceTerm[] } | { ok: false; error: string };

/** Returns an integer in [1, sides]. */
export type DieRoller = (sides: number) => number;

export const STANDARD_DICE = [4, 6, 8, 10, 12, 20, 100] as const;

export const DICE_LIMITS = {
	inputLength: 100,
	terms: 20,
	/** Total dice across all terms. */
	dice: 100,
	sides: 1000,
	flat: 10_000
} as const;

// One term with an optional leading sign: `NdS`, `dS`, `Nd%` or a plain number.
// Whitespace is allowed between parts but never inside a number, so `1d20 5`
// is an error rather than `1d205`. Anchored with bounded quantifiers only.
const TERM = /^\s*([+-]?)\s*(?:(\d{0,3})\s*d\s*(\d{1,4}|%)|(\d{1,5}))\s*/;

/** Validates and normalises a dice expression without rolling it. */
export function parseDice(input: unknown): ParseResult {
	if (typeof input !== 'string') return { ok: false, error: 'Dice expression must be text.' };
	if (input.length > DICE_LIMITS.inputLength)
		return { ok: false, error: 'Dice expression is too long.' };
	let rest = input.toLowerCase();
	if (!rest.trim()) return { ok: false, error: 'Enter a dice expression, e.g. 1d20+5.' };

	const terms: DiceTerm[] = [];
	let dice = 0;
	while (rest) {
		const m = TERM.exec(rest);
		// After the first term, every term must carry an explicit + or -.
		if (!m || (terms.length > 0 && !m[1])) {
			return { ok: false, error: `Could not read "${input.trim()}". Try something like 2d6+3.` };
		}
		rest = rest.slice(m[0].length);
		const sign: Sign = m[1] === '-' ? -1 : 1;
		if (m[4] !== undefined) {
			const value = Number(m[4]);
			if (value > DICE_LIMITS.flat)
				return { ok: false, error: `Modifiers are limited to ${DICE_LIMITS.flat}.` };
			terms.push({ kind: 'flat', sign, value });
		} else {
			const count = m[2] === '' ? 1 : Number(m[2]);
			const sides = m[3] === '%' ? 100 : Number(m[3]);
			if (count < 1) return { ok: false, error: 'Roll at least one die.' };
			if (sides < 2 || sides > DICE_LIMITS.sides) {
				return { ok: false, error: `Dice need between 2 and ${DICE_LIMITS.sides} sides.` };
			}
			dice += count;
			if (dice > DICE_LIMITS.dice)
				return { ok: false, error: `At most ${DICE_LIMITS.dice} dice per roll.` };
			terms.push({ kind: 'dice', sign, count, sides });
		}
		if (terms.length > DICE_LIMITS.terms)
			return { ok: false, error: 'Too many terms in one roll.' };
	}
	return { ok: true, terms, expression: formatExpression(terms) };
}

export function formatExpression(terms: readonly DiceTerm[]): string {
	return terms
		.map((t, i) => {
			const sign = t.sign === -1 ? '-' : i === 0 ? '' : '+';
			return sign + (t.kind === 'dice' ? `${t.count}d${t.sides}` : `${t.value}`);
		})
		.join('');
}

export function rollDice(terms: readonly DiceTerm[], roll: DieRoller): DiceRoll {
	let total = 0;
	const rolled: RolledTerm[] = terms.map((t) => {
		if (t.kind === 'flat') {
			total += t.sign * t.value;
			return { ...t };
		}
		const rolls = Array.from({ length: t.count }, () => roll(t.sides));
		total += t.sign * rolls.reduce((a, b) => a + b, 0);
		return { ...t, rolls };
	});
	return { expression: formatExpression(terms), terms: rolled, total };
}

/** Breakdown for display, e.g. `[3, 5] + 3`. */
export function formatBreakdown(roll: DiceRoll): string {
	return roll.terms
		.map((t, i) => {
			const sign = t.sign === -1 ? '- ' : i === 0 ? '' : '+ ';
			return sign + (t.kind === 'dice' ? `[${t.rolls.join(', ')}]` : `${t.value}`);
		})
		.join(' ');
}
