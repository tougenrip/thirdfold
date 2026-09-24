import { describe, expect, it } from 'vitest';
import type { SquareGrid } from './grid';
import {
	lightLevels,
	lightSources,
	litMask,
	seenByLight,
	withDarkness,
	type Light
} from './lights';
import { blockingEdges } from './objects';
import { cellIndex } from './visibility';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 12, height: 12 };
const light = (x: number, y: number, radius: number, on = true): Light => ({
	id: `l${x}${y}`,
	pos: { x, y },
	radius,
	color: '#ffa04d',
	on
});
const wallX6 = blockingEdges([{ id: 'w', kind: 'wall', a: { x: 6, y: 0 }, b: { x: 6, y: 12 } }]);
const at = (x: number, y: number) => cellIndex(grid, { x, y });

describe('lightSources', () => {
	it('includes switched-on lights and tokens carrying light, nothing else', () => {
		const sources = lightSources(
			[light(1, 1, 3), light(2, 2, 3, false)],
			[
				{ pos: { x: 5, y: 5 }, light: 2 },
				{ pos: { x: 7, y: 7 }, light: 0 }
			]
		);
		expect(sources.map((s) => [s.pos.x, s.pos.y, s.radius])).toEqual([
			[1, 1, 3],
			[5, 5, 2]
		]);
	});
});

describe('litMask / lightLevels', () => {
	it('lights a radius and stops at walls', () => {
		const mask = litMask(grid, wallX6, [light(4, 4, 4)]);
		expect(mask[at(4, 4)]).toBe(1);
		expect(mask[at(5, 4)]).toBe(1);
		expect(mask[at(6, 4)]).toBe(0);
		expect(mask[at(4, 9)]).toBe(0);
	});

	it('fades towards the edge and agrees with the lit mask', () => {
		const sources = [light(4, 4, 4), light(9, 9, 2)];
		const levels = lightLevels(grid, wallX6, sources);
		const mask = litMask(grid, wallX6, sources);
		expect(levels[at(4, 4)]).toBe(1);
		expect(levels[at(4, 7)]).toBeLessThan(levels[at(4, 5)]);
		for (let i = 0; i < mask.length; i++) expect(levels[i] > 0).toBe(mask[i] === 1);
	});
});

describe('dark areas', () => {
	const sources = lightSources([light(2, 2, 2)], []);

	it('marks and clears a dark area, and is null once nothing is dark', () => {
		const dark = withDarkness(null, grid, { x: 0, y: 0 }, { x: 5, y: 5 }, true);
		expect(dark?.[at(3, 3)]).toBe(1);
		expect(dark?.[at(8, 8)]).toBe(0);
		expect(withDarkness(dark, grid, { x: 5, y: 5 }, { x: 0, y: 0 }, false)).toBeNull();
	});

	it('lets anyone see only lit cells where it is dark, and everything elsewhere by day', () => {
		expect(seenByLight(grid, new Set(), 'day', null, sources)).toBeNull();
		const dark = withDarkness(null, grid, { x: 0, y: 0 }, { x: 5, y: 5 }, true);
		const seen = seenByLight(grid, new Set(), 'day', dark, sources)!;
		// Inside the dark area only the light's reach counts; outside it, everything is seen.
		expect(seen[at(2, 3)]).toBe(1);
		expect(seen[at(5, 5)]).toBe(0);
		expect(seen[at(9, 9)]).toBe(1);
		// After dark the whole table needs light, dark areas or not.
		const night = seenByLight(grid, new Set(), 'dark', null, sources)!;
		expect(night[at(9, 9)]).toBe(0);
		expect(night[at(2, 3)]).toBe(1);
	});
});
