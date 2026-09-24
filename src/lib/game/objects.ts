// Scene objects that live on grid lines: walls and doors. They block
// movement between cells (and will block sight once visibility exists).
// Everything here is plain grid math, shared by the server's rules and the
// client's previews.

import { cornerInBounds, inBounds, type GridEdge, type GridPos, type SquareGrid } from './grid';

/** An axis-aligned wall along a grid line, from corner `a` to corner `b` (a before b). */
export interface Wall {
	id: string;
	kind: 'wall';
	a: GridPos;
	b: GridPos;
}

/** A door spanning exactly one unit edge. Closed doors block like walls. */
export interface Door {
	id: string;
	kind: 'door';
	a: GridPos;
	b: GridPos;
	open: boolean;
}

export type SceneObject = Wall | Door;

/** Upper bound on scene objects per room, so one client cannot grow room state without limit. */
export const MAX_OBJECTS_PER_ROOM = 2000;

/** Orders two corners so `a` has the smaller coordinate along the segment's axis. */
export function orderCorners(a: GridPos, b: GridPos): { a: GridPos; b: GridPos } {
	return a.x < b.x || (a.x === b.x && a.y <= b.y) ? { a, b } : { a: b, b: a };
}

/** Why a segment is unusable, or null if it is a valid axis-aligned run of grid line. */
export function segmentProblem(grid: SquareGrid, a: GridPos, b: GridPos): string | null {
	if (!cornerInBounds(grid, a) || !cornerInBounds(grid, b)) return 'That runs off the table.';
	if (a.x === b.x && a.y === b.y) return 'A wall needs two different corners.';
	if (a.x !== b.x && a.y !== b.y) return 'Walls run along grid lines, not diagonally.';
	return null;
}

export function isUnitEdge(a: GridPos, b: GridPos): boolean {
	return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

/** Stable key for a unit edge, independent of corner order. */
export function edgeKey(e: GridEdge): string {
	const { a, b } = orderCorners(e.a, e.b);
	return a.x === b.x ? `v:${a.x}:${a.y}` : `h:${a.x}:${a.y}`;
}

/** The unit edges an axis-aligned segment covers, in order from `a` to `b`. */
export function unitEdges(a: GridPos, b: GridPos): GridEdge[] {
	const o = orderCorners(a, b);
	const edges: GridEdge[] = [];
	if (o.a.x === o.b.x) {
		for (let y = o.a.y; y < o.b.y; y++)
			edges.push({ a: { x: o.a.x, y }, b: { x: o.a.x, y: y + 1 } });
	} else {
		for (let x = o.a.x; x < o.b.x; x++)
			edges.push({ a: { x, y: o.a.y }, b: { x: x + 1, y: o.a.y } });
	}
	return edges;
}

/** Keys of every unit edge that currently blocks movement: walls and closed doors. */
export function blockingEdges(objects: Iterable<SceneObject>): Set<string> {
	const blocked = new Set<string>();
	for (const o of objects) {
		if (o.kind === 'door' && o.open) continue;
		for (const e of unitEdges(o.a, o.b)) blocked.add(edgeKey(e));
	}
	return blocked;
}

/** The edge shared by two orthogonally adjacent cells. */
export function edgeBetween(c1: GridPos, c2: GridPos): GridEdge {
	if (c1.x === c2.x) {
		const y = Math.max(c1.y, c2.y);
		return { a: { x: c1.x, y }, b: { x: c1.x + 1, y } };
	}
	const x = Math.max(c1.x, c2.x);
	return { a: { x, y: c1.y }, b: { x, y: c1.y + 1 } };
}

/** The (up to two) on-grid cells on either side of a unit edge. */
export function cellsBeside(grid: SquareGrid, e: GridEdge): GridPos[] {
	const { a, b } = orderCorners(e.a, e.b);
	const cells =
		a.x === b.x
			? [
					{ x: a.x - 1, y: a.y },
					{ x: a.x, y: a.y }
				]
			: [
					{ x: a.x, y: a.y - 1 },
					{ x: a.x, y: a.y }
				];
	return cells.filter((c) => inBounds(grid, c));
}

/**
 * Whether a token can step from `from` to an adjacent cell (including
 * diagonals). A diagonal step needs at least one open L-shaped route around
 * the corner, so a wall corner can't be squeezed through.
 */
export function canStep(blocked: ReadonlySet<string>, from: GridPos, to: GridPos): boolean {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const open = (p: GridPos, q: GridPos) => !blocked.has(edgeKey(edgeBetween(p, q)));
	if (Math.abs(dx) + Math.abs(dy) === 1) return open(from, to);
	const viaX = { x: to.x, y: from.y };
	const viaY = { x: from.x, y: to.y };
	return (open(from, viaX) && open(viaX, to)) || (open(from, viaY) && open(viaY, to));
}

/** Whether `to` can be walked to from `from` without crossing a wall or closed door. */
export function isReachable(
	grid: SquareGrid,
	blocked: ReadonlySet<string>,
	from: GridPos,
	to: GridPos
): boolean {
	if (!inBounds(grid, from) || !inBounds(grid, to)) return false;
	const key = (p: GridPos) => p.y * grid.width + p.x;
	const seen = new Uint8Array(grid.width * grid.height);
	const queue: GridPos[] = [from];
	seen[key(from)] = 1;
	for (let i = 0; i < queue.length; i++) {
		const cur = queue[i];
		if (cur.x === to.x && cur.y === to.y) return true;
		for (let dy = -1; dy <= 1; dy++) {
			for (let dx = -1; dx <= 1; dx++) {
				if (!dx && !dy) continue;
				const next = { x: cur.x + dx, y: cur.y + dy };
				if (!inBounds(grid, next) || seen[key(next)] || !canStep(blocked, cur, next)) continue;
				seen[key(next)] = 1;
				queue.push(next);
			}
		}
	}
	return false;
}

/**
 * Removes one unit edge from a wall, returning the remaining pieces (zero,
 * one or two walls). Used to cut a doorway. The first piece keeps the id.
 */
export function cutWall(wall: Wall, edge: GridEdge, newId: () => string): Wall[] {
	const cut = edgeKey(edge);
	const edges = unitEdges(wall.a, wall.b);
	const at = edges.findIndex((e) => edgeKey(e) === cut);
	if (at === -1) return [wall];
	const runs = [edges.slice(0, at), edges.slice(at + 1)].filter((r) => r.length > 0);
	return runs.map((run, i) => ({
		id: i === 0 ? wall.id : newId(),
		kind: 'wall',
		a: run[0].a,
		b: run[run.length - 1].b
	}));
}

/** The wall or door covering a unit edge, preferring doors (they sit on top of cut walls). */
export function objectOnEdge(
	objects: Iterable<SceneObject>,
	edge: GridEdge
): SceneObject | undefined {
	const key = edgeKey(edge);
	let wall: SceneObject | undefined;
	for (const o of objects) {
		if (!unitEdges(o.a, o.b).some((e) => edgeKey(e) === key)) continue;
		if (o.kind === 'door') return o;
		wall ??= o;
	}
	return wall;
}

/** Snaps `to` onto the row or column through `from`, whichever it is closer to. */
export function alignToAxis(from: GridPos, to: GridPos): GridPos {
	return Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
		? { x: to.x, y: from.y }
		: { x: from.x, y: to.y };
}
