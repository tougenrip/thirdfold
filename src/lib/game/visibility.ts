// Grid visibility: what a token can see, and the compact cell masks the
// server sends each client. Deliberately simple and deterministic: cell-to-
// cell line of sight through the same walls and closed doors that block
// movement, within a round vision radius.

import { inBounds, type GridPos, type SquareGrid } from './grid';
import { canStep, type Blockers } from './objects';

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
		if (!canStep(blocked, { x, y }, next, 'sight', to)) return false;
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
