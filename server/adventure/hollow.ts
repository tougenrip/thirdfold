// The last table of The Hollow Bell: the Hollow, a cavern under the monastery,
// far larger than anything above it. The stair from the ringing chamber comes
// down onto a landing at the south edge. Before it lies a black lake, and out
// in the lake, on an island walled by ancient stone, the Hollow Bell hangs in
// its frame among the gears and chains that once rang it, over a pit where
// something sleeps. Tobin stands beneath it with the rope in his hands.
//
// A long causeway runs from the landing across the water to the island's
// gate. West along the shore are the ruins of a chapel older than the
// monastery, and from them a narrow bridge climbs north to a ledge beside the
// island's wall, where a cleft opens only while the cultists' torch burns.
// East, terraces climb the cavern wall to the Steps and then the Watch, a high
// shelf of statues, and from the Watch a bridge comes down to the island's
// east arch. Beyond the island, north, is only the void.
//
// The grid runs x to the east and y to the south. Levels (elevation) are in
// steps of a fifth of a wall's height: the lake and the void are at 0, the
// shore at 3 (a drop nobody climbs out of), the island at 4, the Steps at 5
// and the Watch at 7.

import type { GridPos, SquareGrid } from '../../src/lib/game/grid';
import type { Prop } from '../../src/lib/game/props';
import type { SceneFile } from '../../src/lib/game/scene-file';
import { flatLevels, withLevel } from '../../src/lib/game/terrain';
import { npcTokens } from './npcs';
import { at, light, prop, table, wall, window, type Rise } from './tables';

export const HOLLOW_GRID: SquareGrid = { kind: 'square', cellSize: 1, width: 48, height: 36 };

export const HOLLOW_IDS = {
	bell: 'ho-bell',
	pit: 'ho-pit',
	bones: 'ho-bones',
	/** The cultists' torch on the west ledge; while it burns it shows the cleft. */
	torch: 'ho-torch',
	torchLight: 'ho-torch-light',
	/** A cleft in the island's west wall: a way in past the Keeper's gate, seen only by the torch. */
	cleft: 'ho-cleft',
	/** The Bell's rope, in Tobin's hands. */
	rope: 'ho-rope'
} as const;

/** Levels of the Hollow's ground. */
export const LEVELS = { lake: 0, shore: 3, island: 4, steps: 5, watch: 7 } as const;

/** An inclusive rectangle of cells. */
type Area = { from: GridPos; to: GridPos };
const area = (x1: number, y1: number, x2: number, y2: number): Area => ({
	from: { x: x1, y: y1 },
	to: { x: x2, y: y2 }
});

/** Where the stair from the ringing chamber comes down. */
export const LANDING = area(19, 30, 28, 35);
/** The ruined chapel on the west shore. */
export const RUINS = area(2, 22, 15, 33);
/** The lowest of the east terraces, on the shore. */
export const TERRACE = area(32, 24, 44, 33);
/** The middle terrace, up a stair from the shore. */
export const STEPS = area(38, 14, 45, 22);
/** The high shelf of statues at the top of the cavern wall. */
export const WATCH = area(40, 5, 46, 12);
/** The island in the lake: the great chamber of the Bell, inside its ancient wall. */
export const ISLAND = area(17, 5, 31, 18);
/** The causeway across the lake, from the landing to the island's gate. */
export const CAUSEWAY = area(23, 19, 24, 29);
/** The ledge by the island's west wall, where the cultists keep their torch. */
export const LEDGE = area(13, 11, 16, 15);

/** Where the Hollow Bell hangs in its frame (a 3×3 prop; this is its corner). */
export const BELL_AT: GridPos = { x: 23, y: 8 };
/** Where Tobin stands, beneath the Bell with its rope in his hands. */
export const TOBIN_AT: GridPos = { x: 24, y: 11 };
/** Beside Tobin, where a character stands to talk to him. */
export const BY_TOBIN: GridPos = { x: 23, y: 12 };
/** The pit where the sleeper lies. */
export const PIT_AT: GridPos = { x: 28, y: 6 };
/** At the pit's edge, where a character stands to look in. */
export const BESIDE_PIT: GridPos = { x: 28, y: 5 };
/** Where the Hollow's tendrils (and its Hand) come up: around the pit, nearest first. */
export const PIT_RING: readonly GridPos[] = [
	{ x: 27, y: 7 },
	{ x: 30, y: 7 },
	{ x: 28, y: 8 },
	{ x: 29, y: 8 },
	{ x: 27, y: 6 },
	{ x: 30, y: 6 },
	{ x: 27, y: 8 },
	{ x: 30, y: 8 },
	{ x: 26, y: 6 },
	{ x: 31, y: 7 }
];
/** The cultists' torch on the west ledge. */
export const TORCH_AT: GridPos = { x: 14, y: 11 };
/** The cleft's edge, in the island's west wall beside the ledge. */
export const CLEFT_EDGE = { a: { x: 17, y: 13 }, b: { x: 17, y: 14 } };

