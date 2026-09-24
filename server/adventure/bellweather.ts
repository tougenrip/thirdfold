// The opening table of The Hollow Bell: the square of Bellweather village at
// dusk, the Tolling Rest inn, the Hale house, the old well, and the chained
// gate to the mountain path. Built as an ordinary scene file, so it goes
// through the same validation and loading as any saved scene.
//
// The grid runs x to the east and y to the south: the village road enters
// from the south edge, the mountain path leaves from the north edge.

import type { GridPos, SquareGrid } from '../../src/lib/game/grid';
import type { Light } from '../../src/lib/game/lights';
import type { SceneObject } from '../../src/lib/game/objects';
import type { AssetId, Prop, Rotation } from '../../src/lib/game/props';
import { SCENE_FILE_VERSION, type SceneFile, type SavedToken } from '../../src/lib/game/scene-file';
import { emptyMask, encodeMask, rectCells } from '../../src/lib/game/visibility';

export const GRID: SquareGrid = { kind: 'square', cellSize: 1, width: 24, height: 20 };

/** Ids of the things the story refers to. */
export const IDS = {
	maren: 'hb-maren',
	well: 'hb-well',
	noticeboard: 'hb-noticeboard',
	chest: 'hb-chest',
	gate: 'hb-gate'
} as const;

/** Where characters appear, in order: the village road at the south edge. */
export const SPAWN: readonly GridPos[] = [
	{ x: 11, y: 18 },
	{ x: 12, y: 18 },
	{ x: 13, y: 18 },
	{ x: 14, y: 18 },
	{ x: 11, y: 19 },
	{ x: 12, y: 19 },
	{ x: 13, y: 19 },
	{ x: 14, y: 19 }
];

/** Reaching one of these cells in the aftermath ends the section: the path up the mountain. */
export const EXIT: readonly GridPos[] = [10, 11, 12, 13].flatMap((x) => [
	{ x, y: 0 },
	{ x, y: 1 }
]);

/** The mountain path, revealed to everyone when the gate opens. */
export const PATH_AREA = { from: { x: 9, y: 0 }, to: { x: 14, y: 5 } };

/** Where the Hollow Hound can climb out: the cells around the well, nearest first. */
export const WELL_RING: readonly GridPos[] = [
	{ x: 11, y: 12 },
	{ x: 12, y: 12 },
	{ x: 13, y: 13 },
	{ x: 10, y: 13 },
	{ x: 13, y: 14 },
	{ x: 10, y: 14 },
	{ x: 11, y: 15 },
	{ x: 12, y: 15 }
];

const wall = (id: string, a: GridPos, b: GridPos): SceneObject => ({ id, kind: 'wall', a, b });
const door = (id: string, a: GridPos, b: GridPos): SceneObject => ({
	id,
	kind: 'door',
	a,
	b,
	open: false
});
const prop = (
	id: string,
	assetId: AssetId,
	x: number,
	y: number,
	rotation: Rotation = 0
): Prop => ({
	id,
	assetId,
	pos: { x, y },
	rotation,
	scale: 1
});
const light = (id: string, x: number, y: number, radius: number, color: string): Light => ({
	id,
	pos: { x, y },
	radius,
	color,
	on: true
});

const TREES: readonly [number, number][] = [
	// Mountainside north of the fence, leaving the path (x 10-13) clear.
	[1, 1],
	[3, 3],
	[5, 0],
	[6, 2],
	[8, 1],
	[15, 2],
	[16, 0],
	[18, 3],
	[20, 1],
	[22, 3],
	// Around the village.
	[0, 6],
	[23, 6],
	[0, 15],
	[1, 17],
	[3, 16],
	[5, 18],
	[18, 17],
	[20, 15],
	[22, 17],
	[22, 13]
];

