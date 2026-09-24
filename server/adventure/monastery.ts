// The second table of The Hollow Bell, and thirdfold's showcase of height:
// the abandoned monastery on the mountain at night. The party comes up the
// path into the courtyard at the south edge and finds Brother Oswin in the
// gatehouse. The ringers' door is not at ground level: an outside stair
// climbs the east wall to a ledge, and the door opens onto the gallery, a
// balcony over the nave with a stair down into it. From the ledge a second
// stair climbs into the bell tower, to the belfry where the bell hangs on
// its chains, with open arches looking down on the courtyard. Behind the
// nave's west wall, sealed off, is the ringing chamber, with the grate over
// the stair down to the Hollow.
//
// The grid runs x to the east and y to the south. Levels (elevation) are in
// steps of a fifth of a wall's height: the gallery and ledge are at 5, the
// belfry at 10.

import type { GridPos, SquareGrid } from '../../src/lib/game/grid';
import type { SceneFile } from '../../src/lib/game/scene-file';
import { npcTokens } from './npcs';
import { at, door, light, prop, stair, table, wall, window, type Rise } from './tables';

export const MONASTERY_GRID: SquareGrid = { kind: 'square', cellSize: 1, width: 30, height: 20 };

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
	grate: 'mn-grate',
	ledgers: 'mn-ledgers',
	bell: 'mn-bell',
	lever: 'mn-lever',
	crate: 'mn-chamber-crate',
	chamberChains: 'mn-chamber-chains',
	handbell: 'mn-handbell',
	doorChains: 'mn-door-chains'
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

/** Inside the nave, gallery included. */
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

/** The lever that lifts the grate, by the ringing chamber's door. */
export const LEVER_AT: GridPos = { x: 7, y: 7 };

/** Levels of the monastery's raised places. */
export const LEVELS = { gallery: 5, ledge: 5, belfry: 10 } as const;

/** The gallery: a balcony along the nave's east end. */
export const GALLERY = { from: { x: 19, y: 2 }, to: { x: 21, y: 9 } };
/** The ledge outside the east wall, where the ringers' door is. */
export const LEDGE = { from: { x: 22, y: 2 }, to: { x: 23, y: 9 } };
/** The belfry at the top of the bell tower. */
export const BELFRY = { from: { x: 24, y: 3 }, to: { x: 28, y: 5 } };
/** Where the bell hangs. */
export const BELL_AT: GridPos = { x: 26, y: 4 };

