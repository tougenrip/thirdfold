// The light model's pure parts (M68): where lights are drawn and, as later tasks add them, how
// they flicker, which cast shadows and how the sun's shadow is fitted. No three.js, so the server
// test project checks it; the rules' falloff itself lives in $lib/game/lights.ts. Keep it in
// sections, one per task.

import { gridToWorld, type GridPos, type SquareGrid, type WorldPos } from '../game/grid';
import { lightLook, type LightSource } from '../game/lights';
import { edgeKey } from '../game/objects';
import { STEP_HEIGHT, WALL_HEIGHT, type Ground } from './ground';

// ---------------------------------------------------------------------------------------------
// Mounting (#226): a light's visual position. Its rule origin (the cell centre) never moves:
// reach, occlusion and which cells it lights come from there.

/** How far a wall-mounted light stands off its wall, in cells. */
export const MOUNT_OFFSET = 0.15;
/** A wall-mounted light's height, as a share of WALL_HEIGHT. */
export const MOUNT_HEIGHT = 0.7;

/** The kinds that hang on a wall when their cell has one. */
const WALL_KINDS = new Set(['torch', 'lantern']);

/** A cell's four edges in the fixed order a mount tries them: north, east, south, west. */
const SIDES = [
	{ edge: (c: GridPos) => ({ a: c, b: { x: c.x + 1, y: c.y } }), dx: 0, dz: -1 },
	{
		edge: (c: GridPos) => ({ a: { x: c.x + 1, y: c.y }, b: { x: c.x + 1, y: c.y + 1 } }),
		dx: 1,
		dz: 0
	},
	{
		edge: (c: GridPos) => ({ a: { x: c.x, y: c.y + 1 }, b: { x: c.x + 1, y: c.y + 1 } }),
		dx: 0,
		dz: 1
	},
	{ edge: (c: GridPos) => ({ a: c, b: { x: c.x, y: c.y + 1 } }), dx: -1, dz: 0 }
] as const;

/**
 * Where a light is drawn, in world units. A torch or lantern (no kind counts as a torch) whose
 * cell has a walled edge (`walled`: edge keys, `edgeKey`) sits MOUNT_OFFSET off the first one in
 * SIDES' order, at MOUNT_HEIGHT of a wall, so its light rakes across the wall's normals; any other
 * light stands at its cell centre at its look's height (levels above the floor).
 */
export function lightMount(
	grid: SquareGrid,
	light: Pick<LightSource, 'pos' | 'kind' | 'height'>,
	walled: ReadonlySet<string>,
	ground: Ground | null
): WorldPos {
	const centre = gridToWorld(grid, light.pos);
	const floor = ground?.floorY(light.pos) ?? 0;
	const look = lightLook(light);
	if (WALL_KINDS.has(look.kind)) {
		const side = SIDES.find((s) => walled.has(edgeKey(s.edge(light.pos))));
		if (side) {
			const off = (0.5 - MOUNT_OFFSET) * grid.cellSize;
			return {
				x: centre.x + side.dx * off,
				y: floor + MOUNT_HEIGHT * WALL_HEIGHT * grid.cellSize,
				z: centre.z + side.dz * off
			};
		}
	}
	return { x: centre.x, y: floor + look.height * STEP_HEIGHT * grid.cellSize, z: centre.z };
}
