// How the world's shape treats each floor (#248), plain data with no three.js.

import { FLOOR_IDS } from '../../game/floor';

/**
 * The man-made floors by `FLOOR_IDS` index: their corners bevelled (ground-mesh.ts) and their
 * cliffs masonry (cliffs.ts). Rock is kerbed by the splat (FLOOR_STYLE) but natural.
 */
export const MAN_MADE: ReadonlySet<number> = new Set(
	(['stone', 'wood', 'cobble', 'flagstone', 'tile', 'grating'] as const).map((id) => FLOOR_IDS.indexOf(id))
);
