// Small builders for the adventure's tables, so each location reads as a map
// rather than as JSON. Every table is an ordinary scene file and goes through
// the same validation and loading as any saved scene.

import type { GridPos, SquareGrid } from '../../src/lib/game/grid';
import type { Ambient, Light } from '../../src/lib/game/lights';
import type { SceneObject } from '../../src/lib/game/objects';
import type { AssetId, Prop, Rotation } from '../../src/lib/game/props';
import { SCENE_FILE_VERSION, type SavedToken, type SceneFile } from '../../src/lib/game/scene-file';
import { emptyMask, encodeMask, rectCells } from '../../src/lib/game/visibility';

export const wall = (id: string, a: GridPos, b: GridPos): SceneObject => ({
	id,
	kind: 'wall',
	a,
	b
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
	on = true
): Light => ({ id, pos: { x, y }, radius, color, on });

/** A person the party can talk to: a GM-controlled token. */
export const npc = (id: string, name: string, color: string, x: number, y: number): SavedToken => ({
	id,
	name,
	color,
	pos: { x, y },
	vision: 6,
	light: 0,
	owner: null
});

export interface TableParts {
	name: string;
	grid: SquareGrid;
	objects: SceneObject[];
	props: Prop[];
	lights: Light[];
	tokens: SavedToken[];
	ambient: Ambient;
	/** Already in view when the party arrives: an inclusive rectangle of cells. */
	arrival: { from: GridPos; to: GridPos };
}

export function table(parts: TableParts, now = new Date()): SceneFile {
	const revealed = emptyMask(parts.grid);
	for (const i of rectCells(parts.grid, parts.arrival.from, parts.arrival.to)) revealed[i] = 1;
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
		fog: { enabled: true, revealed: encodeMask(revealed) },
		adventure: null
	};
}

/** Every cell of an inclusive rectangle. */
export function cellsOf(from: GridPos, to: GridPos): GridPos[] {
	const cells: GridPos[] = [];
	for (let y = from.y; y <= to.y; y++) for (let x = from.x; x <= to.x; x++) cells.push({ x, y });
	return cells;
}