/** Where characters arrive: the foot of the stair, on the landing. */
export const HOLLOW_SPAWN: readonly GridPos[] = [
	{ x: 23, y: 33 },
	{ x: 24, y: 33 },
	{ x: 22, y: 33 },
	{ x: 25, y: 33 },
	{ x: 23, y: 34 },
	{ x: 24, y: 34 },
	{ x: 22, y: 34 },
	{ x: 25, y: 34 }
];

/** Where the Bell Keeper stands guard, beside Tobin and the Bell, watching the gate. */
export const KEEPER_POST: GridPos = { x: 26, y: 12 };

/** The rounds the two cultists walk with their lanterns: one through the ruins, one on the terrace. */
export const CULTIST_ROUNDS: readonly (readonly GridPos[])[] = [
	[
		{ x: 6, y: 26 },
		{ x: 12, y: 26 },
		{ x: 12, y: 30 },
		{ x: 6, y: 30 }
	],
	[
		{ x: 34, y: 26 },
		{ x: 42, y: 26 },
		{ x: 42, y: 31 },
		{ x: 34, y: 31 }
	]
];

/** The island, lit up for the fight. */
export const CAVERN = area(16, 4, 32, 19);

/** All the Hollow's ground: whatever is not listed is the lake, or the void. */
export const TERRAIN: readonly Rise[] = [
	{ ...LANDING, level: LEVELS.shore },
	// The shore, west to the ruins and east to the terraces.
	{ ...area(16, 28, 18, 33), level: LEVELS.shore },
	{ ...RUINS, level: LEVELS.shore },
	{ ...area(29, 30, 31, 33), level: LEVELS.shore },
	{ ...TERRACE, level: LEVELS.shore },
	// Up the cavern wall: a stair to the Steps, and another to the Watch.
	{ ...area(40, 23, 41, 23), level: LEVELS.shore + 1 },
	{ ...STEPS, level: LEVELS.steps },
	{ ...area(42, 13, 43, 13), level: LEVELS.steps + 1 },
	{ ...WATCH, level: LEVELS.watch },
	// The high bridge from the Watch down to the island's east arch.
	{ ...at(39, 9), level: LEVELS.watch - 1 },
	{ ...at(38, 9), level: LEVELS.watch - 2 },
	{ ...area(32, 9, 37, 9), level: LEVELS.island },
	{ ...ISLAND, level: LEVELS.island },
	// The causeway across the lake, a step below the island's gate.
	{ ...CAUSEWAY, level: LEVELS.shore },
	// North from the ruins, a narrow bridge to the ledge by the island's west wall.
	{ ...area(12, 14, 12, 21), level: LEVELS.shore },
	{ ...LEDGE, level: LEVELS.island }
];

/**
 * The lake's surface: black water over every cell of it, out into the void,
 * in the largest sheets that fit (4×4, then 2×2, then single cells).
 */
function lake(): Prop[] {
	const { width, height } = HOLLOW_GRID;
	let levels = flatLevels(HOLLOW_GRID);
	for (const r of TERRAIN) levels = withLevel(levels, HOLLOW_GRID, r.from, r.to, r.level) ?? levels;
	const covered = new Set<number>();
	const open = (x: number, y: number) =>
		x < width && y < height && levels[y * width + x] === LEVELS.lake && !covered.has(y * width + x);
	const sheets: Prop[] = [];
	for (const [size, asset] of [
		[4, 'water-lg'],
		[2, 'water'],
		[1, 'water-sm']
	] as const) {
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const cells: number[] = [];
				for (let dy = 0; dy < size; dy++)
					for (let dx = 0; dx < size; dx++)
						if (open(x + dx, y + dy)) cells.push((y + dy) * width + x + dx);
				if (cells.length !== size * size) continue;
				for (const c of cells) covered.add(c);
				sheets.push(prop(`ho-water-${x}-${y}`, asset, x, y));
			}
		}
	}
	return sheets;
}

