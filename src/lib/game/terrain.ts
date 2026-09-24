// Elevation: each cell of a table has a level, 0 (the floor) up to
// MAX_LEVEL. Balconies, ledges, towers and stairs are cells at other levels;
// nothing stacks, so a cell has one floor. Movement and sight read the levels
// through Obstacles (see objects.ts and visibility.ts). A table without
// elevation has no level map at all (null), and behaves exactly as flat.

import { inBounds, type GridPos, type SquareGrid } from './grid';
import { rectCells, type CellMask } from './visibility';

/** The highest level a cell can be at. */
export const MAX_LEVEL = 40;

/** One byte per cell, row-major, like a CellMask; values are levels. */
export type LevelMap = Uint8Array;

export function flatLevels(grid: SquareGrid): LevelMap {
	return new Uint8Array(grid.width * grid.height);
}

export function levelAt(levels: LevelMap | null, grid: SquareGrid, c: GridPos): number {
	return levels && inBounds(grid, c) ? levels[c.y * grid.width + c.x] : 0;
}

/** Sets every cell of a rectangle to `level`. Returns the new map (null again once all flat). */
export function withLevel(
	levels: LevelMap | null,
	grid: SquareGrid,
	from: GridPos,
	to: GridPos,
	level: number
): LevelMap | null {
	const next = levels ? levels.slice() : flatLevels(grid);
	for (const i of rectCells(grid, from, to)) next[i] = level;
	return next.some((l) => l !== 0) ? next : null;
}

/** Packs levels as base64, one byte per cell. */
export function encodeLevels(levels: LevelMap): string {
	let binary = '';
	for (const l of levels) binary += String.fromCharCode(l);
	return btoa(binary);
}

/** Inverse of encodeLevels; null if the data is malformed, the wrong size or out of range. */
export function decodeLevels(encoded: string, size: number): LevelMap | null {
	let binary: string;
	try {
		binary = atob(encoded);
	} catch {
		return null;
	}
	if (binary.length !== size) return null;
	const levels = new Uint8Array(size);
	for (let i = 0; i < size; i++) {
		const l = binary.charCodeAt(i);
		if (l > MAX_LEVEL) return null;
		levels[i] = l;
	}
	return levels;
}

/** What a viewer may know of the ground: levels only where `known` (the rest reads as flat). */
export function knownLevels(levels: LevelMap, known: CellMask | null): LevelMap {
	if (!known) return levels;
	const out = new Uint8Array(levels.length);
	for (let i = 0; i < levels.length; i++) if (known[i]) out[i] = levels[i];
	return out;
}
