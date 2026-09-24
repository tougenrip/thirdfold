import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit';

describe('RateLimiter', () => {
	it('allows a burst, then refills over time', () => {
		const limiter = new RateLimiter(3, 1);
		expect([0, 0, 0, 0].map(() => limiter.take('a', 0))).toEqual([true, true, true, false]);
		expect(limiter.take('a', 500)).toBe(false);
		expect(limiter.take('a', 1000)).toBe(true);
	});

	it('tracks keys independently', () => {
		const limiter = new RateLimiter(1, 1);
		expect(limiter.take('a', 0)).toBe(true);
		expect(limiter.take('b', 0)).toBe(true);
		expect(limiter.take('a', 0)).toBe(false);
	});
});
