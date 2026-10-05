// The invariant harness for floor tiles (#254), beside wall-invariants.ts:
// every piece's plan rectangle lies on known, tiled cells of its own floor at
// one level, and its top lies between the floor and TILE_TOP_DEPTH below it
// (so no tile rises above `floorY` over a base disk, and none sinks out of
// sight). Test support, pure.

import { STEP_HEIGHT } from '../ground';
import { TILE_TOP_DEPTH, type TileKit, type TilePiece } from './floor-tiles';
import type { WorldShape } from './shape';

export interface TileViolation {
	rule: 'tile-cell' | 'tile-unexplored' | 'tile-top';
	piece: number;
	cell?: number;
}

/**
 * Where tiles break the rules. `top` is a variant's highest point over its pivot (at most 0 by the
 * kit's floor envelope): a piece's top is its `y` plus that.
 */
export function checkTiles(
	shape: WorldShape,
	kit: TileKit,
	tiled: Uint8Array,
	pieces: readonly TilePiece[],
	top = 0
): TileViolation[] {
	const { width: w, height: h, cellSize: cs } = shape.grid;
	const out: TileViolation[] = [];
	const eps = 1e-6;
	pieces.forEach((p, n) => {
		const spec = kit.get(p.floor)!;
		const [ax, az] = [(p.sx * spec.pitch.x) / 2, (p.sz * spec.pitch.z) / 2];
		const [hx, hz] = p.turn % 2 ? [az, ax] : [ax, az];
		const gx = p.x / cs + w / 2;
		const gy = p.z / cs + h / 2;
		const [x0, x1] = [Math.floor(gx - hx / cs + eps), Math.floor(gx + hx / cs - eps)];
		const [y0, y1] = [Math.floor(gy - hz / cs + eps), Math.floor(gy + hz / cs - eps)];
		for (let y = y0; y <= y1; y++)
			for (let x = x0; x <= x1; x++) {
				const k = y * w + x;
				const off = x < 0 || y < 0 || x >= w || y >= h;
				if (!off && shape.known && !shape.known[k])
					out.push({ rule: 'tile-unexplored', piece: n, cell: k });
				else if (off || !tiled[k] || shape.floor[k] !== p.floor)
					out.push({ rule: 'tile-cell', piece: n, cell: off ? -1 : k });
				else {
					const floorY = shape.levels[k] * STEP_HEIGHT * cs;
					const t = p.y + top;
					if (t > floorY + eps || t < floorY - TILE_TOP_DEPTH * cs - eps)
						out.push({ rule: 'tile-top', piece: n, cell: k });
				}
			}
	});
	return out;
}
