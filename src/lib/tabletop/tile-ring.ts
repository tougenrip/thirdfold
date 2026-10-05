// The ring of kit floor tiles round the camera (#254), plain maths with no three.js: how far tiles
// reach on each tier, the band they fade over, the bed the ground sinks to under them, and the
// fade both sides use (materials/ring.ts mirrors `ringFade` in the graphs). Tiles never pop: across
// the band each one sinks under the ground as the ground rises back to its floor, so at the ring's
// edge nothing is left above the ground, and a chunk hidden past it was already out of sight.

import type { SquareGrid } from '../game/grid';
import type { Tier } from './quality';

/** How far from the camera's target tiles are drawn, in cells: none on low, the whole table on ultra. */
export const TILE_RING: Record<Tier, number> = { low: 0, medium: 12, high: 20, ultra: Infinity };
/** The tier's ring on a table, in cells: the whole table where it is endless. */
export function ringCells(tier: Tier, grid: Pick<SquareGrid, 'width' | 'height'>): number {
	const ring = TILE_RING[tier];
	return Number.isFinite(ring) ? ring : Math.hypot(grid.width, grid.height);
}

/** The band the ring fades over, in cells, inside its radius. */
export const RING_BAND = 3;
/** How far the ground sinks under tiles (the gaps between them), in cells. */
export const BED_DEPTH = 0.04;
/** How far a tile sinks at the ring's edge, in cells: deeper than the bed, so it ends under the floor. */
export const TILE_SINK = 0.12;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 1 inside the ring, 0 past it, smooth across the band; 0 everywhere at radius 0. */
export function ringFade(distance: number, radius: number, band = RING_BAND): number {
	if (radius <= 0) return 0;
	const t = clamp01((distance - (radius - band)) / band);
	return 1 - t * t * (3 - 2 * t);
}

/** Whether any of a rectangle (world x and z) lies within `radius` of (cx, cz). */
export function rectInRing(
	rect: { x0: number; z0: number; x1: number; z1: number },
	cx: number,
	cz: number,
	radius: number
): boolean {
	if (radius <= 0) return false;
	const dx = Math.max(rect.x0 - cx, 0, cx - rect.x1);
	const dz = Math.max(rect.z0 - cz, 0, cz - rect.z1);
	return Math.hypot(dx, dz) < radius;
}
