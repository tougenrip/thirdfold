// The second table of The Hollow Bell: the abandoned monastery on the
// mountain at night. The party comes up the path into the courtyard at the
// south edge, finds Brother Oswin in the gatehouse, gets in by the ringers'
// door on the east side, and searches the nave. Behind the west wall of the
// nave, sealed off, is the ringing chamber, with the grate over the stair
// down to the Hollow.
//
// The grid runs x to the east and y to the south.

import type { GridPos, SquareGrid } from '../../src/lib/game/grid';
import type { SceneFile } from '../../src/lib/game/scene-file';
import { npcTokens } from './npcs';
import { door, light, prop, table, wall } from './tables';

export const MONASTERY_GRID: SquareGrid = { kind: 'square', cellSize: 1, width: 24, height: 20 };

export const MONASTERY_IDS = {
	gatehouseDoor: 'mn-gatehouse-door',
	greatDoor: 'mn-great-door',
	sideDoor: 'mn-side-door',
	/** The way into the ringing chamber; a plain wall (`sealed`) until it is found. */
	secretDoor: 'mn-secret-door',
	grave: 'mn-grave1',
	altar: 'mn-altar',
	agna: 'mn-agna',
	rope: 'mn-rope',
	grate: 'mn-grate'
} as const;

/** The edge of the secret door, in the wall between the nave and the ringing chamber. */
export const SECRET_EDGE = { a: { x: 8, y: 5 }, b: { x: 8, y: 6 } };

/** Where characters arrive: the top of the mountain path, at the south edge. */
export const MONASTERY_SPAWN: readonly GridPos[] = [
	{ x: 11, y: 18 },
	{ x: 12, y: 18 },
	{ x: 13, y: 18 },
	{ x: 14, y: 18 },
	{ x: 11, y: 19 },
	{ x: 12, y: 19 },
	{ x: 13, y: 19 },
	{ x: 14, y: 19 }
];

/** Inside the nave. */
export const NAVE = { from: { x: 8, y: 2 }, to: { x: 21, y: 9 } };
/** The ringing chamber behind the nave's west wall. */
export const CHAMBER = { from: { x: 2, y: 2 }, to: { x: 7, y: 9 } };
/** The grate over the stair down; it opens when the bell rings. */
export const STAIR = { from: { x: 3, y: 8 }, to: { x: 3, y: 8 } };
/** Where the bell's hounds come up: around the grate, nearest first. */
export const STAIR_RING: readonly GridPos[] = [
	{ x: 3, y: 7 },
	{ x: 4, y: 8 },
	{ x: 2, y: 8 },
	{ x: 4, y: 7 },
	{ x: 2, y: 7 },
	{ x: 3, y: 9 },
	{ x: 4, y: 9 }
];

export function monasteryScene(now = new Date()): SceneFile {
	const I = MONASTERY_IDS;
	return table(
		{
			name: 'The Monastery',
			grid: MONASTERY_GRID,
			ambient: 'dusk',
			arrival: { from: { x: 8, y: 14 }, to: { x: 16, y: 19 } },
			tokens: npcTokens('monastery'),
			objects: [
				// The monastery: x 2-21, y 2-9, the great doors in the south wall.
				wall('mn-north', { x: 2, y: 2 }, { x: 22, y: 2 }),
				wall('mn-west', { x: 2, y: 2 }, { x: 2, y: 10 }),
				wall('mn-south-w', { x: 2, y: 10 }, { x: 13, y: 10 }),
				door(I.greatDoor, { x: 13, y: 10 }, { x: 14, y: 10 }),
				wall('mn-south-e', { x: 14, y: 10 }, { x: 22, y: 10 }),
				// The ringers' door on the east side.
				wall('mn-east-n', { x: 22, y: 2 }, { x: 22, y: 6 }),
				door(I.sideDoor, { x: 22, y: 6 }, { x: 22, y: 7 }),
				wall('mn-east-s', { x: 22, y: 7 }, { x: 22, y: 10 }),
				// The wall between the nave and the ringing chamber, sealed where the door is.
				wall('mn-inner-n', { x: 8, y: 2 }, { x: 8, y: 5 }),
				wall(`${I.secretDoor}-sealed`, SECRET_EDGE.a, SECRET_EDGE.b),
				wall('mn-inner-s', { x: 8, y: 6 }, { x: 8, y: 10 }),
				// The gatehouse: x 1-5, y 13-17, its door on the east side.
				wall('mn-gh-n', { x: 1, y: 13 }, { x: 6, y: 13 }),
				wall('mn-gh-w', { x: 1, y: 13 }, { x: 1, y: 18 }),
				wall('mn-gh-s', { x: 1, y: 18 }, { x: 6, y: 18 }),
				wall('mn-gh-e1', { x: 6, y: 13 }, { x: 6, y: 15 }),
				door(I.gatehouseDoor, { x: 6, y: 15 }, { x: 6, y: 16 }),
				wall('mn-gh-e2', { x: 6, y: 16 }, { x: 6, y: 18 })
			],
			props: [
				// The nave.
				prop(I.altar, 'altar', 14, 2),
				prop(I.agna, 'statue', 8, 4),
				prop('mn-pew1', 'pew', 11, 4),
				prop('mn-pew2', 'pew', 14, 4),
				prop('mn-pew3', 'pew', 17, 4),
				prop('mn-pew4', 'pew', 11, 8),
				prop('mn-pew5', 'pew', 14, 8),
				prop('mn-pew6', 'pew', 17, 8),
				prop('mn-pillar1', 'pillar', 10, 3),
				prop('mn-pillar2', 'pillar', 20, 3),
				prop('mn-pillar3', 'pillar', 10, 9),
				prop('mn-pillar4', 'pillar', 20, 9),
				// The ringing chamber.
				prop(I.rope, 'rope', 4, 4),
				prop(I.grate, 'grate', STAIR.from.x, STAIR.from.y),
				prop('mn-chamber-crate', 'crate', 6, 2),
				// The gatehouse.
				prop('mn-gh-bed', 'bed', 2, 16),
				prop('mn-gh-table', 'table', 3, 13),
				// The courtyard and its graves.
				prop(I.grave, 'gravestone', 15, 13),
				prop('mn-grave2', 'gravestone', 17, 13),
				prop('mn-grave3', 'gravestone', 19, 13),
				prop('mn-grave4', 'gravestone', 15, 15),
				prop('mn-grave5', 'gravestone', 17, 15),
				prop('mn-grave6', 'gravestone', 19, 15),
				prop('mn-tree1', 'tree', 0, 19),
				prop('mn-tree2', 'tree', 23, 19),
				prop('mn-tree3', 'tree', 23, 12),
				prop('mn-tree4', 'tree', 8, 17),
				prop('mn-tree5', 'tree', 0, 11),
				prop('mn-well', 'barrel', 9, 12)
			],
			lights: [
				light('mn-gh-lamp', 2, 14, 3, '#ffd27a'),
				light('mn-gate-lamp', 7, 16, 3, '#ffa04d'),
				light('mn-altar-candles', 14, 3, 4, '#ffe3a8'),
				// Someone lit a candle in the sealed chamber not long ago.
				light('mn-chamber-candle', 5, 3, 3, '#ffd27a')
			]
		},
		now
	);
}
