import { describe, expect, it } from 'vitest';
import type { SquareGrid } from '$lib/game/grid';
import { fogRange } from './atmosphere-curve';
import { aboveGround, GROUND_CLEARANCE, MAX_POLAR_ANGLE, worldExtents } from './world-ground';

const grid = (width: number, height: number, cellSize = 1): SquareGrid => ({
	kind: 'square',
	cellSize,
	width,
	height
});

// 4×4 to 64×64, the Hollow (48×36) and the train (68×7), at two cell sizes.
const GRIDS = [
	...[4, 8, 16, 32, 64].map((n) => grid(n, n)),
	grid(48, 36),
	grid(68, 7),
	grid(10, 6, 2)
];
const label = (g: SquareGrid) => `${g.width}×${g.height} at ${g.cellSize}`;

describe('the play extent', () => {
	it.each(GRIDS.map((g) => [label(g), g] as const))('contains the play area of %s', (_, g) => {
		const { play } = worldExtents(g, { top: 7 });
		expect(play.width).toBe(g.width * g.cellSize);
		expect(play.depth).toBe(g.height * g.cellSize);
		expect(play.frame).toBeGreaterThan(play.across);
		// Every corner of the grid's box, floor to top, is in the bounding sphere.
		for (const x of [-1, 1])
			for (const z of [-1, 1])
				for (const y of [0, 7]) {
					const d = Math.hypot(
						(x * play.width) / 2 - play.center.x,
						y - play.center.y,
						(z * play.depth) / 2 - play.center.z
					);
					expect(d).toBeLessThanOrEqual(play.radius + 1e-9);
				}
	});

	it('takes the haze from the retuned fog range (#221), more for a longer table', () => {
		for (const g of GRIDS) {
			const { play, world } = worldExtents(g);
			expect({ near: world.fogNear, far: world.fogFar }).toEqual(fogRange(play.frame));
		}
		const hollow = worldExtents(grid(48, 36)).world;
		expect(worldExtents(grid(68, 7)).world.fogFar).toBeGreaterThan(hollow.fogFar);
		expect(worldExtents(grid(4, 4)).world.fogFar).toBe(90);
	});
});

describe('the world extent', () => {
	it.each(GRIDS.map((g) => [label(g), g] as const))(
		'puts the horizon in full haze from anywhere the camera can be over %s',
		(_, g) => {
			const { play, world } = worldExtents(g);
			expect(world.fogNear).toBeLessThan(world.fogFar);
			// The nearest horizon point, in depth, even at the edge of a 90° view.
			expect((world.horizon - play.reach) * Math.cos(Math.PI / 4)).toBeGreaterThanOrEqual(
				world.fogFar
			);
			// The farthest horizon point, from the farthest the camera can stand, is within the far plane.
			expect(Math.hypot(world.horizon + play.reach, play.maxDistance)).toBeLessThanOrEqual(
				world.far
			);
			expect(play.maxDistance).toBeLessThan(world.far);
		}
	);
});

describe('the camera', () => {
	it('tilts to about 85 degrees and never goes below the ground', () => {
		expect(MAX_POLAR_ANGLE).toBeCloseTo((85 * Math.PI) / 180);
		// At the closest distance (3) and the full tilt, over a target on the ground, the
		// orbit alone would leave the camera a hand's breadth up; the clamp lifts it.
		const low = { x: 0, y: 3 * Math.cos(MAX_POLAR_ANGLE), z: 3 };
		expect(aboveGround(low, 0)).toBe(GROUND_CLEARANCE);
		// Over raised ground (a level-10 belfry at 4 units), and never lowered when high.
		expect(aboveGround(low, 4)).toBe(4 + GROUND_CLEARANCE);
		expect(aboveGround({ x: 0, y: 20, z: 0 }, 4)).toBe(20);
		for (const y of [-5, 0, 0.1, 0.5, 3])
			expect(aboveGround({ x: 0, y, z: 0 }, 0)).toBeGreaterThanOrEqual(GROUND_CLEARANCE);
	});
});
