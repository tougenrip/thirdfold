// The Hollow Bell as a state machine: its chapters in order, the story event
// that moves the party from each chapter to the next, what the party is
// trying to do in each (objectives), and the places, people, choices, fights
// and endings the story keeps track of. Plain data; engine.ts carries out
// what each event does to the table.
//
// Events happen through play: talking to someone, finding something, winning
// a fight, walking into a place, answering a choice. Each is recorded once in
// `AdventureState.events`. The chapter only moves when the current chapter
// is waiting for that event, so the story can't skip ahead.

import type {
	AdventureStage,
	ChapterId,
	LocationId,
	Objective
} from '../../src/lib/adventure/adventure';
import { CHAPTER_IDS } from '../../src/lib/adventure/adventure';
import type { GridPos } from '../../src/lib/game/grid';

export type EventId =
	/** Maren told the party about Tobin and the well. */
	| 'talked_maren'
	/** The well gave up its clue, and the Hound climbed out. */
	| 'well_clue'
	| 'won_well'
	/** A character reached the mountain path. */
	| 'left_village'
	| 'talked_oswin'
	/** The party answered Oswin, and he unlocked the ringers' door. */
	| 'promised'
	| 'entered_nave'
	/** The statue of Saint Agna turned, showing the way into the hidden chamber. */
	| 'found_hidden_door'
	| 'entered_chamber'
	| 'won_chamber'
	/** A character stood on the stair beneath the tower. */
	| 'reached_stair'
	| 'found_tobin'
	/** The party decided what to do with the Bell. */
	| 'decided_bell';

export const EVENT_IDS: readonly EventId[] = [
	'talked_maren',
	'well_clue',
	'won_well',
	'left_village',
	'talked_oswin',
	'promised',
	'entered_nave',
	'found_hidden_door',
	'entered_chamber',
	'won_chamber',
	'reached_stair',
	'found_tobin',
	'decided_bell'
];

interface ObjectiveDef {
	id: string;
	text: string;
	/** Shown once this has happened (always shown if omitted). */
	after?: EventId;
	/** Done once this has happened. */
	done: EventId;
}

export interface ChapterDef {
	id: ChapterId;
	title: string;
	location: LocationId;
	objectives: readonly ObjectiveDef[];
	/** The event that ends this chapter, and the chapter it leads to (null: the story ends). */
	next: { on: EventId; to: ChapterId | null };
}

export const CHAPTERS: Record<ChapterId, ChapterDef> = {
	village: {
		id: 'village',
		title: 'The quiet village',
		location: 'bellweather',
		objectives: [
			{ id: 'innkeeper', text: 'Find the innkeeper at the Tolling Rest', done: 'talked_maren' },
			{
				id: 'well',
				text: 'Examine the old well in the square',
				after: 'talked_maren',
				done: 'well_clue'
			}
		],
		next: { on: 'well_clue', to: 'discover_bell' }
	},
	discover_bell: {
		id: 'discover_bell',
		title: 'What the bell woke',
		location: 'bellweather',
		objectives: [
			{ id: 'hound', text: 'Drive off what climbed out of the well', done: 'won_well' },
			{
				id: 'path',
				text: 'Take the mountain path north toward the monastery',
				after: 'won_well',
				done: 'left_village'
			}
		],
		next: { on: 'left_village', to: 'investigate_monastery' }
	},
	investigate_monastery: {
		id: 'investigate_monastery',
		title: 'The monastery gate',
		location: 'monastery',
		objectives: [
			{
				id: 'gatehouse',
				text: 'Find whoever keeps the lamp lit in the gatehouse',
				done: 'talked_oswin'
			},
			{ id: 'way-in', text: 'Find a way into the monastery', done: 'entered_nave' }
		],
		next: { on: 'entered_nave', to: 'enter_monastery' }
	},
	enter_monastery: {
		id: 'enter_monastery',
		title: 'The empty nave',
		location: 'monastery',
		objectives: [
			{
				id: 'ringers',
				text: 'Search the nave for the way to the ringing chamber',
				done: 'found_hidden_door'
			}
		],
		next: { on: 'found_hidden_door', to: 'discover_hidden_chamber' }
	},
	discover_hidden_chamber: {
		id: 'discover_hidden_chamber',
		title: 'The hidden chamber',
		location: 'monastery',
		objectives: [{ id: 'chamber', text: 'Go into the hidden chamber', done: 'entered_chamber' }],
		next: { on: 'entered_chamber', to: 'bell_rings' }
	},
	bell_rings: {
		id: 'bell_rings',
		title: 'The bell rings',
		location: 'monastery',
		objectives: [{ id: 'survive', text: 'Survive what the bell calls up', done: 'won_chamber' }],
		next: { on: 'won_chamber', to: 'descend' }
	},
	descend: {
		id: 'descend',
		title: 'Down into the dark',
		location: 'monastery',
		objectives: [
			{ id: 'stair', text: 'Take the stair down beneath the tower', done: 'reached_stair' }
		],
		next: { on: 'reached_stair', to: 'the_hollow' }
	},
	the_hollow: {
		id: 'the_hollow',
		title: 'The Hollow',
		location: 'hollow',
		objectives: [{ id: 'tobin', text: 'Find Tobin', done: 'found_tobin' }],
		next: { on: 'found_tobin', to: 'final_decision' }
	},
	final_decision: {
		id: 'final_decision',
		title: 'The final decision',
		location: 'hollow',
		objectives: [{ id: 'bell', text: 'Decide what becomes of the Bell', done: 'decided_bell' }],
		next: { on: 'decided_bell', to: null }
	}
};

