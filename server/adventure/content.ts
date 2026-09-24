// The words of The Hollow Bell, part one. Server-side only, so what the party
// hasn't discovered yet never reaches a client: dialogue, clues and narration
// go out as log entries and adventure state once they happen.

import type { AdventureStage, Clue, Objective } from '../../src/lib/adventure/adventure';
import type { Attack } from '../../src/lib/adventure/characters';

export const TITLE = 'The Hollow Bell';
export const SECTION = 'Part One: Bellweather';

export const CLUES = {
	notice: {
		id: 'notice',
		title: 'A missing boy',
		text: 'MISSING: Tobin Hale, twelve, apprentice to the old bell-ringer. Last seen by the well in the square at dusk.'
	},
	rope: {
		id: 'rope',
		title: 'A cut bell rope',
		text: "In the Hale house chest: a length of bell rope, cut clean through, and a boy's glove stitched with the name TOBIN."
	},
	register: {
		id: 'register',
		title: 'The last bell-ringer',
		text: 'The parish register lists every bell-ringer of the monastery. The last entry, forty years old, is not a name but a line: “We have stopped the Bell. May no one ring it again.”'
	},
	drawing: {
		id: 'drawing',
		title: "Tobin's drawing",
		text: 'Hidden under the floorboard: a child’s drawing of the monastery tower, a bell inside it, and beneath the tower a huge dark shape with far too many eyes.'
	},
	clapper: {
		id: 'clapper',
		title: 'A bell clapper in the ashes',
		text: 'In the Hound’s ashes lies a small iron clapper, like one from a hand bell, still warm. It hums when you hold it.'
	},
	scratches: {
		id: 'scratches',
		title: 'Scratches in the well',
		text: 'Deep claw marks run up the inside of the well, as if something climbed out. Pressed into the stone lip: the shape of a bell.'
	}
} satisfies Record<string, Clue>;

export type ClueId = keyof typeof CLUES;

/** Stages in story order, for deciding which objectives are done. */
const ORDER: AdventureStage[] = ['choosing', 'arrival', 'investigate', 'encounter', 'aftermath'];

const OBJECTIVES: { id: string; text: string; from: AdventureStage }[] = [
	{ id: 'innkeeper', text: 'Find the innkeeper at the Tolling Rest', from: 'arrival' },
	{ id: 'well', text: 'Examine the old well in the square', from: 'investigate' },
	{ id: 'hound', text: 'Drive off what climbed out of the well', from: 'encounter' },
	{ id: 'path', text: 'Take the mountain path north toward the monastery', from: 'aftermath' }
];

/** The objectives the party knows of at a stage: earlier ones done, the current one open. */
export function objectivesFor(stage: AdventureStage): Objective[] {
	if (stage === 'choosing') return [{ id: 'choose', text: 'Choose your characters', done: false }];
	if (stage === 'complete') return OBJECTIVES.map((o) => ({ id: o.id, text: o.text, done: true }));
	// A defeat happens in the encounter; show where the party fell.
	const at = ORDER.indexOf(stage === 'defeat' ? 'encounter' : stage);
	return OBJECTIVES.filter((o) => ORDER.indexOf(o.from) <= at).map((o) => ({
		id: o.id,
		text: o.text,
		done: ORDER.indexOf(o.from) < at
	}));
}

export const HOUND = {
	name: 'Hollow Hound',
	color: '#c9d1d6',
	armor: 1,
	speed: 6,
	vision: 8,
	attack: { name: 'Bite', range: 1, toHit: 4, damage: '1d6+2' } satisfies Attack,
	/** Tougher with a bigger party. */
	hpFor: (characters: number) => 10 + 6 * Math.max(1, characters)
};

/** Narration, spoken lines and prepared read-aloud text. */
export const TEXT = {
	started: `${TITLE} · ${SECTION}. Choose your characters.`,
	arrival:
		'Dusk settles over Bellweather. The valley road brings you into the village square, where the lamps are already lit and every shutter is closed. High on the mountain, the old monastery is a black shape against the last of the light. An hour ago its bell rang, for the first time in forty years.',
	marenArrival:
		"You came up the valley road? Then you heard it too. The monastery bell rang at sundown, and nobody has rung it since the brothers left. And the Hale boy, Tobin… he went to the old well at dusk and hasn't come back. Please. Look at the well.",
	marenInvestigate: "The well's in the middle of the square, past the lamps. Mind yourselves.",
	marenAftermath:
		"You've seen it now. Whatever woke down there, the bell called it. I've cut the chain on the gate. The mountain path is open, if you mean to go up.",
	marenComplete: 'Go carefully. Bring the boy home if you can.',
	wellEarly:
		'An old stone well. A cold draught breathes up from the shaft, carrying a faint metallic hum. Someone in the village might know its story.',
	wellClue:
		'You lean over the stone lip. Claw marks score the inside of the shaft, and something has pressed the shape of a bell into the stone. Then, far below, a sound like a cracked bell, rising.',
	houndEmerges:
		'Something pale and long-limbed drags itself over the lip of the well: a Hollow Hound, its ribs ringing faintly as it breathes. It turns toward the nearest light.',
	houndFalls:
		'The Hollow Hound collapses into grey ash that chimes as it settles. Somewhere up the mountain, the bell answers, once.',
	gateOpens:
		'Maren hurries out of the inn with a pair of shears. The chain on the north gate falls away, and the path up the mountain lies open.',
	gateLocked: 'The gate is chained shut.',
	notNow: "There's no time for that. The Hound is here.",
	complete:
		'The lamps of Bellweather fall away behind you as the path climbs into the dark. Above, the monastery waits, and the bell is silent. For now. — End of Part One.',
	defeat:
		'The last of you falls. The Hound drags the lamplight down with it, and Bellweather is quiet again. The GM can start the section over.',
	revive: 'Those who fell struggle back to their feet, bruised but alive.',
	chestOpen: 'The lid creaks up. Folded blankets, a boy’s spare boots, and something underneath.',
	chestEmpty: 'Nothing else in the chest but blankets.',
	table:
		'Half-drunk mugs, a dropped pipe, a game of dice abandoned mid-throw. Everyone left in a hurry when the bell rang.',
	tableAgain: 'The dice still show two ones.',
	shrine:
		'A weathered saint holds a bell to her chest. Fresh wax pools at her feet; someone has been praying here every night.',
	rug: 'The rug slides aside. One floorboard beneath it sits a little proud of the others.',
	hatchEmpty: 'The gap under the floorboard is empty now.',
	crate: 'The old crate splinters apart. Inside: straw and a dozen candles, all unlit.',
	brazierLit:
		'The brazier catches, and warm light spills across the gate and the first stretch of path.',
	brazierOut: 'The brazier gutters out.',
	remainsEmpty: 'Only ash now.'
};

export const CUES = [
	{
		id: 'village',
		title: 'The quiet village',
		text: 'No dogs bark. No children call. Behind the shutters, candles gutter, and more than one face watches you pass from the dark behind the glass.'
	},
	{
		id: 'bell',
		title: 'The bell hums',
		text: 'For a moment you feel it more than hear it: a low hum in your teeth, as if the bell far above were still ringing, too deep for ears.'
	},
	{
		id: 'hale-house',
		title: 'The Hale house',
		text: "The Hale house is unlocked. Inside, supper sits cold on the table, and a boy's coat still hangs by the door."
	}
] as const;
