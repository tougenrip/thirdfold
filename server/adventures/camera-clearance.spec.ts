// No cinematic shot or view change puts the camera inside a wall or under the
// ground (#152): every shot of every built-in adventure, on every table of that
// adventure its focus lies on, from both camera views, sampled along its whole
// move there and back, and the moves between the two views. Walls stand
// WALL_HEIGHT above the higher floor beside them, so this checks the picture
// the renderer draws at thirdfold's scale.

import { describe, expect, it } from 'vitest';
import type { Shot } from '../../src/lib/game/chat';
import {
	cornerToWorld,
	gridToWorld,
	inBounds,
	worldToGrid,
	type SquareGrid
} from '../../src/lib/game/grid';
import type { SceneObject } from '../../src/lib/game/objects';
import { decodeLevels } from '../../src/lib/game/terrain';
import { groundFor, WALL_HEIGHT, type Ground } from '../../src/lib/tabletop/ground';
import {
	SHOT_TOTAL,
	shotAt,
	shotPose,
	viewPose,
	type Pose,
	type Vec3
} from '../../src/lib/tabletop/shots';
import { ADVENTURES } from './index';

/** The table's margin around the grid (TableLayer's TABLE_MARGIN, which imports three). */
const TABLE_MARGIN = 3;
/** Half a wall's thickness (walls.ts) plus the camera's near plane: closer is inside it. */
const WALL_CLEARANCE = 0.07 + 0.1;
/** The camera's near plane: closer to the floor than this is under it. */
const FLOOR_CLEARANCE = 0.1;

/** Every shot an adventure's content calls for, found wherever it sits in its effects. */
function shotsIn(value: unknown, found = new Map<string, Shot>(), seen = new Set<object>()) {
	if (typeof value !== 'object' || value === null || seen.has(value)) return found;
	seen.add(value);
	const v = value as Record<string, unknown>;
	if ('frame' in v && 'focus' in v && typeof v.frame === 'string')
		found.set(JSON.stringify(v), { focus: v.focus, frame: v.frame } as Shot);
	for (const child of Object.values(v)) shotsIn(child, found, seen);
	return found;
}

/** What is wrong with the camera at `p` on this table, or null if it stands clear. */
function blocked(p: Vec3, grid: SquareGrid, ground: Ground, walls: SceneObject[]): string | null {
	const cell = worldToGrid(grid, p);
	const floor = cell && inBounds(grid, cell) ? ground.floorY(cell) : 0;
	if (p.y < floor + FLOOR_CLEARANCE) return `under the ground at ${JSON.stringify(cell)}`;
	for (const w of walls) {
		const a = cornerToWorld(grid, w.a);
		const b = cornerToWorld(grid, w.b);
		const [dx, dz] = [b.x - a.x, b.z - a.z];
		const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
		const d = Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
		const { low, high } = ground.edgeFloors(w);
		if (d < WALL_CLEARANCE && p.y > low && p.y < high + WALL_HEIGHT * grid.cellSize)
			return `inside ${w.id}`;
	}
	return null;
}

const lerp = (a: Pose, b: Pose, k: number): Vec3 => ({
	x: a.position.x + (b.position.x - a.position.x) * k,
	y: a.position.y + (b.position.y - a.position.y) * k,
	z: a.position.z + (b.position.z - a.position.z) * k
});

describe('the camera', () => {
	for (const adventure of ADVENTURES) {
		const shots = [...shotsIn(adventure).values()];

		it(`stays clear of walls and ground in ${adventure.title}'s shots and view changes`, () => {
			expect(shots.length).toBeGreaterThan(0);
			const problems: string[] = [];
			for (const [id, location] of Object.entries(adventure.locations)) {
				const scene = location.scene();
				const grid = scene.grid;
				const size = grid.width * grid.height;
				const ground = groundFor(grid, scene.terrain ? decodeLevels(scene.terrain, size) : null);
				const walls = scene.objects.filter((o) => o.kind === 'wall' || !o.open);
				const extent = Math.max(grid.width, grid.height) * grid.cellSize + TABLE_MARGIN * 2;
				const check = (what: string, p: Vec3) => {
					const why = blocked(p, grid, ground, walls);
					if (why) problems.push(`${id}: ${what}: ${why}`);
				};
				const tactical = viewPose('tactical', extent);
				const tabletop = viewPose('tabletop', extent);
				for (let k = 0; k <= 1; k += 0.02) {
					check('tactical to tabletop', lerp(tactical, tabletop, k));
					check('tabletop to tactical', lerp(tabletop, tactical, k));
				}
				for (const shot of shots) {
					if (shot.focus && !inBounds(grid, shot.focus)) continue;
					const focus = shot.focus && {
						...gridToWorld(grid, shot.focus),
						y: ground.floorY(shot.focus)
					};
					for (const [view, home] of [
						['tactical', tactical],
						['tabletop', tabletop]
					] as const) {
						const to = shotPose(home, focus, shot.frame, extent, grid.cellSize);
						for (let ms = 0; ms <= SHOT_TOTAL; ms += 50)
							check(`${JSON.stringify(shot)} from ${view}`, shotAt(home, to, ms).pose.position);
					}
				}
			}
			expect(problems.slice(0, 10)).toEqual([]);
		});
	}

	it('is caught inside a wall or under the floor (the check is not vacuous)', () => {
		const monastery = ADVENTURES[0].locations.monastery.scene();
		const grid = monastery.grid;
		const ground = groundFor(
			grid,
			monastery.terrain ? decodeLevels(monastery.terrain, grid.width * grid.height) : null
		);
		const wall = monastery.objects.find((o) => o.kind === 'wall')!;
		const [a, b] = [cornerToWorld(grid, wall.a), cornerToWorld(grid, wall.b)];
		const floor = ground.edgeFloors(wall).high;
		const inside = { x: (a.x + b.x) / 2, y: floor + 1, z: (a.z + b.z) / 2 };
		expect(blocked(inside, grid, ground, [wall])).toBe(`inside ${wall.id}`);
		expect(blocked({ ...inside, y: floor + WALL_HEIGHT + 0.5 }, grid, ground, [wall])).toBeNull();
		expect(blocked({ x: 0, y: -1, z: 0 }, grid, ground, [])).toMatch(/under the ground/);
	});
});
