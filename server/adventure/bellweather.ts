// The opening table of The Hollow Bell: Bellweather village at dusk. The
// valley road comes in from the south past Widow Crane's cottage and the
// smithy to the main square with its well and Rosa's stall. West of the
// square is the Tolling Rest; east, the Hale house, and beyond it the chapel
// of Saint Agna and the churchyard. North, a fence and a chained gate close
// off the mountain path, where the pilgrims' arch marks the way up to the
// monastery. Built as an ordinary scene file, so it goes through the same
// validation and loading as any saved scene. The villagers are in npcs.ts.
//
// The grid runs x to the east and y to the south.

import type { GridPos, SquareGrid } from '../../src/lib/game/grid';
import type { Light } from '../../src/lib/game/lights';
import type { SceneObject } from '../../src/lib/game/objects';
import type { Prop } from '../../src/lib/game/props';
import type { SceneFile } from '../../src/lib/game/scene-file';
import { npcTokens } from './npcs';
import { door, light, prop, table, wall } from './tables';

export const GRID: SquareGrid = { kind: 'square', cellSize: 1, width: 36, height: 28 };

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
	remains: 'hb-remains',
	chapelDoor: 'hb-chapel-door',
	chapelRope: 'hb-chapel-rope',
	chapelAgna: 'hb-chapel-agna',
	ringers: 'hb-ringers',
	anvil: 'hb-anvil',
	craneDoor: 'hb-crane-door',
	loom: 'hb-loom',
	stall: 'hb-stall',
	waystone: 'hb-waystone',
	charm: 'hb-charm',
	charmGlow: 'hb-charm-glow'
} as const;

/** The mountain path north out of the village, up to the monastery: where the first bell draws the eye. */
export const MOUNTAIN_PATH: GridPos = { x: 11, y: 2 };

/**
 * What the first bell shows a newly arrived party: the path up the mountain
 * beyond the fence, where the camera looks. They remember its shape (not who
 * is on it), as they will the Hollow's; the village itself they find on foot.
 */
export const FIRST_GLIMPSE = { from: { x: 10, y: 0 }, to: { x: 13, y: 2 } };

/** Where a newcomer's first find lies: in the road, a few steps from where the party arrives. */
export const CHARM_AT: GridPos = { x: 12, y: 20 };

/** Where characters appear, in order: the valley road at the south edge. */
export const SPAWN: readonly GridPos[] = [
	{ x: 11, y: 26 },
	{ x: 12, y: 26 },
	{ x: 13, y: 26 },
	{ x: 14, y: 26 },
	{ x: 11, y: 27 },
	{ x: 12, y: 27 },
	{ x: 13, y: 27 },
	{ x: 14, y: 27 }
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
	[25, 1],
	[27, 3],
	[29, 0],
	[31, 2],
	[33, 4],
	[35, 1],
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
	[22, 13],
	[35, 8],
	[34, 12],
	[0, 26],
	[3, 25],
	[8, 26],
	[18, 26],
	[23, 25],
	[27, 25],
	[31, 26],
	[35, 24]
];

/** Churchyard stones, besides the three ringers' graves. */
const GRAVES: readonly [number, number][] = [
	[27, 17],
	[29, 17],
	[31, 17],
	[33, 17],
	[27, 19],
	[29, 19],
	[33, 19],
	[27, 21],
	[29, 21]
];