export function hollowScene(now = new Date()): SceneFile {
	const I = HOLLOW_IDS;
	return table(
		{
			name: 'The Hollow',
			grid: HOLLOW_GRID,
			ambient: 'dark',
			arrival: LANDING,
			tokens: npcTokens('hollow'),
			terrain: TERRAIN,
			objects: [
				// The island's ancient wall. The gate faces the causeway, an arch the high bridge.
				wall('ho-wall-n', { x: 17, y: 5 }, { x: 32, y: 5 }),
				wall('ho-wall-sw', { x: 17, y: 19 }, { x: 19, y: 19 }),
				window('ho-arches-sw', { x: 19, y: 19 }, { x: 22, y: 19 }),
				wall('ho-wall-gate-w', { x: 22, y: 19 }, { x: 23, y: 19 }),
				wall('ho-wall-gate-e', { x: 25, y: 19 }, { x: 27, y: 19 }),
				window('ho-arches-se', { x: 27, y: 19 }, { x: 30, y: 19 }),
				wall('ho-wall-se', { x: 30, y: 19 }, { x: 32, y: 19 }),
				wall('ho-wall-w', { x: 17, y: 5 }, { x: 17, y: 13 }),
				{ id: I.cleft, kind: 'door', a: { ...CLEFT_EDGE.a }, b: { ...CLEFT_EDGE.b }, open: true },
				wall('ho-wall-w2', { x: 17, y: 14 }, { x: 17, y: 19 }),
				wall('ho-wall-e', { x: 32, y: 5 }, { x: 32, y: 9 }),
				wall('ho-wall-e2', { x: 32, y: 10 }, { x: 32, y: 19 }),
				// The ruined chapel: what is left of its walls.
				wall('ho-ruin-n', { x: 4, y: 23 }, { x: 8, y: 23 }),
				wall('ho-ruin-n2', { x: 11, y: 23 }, { x: 14, y: 23 }),
				wall('ho-ruin-w', { x: 4, y: 23 }, { x: 4, y: 27 }),
				window('ho-ruin-w2', { x: 4, y: 29 }, { x: 4, y: 32 }),
				wall('ho-ruin-e', { x: 14, y: 25 }, { x: 14, y: 28 }),
				// The statues' gallery on the Watch.
				window('ho-watch-rail', { x: 40, y: 13 }, { x: 42, y: 13 }),
				wall('ho-watch-back', { x: 47, y: 5 }, { x: 47, y: 13 })
			],
			props: [
				// The Bell in its frame, the gears and chains that rang it, and the pit.
				prop(I.bell, 'great-bell', BELL_AT.x, BELL_AT.y),
				prop('ho-gear-w', 'gear', 19, 7),
				prop('ho-gear-e', 'gear', 28, 9),
				prop('ho-chains-w', 'chains', 22, 7),
				prop('ho-chains-e', 'chains', 26, 7),
				prop(I.pit, 'well', PIT_AT.x, PIT_AT.y),
				prop(I.rope, 'rope', TOBIN_AT.x, TOBIN_AT.y),
				prop('ho-pillar-1', 'pillar', 19, 11),
				prop('ho-pillar-2', 'pillar', 29, 13),
				prop('ho-pillar-3', 'pillar', 19, 16),
				prop('ho-pillar-4', 'pillar', 29, 16),
				prop('ho-statue-1', 'statue', 18, 6),
				prop('ho-statue-2', 'statue', 30, 17),
				prop('ho-ashes', 'ashes', 21, 15),
				// The ruins of the chapel.
				prop(I.bones, 'rubble', 7, 24),
				prop('ho-ruin-altar', 'altar', 8, 31),
				prop('ho-ruin-pillar-1', 'pillar', 6, 25),
				prop('ho-ruin-pillar-2', 'pillar', 12, 25),
				prop('ho-ruin-pillar-3', 'pillar', 5, 28),
				prop('ho-ruin-statue', 'statue', 9, 28),
				prop('ho-ruin-rubble-1', 'rubble', 10, 24),
				prop('ho-ruin-rubble-2', 'rubble', 13, 32),
				prop('ho-ruin-rubble-3', 'rubble', 3, 30),
				prop('ho-ruin-grave', 'gravestone', 11, 32),
				// The terraces and the Watch: statues looking down on the island.
				prop('ho-terrace-gear', 'gear', 36, 28),
				prop('ho-terrace-rubble', 'rubble', 33, 25),
				prop('ho-steps-statue', 'statue', 44, 16),
				prop('ho-watch-statue-1', 'statue', 41, 6),
				prop('ho-watch-statue-2', 'statue', 43, 6),
				prop('ho-watch-statue-3', 'statue', 45, 6),
				prop('ho-watch-pillar', 'pillar', 45, 10),
				// The landing, and the cultists' ledge.
				prop('ho-stair', 'stairs', 24, 35),
				prop('ho-landing-rubble', 'rubble', 27, 31),
				prop('ho-ledge-ashes', 'ashes', 15, 14),
				prop(I.torch, 'sconce', TORCH_AT.x, TORCH_AT.y),
				...lake()
			],
			lights: [
				light('ho-bell-glow', 24, 9, 6, '#7fb6ff'),
				light('ho-pit-glow', PIT_AT.x, PIT_AT.y, 3, '#9c6cff'),
				light('ho-stair-light', 24, 35, 1, '#ffd27a'),
				light(I.torchLight, TORCH_AT.x, TORCH_AT.y, 3, '#ffa04d'),
				// Something in the water glows, here and there.
				light('ho-lake-glow-1', 19, 25, 2, '#3fb6c4'),
				light('ho-lake-glow-2', 30, 22, 2, '#3fb6c4'),
				light('ho-lake-glow-3', 28, 27, 2, '#3fb6c4'),
				// The statues on the Watch have eyes that shine.
				light('ho-watch-glow', 43, 7, 3, '#8f7bff'),
				// A fire someone left burning in the ruins.
				light('ho-ruin-fire', 9, 30, 2, '#ffa04d')
			]
		},
		now
	);
}
