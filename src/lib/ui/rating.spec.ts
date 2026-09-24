import { describe, expect, it } from 'vitest';
import { describePlays, describeRating } from './rating';

describe('library words', () => {
	it('describes ratings and plays', () => {
		expect(describeRating(null)).toBe('Not rated yet');
		expect(describeRating({ average: 4, count: 1 })).toBe('★ 4.0 · 1 rating');
		expect(describeRating({ average: 4.5, count: 12 })).toBe('★ 4.5 · 12 ratings');
		expect(describePlays(0)).toBe('Not played yet');
		expect(describePlays(1)).toBe('Played once');
		expect(describePlays(7)).toBe('Played 7 times');
	});
});
