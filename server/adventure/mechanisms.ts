// Mechanisms: chains of physical changes set off by one interaction, played
// out on the server step by step. Pulling the ringing chamber's lever swings
// the lever down, runs the chain up through the wall, and then lifts the
// grate over the stair, which moves the story on. Each step can put a world
// object in a new state (its look follows, so every client sees it through
// the ordinary view sync), show a motion and a sound on a prop, say a line,
// and raise a story event. The steps are data; engine.ts runs them, and the
// game server waits between them, so every client sees the same chain at
// the same pace.

import type { LocationId, ObjectState } from '../../src/lib/adventure/adventure';
import type { MotionKind, Sound } from '../../src/lib/game/motion';
import { TEXT } from './content';
import { MONASTERY_IDS } from './monastery';
import type { EventId } from './story';

export interface Step {
	/** Ms after the previous step; the first step runs as the mechanism is set off. */
	after: number;
	/** A world object put in a new state. */
	set?: { object: string; state: ObjectState };
	/** What a prop (by prop id) does, and the sound it makes. */
	motion?: { prop: string; kind: MotionKind | null; sound: Sound | null };
	/** Said to the table. */
	text?: string;
	/** A story event it raises. */
	event?: EventId;
}

export type MechanismId = 'grate';

export interface Mechanism {
	id: MechanismId;
	/** Where it is: a mechanism stops if the party leaves the table. */
	location: LocationId;
	steps: readonly Step[];
}

export const MECHANISMS: Record<MechanismId, Mechanism> = {
	grate: {
		id: 'grate',
		location: 'monastery',
		steps: [
			{
				after: 0,
				motion: { prop: MONASTERY_IDS.lever, kind: 'swing', sound: 'clank' },
				text: TEXT.leverPulled
			},
			{
				after: 900,
				motion: { prop: MONASTERY_IDS.chamberChains, kind: 'shake', sound: 'rattle' },
				text: TEXT.chainRuns
			},
			{
				after: 1100,
				set: { object: 'grate', state: 'opened' },
				motion: { prop: MONASTERY_IDS.grate, kind: 'shake', sound: 'grind' },
				text: TEXT.grateLifts,
				event: 'opened_grate'
			}
		]
	}
};

export const MECHANISM_IDS = Object.keys(MECHANISMS) as MechanismId[];

/** What each mechanism is set off by: `<object>:<verb>`. */
export const TRIGGERS: Readonly<Record<string, MechanismId>> = {
	'lever:pull': 'grate'
};