export function bellweatherScene(now = new Date()): SceneFile {
	const objects: SceneObject[] = [
		// The fence across the valley, with the chained gate to the mountain path.
		wall('hb-fence-w', { x: 0, y: 5 }, { x: 11, y: 5 }),
		door(IDS.gate, { x: 11, y: 5 }, { x: 12, y: 5 }),
		wall('hb-fence-e', { x: 12, y: 5 }, { x: 24, y: 5 }),
		// The Tolling Rest: x 2-8, y 7-12, door on the east side.
		wall('hb-inn-n', { x: 2, y: 7 }, { x: 9, y: 7 }),
		wall('hb-inn-w', { x: 2, y: 7 }, { x: 2, y: 13 }),
		wall('hb-inn-s', { x: 2, y: 13 }, { x: 9, y: 13 }),
		wall('hb-inn-e1', { x: 9, y: 7 }, { x: 9, y: 10 }),
		door('hb-inn-door', { x: 9, y: 10 }, { x: 9, y: 11 }),
		wall('hb-inn-e2', { x: 9, y: 11 }, { x: 9, y: 13 }),
		// The Hale house: x 15-21, y 7-11, door on the west side.
		wall('hb-hale-n', { x: 15, y: 7 }, { x: 22, y: 7 }),
		wall('hb-hale-e', { x: 22, y: 7 }, { x: 22, y: 12 }),
		wall('hb-hale-s', { x: 15, y: 12 }, { x: 22, y: 12 }),
		wall('hb-hale-w1', { x: 15, y: 7 }, { x: 15, y: 9 }),
		door('hb-hale-door', { x: 15, y: 9 }, { x: 15, y: 10 }),
		wall('hb-hale-w2', { x: 15, y: 10 }, { x: 15, y: 12 })
	];

	const props: Prop[] = [
		prop(IDS.well, 'well', 11, 13),
		prop(IDS.noticeboard, 'noticeboard', 11, 8),
		// Inside the inn.
		prop('hb-inn-table1', 'table', 3, 8),
		prop('hb-inn-chair1', 'chair', 3, 9),
		prop('hb-inn-chair2', 'chair', 4, 9),
		prop('hb-inn-table2', 'table', 3, 11),
		prop('hb-inn-chair3', 'chair', 5, 11),
		prop('hb-inn-barrel1', 'barrel', 8, 7),
		prop('hb-inn-barrel2', 'barrel', 8, 12),
		prop('hb-inn-shelf', 'bookshelf', 5, 7),
		// Inside the Hale house.
		prop('hb-hale-bed', 'bed', 20, 8),
		prop(IDS.chest, 'chest', 17, 8),
		prop('hb-hale-rug', 'rug', 17, 10),
		// Outside.
		prop('hb-crate1', 'crate', 10, 11),
		prop('hb-barrel1', 'barrel', 14, 15),
		prop('hb-crate2', 'crate', 6, 15),
		...TREES.map(([x, y], i) => prop(`hb-tree${i + 1}`, 'tree', x, y))
	];

	const lights: Light[] = [
		light('hb-lamp-square', 13, 11, 4, '#ffa04d'),
		light('hb-lamp-road', 10, 16, 4, '#ffa04d'),
		light('hb-inn-candle', 5, 10, 4, '#ffd27a'),
		light('hb-hale-candle', 18, 9, 3, '#ffd27a')
	];

	const tokens: SavedToken[] = [
		{
			id: IDS.maren,
			name: 'Maren',
			color: '#a04a2c',
			pos: { x: 6, y: 9 },
			vision: 6,
			light: 0,
			owner: null
		}
	];

	// The road the party arrives on is already in view.
	const revealed = emptyMask(GRID);
	for (const i of rectCells(GRID, { x: 9, y: 16 }, { x: 16, y: 19 })) revealed[i] = 1;

	return {
		format: 'thirdfold-scene',
		version: SCENE_FILE_VERSION,
		name: 'Bellweather',
		savedAt: now.toISOString(),
		grid: { ...GRID },
		tokens,
		objects,
		props,
		lights,
		ambient: 'dusk',
		fog: { enabled: true, revealed: encodeMask(revealed) }
	};
}
