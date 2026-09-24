// Rooms: the enclosed spaces of a table, found from its walls. A room is the
// cells reachable from one cell without crossing a wall, window or door (open
// or shut: a doorway is where a room ends), stepping straight between
// neighbours. A space that runs on past `MAX_ROOM_CELLS` is open ground, not
// a room. Used to reveal or hide a whole room at once, and to let a
// character who walks into a room learn its layout.

import { inBounds, type GridPos, type SquareGrid } from './grid';
import { edgeBetween, edgeKey, unitEdges, type SceneObject } from './objects';

/** The most cells a room may have; anything bigger is open ground. */
export const MAX_ROOM_CELLS = 150;

/** Every edge that bounds a room: each wall, window and door, open or shut. */
export function roomBoundary(objects: Iterable<SceneObject>): Set<string> {
	const edges = new Set<string>();
	for (const o of objects) for (const e of unitEdges(o.a, o.b)) edges.add(edgeKey(e));
	return edges;
}

/**
 * The cell indices (y * width + x) of the room around `cell`, in the order
 * found, or null when the space is bigger than `max` cells (open ground) or
 * the cell is off the table.
 */
export function roomAround(
	grid: SquareGrid,
	boundary: ReadonlySet<string>,
	cell: GridPos,
	max: number = MAX_ROOM_CELLS
): number[] | null {
	if (!inBounds(grid, cell)) return null;
	const index = (c: GridPos) => c.y * grid.width + c.x;
	const seen = new Set<number>([index(cell)]);
	const queue: GridPos[] = [cell];
	for (let head = 0; head < queue.length; head++) {
		const c = queue[head];
		for (const [dx, dy] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1]
		]) {
			const n = { x: c.x + dx, y: c.y + dy };
			if (!inBounds(grid, n) || seen.has(index(n))) continue;
			if (boundary.has(edgeKey(edgeBetween(c, n)))) continue;
			seen.add(index(n));
			if (seen.size > max) return null;
			queue.push(n);
		}
	}
	return [...seen];
}
