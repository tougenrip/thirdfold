import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { viewPose } from './camera';
import { pickKey } from './picking';
import type { Pick } from './types';

const DIR = path.dirname(new URL(import.meta.url).pathname);

describe('the tabletop modules', () => {
	it('each stay under 500 lines', () => {
		const long = readdirSync(DIR)
			.filter((f) => /\.(ts|svelte)$/.test(f) && !/\.spec\.ts$/.test(f))
			.map((f) => ({ f, lines: readFileSync(path.join(DIR, f), 'utf8').split('\n').length }))
			.filter(({ lines }) => lines > 500);
		expect(long).toEqual([]);
	});
});

describe('views', () => {
	it('frame the table from high above in tactical view and low and close in tabletop view', () => {
		for (const extent of [10, 26, 54]) {
			const tactical = viewPose('tactical', extent);
			const tabletop = viewPose('tabletop', extent);
			expect(tactical.target.toArray()).toEqual([0, 0, 0]);
			expect(tactical.position.y).toBeCloseTo(extent * 1.15);
			expect(tabletop.position.y).toBeLessThan(tactical.position.y);
			expect(tabletop.position.length()).toBeLessThan(tactical.position.length());
		}
	});
});

describe('hover keys', () => {
	const pick = (over: Partial<Pick> = {}): Pick => ({
		cell: { x: 1, y: 2 },
		corner: { x: 1, y: 2 },
		edge: null,
		edgeDistance: Infinity,
		tokenId: null,
		objectId: null,
		lightId: null,
		propId: null,
		...over
	});

	it('change when what is under the pointer changes, and only then', () => {
		expect(pickKey(pick())).toBe(pickKey(pick()));
		expect(pickKey(pick({ cell: { x: 2, y: 2 } }))).not.toBe(pickKey(pick()));
		expect(pickKey(pick({ tokenId: 'a' }))).not.toBe(pickKey(pick()));
		const edge = { a: { x: 1, y: 2 }, b: { x: 2, y: 2 } };
		// Moving along an edge changes nothing; coming close to it (under 0.2 cells) does.
		expect(pickKey(pick({ edge, edgeDistance: 0.4 }))).toBe(
			pickKey(pick({ edge, edgeDistance: 0.3 }))
		);
		expect(pickKey(pick({ edge, edgeDistance: 0.1 }))).not.toBe(
			pickKey(pick({ edge, edgeDistance: 0.3 }))
		);
	});
});
