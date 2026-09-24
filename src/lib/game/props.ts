// Props: furniture and scenery. An asset (from the built-in catalog) says
// what a thing is: its name, its footprint on the grid, and what it blocks.
// A prop is one placement of an asset: where, which way round, how big.
// How assets look is a model with the same id (assets/models/prop, built by the asset pipeline); only what
// matters to the rules lives here.

import { blockingEdges, windowEdges, type Obstacles, type SceneObject } from './objects';
import { VOID, type FloorMap } from './floor';
import { inBounds, type GridPos, type SquareGrid } from './grid';

/** 'movement': can't walk into it. 'sight': can't walk into or see past it. */
export type PropBlocks = 'none' | 'movement' | 'sight';

export interface Asset {
	name: string;
	/** Footprint in cells when unrotated: `w` along x, `h` along y. */
	w: number;
	h: number;
	blocks: PropBlocks;
}

export const ASSETS = {
	table: { name: 'Table', w: 2, h: 1, blocks: 'movement' },
	chair: { name: 'Chair', w: 1, h: 1, blocks: 'none' },
	crate: { name: 'Crate', w: 1, h: 1, blocks: 'movement' },
	barrel: { name: 'Barrel', w: 1, h: 1, blocks: 'movement' },
	chest: { name: 'Chest', w: 1, h: 1, blocks: 'movement' },
	bed: { name: 'Bed', w: 1, h: 2, blocks: 'movement' },
	bookshelf: { name: 'Bookshelf', w: 2, h: 1, blocks: 'sight' },
	pillar: { name: 'Pillar', w: 1, h: 1, blocks: 'sight' },
	statue: { name: 'Statue', w: 1, h: 1, blocks: 'movement' },
	tree: { name: 'Tree', w: 1, h: 1, blocks: 'sight' },
	rug: { name: 'Rug', w: 2, h: 2, blocks: 'none' },
	well: { name: 'Well', w: 2, h: 2, blocks: 'movement' },
	noticeboard: { name: 'Notice board', w: 1, h: 1, blocks: 'movement' },
	'chest-open': { name: 'Open chest', w: 1, h: 1, blocks: 'movement' },
	rubble: { name: 'Rubble', w: 1, h: 1, blocks: 'none' },
	hatch: { name: 'Floor hatch', w: 1, h: 1, blocks: 'none' },
	'hatch-open': { name: 'Open hatch', w: 1, h: 1, blocks: 'none' },
	brazier: { name: 'Brazier', w: 1, h: 1, blocks: 'movement' },
	ashes: { name: 'Ashes', w: 1, h: 1, blocks: 'none' },
	altar: { name: 'Altar', w: 2, h: 1, blocks: 'movement' },
	pew: { name: 'Pew', w: 2, h: 1, blocks: 'movement' },
	gravestone: { name: 'Gravestone', w: 1, h: 1, blocks: 'movement' },
	grate: { name: 'Iron grate', w: 1, h: 1, blocks: 'none' },
	stairs: { name: 'Stair down', w: 1, h: 1, blocks: 'none' },
	rope: { name: 'Bell rope', w: 1, h: 1, blocks: 'none' },
	bell: { name: 'Great bell', w: 2, h: 2, blocks: 'movement' },
	anvil: { name: 'Anvil', w: 1, h: 1, blocks: 'movement' },
	chains: { name: 'Hanging chains', w: 1, h: 1, blocks: 'none' },
	'belfry-bell': { name: 'Hanging bell', w: 1, h: 1, blocks: 'movement' },
	lever: { name: 'Lever', w: 1, h: 1, blocks: 'movement' },
	'lever-down': { name: 'Lever (pulled)', w: 1, h: 1, blocks: 'movement' },
	handbell: { name: 'Hand bell', w: 1, h: 1, blocks: 'none' },
	sconce: { name: 'Torch stand', w: 1, h: 1, blocks: 'none' },
	carvings: { name: 'Carvings', w: 1, h: 1, blocks: 'none' },
	'great-bell': { name: 'Giant bell', w: 3, h: 3, blocks: 'movement' },
	gear: { name: 'Great gear', w: 2, h: 2, blocks: 'movement' },
	water: { name: 'Dark water', w: 2, h: 2, blocks: 'none' },
	'water-sm': { name: 'Dark water (small)', w: 1, h: 1, blocks: 'none' },
	'water-lg': { name: 'Dark water (large)', w: 4, h: 4, blocks: 'none' },
	crack: { name: 'Cracked floor', w: 1, h: 1, blocks: 'none' },
	heart: { name: 'Great heart', w: 3, h: 3, blocks: 'sight' },
	'broken-bell': { name: 'Broken bell', w: 3, h: 3, blocks: 'movement' }
} as const satisfies Record<string, Asset>;

export type AssetId = keyof typeof ASSETS;
export const ASSET_IDS = Object.keys(ASSETS) as AssetId[];

export function isAssetId(value: unknown): value is AssetId {
	return typeof value === 'string' && Object.hasOwn(ASSETS, value);
}

