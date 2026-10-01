import { describe, expect, it } from 'vitest';
import type { SquareGrid } from '../game/grid';
import { LEVEL_CELLS } from '../game/lights';
import { edgeKey } from '../game/objects';
import { groundFor, STEP_HEIGHT, WALL_HEIGHT } from './ground';
import { lightMount, MOUNT_HEIGHT, MOUNT_OFFSET } from './light-model';

const grid: SquareGrid = { kind: 'square', cellSize: 2, width: 4, height: 4 };
const pos = { x: 1, y: 1 };
// Cell (1, 1)'s centre in world units, cell size 2.
const cx = -1;
const cz = -1;
const north = edgeKey({ a: { x: 1, y: 1 }, b: { x: 2, y: 1 } });
const east = edgeKey({ a: { x: 2, y: 1 }, b: { x: 2, y: 2 } });
const south = edgeKey({ a: { x: 1, y: 2 }, b: { x: 2, y: 2 } });
const west = edgeKey({ a: { x: 1, y: 1 }, b: { x: 1, y: 2 } });
const off = (0.5 - MOUNT_OFFSET) * grid.cellSize;
const mounted = MOUNT_HEIGHT * WALL_HEIGHT * grid.cellSize;

describe('lightMount (#226)', () => {
	it('hangs a torch off the wall on each side, at mount height', () => {
		const torch = { pos };
		const at = (edge: string) => lightMount(grid, torch, new Set([edge]), null);
		expect(at(north)).toEqual({ x: cx, y: mounted, z: cz - off });
		expect(at(east)).toEqual({ x: cx + off, y: mounted, z: cz });
		expect(at(south)).toEqual({ x: cx, y: mounted, z: cz + off });
		expect(at(west)).toEqual({ x: cx - off, y: mounted, z: cz });
	});

	it('picks a corner deterministically: north, east, south, west', () => {
		const lantern = { pos, kind: 'lantern' as const };
		expect(lightMount(grid, lantern, new Set([west, east]), null).x).toBe(cx + off);
		expect(lightMount(grid, lantern, new Set([south, west, north]), null).z).toBe(cz - off);
	});

	it('stands at the cell centre at its look height without a wall, or for other kinds', () => {
		expect(lightMount(grid, { pos }, new Set(), null)).toEqual({
			x: cx,
			y: 4 * STEP_HEIGHT * grid.cellSize,
			z: cz
		});
		expect(lightMount(grid, { pos, kind: 'brazier' }, new Set([north]), null)).toEqual({
			x: cx,
			y: 2 * STEP_HEIGHT * grid.cellSize,
			z: cz
		});
		expect(lightMount(grid, { pos, kind: 'glow', height: 7 }, new Set(), null).y).toBe(
			7 * STEP_HEIGHT * grid.cellSize
		);
	});

	it('stands on a raised floor', () => {
		const levels = new Uint8Array(16);
		levels[1 * 4 + 1] = 3;
		const ground = groundFor(grid, levels);
		const floor = 3 * STEP_HEIGHT * grid.cellSize;
		expect(lightMount(grid, { pos }, new Set([north]), ground).y).toBeCloseTo(floor + mounted);
		expect(lightMount(grid, { pos }, new Set(), ground).y).toBeCloseTo(
			floor + 4 * STEP_HEIGHT * grid.cellSize
		);
	});

	it("measures levels the renderer's way", () => {
		expect(LEVEL_CELLS).toBe(STEP_HEIGHT);
	});
});
