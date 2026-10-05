// The walls' pieces (#239): each unit of wall stands from the lower floor
// beside it to a wall above the higher; a window is a sill and, between equal
// floors only, a lintel, with the gap between them to see through. This is
// what `walls.ts` drew in `rebuildWalls` before it took its spans from here.
//
// With fog (`known` set) an unexplored side of an edge counts as level with the
// known side, so a wall never shows a drop toward ground the viewer hasn't
// explored. With `known` null the spans are exactly the old ones.

import type { GridEdge, SquareGrid } from '../../game/grid';
import { orderCorners, type SceneObject } from '../../game/objects';
import type { LevelMap } from '../../game/terrain';
import type { CellMask } from '../../game/visibility';
import { STEP_HEIGHT, WALL_HEIGHT } from '../ground';

/** A window's sill and lintel, as fractions of a wall above the floor. */
export const SILL = 0.35;
export const LINTEL = 0.8;

/** One piece of wall on one unit edge, in world heights. */
export interface WallSpan {
	/** The wall's object id. */
	owner: string;
	edge: GridEdge;
	bottom: number;
	top: number;
}

/** Every wall's pieces, each unit edge once (its first wall), in object then edge order. */
export function wallSpans(
	grid: SquareGrid,
	objects: readonly SceneObject[],
	levels: LevelMap | null,
	known: CellMask | null = null
): WallSpan[] {
	const { width: w, height: h, cellSize } = grid;
	const height = WALL_HEIGHT * cellSize;
	const seen = new Set<number>();
	const spans: WallSpan[] = [];
	const floorY = (cx: number, cy: number) =>
		(levels ? levels[cy * w + cx] : 0) * STEP_HEIGHT * cellSize;
	for (const o of objects) {
		if (o.kind !== 'wall') continue;
		const { a, b } = orderCorners(o.a, o.b);
		const vertical = a.x === b.x;
		const units = vertical ? b.y - a.y : b.x - a.x;
		for (let u = 0; u < units; u++) {
			const x = vertical ? a.x : a.x + u;
			const y = vertical ? a.y + u : a.y;
			const key = vertical ? (y * (w + 1) + x) * 2 + 1 : (y * w + x) * 2;
			if (seen.has(key)) continue;
			seen.add(key);
			// The cells beside the edge (west and east, or north and south), if on the table.
			const [px, py] = vertical ? [x - 1, y] : [x, y - 1];
			const p = px >= 0 && py >= 0 && px < w && py < h;
			const q = x < w && y < h;
			// With fog, only the known sides count, unless neither is known.
			const pk = p && (!known || known[py * w + px] === 1);
			const qk = q && (!known || known[y * w + x] === 1);
			const useP = pk || (p && !qk);
			const useQ = qk || (q && !pk);
			const ys = [...(useP ? [floorY(px, py)] : []), ...(useQ ? [floorY(x, y)] : [])];
			const low = ys.length ? Math.min(...ys) : 0;
			const high = ys.length ? Math.max(...ys) : 0;
			const edge = { a: { x, y }, b: vertical ? { x, y: y + 1 } : { x: x + 1, y } };
			if (!o.window) {
				spans.push({ owner: o.id, edge, bottom: low, top: high + height });
				continue;
			}
			spans.push({ owner: o.id, edge, bottom: low, top: high + height * SILL });
			if (high === low)
				spans.push({ owner: o.id, edge, bottom: high + height * LINTEL, top: high + height });
		}
	}
	return spans;
}
