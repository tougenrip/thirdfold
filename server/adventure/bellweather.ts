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
import type { Prop } from '../../src/lib/game/props';
import type { SceneFile, SavedToken } from '../../src/lib/game/scene-file';
import { door, light, npc, prop, table, wall } from './tables';

export const GRID: SquareGrid = { kind: 'square', cellSize: 1, width: 24, height: 20 };

/** Ids of the things the story refers to. */
export const IDS = {
	maren: 'hb-maren',
	well: 'hb-well',
	noticeboard: 'hb-noticeboard',
	chest: 'hb-chest',
	gate: 'hb-gate',
	innDoor: 'hb-inn-door',
	haleDoor: 'hb-hale-door',
	shelf: 'hb-inn-shelf',
	innTable: 'hb-inn-table1',
	shrine: 'hb-shrine',
	rug: 'hb-hale-rug',
	hatch: 'hb-hatch',
	crate: 'hb-crate1',
	brazier: 'hb-brazier',
	brazierLight: 'hb-brazier-light',
	/** Added when the Hound dies, where it fell. */
	remains: 'hb-remains'
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
		door(IDS.innDoor, { x: 9, y: 10 }, { x: 9, y: 11 }),
		wall('hb-inn-e2', { x: 9, y: 11 }, { x: 9, y: 13 }),
		// The Hale house: x 15-21, y 7-11, door on the west side.
		wall('hb-hale-n', { x: 15, y: 7 }, { x: 22, y: 7 }),
		wall('hb-hale-e', { x: 22, y: 7 }, { x: 22, y: 12 }),
		wall('hb-hale-s', { x: 15, y: 12 }, { x: 22, y: 12 }),
		wall('hb-hale-w1', { x: 15, y: 7 }, { x: 15, y: 9 }),
		door(IDS.haleDoor, { x: 15, y: 9 }, { x: 15, y: 10 }),
		wall('hb-hale-w2', { x: 15, y: 10 }, { x: 15, y: 12 })
	];

	const props: Prop[] = [
		prop(IDS.well, 'well', 11, 13),
		prop(IDS.noticeboard, 'noticeboard', 11, 8),
		// Inside the inn.
		prop(IDS.innTable, 'table', 3, 8),
		prop('hb-inn-chair1', 'chair', 3, 9),
		prop('hb-inn-chair2', 'chair', 4, 9),
		prop('hb-inn-table2', 'table', 3, 11),
		prop('hb-inn-chair3', 'chair', 5, 11),
		prop('hb-inn-barrel1', 'barrel', 8, 7),
		prop('hb-inn-barrel2', 'barrel', 8, 12),
		prop(IDS.shelf, 'bookshelf', 5, 7),
		// Inside the Hale house.
		prop('hb-hale-bed', 'bed', 20, 8),
		prop(IDS.chest, 'chest', 17, 8),
		prop(IDS.rug, 'rug', 17, 10),
		// Under the rug, found only by lifting it.
		prop(IDS.hatch, 'hatch', 17, 10),
		// Outside.
		prop(IDS.crate, 'crate', 10, 11),
		prop(IDS.shrine, 'statue', 8, 16),
		prop(IDS.brazier, 'brazier', 14, 6),
		prop('hb-barrel1', 'barrel', 14, 15),
		prop('hb-crate2', 'crate', 6, 15),
		...TREES.map(([x, y], i) => prop(`hb-tree${i + 1}`, 'tree', x, y))
	];

	const lights: Light[] = [
		light('hb-lamp-square', 13, 11, 4, '#ffa04d'),
		light('hb-lamp-road', 10, 16, 4, '#ffa04d'),
		light('hb-inn-candle', 5, 10, 4, '#ffd27a'),
		light('hb-hale-candle', 18, 9, 3, '#ffd27a'),
		{ ...light(IDS.brazierLight, 14, 6, 3, '#ffa04d'), on: false }
	];

	const tokens: SavedToken[] = [npc(IDS.maren, 'Maren', '#a04a2c', 6, 9)];

	return table(
		{
			name: 'Bellweather',
			grid: GRID,
			tokens,
			objects,
			props,
			lights,
			ambient: 'dusk',
			// The road the party arrives on is already in view.
			arrival: { from: { x: 9, y: 16 }, to: { x: 16, y: 19 } }
		},
		now
	);
}
