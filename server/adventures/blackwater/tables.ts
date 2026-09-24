// The Last Train to Blackwater's tables: the train (four cars end to end,
// the prairie outside off the map), the locomotive and its tender, and
// Blackwater, the ghost town at the end of the line. Built like any table,
// as scene files; the adventure file carries them.

import type { GridPos } from '../../../src/lib/game/grid';
import type { SceneObject } from '../../../src/lib/game/objects';
import type { Prop } from '../../../src/lib/game/props';
import type { FloorId } from '../../../src/lib/game/floor';
import { door, light, prop, table, wall, window, type Rise } from '../../adventure/tables';

const at = (x: number, y: number): GridPos => ({ x, y });
type Floor = { from: GridPos; to: GridPos; floor: FloorId };
const floor = (x1: number, y1: number, x2: number, y2: number, id: FloorId): Floor => ({
	from: at(x1, y1),
	to: at(x2, y2),
	floor: id
});

/**
 * A car's walls: its long sides as windows (or solid), and its ends with a
 * door in the middle row. `x1..x2` are its cells; rows 1-5 are inside.
 */
function car(
	name: string,
	x1: number,
	x2: number,
	doors: { rear: string | null; front: string | null },
	windows = true
): SceneObject[] {
	const side = windows ? window : wall;
	const end = (x: number, id: string | null, tag: string): SceneObject[] => [
		wall(`${name}-${tag}-a`, at(x, 1), at(x, 3)),
		...(id ? [door(id, at(x, 3), at(x, 4))] : [wall(`${name}-${tag}-mid`, at(x, 3), at(x, 4))]),
		wall(`${name}-${tag}-b`, at(x, 4), at(x, 6))
	];
	return [
		side(`${name}-north`, at(x1, 1), at(x2 + 1, 1)),
		side(`${name}-south`, at(x1, 6), at(x2 + 1, 6)),
		...end(x1, doors.rear, 'rear'),
		...end(x2 + 1, doors.front, 'front')
	];
}

// ---------------------------------------------------------------------------
// The train: from the rear, the baggage car, the sleeper, the dining car and
// the coach, joined by gangways. The engine is ahead of the coach.

export const TRAIN_IDS = {
	baggageDoor: 'bw-baggage-door',
	frontDoor: 'bw-front-door',
	berth: 'bw-berth-3',
	coffin: 'bw-coffin-3',
	strongbox: 'bw-strongbox',
	key: 'bw-key',
	ticket: 'bw-ticket',
	timetable: 'bw-timetable',
	stove: 'bw-stove',
	coachLamps: ['bw-lamp-coach-1', 'bw-lamp-coach-2'],
	diningLamp: 'bw-lamp-dining',
	sleeperLamp: 'bw-lamp-sleeper',
	baggageLamp: 'bw-lamp-baggage',
	stoveGlow: 'bw-stove-glow'
} as const;

export const TRAIN_SPAWN: GridPos[] = [at(63, 3), at(63, 4), at(62, 3), at(62, 4)];
/** The coach's front door: walk up to it at midnight to climb forward to the engine. */
export const FRONT = at(66, 3);
export const BAGGAGE = { from: at(1, 1), to: at(13, 5) };
export const COACH = { from: at(47, 1), to: at(66, 5) };

