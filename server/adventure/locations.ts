// The tables The Hollow Bell is played on, and the places on them that move
// the story along when a character walks in.

import type { LocationId } from '../../src/lib/adventure/adventure';
import type { GridPos } from '../../src/lib/game/grid';
import type { SceneFile } from '../../src/lib/game/scene-file';
import { bellweatherScene, EXIT, SPAWN } from './bellweather';
import { HOLLOW_SPAWN, hollowScene } from './hollow';
import { CHAMBER, MONASTERY_SPAWN, monasteryScene, NAVE, STAIR } from './monastery';
import type { Area } from './story';

export interface LocationDef {
	name: string;
	scene(): SceneFile;
	/** Where characters appear, in order. */
	spawn: readonly GridPos[];
}

export const LOCATIONS: Record<LocationId, LocationDef> = {
	bellweather: { name: 'Bellweather', scene: bellweatherScene, spawn: SPAWN },
	monastery: { name: 'The Monastery', scene: monasteryScene, spawn: MONASTERY_SPAWN },
	hollow: { name: 'The Hollow', scene: hollowScene, spawn: HOLLOW_SPAWN }
};

const exitFrom = EXIT.reduce((a, c) => ({ x: Math.min(a.x, c.x), y: Math.min(a.y, c.y) }));
const exitTo = EXIT.reduce((a, c) => ({ x: Math.max(a.x, c.x), y: Math.max(a.y, c.y) }));

export const AREAS: readonly Area[] = [
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

/** The area `pos` starts an event in, while the story waits for it there. */
export function areaAt(
	location: LocationId,
	chapter: string,
	events: readonly string[],
	pos: GridPos
): Area | undefined {
	return AREAS.find(
		(a) =>
			a.location === location &&
			a.during === chapter &&
			(!a.after || events.includes(a.after)) &&
			pos.x >= a.from.x &&
			pos.x <= a.to.x &&
			pos.y >= a.from.y &&
			pos.y <= a.to.y
	);
}
