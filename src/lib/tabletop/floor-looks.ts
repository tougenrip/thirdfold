// How each floor looks, as plain data with no three.js: the renderer paints
// floors with it and the Build panel shows it as swatches. Kept apart from
// floor.ts so the panel never pulls three.js into the room page's imports.

import type { FloorId } from '$lib/game/floor';

/** Each floor's colour (sRGB) and how much of the table it covers. */
export const FLOOR_LOOKS: Record<FloorId, { color: number; alpha: number }> = {
	plain: { color: 0x000000, alpha: 0 },
	stone: { color: 0x8a8578, alpha: 235 },
	wood: { color: 0x8b5e34, alpha: 235 },
	grass: { color: 0x5b7f3a, alpha: 230 },
	dirt: { color: 0x6e5238, alpha: 230 },
	sand: { color: 0xc8b07a, alpha: 230 },
	water: { color: 0x2f5f86, alpha: 220 },
	void: { color: 0x07080a, alpha: 255 }
};