export function trainScene() {
	const pews: Prop[] = [48, 51, 54, 57].flatMap((x) => [
		prop(`bw-pew-${x}-n`, 'pew', x, 1),
		prop(`bw-pew-${x}-s`, 'pew', x, 5, 2)
	]);
	const tables: Prop[] = [31, 35, 39].flatMap((x) => [
		prop(`bw-table-${x}-n`, 'table', x, 1),
		prop(`bw-table-${x}-s`, 'table', x, 5)
	]);
	const beds: Prop[] = [16, 19, 22, 25].map((x) =>
		prop(x === 22 ? TRAIN_IDS.berth : `bw-bed-${x}`, 'bed', x, 1)
	);
	const berthWalls: SceneObject[] = [18, 21, 24, 27].map((x) =>
		wall(`bw-berth-wall-${x}`, at(x, 1), at(x, 3))
	);
	return table({
		name: 'The last train',
		grid: { kind: 'square', cellSize: 1, width: 68, height: 7 },
		environment: 'railcar',
		ambient: 'dusk',
		arrival: COACH,
		floors: [
			// Outside the cars, the prairie going by: nobody steps off a moving train.
			floor(0, 0, 67, 0, 'void'),
			floor(0, 6, 67, 6, 'void'),
			floor(0, 0, 0, 6, 'void'),
			floor(67, 0, 67, 6, 'void'),
			...[14, 29, 46].flatMap((x) => [floor(x, 1, x, 2, 'void'), floor(x, 4, x, 5, 'void')]),
			floor(1, 1, 13, 5, 'wood')
		],
		objects: [
			...car('baggage', 1, 13, { rear: null, front: TRAIN_IDS.baggageDoor }, false),
			...car('sleeper', 15, 28, { rear: 'bw-sleeper-rear', front: 'bw-sleeper-front' }),
			...car('dining', 30, 45, { rear: 'bw-dining-rear', front: 'bw-dining-front' }),
			...car('coach', 47, 66, { rear: 'bw-coach-rear', front: TRAIN_IDS.frontDoor }),
			...berthWalls
		],
		props: [
			prop('bw-coffin-1', 'coffin', 3, 1),
			prop('bw-coffin-2', 'coffin', 5, 1),
			prop(TRAIN_IDS.coffin, 'coffin', 7, 1),
			prop('bw-coffin-4', 'coffin', 3, 4),
			prop('bw-coffin-5', 'coffin', 5, 4),
			prop(TRAIN_IDS.strongbox, 'strongbox', 11, 1),
			prop('bw-crate-1', 'crate', 12, 5),
			prop('bw-crate-2', 'crate', 11, 5),
			prop('bw-barrel-1', 'barrel', 1, 5),
			...beds,
			...tables,
			prop(TRAIN_IDS.stove, 'stove', 44, 1),
			...pews,
			prop(TRAIN_IDS.timetable, 'noticeboard', 62, 1),
			prop(TRAIN_IDS.ticket, 'paper', 58, 3),
			prop(TRAIN_IDS.key, 'keys', 63, 2)
		],
		lights: [
			light(TRAIN_IDS.coachLamps[0], 52, 3, 5, '#ffcf7a'),
			light(TRAIN_IDS.coachLamps[1], 60, 3, 5, '#ffcf7a'),
			light(TRAIN_IDS.diningLamp, 38, 3, 5, '#ffcf7a'),
			light(TRAIN_IDS.sleeperLamp, 27, 3, 3, '#ffb347'),
			light(TRAIN_IDS.baggageLamp, 9, 3, 3, '#ffb347'),
			light(TRAIN_IDS.stoveGlow, 44, 2, 3, '#ff8c3a')
		],
		tokens: []
	});
}

// ---------------------------------------------------------------------------
// The engine: the tender heaped with coal, then the cab and its boiler.

export const ENGINE_IDS = {
	throttle: 'bw-throttle',
	brake: 'bw-brake',
	whistle: 'bw-whistle-cord',
	boiler: 'bw-boiler',
	firebox: 'bw-firebox'
} as const;

export const ENGINE_SPAWN: GridPos[] = [at(1, 4), at(1, 3), at(1, 5), at(2, 4)];
export const ENGINE_RING: GridPos[] = [at(18, 4), at(13, 2), at(13, 6), at(18, 6)];

