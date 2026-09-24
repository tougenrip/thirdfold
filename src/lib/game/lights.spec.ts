import { describe, expect, it } from 'vitest';
import type { SquareGrid } from './grid';
import { lightLevels, lightSources, litMask, type Light } from './lights';
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
