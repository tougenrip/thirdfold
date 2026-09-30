import { describe, expect, it } from 'vitest';
import type { SquareGrid } from '$lib/game/grid';
import {
	aboveGround,
	GROUND_CLEARANCE,
	MAX_POLAR_ANGLE,
	ringVertices,
	worldExtents
} from './world-ground';

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

	it('frames the Hollow with the haze tuned for it, and a longer table with more', () => {
		const hollow = worldExtents(grid(48, 36)).world;
		expect([hollow.fogNear, hollow.fogFar]).toEqual([40, 90]);
		const train = worldExtents(grid(68, 7)).world;
		expect(train.fogFar).toBeGreaterThan(90);
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

describe('the ground ring', () => {
	const inner = (positions: Float32Array, loops: number) => {
		const points: { x: number; z: number }[] = [];
		for (let v = 0; v < positions.length / 3; v += loops)
			points.push({ x: positions[v * 3], z: positions[v * 3 + 2] });
		return points;
	};

	it.each(GRIDS.map((g) => [label(g), g] as const))(
		'meets the play plane of %s with no gap or overlap and reaches the horizon',
		(_, g) => {
			const extent = worldExtents(g);
			const { width, depth } = extent.play;
			const { horizon } = extent.world;
			const ring = ringVertices(extent, 48);
			const { positions, uvs, indices } = ring;
			const count = positions.length / 3;
			expect(uvs.length).toBe(count * 2);
			for (let v = 0; v < count; v++) {
				expect(positions[v * 3 + 1]).toBe(0);
				expect(uvs[v * 2]).toBe(positions[v * 3]);
				expect(uvs[v * 2 + 1]).toBe(-positions[v * 3 + 2]);
			}
			expect(Math.max(...indices)).toBeLessThan(count);

			// Every triangle faces up; together they cover exactly the disc less the grid.
			let area = 0;
			for (let i = 0; i < indices.length; i += 3) {
				const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]].map((v) => ({
					x: positions[v * 3],
					z: positions[v * 3 + 2]
				}));
				// y of (b - a) × (c - a): positive faces +y.
				const up = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
				expect(up).toBeGreaterThan(0);
				area += up / 2;
			}
			// The rim is a polygon inscribed in the circle; the hole is the grid's rectangle.
			// Seven vertices out from the grid in each direction (six loops).
			const around = inner(positions, 7);
			expect(indices.length).toBe(around.length * 6 * 6);
			let rim = 0;
			for (let i = 0; i < around.length; i++) {
				const o = i * 7 + 6;
				const n = ((i + 1) % around.length) * 7 + 6;
				rim +=
					(positions[o * 3] * positions[n * 3 + 2] - positions[n * 3] * positions[o * 3 + 2]) / 2;
			}
			expect(Math.abs(area - (rim - width * depth))).toBeLessThan(1e-9 * rim);
			expect(rim).toBeGreaterThan(0.99 * Math.PI * horizon * horizon);

			// The inner loop runs round the rectangle's edge, through its four corners.
			for (const p of around)
				expect(
					Math.abs(Math.abs(p.x) - width / 2) < 1e-4 || Math.abs(Math.abs(p.z) - depth / 2) < 1e-4
				).toBe(true);
			for (const x of [-1, 1])
				for (const z of [-1, 1])
					expect(
						around.some(
							(p) =>
								Math.abs(p.x - (x * width) / 2) < 1e-4 && Math.abs(p.z - (z * depth) / 2) < 1e-4
						)
					).toBe(true);
		}
	);

	it('has fewer triangles with fewer segments', () => {
		const extent = worldExtents(grid(48, 36));
		expect(ringVertices(extent, 16).indices.length).toBeLessThan(
			ringVertices(extent, 64).indices.length
		);
	});
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
