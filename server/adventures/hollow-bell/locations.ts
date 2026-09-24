// The tables The Hollow Bell is played on, and the places on them that move
// the story along when a character walks in.

import type { AreaDef, LocationDef } from '../../adventure/define';
import { bellweatherScene, EXIT, SPAWN } from './bellweather';
import { HEART_SPAWN, heartScene } from './heart';
import { HOLLOW_SPAWN, hollowScene } from './hollow';
import { CHAMBER, MONASTERY_SPAWN, monasteryScene, NAVE, STAIR } from './monastery';
import { TEXT } from './content';
import type { LocationId } from './story';

export const LOCATIONS: Record<LocationId, LocationDef> = {
	bellweather: {
		name: 'Bellweather',
		scene: bellweatherScene,
		spawn: SPAWN,
		welcome: TEXT.arrival
	},
	monastery: {
		name: 'The Monastery',
		scene: monasteryScene,
		spawn: MONASTERY_SPAWN,
		welcome: TEXT.leaveVillage
	},
	hollow: { name: 'The Hollow', scene: hollowScene, spawn: HOLLOW_SPAWN, welcome: TEXT.hollow },
	heart: {
		name: 'The Heart of the Hollow',
		scene: heartScene,
		spawn: HEART_SPAWN,
		welcome: TEXT.chooseDescent
	}
};

const exitFrom = EXIT.reduce((a, c) => ({ x: Math.min(a.x, c.x), y: Math.min(a.y, c.y) }));
const exitTo = EXIT.reduce((a, c) => ({ x: Math.max(a.x, c.x), y: Math.max(a.y, c.y) }));

export const AREAS: readonly AreaDef[] = [
	{
		event: 'left_village',
		during: 'discover_bell',
		location: 'bellweather',
		from: exitFrom,
		to: exitTo
	},
	{ event: 'entered_nave', during: 'investigate_monastery', location: 'monastery', ...NAVE },
	{
		event: 'entered_chamber',
		during: 'discover_hidden_chamber',
		location: 'monastery',
		...CHAMBER
	},
	{
		event: 'reached_stair',
		during: 'descend',
		location: 'monastery',
		after: 'opened_grate',
		...STAIR
	}
];
