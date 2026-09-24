import { describe, expect, it } from 'vitest';
import { lastPlayed } from './when';

describe('when a game was last played', () => {
	const now = new Date(2026, 8, 24, 20, 0);
	it('says today, yesterday, or the date', () => {
		expect(lastPlayed(new Date(2026, 8, 24, 9, 5).toISOString(), now, 'en-GB')).toBe('Today 09:05');
		expect(lastPlayed(new Date(2026, 8, 23, 21, 43).toISOString(), now, 'en-GB')).toBe(
			'Yesterday 21:43'
		);
		expect(lastPlayed(new Date(2026, 8, 12, 21, 43).toISOString(), now, 'en-GB')).toBe(
			'12 Sept 21:43'
		);
		expect(lastPlayed(new Date(2025, 0, 2, 8, 0).toISOString(), now, 'en-GB')).toBe(
			'2 Jan 2025 08:00'
		);
		expect(lastPlayed('not a date', now)).toBe('');
	});
});