/** The chapter an event leads to from `chapter`, undefined if the chapter isn't waiting for it. */
export function transition(chapter: ChapterId, event: EventId): ChapterId | null | undefined {
	const next = CHAPTERS[chapter].next;
	return next.on === event ? next.to : undefined;
}

/**
 * What the party is trying to do: the objectives of every chapter so far at
 * this location, done or not, leaving out those not yet heard of.
 */
export function objectivesFor(
	stage: AdventureStage,
	chapter: ChapterId,
	events: readonly EventId[]
): Objective[] {
	if (stage === 'choosing') return [{ id: 'choose', text: 'Choose your characters', done: false }];
	const here = CHAPTERS[chapter].location;
	const upTo = CHAPTER_IDS.indexOf(chapter);
	return CHAPTER_IDS.slice(0, upTo + 1)
		.filter((id) => CHAPTERS[id].location === here)
		.flatMap((id) => CHAPTERS[id].objectives)
		.filter((o) => !o.after || events.includes(o.after))
		.map((o) => ({ id: o.id, text: o.text, done: events.includes(o.done) }));
}

/** Places that start an event when a character walks into them, while their chapter waits for it. */
export interface Area {
	event: EventId;
	during: ChapterId;
	location: LocationId;
	/** Inclusive rectangle of cells. */
	from: GridPos;
	to: GridPos;
}

export type DecisionId = 'promise' | 'bell';

export interface DecisionDef {
	id: DecisionId;
	prompt: string;
	options: readonly { id: string; label: string }[];
}

export const DECISIONS: Record<DecisionId, DecisionDef> = {
	promise: {
		id: 'promise',
		prompt: 'Brother Oswin asks what you have come up the mountain to do.',
		options: [
			{ id: 'silence', label: 'Silence the bell, for good' },
			{ id: 'boy', label: 'Bring Tobin home' }
		]
	},
	bell: {
		id: 'bell',
		prompt:
			'The Hollow Bell hangs over the pit, its rope in Tobin’s hands. Below, the eyes are opening. What do you do?',
		options: [
			{ id: 'ring', label: 'Ring the Bell and bind the Hollow' },
			{ id: 'break', label: 'Break the Bell' },
			{ id: 'leave', label: 'Take Tobin and leave the Bell be' }
		]
	}
};

export type EncounterId = 'well' | 'chamber';

export const ENCOUNTER_IDS: readonly EncounterId[] = ['well', 'chamber'];

export type EndingId = 'kept' | 'broken' | 'silent';

/** The ending each answer to the final decision leads to. */
export const ENDING_FOR: Record<string, EndingId> = {
	ring: 'kept',
	break: 'broken',
	leave: 'silent'
};
