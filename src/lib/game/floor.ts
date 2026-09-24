// Floors: what each cell of a table is made of, painted by the GM (stone,
// wood, grass, water...), or `void`, off the map: nobody can stand there.
// Like the level map (terrain.ts) it is one byte per cell, and a table with
// nothing painted has no floor map at all (null): every cell is the table's
// own surface (its environment, or the plain table).

import type { GridPos, SquareGrid } from './grid';
import { rectCells, type CellMask } from './visibility';

/** The floors, by the byte stored for each cell. `plain` (0) is the table's own surface. */
export const FLOORS = [
	{ id: 'plain', name: 'Table' },
	{ id: 'stone', name: 'Stone' },
	{ id: 'wood', name: 'Wood' },
	{ id: 'grass', name: 'Grass' },
	{ id: 'dirt', name: 'Dirt' },
	{ id: 'sand', name: 'Sand' },
	{ id: 'water', name: 'Water' },
	{ id: 'void', name: 'Off the map' }
] as const;

export type FloorId = (typeof FLOORS)[number]['id'];
export const FLOOR_IDS: readonly FloorId[] = FLOORS.map((f) => f.id);

/** The byte for cells off the map: they block movement like a solid prop. */
export const VOID = FLOOR_IDS.indexOf('void');

/** One byte per cell, row-major, like a CellMask; values index FLOORS. */
export type FloorMap = Uint8Array;

export function isFloorId(value: unknown): value is FloorId {
	return typeof value === 'string' && (FLOOR_IDS as readonly string[]).includes(value);
}

/** Paints every cell of a rectangle. Returns the new map (null again once all plain). */
export function withFloor(
	floor: FloorMap | null,
	grid: SquareGrid,
	from: GridPos,
	to: GridPos,
	id: FloorId
): FloorMap | null {
	const next = floor ? floor.slice() : new Uint8Array(grid.width * grid.height);
	const value = FLOOR_IDS.indexOf(id);
	for (const i of rectCells(grid, from, to)) next[i] = value;
	return next.some((v) => v !== 0) ? next : null;
}

/** Packs a floor map as base64, one byte per cell. */
export function encodeFloor(floor: FloorMap): string {
	let binary = '';
	for (const v of floor) binary += String.fromCharCode(v);
	return btoa(binary);
}

/** Inverse of encodeFloor; null if the data is malformed, the wrong size or names no floor. */
export function decodeFloor(encoded: string, size: number): FloorMap | null {
	let binary: string;
	try {
		binary = atob(encoded);
	} catch {
		return null;
	}
	if (binary.length !== size) return null;
	const floor = new Uint8Array(size);
	for (let i = 0; i < size; i++) {
		const v = binary.charCodeAt(i);
		if (v >= FLOORS.length) return null;
		floor[i] = v;
	}
	return floor;
}

/** What a viewer may know of the floors: only where `known` (the rest reads as plain). */
export function knownFloor(floor: FloorMap, known: CellMask | null): FloorMap {
	if (!known) return floor;
	const out = new Uint8Array(floor.length);
	for (let i = 0; i < floor.length; i++) if (known[i]) out[i] = floor[i];
	return out;
}
