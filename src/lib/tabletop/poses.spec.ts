import { describe, expect, it } from 'vitest';
import type { SquareGrid } from '$lib/game/grid';
import { groundFor, STEP_HEIGHT } from './ground';
import { poseFor } from './poses';

const grid: SquareGrid = { kind: 'square', cellSize: 2, width: 4, height: 4 };

describe('a named pose', () => {
	it('looks at its cell from the given distance, direction and height', () => {
		const pose = poseFor(grid, null, {
			target: { x: 1, y: 1 },
			distance: 5,
			azimuth: 0,
			elevation: 30
		});
		expect(pose.target).toEqual({ x: -1, y: 0, z: -1 });
		const dx = pose.position.x - pose.target.x;
		const dy = pose.position.y - pose.target.y;
		const dz = pose.position.z - pose.target.z;
		expect(Math.hypot(dx, dy, dz)).toBeCloseTo(10);
		expect(Math.atan2(dy, Math.hypot(dx, dz))).toBeCloseTo(Math.PI / 6);
		// Azimuth 0 is from the south, looking north.
		expect(dx).toBeCloseTo(0);
		expect(dz).toBeGreaterThan(0);
		const east = poseFor(grid, null, {
			target: { x: 1, y: 1 },
			distance: 5,
			azimuth: 90,
			elevation: 30
		});
		expect(east.position.x).toBeGreaterThan(east.target.x);
	});

	it('looks at the floor of a raised cell', () => {
		const levels = new Uint8Array(16);
		levels[1 * 4 + 1] = 3;
		const pose = poseFor(grid, groundFor(grid, levels), {
			target: { x: 1, y: 1 },
			distance: 5,
			azimuth: 0,
			elevation: 30
		});
		expect(pose.target.y).toBeCloseTo(3 * STEP_HEIGHT * 2);
	});
});
