import { describe, expect, it } from 'vitest';
import type { SquareGrid } from './grid';
import { canStep, isReachable } from './objects';
import {
	footprintCells,
	footprintInBounds,
	footprintSize,
	isAssetId,
	obstaclesFor,
	propAt,
	type Prop
} from './props';
import { addVision, cellIndex, emptyMask, hasLineOfSight } from './visibility';
import { litMask } from './lights';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 10, height: 10 };
const prop = (
	assetId: Prop['assetId'],
	x: number,
	y: number,
	rotation: Prop['rotation'] = 0
): Prop => ({
	id: `${assetId}${x}${y}`,
	assetId,
	pos: { x, y },
	rotation,
	scale: 1
});
const c = (x: number, y: number) => ({ x, y });

describe('catalog and footprints', () => {
	it('knows its assets and nothing else', () => {
		expect(isAssetId('table')).toBe(true);
		expect(isAssetId('dragon')).toBe(false);
		expect(isAssetId('constructor')).toBe(false);
		expect(isAssetId('toString')).toBe(false);
	});

	it('rotates footprints by quarter turns', () => {
		expect(footprintSize('table', 0)).toEqual({ w: 2, h: 1 });
		expect(footprintSize('table', 1)).toEqual({ w: 1, h: 2 });
		expect(footprintCells(prop('table', 3, 4, 1))).toEqual([c(3, 4), c(3, 5)]);
		expect(footprintInBounds(grid, prop('table', 9, 0))).toBe(false);
		expect(footprintInBounds(grid, prop('table', 9, 0, 1))).toBe(true);
	});

	it('prefers the blocking prop on a shared cell', () => {
		const rug = prop('rug', 2, 2);
		const crate = prop('crate', 3, 3);
		expect(propAt([rug, crate], c(3, 3))).toBe(crate);
		expect(propAt([rug, crate], c(2, 2))).toBe(rug);
		expect(propAt([rug, crate], c(7, 7))).toBeUndefined();
	});
});

describe('props as obstacles', () => {
	it('blocks movement into solid props but not rugs or chairs', () => {
		const obs = obstaclesFor(
			grid,
			[],
			[prop('crate', 5, 5), prop('rug', 1, 1), prop('chair', 3, 3)]
		);
		expect(canStep(obs, c(4, 5), c(5, 5))).toBe(false);
		expect(canStep(obs, c(0, 1), c(1, 1))).toBe(true);
		expect(canStep(obs, c(2, 3), c(3, 3))).toBe(true);
	});

	it('routes around a table, and not through a sealed row of them', () => {
		const obs = obstaclesFor(grid, [], [prop('table', 4, 5)]);
		expect(isReachable(grid, obs, c(4, 4), c(4, 6))).toBe(true);
		const row = [0, 2, 4, 6, 8].map((x) => prop('table', x, 5));
		expect(isReachable(grid, obstaclesFor(grid, [], row), c(4, 4), c(4, 6))).toBe(false);
	});

	it('does not let a diagonal squeeze between two solid cells', () => {
		const obs = obstaclesFor(grid, [], [prop('crate', 5, 4), prop('crate', 4, 5)]);
		expect(canStep(obs, c(4, 4), c(5, 5))).toBe(false);
	});

	it('lets sight reach an opaque prop but not past it', () => {
		const obs = obstaclesFor(grid, [], [prop('pillar', 5, 5)]);
		expect(hasLineOfSight(obs, c(2, 5), c(5, 5))).toBe(true);
		expect(hasLineOfSight(obs, c(2, 5), c(8, 5))).toBe(false);
		// A crate blocks feet, not eyes.
		const crate = obstaclesFor(grid, [], [prop('crate', 5, 5)]);
		expect(hasLineOfSight(crate, c(2, 5), c(8, 5))).toBe(true);
	});

	it('casts a vision and light shadow behind a pillar', () => {
		const obs = obstaclesFor(grid, [], [prop('pillar', 5, 5)]);
		const sight = emptyMask(grid);
		addVision(grid, obs, c(3, 5), 6, sight);
		expect(sight[cellIndex(grid, c(5, 5))]).toBe(1);
		expect(sight[cellIndex(grid, c(7, 5))]).toBe(0);
		const lit = litMask(grid, obs, [{ pos: c(3, 5), radius: 6, color: '#ffa04d' }]);
		expect(lit[cellIndex(grid, c(7, 5))]).toBe(0);
	});

	it('still treats a bare edge set as walls only', () => {
		expect(canStep(new Set(['v:5:5']), c(4, 5), c(5, 5))).toBe(false);
		expect(canStep(new Set<string>(), c(4, 5), c(5, 5))).toBe(true);
	});
});