/** Quarter turns clockwise (seen from above). */
export type Rotation = 0 | 1 | 2 | 3;

export interface Prop {
	id: string;
	assetId: AssetId;
	/** The footprint's min-x/min-y cell. */
	pos: GridPos;
	rotation: Rotation;
	/** Visual only; the footprint on the grid does not change. */
	scale: number;
	/** GM: kept out of players' and spectators' views (a secret); it still blocks as usual. */
	hidden?: true;
}

export const MAX_PROPS_PER_ROOM = 500;
export const PROP_SCALE = { min: 0.5, max: 2 };

/** Footprint size in cells after rotation. */
export function footprintSize(assetId: AssetId, rotation: Rotation): { w: number; h: number } {
	const a = ASSETS[assetId];
	return rotation % 2 === 0 ? { w: a.w, h: a.h } : { w: a.h, h: a.w };
}

/** Every cell a prop covers. */
export function footprintCells(p: Pick<Prop, 'assetId' | 'pos' | 'rotation'>): GridPos[] {
	const { w, h } = footprintSize(p.assetId, p.rotation);
	const cells: GridPos[] = [];
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) cells.push({ x: p.pos.x + x, y: p.pos.y + y });
	return cells;
}

export function footprintInBounds(
	grid: SquareGrid,
	p: Pick<Prop, 'assetId' | 'pos' | 'rotation'>
): boolean {
	return footprintCells(p).every((c) => inBounds(grid, c));
}

export function propBlocks(p: Pick<Prop, 'assetId'>): PropBlocks {
	return ASSETS[p.assetId].blocks;
}

/** The prop covering a cell, preferring one that blocks (a crate on a rug is "the crate"). */
export function propAt(props: Iterable<Prop>, cell: GridPos): Prop | undefined {
	let found: Prop | undefined;
	for (const p of props) {
		if (!footprintCells(p).some((c) => c.x === cell.x && c.y === cell.y)) continue;
		if (propBlocks(p) !== 'none') return p;
		found ??= p;
	}
	return found;
}

/**
 * All blockers on a table: walls, windows and closed doors, the cells props
 * make solid or opaque, cells off the map (a `void` floor), and each cell's
 * level if the table has elevation.
 */
export function obstaclesFor(
	grid: SquareGrid,
	objects: Iterable<SceneObject>,
	props: Iterable<Prop> = [],
	levels: Uint8Array | null = null,
	floor: FloorMap | null = null
): Obstacles {
	const size = grid.width * grid.height;
	let solid: Uint8Array | null = null;
	let opaque: Uint8Array | null = null;
	// Off the map: nobody stands there.
	if (floor?.includes(VOID)) {
		solid = new Uint8Array(size);
		for (let i = 0; i < size; i++) if (floor[i] === VOID) solid[i] = 1;
	}
	for (const p of props) {
		const blocks = propBlocks(p);
		if (blocks === 'none') continue;
		solid ??= new Uint8Array(size);
		if (blocks === 'sight') opaque ??= new Uint8Array(size);
		for (const c of footprintCells(p)) {
			if (!inBounds(grid, c)) continue;
			solid[c.y * grid.width + c.x] = 1;
			if (blocks === 'sight') opaque![c.y * grid.width + c.x] = 1;
		}
	}
	const all = [...objects];
	const windows = windowEdges(all);
	return {
		edges: blockingEdges(all),
		width: grid.width,
		solid,
		opaque,
		windows: windows.size ? windows : null,
		levels
	};
}

/** Whether a cell can be stood on: on the grid and not inside a blocking prop. */
export function isSolidCell(obstacles: Obstacles, cell: GridPos): boolean {
	return !!obstacles.solid?.[cell.y * obstacles.width + cell.x];
}

export interface PlacementProblem {
	code: 'invalid_position' | 'cell_occupied';
	message: string;
}

/**
 * Why a prop can't stand here, or null if it can: fully on the table, and if
 * it blocks, not on a token or another blocking prop. Rugs and chairs go
 * anywhere. `selfId` ignores the prop being moved.
 */
export function placementProblem(
	grid: SquareGrid,
	placement: Pick<Prop, 'assetId' | 'pos' | 'rotation'>,
	tokens: Iterable<{ pos: GridPos }>,
	props: Iterable<Prop>,
	selfId?: string
): PlacementProblem | null {
	if (!footprintInBounds(grid, placement)) {
		return {
			code: 'invalid_position',
			message: 'That would stick out over the edge of the table.'
		};
	}
	if (propBlocks(placement) === 'none') return null;
	const cells = new Set(footprintCells(placement).map((c) => `${c.x},${c.y}`));
	for (const t of tokens) {
		if (cells.has(`${t.pos.x},${t.pos.y}`)) {
			return { code: 'cell_occupied', message: 'A token is standing there. Move it first.' };
		}
	}
	for (const p of props) {
		if (p.id === selfId || propBlocks(p) === 'none') continue;
		if (footprintCells(p).some((c) => cells.has(`${c.x},${c.y}`))) {
			return { code: 'cell_occupied', message: 'Something is already standing there.' };
		}
	}
	return null;
}
