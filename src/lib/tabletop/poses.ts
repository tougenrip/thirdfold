// Named camera poses for fixture tables (tests/fixtures/scenes/*.poses.json),
// written in grid terms so they survive changes to the world's scale: a cell
// to look at, how far away in cells, and from which direction. Pure maths;
// the renderer's `setPose` takes the result.

import { gridToWorld, type GridPos, type SquareGrid } from '$lib/game/grid';
import type { Ground } from './ground';
import type { Pose } from './shots';

export interface GridPose {
	/** The cell the camera looks at (its floor, raised ground included). */
	target: GridPos;
	/** Distance from the target, in cells. */
	distance: number;
	/** Degrees round the target: 0 looks north from the south (+z), 90 looks west from the east. */
	azimuth: number;
	/** Degrees above the horizontal. */
	elevation: number;
}

export function poseFor(grid: SquareGrid, ground: Ground | null, pose: GridPose): Pose {
	const at = gridToWorld(grid, pose.target);
	const target = { x: at.x, y: ground?.floorY(pose.target) ?? 0, z: at.z };
	const d = pose.distance * grid.cellSize;
	const az = (pose.azimuth * Math.PI) / 180;
	const el = (pose.elevation * Math.PI) / 180;
	return {
		target,
		position: {
			x: target.x + d * Math.cos(el) * Math.sin(az),
			y: target.y + d * Math.sin(el),
			z: target.z + d * Math.cos(el) * Math.cos(az)
		}
	};
}