export function engineScene() {
	const coal: Rise[] = [
		{ from: at(3, 2), to: at(6, 6), level: 1 },
		{ from: at(4, 3), to: at(5, 5), level: 2 }
	];
	return table({
		name: 'The locomotive',
		grid: { kind: 'square', cellSize: 1, width: 22, height: 9 },
		environment: 'railcar',
		ambient: 'dark',
		arrival: { from: at(0, 0), to: at(21, 8) },
		terrain: coal,
		floors: [
			floor(0, 0, 21, 0, 'void'),
			floor(0, 8, 21, 8, 'void'),
			floor(21, 0, 21, 8, 'void'),
			floor(0, 0, 0, 8, 'void'),
			floor(3, 2, 6, 6, 'dirt'),
			floor(10, 1, 20, 7, 'stone')
		],
		objects: [
			wall('bw-tender-north', at(1, 1), at(9, 1)),
			wall('bw-tender-south', at(1, 8), at(9, 8)),
			window('bw-cab-north', at(10, 1), at(21, 1)),
			window('bw-cab-south', at(10, 8), at(21, 8)),
			wall('bw-cab-front', at(21, 1), at(21, 8)),
			wall('bw-tender-rear-a', at(1, 1), at(1, 3)),
			door('bw-tender-door', at(1, 3), at(1, 4)),
			wall('bw-tender-rear-b', at(1, 4), at(1, 8))
		],
		props: [
			prop(ENGINE_IDS.boiler, 'boiler', 15, 4),
			prop(ENGINE_IDS.throttle, 'lever', 19, 3),
			prop(ENGINE_IDS.brake, 'lever', 19, 6),
			prop(ENGINE_IDS.whistle, 'rope', 18, 2),
			prop('bw-coal-1', 'rubble', 4, 3),
			prop('bw-coal-2', 'rubble', 5, 5)
		],
		lights: [light(ENGINE_IDS.firebox, 16, 6, 5, '#ff7a2a')],
		tokens: []
	});
}

// ---------------------------------------------------------------------------
// Blackwater: the station platform, the tracks running out onto what is left
// of the bridge, the river, the town, and its graves.

export const BLACKWATER_IDS = {
	grave: 'bw-grave-1861',
	sign: 'bw-town-sign'
} as const;

export const BLACKWATER_SPAWN: GridPos[] = [at(3, 3), at(4, 3), at(3, 4), at(4, 4)];
export const RIVER_RING: GridPos[] = [at(17, 8), at(16, 11), at(17, 3), at(16, 13)];

export function blackwaterScene() {
	const graves: Prop[] = [
		[10, 10],
		[12, 10],
		[14, 10],
		[10, 12],
		[14, 12]
	].map(([x, y]) => prop(`bw-grave-${x}-${y}`, 'gravestone', x, y));
	return table({
		name: 'Blackwater',
		grid: { kind: 'square', cellSize: 1, width: 26, height: 16 },
		environment: 'ghost-town',
		ambient: 'dark',
		arrival: { from: at(0, 0), to: at(25, 15) },
		floors: [
			floor(1, 2, 14, 4, 'wood'),
			floor(0, 5, 20, 6, 'stone'),
			floor(18, 0, 20, 15, 'water'),
			floor(17, 5, 20, 6, 'stone'),
			floor(21, 0, 25, 15, 'void'),
			floor(1, 8, 16, 14, 'dirt')
		],
		objects: [
			wall('bw-saloon-n', at(2, 9), at(8, 9)),
			wall('bw-saloon-w', at(2, 9), at(2, 14)),
			wall('bw-saloon-s', at(2, 14), at(8, 14)),
			wall('bw-saloon-e-a', at(8, 9), at(8, 11)),
			door('bw-saloon-door', at(8, 11), at(8, 12)),
			wall('bw-saloon-e-b', at(8, 12), at(8, 14))
		],
		props: [
			...graves,
			prop(BLACKWATER_IDS.grave, 'gravestone', 12, 12),
			prop(BLACKWATER_IDS.sign, 'noticeboard', 8, 3),
			prop('bw-water-tower', 'pillar', 15, 3),
			prop('bw-bench', 'pew', 5, 2),
			prop('bw-saloon-table', 'table', 4, 11),
			prop('bw-saloon-barrel', 'barrel', 3, 13)
		],
		lights: [
			light('bw-ghost-lamp-1', 4, 3, 4, '#9fd0ff'),
			light('bw-ghost-lamp-2', 12, 3, 4, '#9fd0ff'),
			light('bw-ghost-lamp-3', 11, 9, 4, '#9fd0ff')
		],
		tokens: []
	});
}
