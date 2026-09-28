import { describe, expect, it } from 'vitest';
import { fnv1a, liftOf, liftSeed, pcgHash } from './lift';

/** Hash.js's PCG in exact integers, to check the 32-bit arithmetic against. */
function pcgReference(seed: number): number {
	const M = 2n ** 32n;
	const state = (BigInt(seed >>> 0) * 747796405n + 2891336453n) % M;
	const word = (((state >> ((state >> 28n) + 4n)) ^ state) * 277803737n) % M;
	return Number((word >> 22n) ^ word) / 2 ** 32;
}

describe('micro-offsets (#181)', () => {
	it('hash ids with FNV-1a and cells with the PCG hash three uses', () => {
		expect(fnv1a('')).toBe(0x811c9dc5);
		expect(fnv1a('a')).toBe(0xe40c292c);
		expect(fnv1a('foobar')).toBe(0xbf9cf968);
		for (const seed of [0, 1, 2, 12345, 0x7fffffff, 0xffffffff, liftSeed('water', { x: 3, y: 9 })])
			expect(pcgHash(seed)).toBe(pcgReference(seed));
	});

	it('are fixed for known inputs, so every client and load agrees', () => {
		expect(liftSeed('water', { x: 0, y: 0 })).toBe(fnv1a('water'));
		expect(liftOf('water', { x: 0, y: 0 })).toBe(pcgReference(fnv1a('water')));
		expect(liftOf('water', { x: 12, y: 30 })).toBe(0.41533604077994823);
		expect(liftOf('rug', { x: 4, y: 5 })).toBe(0.8097163757774979);
	});

	it('lie in [0, 1), differ between neighbouring cells and match for duplicates', () => {
		const seen = new Set<number>();
		for (let y = 0; y < 36; y++)
			for (let x = 0; x < 48; x++) {
				const lift = liftOf('water', { x, y });
				expect(lift).toBeGreaterThanOrEqual(0);
				expect(lift).toBeLessThan(1);
				expect(lift).toBe(liftOf('water', { x, y }));
				if (x > 0) expect(lift).not.toBe(liftOf('water', { x: x - 1, y }));
				if (y > 0) expect(lift).not.toBe(liftOf('water', { x, y: y - 1 }));
				seen.add(lift);
			}
		// Spread over the range, not bunched: the Hollow's lake stays apart from itself.
		expect(seen.size).toBeGreaterThan(48 * 36 * 0.99);
		expect(liftOf('water', { x: 3, y: 3 })).not.toBe(liftOf('rug', { x: 3, y: 3 }));
	});
});
