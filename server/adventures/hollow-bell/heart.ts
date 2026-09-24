// The last place in The Hollow Bell, reached only by choosing the Descent: the
// heart of the Hollow, far below the pit. A chamber of living stone, ribbed
// like the inside of something that breathes, with the Heart itself, a vast
// dark knot of flesh and iron, beating on a dais at its far end. The party
// climbs down a root-stair at the south edge.
//
// The grid runs x to the east and y to the south.

import type { GridPos, SquareGrid } from '../../../src/lib/game/grid';
import type { SceneFile } from '../../../src/lib/game/scene-file';
import { light, prop, table, wall } from '../../adventure/tables';

export const HEART_GRID: SquareGrid = { kind: 'square', cellSize: 1, width: 16, height: 14 };

export const HEART_IDS = {
	heart: 'hh-heart',
	heartLight: 'hh-heart-light'
} as const;

/** Where the Heart beats (a 3×3 prop; this is its corner), on its dais. */
export const HEART_AT: GridPos = { x: 6, y: 2 };
/** The dais the Heart stands on, a step above the floor. */
export const DAIS = { from: { x: 4, y: 1 }, to: { x: 11, y: 6 } };

/** Where characters arrive: the foot of the root-stair. */
export const HEART_SPAWN: readonly GridPos[] = [
	{ x: 7, y: 11 },
	{ x: 8, y: 11 },
	{ x: 6, y: 11 },
	{ x: 9, y: 11 },
	{ x: 7, y: 12 },
	{ x: 8, y: 12 },
	{ x: 6, y: 12 },
	{ x: 9, y: 12 }
];

/** Where the Heart's tendrils come up: around the dais, nearest the party first. */
export const HEART_RING: readonly GridPos[] = [
	{ x: 7, y: 5 },
	{ x: 5, y: 6 },
	{ x: 10, y: 6 },
	{ x: 7, y: 6 },
	{ x: 4, y: 4 },
	{ x: 11, y: 4 },
	{ x: 8, y: 6 }
];

export function heartScene(now = new Date()): SceneFile {
	const I = HEART_IDS;
	return table(
		{
			name: 'The Heart of the Hollow',
			grid: HEART_GRID,
			ambient: 'dark',
			environment: 'living-cave',
			arrival: { from: { x: 4, y: 9 }, to: { x: 11, y: 13 } },
			tokens: [],
			terrain: [{ ...DAIS, level: 1 }],
			objects: [
				// The chamber's walls of living stone, pinched in at the corners.
				wall('hh-wall-n', { x: 2, y: 0 }, { x: 14, y: 0 }),
				wall('hh-wall-w', { x: 1, y: 1 }, { x: 1, y: 13 }),
				wall('hh-wall-e', { x: 15, y: 1 }, { x: 15, y: 13 }),
				wall('hh-wall-nw', { x: 1, y: 1 }, { x: 2, y: 1 }),
				wall('hh-wall-ne', { x: 14, y: 1 }, { x: 15, y: 1 })
			],
			props: [
				prop(I.heart, 'heart', HEART_AT.x, HEART_AT.y),
				// Ribs of stone curving up into the dark.
				prop('hh-rib-1', 'pillar', 2, 3),
				prop('hh-rib-2', 'pillar', 13, 3),
				prop('hh-rib-3', 'pillar', 2, 7),
				prop('hh-rib-4', 'pillar', 13, 7),
				prop('hh-rib-5', 'pillar', 3, 10),
				prop('hh-rib-6', 'pillar', 12, 10),
				// What the Hollow took, down the years.
				prop('hh-bones-1', 'rubble', 4, 8),
				prop('hh-bones-2', 'ashes', 11, 8),
				prop('hh-bell-shard', 'rubble', 10, 11),
				prop('hh-stair', 'stairs', 7, 13)
			],
			lights: [
				light(I.heartLight, HEART_AT.x + 1, HEART_AT.y + 1, 5, '#c0392b'),
				light('hh-stair-light', 7, 13, 1, '#7fb6ff')
			]
		},
		now
	);
}
