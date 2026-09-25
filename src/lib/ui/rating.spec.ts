import { describe, expect, it } from 'vitest';
import { describeFacts, describePlays, describeRating } from './rating';

describe('library words', () => {
	it('describes ratings and plays', () => {
		expect(describeRating(null)).toBe('Not rated yet');
		expect(describeRating({ average: 4, count: 1 })).toBe('★ 4.0 · 1 rating');
		expect(describeRating({ average: 4.5, count: 12 })).toBe('★ 4.5 · 12 ratings');
		expect(describePlays(0)).toBe('Not played yet');
		expect(describePlays(1)).toBe('Played once');
		expect(describePlays(7)).toBe('Played 7 times');
	});

	it('describes what a story holds', () => {
		expect(describeFacts({ chapters: 5, places: 3, characters: 4, endings: 3 })).toBe(
			'5 chapters · 3 places · up to 4 players · 3 endings'
		);
		expect(describeFacts({ chapters: 1, places: 1, characters: 1, endings: 1 })).toBe(
			'1 chapter · 1 place · up to 1 player · 1 ending'
		);
	});
});
