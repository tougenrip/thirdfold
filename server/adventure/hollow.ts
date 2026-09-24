// The last table of The Hollow Bell: the Hollow, a cavern under the
// monastery. The stair from the ringing chamber comes down at the south edge.
// To the north, the Hollow Bell hangs from the rock over a pit, and Tobin
// stands beneath it with the rope in his hands.
//
// The grid runs x to the east and y to the south.

import type { GridPos, SquareGrid } from '../../src/lib/game/grid';
import type { SceneFile } from '../../src/lib/game/scene-file';
import { npcTokens } from './npcs';
import { light, prop, table, wall } from './tables';

export const HOLLOW_GRID: SquareGrid = { kind: 'square', cellSize: 1, width: 20, height: 16 };

export const HOLLOW_IDS = {
	bell: 'ho-bell',
	pit: 'ho-pit',
	bones: 'ho-bones',
	/** The cultists' torch in the east alcove; while it burns it shows the cleft. */
	torch: 'ho-torch',
	torchLight: 'ho-torch-light',
	/** A cleft in the rock north of the alcove: a way round to the pit, seen only by the torch. */
	cleft: 'ho-cleft'
} as const;

/** The torch in the east alcove. */
export const TORCH_AT: GridPos = { x: 18, y: 8 };
/** The cleft's edge, in the rock between the alcove and the pit. */
export const CLEFT_EDGE = { a: { x: 17, y: 5 }, b: { x: 18, y: 5 } };

/** Where characters arrive: the foot of the stair. */
export const HOLLOW_SPAWN: readonly GridPos[] = [
	{ x: 9, y: 14 },
	{ x: 10, y: 14 },
	{ x: 8, y: 14 },
	{ x: 11, y: 14 },
	{ x: 9, y: 15 },
	{ x: 10, y: 15 },
	{ x: 8, y: 15 },
	{ x: 11, y: 15 }
];

/** Where the Bell Keeper stands guard, beside Tobin and the Bell. */
export const KEEPER_POST: GridPos = { x: 10, y: 5 };

/** The rounds the two cultists walk with their lanterns, across the cavern floor. */
export const CULTIST_ROUNDS: readonly (readonly GridPos[])[] = [
	[
		{ x: 6, y: 7 },
		{ x: 6, y: 11 },
		{ x: 9, y: 11 },
		{ x: 9, y: 7 }
	],
	[
		{ x: 14, y: 7 },
		{ x: 14, y: 11 },
		{ x: 11, y: 11 },
		{ x: 11, y: 8 }
	]
];

/** The cavern floor, lit up for the fight. */
export const CAVERN = { from: { x: 4, y: 1 }, to: { x: 15, y: 15 } };

export function hollowScene(now = new Date()): SceneFile {
	const I = HOLLOW_IDS;
	return table(
		{
			name: 'The Hollow',
			grid: HOLLOW_GRID,
			ambient: 'dark',
			arrival: { from: { x: 6, y: 11 }, to: { x: 13, y: 15 } },
			tokens: npcTokens('hollow'),
			objects: [
				// Ribs of rock narrowing the cave.
				wall('ho-rock1', { x: 0, y: 4 }, { x: 4, y: 4 }),
				wall('ho-rock2', { x: 16, y: 5 }, { x: 17, y: 5 }),
				{ id: I.cleft, kind: 'door', a: { ...CLEFT_EDGE.a }, b: { ...CLEFT_EDGE.b }, open: true },
				wall('ho-rock2b', { x: 18, y: 5 }, { x: 20, y: 5 }),
				wall('ho-rock3', { x: 0, y: 11 }, { x: 4, y: 11 }),
				wall('ho-rock4', { x: 16, y: 11 }, { x: 20, y: 11 }),
				wall('ho-rock5', { x: 5, y: 8 }, { x: 5, y: 11 }),
				wall('ho-rock6', { x: 15, y: 8 }, { x: 15, y: 11 })
			],
			props: [
				prop(I.bell, 'bell', 9, 2),
				prop(I.pit, 'well', 13, 2),
				prop(I.bones, 'rubble', 4, 7),
				prop('ho-bones2', 'ashes', 16, 8),
				prop('ho-stair', 'stairs', 12, 15),
				prop('ho-rock-a', 'pillar', 3, 13),
				prop('ho-rock-b', 'pillar', 16, 13),
				prop('ho-rock-c', 'pillar', 7, 6),
				prop('ho-rock-d', 'pillar', 12, 7),
				prop('ho-rock-e', 'pillar', 1, 1),
				prop('ho-rock-f', 'pillar', 18, 2),
				prop(I.torch, 'sconce', TORCH_AT.x, TORCH_AT.y)
			],
			lights: [
				light('ho-bell-glow', 10, 3, 5, '#7fb6ff'),
				light('ho-pit-glow', 14, 3, 3, '#9c6cff'),
				light('ho-stair-light', 12, 15, 1, '#ffd27a'),
				light(I.torchLight, TORCH_AT.x, TORCH_AT.y, 3, '#ffa04d')
			]
		},
		now
	);
}
