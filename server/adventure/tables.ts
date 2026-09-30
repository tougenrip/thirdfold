// Small builders for the adventure's tables, so each location reads as a map
// rather than as JSON. Every table is an ordinary scene file and goes through
// the same validation and loading as any saved scene.

import { encodeFloor, withFloor, type FloorId, type FloorMap } from '../../src/lib/game/floor';
import type { GridPos, SquareGrid } from '../../src/lib/game/grid';
import type { Ambient, Light, LightLook } from '../../src/lib/game/lights';
import type { SceneObject } from '../../src/lib/game/objects';
import type { AssetId, Prop, Rotation } from '../../src/lib/game/props';
import { SCENE_FILE_VERSION, type SavedToken, type SceneFile } from '../../src/lib/game/scene-file';
import { encodeLevels, flatLevels, withLevel, type LevelMap } from '../../src/lib/game/terrain';
import { emptyMask, encodeMask, rectCells } from '../../src/lib/game/visibility';
import {
	ambientFor,
	applyWorldPatch,
	defaultWorldFor,
	type WorldPatch
} from '../../src/lib/game/world';

export const wall = (id: string, a: GridPos, b: GridPos): SceneObject => ({
	id,
	kind: 'wall',
	a,
	b
});

/** A wall you can see through but not pass: a window, an arrow slit, a railing. */
export const window = (id: string, a: GridPos, b: GridPos): SceneObject => ({
	id,
	kind: 'wall',
	a,
	b,
	window: true
});

export const door = (id: string, a: GridPos, b: GridPos): SceneObject => ({
	id,
	kind: 'door',
	a,
	b,
	open: false
});

export const prop = (
	id: string,
	assetId: AssetId,
	x: number,
	y: number,
	rotation: Rotation = 0
): Prop => ({ id, assetId, pos: { x, y }, rotation, scale: 1 });

export const light = (
	id: string,
	x: number,
	y: number,
	radius: number,
	color: string,
	on = true,
	look: Partial<LightLook> = {}
): Light => ({ id, pos: { x, y }, radius, color, on, ...look });

/** A light that is only a glow (the Bell's, a charm's, the lake's): no lantern post (#201). */
export const GLOW: Partial<LightLook> = { kind: 'glow', fixture: false };

export interface TableParts {
	name: string;
	grid: SquareGrid;
	objects: SceneObject[];
	props: Prop[];
	lights: Light[];
	tokens: SavedToken[];
	ambient: Ambient;
	/** How the world looks over the default at `ambient`'s hour; with a sun its hour must fall in `ambient`. */
	world?: WorldPatch;
	/** Already in view when the party arrives: an inclusive rectangle of cells. */
	arrival: { from: GridPos; to: GridPos };
	/** Raised ground, applied in order (later areas win); the rest is level 0. */
	terrain?: readonly Rise[];
	/** Dark areas (inclusive rectangles): only light lets anyone see there, whatever the ambient. */
	dark?: readonly { from: GridPos; to: GridPos }[];
	/** Roofed cells (inclusive rectangles): presentation only, never a rule of sight, light or movement. */
	interior?: readonly { from: GridPos; to: GridPos }[];
	/** How it looks: an environment asset (assets/environments). */
	environment: string;
	/** Painted floors (inclusive rectangles, later ones win); the rest is the table's own surface. */
	floors?: readonly { from: GridPos; to: GridPos; floor: FloorId }[];
}

/** A rectangle of cells at one level. */
export interface Rise {
	from: GridPos;
	to: GridPos;
	level: number;
}

/**
 * A stair: `cells` in order from the bottom, each one level up from the
 * last, starting at `from` + 1 (so it climbs off a floor at level `from`).
 * Each cell may be a rectangle to make the stair wider.
 */
export function stair(from: number, cells: readonly { from: GridPos; to: GridPos }[]): Rise[] {
	return cells.map((c, i) => ({ ...c, level: from + i + 1 }));
}

/** A one-cell rectangle. */
export const at = (x: number, y: number) => ({ from: { x, y }, to: { x, y } });

export function table(parts: TableParts, now = new Date()): SceneFile {
	const world = applyWorldPatch(defaultWorldFor(parts.ambient), parts.world ?? {}, now.getTime());
	if (ambientFor(world, parts.ambient) !== parts.ambient) {
		throw new Error(`${parts.name}: its world's hour is not ${parts.ambient}`);
	}
	const revealed = emptyMask(parts.grid);
	for (const i of rectCells(parts.grid, parts.arrival.from, parts.arrival.to)) revealed[i] = 1;
	let levels: LevelMap | null = null;
	for (const r of parts.terrain ?? []) {
		levels = withLevel(levels ?? flatLevels(parts.grid), parts.grid, r.from, r.to, r.level);
	}
	let floor: FloorMap | null = null;
	for (const f of parts.floors ?? []) floor = withFloor(floor, parts.grid, f.from, f.to, f.floor);
	const darkness = emptyMask(parts.grid);
	for (const d of parts.dark ?? [])
		for (const i of rectCells(parts.grid, d.from, d.to)) darkness[i] = 1;
	const interior = emptyMask(parts.grid);
	for (const d of parts.interior ?? [])
		for (const i of rectCells(parts.grid, d.from, d.to)) interior[i] = 1;
	return {
		format: 'thirdfold-scene',
		version: SCENE_FILE_VERSION,
		name: parts.name,
		savedAt: now.toISOString(),
		grid: { ...parts.grid },
		tokens: parts.tokens,
		objects: parts.objects,
		props: parts.props,
		lights: parts.lights,
		ambient: parts.ambient,
		world,
		interior: interior.some((v) => v) ? encodeMask(interior) : null,
		fog: { enabled: true, revealed: encodeMask(revealed), shared: false },
		discovery: {},
		adventure: null,
		terrain: levels ? encodeLevels(levels) : null,
		darkness: darkness.some((v) => v) ? encodeMask(darkness) : null,
		environment: parts.environment,
		floor: floor ? encodeFloor(floor) : null
	};
}

/** Every cell of an inclusive rectangle. */
export function cellsOf(from: GridPos, to: GridPos): GridPos[] {
	const cells: GridPos[] = [];
	for (let y = from.y; y <= to.y; y++) for (let x = from.x; x <= to.x; x++) cells.push({ x, y });
	return cells;
}