/** All the monastery's raised ground: the gallery, the ledge, the tower, and the stairs between. */
export const TERRAIN: readonly Rise[] = [
	{ ...GALLERY, level: LEVELS.gallery },
	// Down from the gallery into the nave, along the south wall.
	...stair(0, [at(15, 9), at(16, 9), at(17, 9), at(18, 9)]),
	{ ...LEDGE, level: LEVELS.ledge },
	// Up the outside of the east wall from the courtyard, two cells wide.
	...stair(0, [
		{ from: { x: 22, y: 13 }, to: { x: 23, y: 13 } },
		{ from: { x: 22, y: 12 }, to: { x: 23, y: 12 } },
		{ from: { x: 22, y: 11 }, to: { x: 23, y: 11 } },
		{ from: { x: 22, y: 10 }, to: { x: 23, y: 10 } }
	]),
	// The tower: its stair climbs east from the ledge, then the belfry.
	...stair(LEVELS.ledge, [at(24, 2), at(25, 2), at(26, 2), at(27, 2), at(28, 2)]),
	{ ...BELFRY, level: LEVELS.belfry }
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
			terrain: TERRAIN,
			objects: [
				// The monastery: x 2-21, y 2-9, the great doors in the south wall.
				wall('mn-north', { x: 2, y: 2 }, { x: 22, y: 2 }),
				wall('mn-west', { x: 2, y: 2 }, { x: 2, y: 10 }),
				// The south wall, with windows onto the courtyard.
				wall('mn-south-w1', { x: 2, y: 10 }, { x: 5, y: 10 }),
				window('mn-window-s1', { x: 5, y: 10 }, { x: 6, y: 10 }),
				wall('mn-south-w2', { x: 6, y: 10 }, { x: 9, y: 10 }),
				window('mn-window-s2', { x: 9, y: 10 }, { x: 10, y: 10 }),
				wall('mn-south-w3', { x: 10, y: 10 }, { x: 13, y: 10 }),
				door(I.greatDoor, { x: 13, y: 10 }, { x: 14, y: 10 }),
				wall('mn-south-e1', { x: 14, y: 10 }, { x: 17, y: 10 }),
				window('mn-window-s3', { x: 17, y: 10 }, { x: 18, y: 10 }),
				wall('mn-south-e2', { x: 18, y: 10 }, { x: 22, y: 10 }),
				// The east wall, between the gallery and the ledge, with the ringers' door.
				wall('mn-east-1', { x: 22, y: 2 }, { x: 22, y: 3 }),
				window('mn-window-e1', { x: 22, y: 3 }, { x: 22, y: 4 }),
				wall('mn-east-2', { x: 22, y: 4 }, { x: 22, y: 6 }),
				door(I.sideDoor, { x: 22, y: 6 }, { x: 22, y: 7 }),
				wall('mn-east-3', { x: 22, y: 7 }, { x: 22, y: 8 }),
				window('mn-window-e2', { x: 22, y: 8 }, { x: 22, y: 9 }),
				wall('mn-east-4', { x: 22, y: 9 }, { x: 22, y: 10 }),
				// The gallery's railing: see down into the nave, don't fall into it.
				window('mn-railing', { x: 19, y: 2 }, { x: 19, y: 9 }),
				// The wall between the nave and the ringing chamber, sealed where the door is.
				wall('mn-inner-n', { x: 8, y: 2 }, { x: 8, y: 5 }),
				wall(`${I.secretDoor}-sealed`, SECRET_EDGE.a, SECRET_EDGE.b),
				wall('mn-inner-s', { x: 8, y: 6 }, { x: 8, y: 10 }),
				// The bell tower, x 24-28, y 2-5: its stair along the north side, walled off
				// from the belfry except at the top; the belfry open to the east and south.
				wall('mn-tower-n', { x: 24, y: 2 }, { x: 29, y: 2 }),
				wall('mn-tower-w', { x: 24, y: 3 }, { x: 24, y: 6 }),
				wall('mn-tower-mid', { x: 24, y: 3 }, { x: 28, y: 3 }),
				window('mn-arch-e', { x: 29, y: 2 }, { x: 29, y: 6 }),
				window('mn-arch-s', { x: 24, y: 6 }, { x: 29, y: 6 }),
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
				prop('mn-pillar3', 'pillar', 10, 9),
				// Chains barring the great doors from inside.
				prop(I.doorChains, 'chains', 13, 9),
				// The gallery: the brothers' ledgers.
				prop(I.ledgers, 'bookshelf', 20, 2),
				// The belfry: the bell on its chains, and a brazier long gone cold.
				prop(I.bell, 'belfry-bell', BELL_AT.x, BELL_AT.y),
				prop('mn-belfry-brazier', 'brazier', 28, 5),
				// The ringing chamber.
				prop(I.rope, 'rope', 4, 4),
				prop(I.grate, 'grate', STAIR.from.x, STAIR.from.y),
				prop(I.crate, 'crate', 6, 2),
				// The grate's chain runs up the wall and across to the lever by the door.
				prop(I.chamberChains, 'chains', 2, 3),
				prop(I.lever, 'lever', LEVER_AT.x, LEVER_AT.y),
				// The gatehouse.
				prop('mn-gh-bed', 'bed', 2, 16),
				prop('mn-gh-table', 'table', 3, 13),
				prop(I.handbell, 'handbell', 5, 13),
				// The courtyard and its graves.
				prop(I.grave, 'gravestone', 15, 13),
				prop('mn-grave2', 'gravestone', 17, 13),
				prop('mn-grave3', 'gravestone', 19, 13),
				prop('mn-grave4', 'gravestone', 15, 15),
				prop('mn-grave5', 'gravestone', 17, 15),
				prop('mn-grave6', 'gravestone', 19, 15),
				prop('mn-tree1', 'tree', 0, 19),
				prop('mn-tree2', 'tree', 23, 19),
				prop('mn-tree3', 'tree', 28, 14),
				prop('mn-tree4', 'tree', 8, 17),
				prop('mn-tree5', 'tree', 0, 11),
				prop('mn-tree6', 'tree', 27, 9),
				prop('mn-well', 'barrel', 9, 12)
			],
			lights: [
				light('mn-gh-lamp', 2, 14, 3, '#ffd27a'),
				light('mn-gate-lamp', 7, 16, 3, '#ffa04d'),
				light('mn-altar-candles', 14, 3, 4, '#ffe3a8'),
				// Someone lit a candle in the sealed chamber not long ago.
				light('mn-chamber-candle', 5, 3, 3, '#ffd27a'),
				light('mn-gallery-lamp', 20, 6, 3, '#ffd27a'),
				light('mn-ledge-lamp', 23, 9, 2, '#ffa04d'),
				// Moonlight through the belfry arches.
				light('mn-belfry-moon', 26, 5, 4, '#b8c8ff')
			]
		},
		now
	);
}