export function bellweatherScene(now = new Date()): SceneFile {
	const objects: SceneObject[] = [
		// The fence across the valley, with the chained gate to the mountain path.
		wall('hb-fence-w', { x: 0, y: 5 }, { x: 11, y: 5 }),
		door(IDS.gate, { x: 11, y: 5 }, { x: 12, y: 5 }),
		wall('hb-fence-e', { x: 12, y: 5 }, { x: 36, y: 5 }),
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
		wall('hb-hale-w2', { x: 15, y: 10 }, { x: 15, y: 12 }),
		// The chapel of Saint Agna: x 25-32, y 7-12, door on the west side.
		wall('hb-chapel-n', { x: 25, y: 7 }, { x: 33, y: 7 }),
		wall('hb-chapel-e', { x: 33, y: 7 }, { x: 33, y: 13 }),
		wall('hb-chapel-s', { x: 25, y: 13 }, { x: 33, y: 13 }),
		wall('hb-chapel-w1', { x: 25, y: 7 }, { x: 25, y: 9 }),
		door(IDS.chapelDoor, { x: 25, y: 9 }, { x: 25, y: 10 }),
		wall('hb-chapel-w2', { x: 25, y: 10 }, { x: 25, y: 13 }),
		// The churchyard wall: x 25-35, y 15-22, open to the lane at x 29-30.
		wall('hb-yard-n1', { x: 25, y: 15 }, { x: 29, y: 15 }),
		wall('hb-yard-n2', { x: 31, y: 15 }, { x: 36, y: 15 }),
		wall('hb-yard-w', { x: 25, y: 15 }, { x: 25, y: 23 }),
		wall('hb-yard-s', { x: 25, y: 23 }, { x: 36, y: 23 }),
		// The smithy: x 16-21, y 20-23, open to the road on the west.
		wall('hb-smithy-n', { x: 16, y: 20 }, { x: 22, y: 20 }),
		wall('hb-smithy-e', { x: 22, y: 20 }, { x: 22, y: 24 }),
		wall('hb-smithy-s', { x: 16, y: 24 }, { x: 22, y: 24 }),
		// Widow Crane's cottage: x 2-7, y 20-23, door on the east side.
		wall('hb-crane-n', { x: 2, y: 20 }, { x: 8, y: 20 }),
		wall('hb-crane-w', { x: 2, y: 20 }, { x: 2, y: 24 }),
		wall('hb-crane-s', { x: 2, y: 24 }, { x: 8, y: 24 }),
		wall('hb-crane-e1', { x: 8, y: 20 }, { x: 8, y: 21 }),
		door(IDS.craneDoor, { x: 8, y: 21 }, { x: 8, y: 22 }),
		wall('hb-crane-e2', { x: 8, y: 22 }, { x: 8, y: 24 })
	];

	const props: Prop[] = [
		prop(IDS.well, 'well', 11, 13),
		prop(IDS.noticeboard, 'noticeboard', 11, 8),
		prop(IDS.stall, 'table', 15, 14),
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
		// The chapel.
		prop('hb-chapel-altar', 'altar', 29, 7),
		prop('hb-chapel-pew1', 'pew', 26, 10),
		prop('hb-chapel-pew2', 'pew', 29, 10),
		prop('hb-chapel-pew3', 'pew', 26, 12),
		prop('hb-chapel-pew4', 'pew', 29, 12),
		prop(IDS.chapelRope, 'rope', 32, 8),
		prop(IDS.chapelAgna, 'statue', 32, 11),
		// The churchyard.
		prop(IDS.ringers, 'gravestone', 31, 19),
		prop('hb-ringer2', 'gravestone', 32, 19),
		prop('hb-ringer3', 'gravestone', 31, 20),
		...GRAVES.map(([x, y], i) => prop(`hb-grave${i + 1}`, 'gravestone', x, y)),
		// The smithy.
		prop(IDS.anvil, 'anvil', 18, 21),
		prop('hb-forge', 'brazier', 20, 21),
		prop('hb-smithy-barrel', 'barrel', 21, 23),
		// Widow Crane's cottage.
		prop(IDS.loom, 'table', 3, 22),
		prop('hb-crane-bed', 'bed', 2, 20),
		// Outside.
		prop(IDS.crate, 'crate', 10, 11),
		prop(IDS.shrine, 'statue', 8, 16),
		prop(IDS.brazier, 'brazier', 14, 6),
		prop('hb-barrel1', 'barrel', 14, 15),
		prop('hb-crate2', 'crate', 6, 15),
		// The pilgrims' arch at the foot of the mountain path.
		prop('hb-arch-w', 'pillar', 9, 1),
		prop('hb-arch-e', 'pillar', 14, 1),
		prop(IDS.waystone, 'gravestone', 9, 3),
		...TREES.map(([x, y], i) => prop(`hb-tree${i + 1}`, 'tree', x, y)),
		prop(IDS.charm, 'handbell', CHARM_AT.x, CHARM_AT.y)
	];

	const lights: Light[] = [
		light('hb-lamp-square', 13, 11, 4, '#ffa04d'),
		light('hb-lamp-road', 10, 16, 4, '#ffa04d'),
		light('hb-lamp-south', 15, 21, 3, '#ffa04d'),
		light('hb-lamp-lane', 24, 14, 3, '#ffa04d'),
		light('hb-inn-candle', 5, 10, 4, '#ffd27a'),
		light('hb-hale-candle', 18, 9, 3, '#ffd27a'),
		light('hb-chapel-candles', 30, 9, 4, '#ffe3a8'),
		light('hb-yard-lantern', 30, 16, 3, '#cfd8ff'),
		light('hb-forge-glow', 19, 22, 3, '#ff7a3d'),
		light('hb-crane-candle', 7, 20, 2, '#ffd27a'),
		// The charm's own faint glow: what catches a newcomer's eye.
		light(IDS.charmGlow, CHARM_AT.x, CHARM_AT.y, 1, '#9fd7ff'),
		{ ...light(IDS.brazierLight, 14, 6, 3, '#ffa04d'), on: false }
	];

	return table(
		{
			name: 'Bellweather',
			grid: GRID,
			tokens: npcTokens('bellweather'),
			objects,
			props,
			lights,
			ambient: 'dusk',
			// The road the party arrives on is already in view.
			arrival: { from: { x: 9, y: 23 }, to: { x: 16, y: 27 } }
		},
		now
	);
}
