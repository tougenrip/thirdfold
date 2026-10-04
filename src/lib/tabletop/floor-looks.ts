// How each floor looks, as plain data with no three.js: the terrain kind paints
// floors with it (materials/hooks.ts) and the Build panel shows it as swatches,
// so the panel never pulls three.js into the room page's imports.

import type { FloorId } from '$lib/game/floor';

/**
 * Each floor's colour (sRGB) and how much of the table it covers: the whole look of a floor whose
 * environment has no surface layer for it (#248: the tint fallback).
 */
export const FLOOR_LOOKS: Record<FloorId, { color: number; alpha: number }> = {
	plain: { color: 0x000000, alpha: 0 },
	stone: { color: 0x8a8578, alpha: 235 },
	wood: { color: 0x8b5e34, alpha: 235 },
	grass: { color: 0x5b7f3a, alpha: 230 },
	dirt: { color: 0x6e5238, alpha: 230 },
	sand: { color: 0xc8b07a, alpha: 230 },
	water: { color: 0x2f5f86, alpha: 220 },
	void: { color: 0x07080a, alpha: 255 },
	cobble: { color: 0x7a7468, alpha: 235 },
	flagstone: { color: 0x9a927f, alpha: 235 },
	rock: { color: 0x6f6a62, alpha: 235 },
	mud: { color: 0x4f3b28, alpha: 230 },
	snow: { color: 0xe4e8ec, alpha: 230 },
	gravel: { color: 0x8c8478, alpha: 230 }
};
