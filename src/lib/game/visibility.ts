// Grid visibility: what a token can see, and the compact cell masks the
// server sends each client. Deliberately simple and deterministic: cell-to-
// cell line of sight through the same walls and closed doors that block
// movement, within a round vision radius.
//
// With elevation the sight line also has a height: it runs from the viewer's
// eye (its cell's level + EYE_LEVELS) to just above the target cell (its
// level + TARGET_LEVELS). Ground rising above the line blocks it; a line high
// enough passes over walls and tall props. On a flat table this reduces
// exactly to the flat rules.

import { inBounds, type GridPos, type SquareGrid } from './grid';
import { asObstacles, canStep, type Blockers } from './objects';

/** Eye height of a viewer (or a light) above its cell, in levels. */
export const EYE_LEVELS = 3;
/** How far above a cell's floor it must be seen to count as seen (a figure standing there). */
export const TARGET_LEVELS = 1;
/** Height of a wall (or door, or window frame) above the higher of the cells beside it. */
export const WALL_LEVELS = 5;
/** Height of a prop that blocks sight (a pillar, a tree, a bookshelf). */
export const PROP_LEVELS = 5;

/** One byte per cell, row-major (`y * width + x`); non-zero means "in the set". */
export type CellMask = Uint8Array;

/** What one client should see. Masks are base64 bitsets (see encodeMask). */
export interface FogView {
	enabled: boolean;
	/** Cells seen right now (vision or GM reveal). */
	visible: string;
	/** Cells seen at some point (includes visible). */
	explored: string;
}

export const DEFAULT_VISION = 6;
export const MAX_VISION = 60;

export function emptyMask(grid: SquareGrid): CellMask {
	return new Uint8Array(grid.width * grid.height);
}

export function cellIndex(grid: SquareGrid, c: GridPos): number {
	return c.y * grid.width + c.x;
}

/**
 * Whether the centre of `to` can be seen from the centre of `from`. Walks the
 * cells the sight line passes through; each step must be passable in the
 * movement sense, so walls and closed doors block sight and a line exactly
 * through a wall corner is blocked unless one side of the corner is open.
 */
export function hasLineOfSight(blocked: Blockers, from: GridPos, to: GridPos): boolean {
	const nx = Math.abs(to.x - from.x);
	const ny = Math.abs(to.y - from.y);
	const sx = Math.sign(to.x - from.x);
	const sy = Math.sign(to.y - from.y);
	const o = asObstacles(blocked);
	const levels = o.levels ?? null;
	const level = (c: GridPos) => (levels ? levels[c.y * o.width + c.x] : 0);
	const eye = level(from) + EYE_LEVELS;
	const top = level(to) + TARGET_LEVELS;
	const length = Math.hypot(nx, ny) || 1;
	/** Height of the sight line where it is `d` cells (horizontally) from the viewer. */
	const heightAt = (d: number) => eye + ((top - eye) * d) / length;
	let x = from.x;
	let y = from.y;
	let ix = 0;
	let iy = 0;
	while (ix < nx || iy < ny) {
		// Which cell boundary does the line cross next? Compares (0.5+ix)/nx with
		// (0.5+iy)/ny without division; zero means it passes exactly through a corner.
		const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
		const next =
			decision === 0
				? { x: x + sx, y: y + sy }
				: decision < 0
					? { x: x + sx, y }
					: { x, y: y + sy };
		if (decision <= 0) ix++;
		if (decision >= 0) iy++;
		const near = Math.hypot(x - from.x, y - from.y);
		const far = Math.hypot(next.x - from.x, next.y - from.y);
		const crossing = heightAt((near + far) / 2);
		const clear = levels
			? {
					walls: crossing >= Math.max(level({ x, y }), level(next)) + WALL_LEVELS,
					props: crossing >= level(next) + PROP_LEVELS
				}
			: undefined;
		if (!canStep(blocked, { x, y }, next, 'sight', to, clear)) return false;
		// Ground in between that rises above the line hides what is beyond it.
		const isTarget = next.x === to.x && next.y === to.y;
		if (levels && !isTarget && level(next) > heightAt(far)) return false;
		x = next.x;
		y = next.y;
	}
	return true;
}

/** Marks every cell visible from `origin` within `radius` cells (round) into `into`. */
export function addVision(
	grid: SquareGrid,
	blocked: Blockers,
	origin: GridPos,
	radius: number,
	into: CellMask
): void {
	if (!inBounds(grid, origin) || radius < 0) return;
	into[cellIndex(grid, origin)] = 1;
	const r = Math.floor(radius);
	// (r + 0.5)^2 - 0.25 keeps the edge of the circle from looking ragged on a grid.
	const limit = r * r + r;
	for (let dy = -r; dy <= r; dy++) {
		for (let dx = -r; dx <= r; dx++) {
			if (dx * dx + dy * dy > limit) continue;
			const c = { x: origin.x + dx, y: origin.y + dy };
			if (!inBounds(grid, c) || into[cellIndex(grid, c)]) continue;
			if (hasLineOfSight(blocked, origin, c)) into[cellIndex(grid, c)] = 1;
		}
	}
}

/** Marks every cell of the inclusive rectangle between two cells. */
export function rectCells(grid: SquareGrid, a: GridPos, b: GridPos): number[] {
	const cells: number[] = [];
	const x0 = Math.max(0, Math.min(a.x, b.x));
	const x1 = Math.min(grid.width - 1, Math.max(a.x, b.x));
	const y0 = Math.max(0, Math.min(a.y, b.y));
	const y1 = Math.min(grid.height - 1, Math.max(a.y, b.y));
	for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push(y * grid.width + x);
	return cells;
}

/** Packs a mask into a base64 bitset: 1 bit per cell, so a 100×100 grid is ~1.7 KB. */
export function encodeMask(mask: CellMask): string {
	const bytes = new Uint8Array(Math.ceil(mask.length / 8));
	for (let i = 0; i < mask.length; i++) if (mask[i]) bytes[i >> 3] |= 1 << (i & 7);
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

/** Inverse of encodeMask. Malformed input decodes to an empty mask. */
export function decodeMask(encoded: string, size: number): CellMask {
	const mask = new Uint8Array(size);
	let binary: string;
	try {
		binary = atob(encoded);
	} catch {
		return mask;
	}
	for (let i = 0; i < size; i++) {
		const byte = binary.charCodeAt(i >> 3);
		if (byte & (1 << (i & 7))) mask[i] = 1;
	}
	return mask;
}
