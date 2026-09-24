// Cinematic moments: the camera shots a few lines of narration call for
// (presentation only, played by each client; see src/lib/tabletop/shots.ts).
// Few and short, so the game never turns into a string of cutscenes.

import type { Shot } from '../../../src/lib/game/chat';
import { MOUNTAIN_PATH } from './bellweather';
import { PIT_AT } from './hollow';
import { BELL_AT as TOWER_BELL, SECRET_EDGE } from './monastery';

export const SHOTS = {
	/** The first bell: the party arrives, and the eye goes up the mountain path to the monastery. */
	firstBell: { focus: MOUNTAIN_PATH, frame: 'wide' },
	/** The tower bell swings as the party enters the nave. */
	bellRing: { focus: TOWER_BELL, frame: 'close' },
	/** Saint Agna turns, and there is a door where there was wall. */
	hiddenDoor: { focus: SECRET_EDGE.a, frame: 'close' },
	/** The Hollow, all of it, in the Bell's light. */
	hollow: { focus: null, frame: 'table' },
	/** Tobin found: what he stands over, the pit. */
	pit: { focus: PIT_AT, frame: 'close' },
	/** The final encounter: the Hollow rising out of its pit. */
	waking: { focus: PIT_AT, frame: 'wide' }
} as const satisfies Record<string, Shot>;
