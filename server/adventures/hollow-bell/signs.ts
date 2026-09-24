// Signs: evidence that isn't a thing to pick up but part of a place, found by
// listening or looking around nearby (Listen and Observe), each behind a
// check. A character may try each sign once; someone else can try again.

import type { SignDef } from '../../adventure/define';
import { PIT_AT } from './hollow';

export const SIGNS: readonly SignDef[] = [
	// Bellweather
	{
		id: 'well-hum',
		location: 'bellweather',
		sense: 'listen',
		at: { x: 11, y: 13 },
		range: 2,
		check: { stat: 'wits', dc: 8 },
		clue: 'hum'
	},
	{
		id: 'gate-prints',
		location: 'bellweather',
		sense: 'observe',
		at: { x: 11, y: 6 },
		range: 2,
		check: { stat: 'wits', dc: 12 },
		clue: 'footprints'
	},
	{
		id: 'shrine-wax',
		location: 'bellweather',
		sense: 'observe',
		at: { x: 8, y: 16 },
		range: 2,
		check: { stat: 'wits', dc: 9 },
		clue: 'vigil'
	},
	// The monastery
	{
		id: 'nave-prints',
		location: 'monastery',
		sense: 'observe',
		at: { x: 9, y: 5 },
		range: 5,
		check: { stat: 'wits', dc: 8 },
		clue: 'prints'
	},
	{
		id: 'hollow-wall',
		location: 'monastery',
		sense: 'listen',
		at: { x: 8, y: 5 },
		range: 1,
		check: { stat: 'wits', dc: 11 },
		clue: 'hollow-wall'
	},
	{
		id: 'grate-breath',
		location: 'monastery',
		sense: 'listen',
		at: { x: 3, y: 8 },
		range: 2,
		check: { stat: 'wits', dc: 6 },
		clue: 'breath'
	},
	// The Hollow
	{
		id: 'pit-eye',
		location: 'hollow',
		sense: 'observe',
		at: PIT_AT,
		range: 4,
		check: { stat: 'spirit', dc: 12 },
		clue: 'sleeper'
	}
];
