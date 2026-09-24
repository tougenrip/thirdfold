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
	/** The lever in the ringing chamber lifted the grate off the stair. */
	| 'opened_grate'
	/** A character stood on the stair beneath the tower. */
	| 'reached_stair'
	/** The Bell Keeper and its cultists were beaten in the Hollow. */
	| 'won_hollow'
	| 'found_tobin'
	/** The party looked into the pit and saw what sleeps there (or already had). */
	| 'saw_hollow'
	/** The Hollow's first stirring was survived, and the Bell began to ring itself. */
	| 'bell_rings_itself'
	/** Three pulls on the rope held the Bell still. */
	| 'bell_held'
	/** The party chose to destroy the Bell, and the Hollow rose against them. */
	| 'chose_destroy'
	/** The party chose to go down into the pit and face the Hollow in its heart. */
	| 'chose_descent'
	/** The party decided what to do with the Bell (and, if they broke it, lived). */
	| 'decided_bell'
	/** The party knows the ringers' rule: three pulls bind it. */
	| 'learned_rule'
	/** The party knows where Tobin went (shared evidence or testimony). */
	| 'learned_tobin'
	/** The party knows Saint Agna holds the way to the ringers. */
	| 'learned_agna';

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
	'opened_grate',
	'reached_stair',
	'won_hollow',
	'found_tobin',
	'saw_hollow',
	'bell_rings_itself',
	'bell_held',
	'chose_destroy',
	'chose_descent',
	'decided_bell',
	'learned_tobin',
	'learned_agna',
	'learned_rule'
];

interface ObjectiveDef {
	id: string;
	text: string;
	/** Worth doing, but the story goes on without it. */
	optional?: boolean;
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
			},
			{ id: 'tobin', text: 'Find out where Tobin went', optional: true, done: 'learned_tobin' }
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
			{ id: 'way-in', text: 'Find a way into the monastery', done: 'entered_nave' },
			{
				id: 'agna',
				text: 'Find what Saint Agna holds: the way to the ringers',
				optional: true,
				after: 'learned_agna',
				done: 'found_hidden_door'
			}
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
			{ id: 'grate', text: 'Find a way to lift the grate', done: 'opened_grate' },
			{
				id: 'stair',
				text: 'Take the stair down beneath the tower',
				after: 'opened_grate',
				done: 'reached_stair'
			}
		],
		next: { on: 'reached_stair', to: 'the_hollow' }
	},
	the_hollow: {
		id: 'the_hollow',
		title: 'The Hollow',
		location: 'hollow',
		objectives: [
			{ id: 'keeper', text: 'Get past the Bell Keeper', done: 'won_hollow' },
			{ id: 'tobin', text: 'Find Tobin', after: 'won_hollow', done: 'found_tobin' }
		],
		next: { on: 'found_tobin', to: 'the_pit' }
	},
	// The finale, in four phases: the party sees what sleeps below, survives its
	// waking, takes hold of the Bell, and decides what becomes of it.
	the_pit: {
		id: 'the_pit',
		title: 'What sleeps below',
		location: 'hollow',
		objectives: [{ id: 'pit', text: 'Look into the pit', done: 'saw_hollow' }],
		next: { on: 'saw_hollow', to: 'the_waking' }
	},
	the_waking: {
		id: 'the_waking',
		title: 'The Hollow wakes',
		location: 'hollow',
		objectives: [
			{
				id: 'waking',
				text: 'Survive the waking, and keep off the cracking floor',
				done: 'bell_rings_itself'
			}
		],
		next: { on: 'bell_rings_itself', to: 'the_ringing' }
	},
	the_ringing: {
		id: 'the_ringing',
		title: 'The Bell rings itself',
		location: 'hollow',
		objectives: [
			{ id: 'hold', text: 'Stop the Bell ringing itself', done: 'bell_held' },
			{
				id: 'rule',
				text: 'Three pulls bind it: pull the Bell’s rope three times',
				after: 'learned_rule',
				done: 'bell_held'
			}
		],
		next: { on: 'bell_held', to: 'final_decision' }
	},
	final_decision: {
		id: 'final_decision',
		title: 'The final decision',
		location: 'hollow',
		objectives: [
			{ id: 'bell', text: 'Decide what becomes of the Bell', done: 'decided_bell' },
			{
				id: 'wrath',
				text: 'Survive the Hollow’s wrath',
				after: 'chose_destroy',
				done: 'decided_bell'
			}
		],
		next: { on: 'decided_bell', to: null }
	},
	// Only by choosing to go down into the pit: the Hollow's heart, where the story ends in the Descent.
	the_descent: {
		id: 'the_descent',
		title: 'The heart of the Hollow',
		location: 'heart',
		objectives: [{ id: 'heart', text: 'Face the Hollow in its heart', done: 'decided_bell' }],
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
		.map((o) => ({
			id: o.id,
			text: o.text,
			done: events.includes(o.done),
			...(o.optional ? { optional: true } : {})
		}));
}

/** Places that start an event when a character walks into them, while their chapter waits for it. */
export interface Area {
	event: EventId;
	during: ChapterId;
	location: LocationId;
	/** Only once this has happened. */
	after?: EventId;
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
			'The Bell hangs still on its rope, and the Hollow waits beneath it, half awake, watching you. What becomes of the Bell?',
		options: [
			{ id: 'destroy', label: 'Destroy the Bell' },
			{ id: 'silence', label: 'Silence the Bell' },
			{ id: 'use', label: 'Use the Bell: ring it, and speak to what is below' },
			{ id: 'descend', label: 'Go down into the pit, and face the Hollow in its heart' }
		]
	}
};

/** The story's fights, and `ambush`: the GM's own, with the enemies the GM put on the table. */
export type EncounterId = 'well' | 'chamber' | 'hollow' | 'waking' | 'wrath' | 'heart' | 'ambush';

export const ENCOUNTER_IDS: readonly EncounterId[] = [
	'well',
	'chamber',
	'hollow',
	'waking',
	'wrath',
	'heart',
	'ambush'
];

/** Each fight as the GM sees it listed, and where it is fought (null: anywhere). */
export const ENCOUNTER_INFO: Record<EncounterId, { name: string; location: LocationId | null }> = {
	well: { name: 'The Hound at the well', location: 'bellweather' },
	chamber: { name: 'The ringing chamber', location: 'monastery' },
	hollow: { name: 'The Keeper and the watch', location: 'hollow' },
	waking: { name: 'The Hollow wakes', location: 'hollow' },
	wrath: { name: 'The Hollow’s Hand', location: 'hollow' },
	heart: { name: 'The Heart', location: 'heart' },
	ambush: { name: 'The enemies you placed', location: null }
};

/** How each event reads in the GM's list of what can be made to happen. */
export const EVENT_LABELS: Record<EventId, string> = {
	talked_maren: 'Maren told the party about Tobin',
	well_clue: 'The well gave up its clue (the Hound climbs out)',
	won_well: 'The Hound at the well was beaten',
	left_village: 'The party took the mountain path',
	talked_oswin: 'The party met Brother Oswin',
	promised: 'The party answered Oswin (the ringers’ door unlocks)',
	entered_nave: 'The party entered the nave',
	found_hidden_door: 'Saint Agna turned, showing the hidden door',
	entered_chamber: 'The party entered the ringing chamber',
	won_chamber: 'The fight in the ringing chamber was won',
	opened_grate: 'The grate over the stair opened',
	reached_stair: 'The party went down the stair',
	won_hollow: 'The Keeper and the watch were beaten',
	found_tobin: 'The party found Tobin',
	saw_hollow: 'The party saw what sleeps in the pit',
	bell_rings_itself: 'The Bell began to ring itself',
	bell_held: 'The Bell was held still',
	chose_destroy: 'The party chose to destroy the Bell',
	chose_descent: 'The party chose to go down into the pit',
	decided_bell: 'The party decided the Bell’s fate',
	learned_rule: 'The party learned the ringers’ rule',
	learned_tobin: 'The party learned where Tobin went',
	learned_agna: 'The party learned what Saint Agna holds'
};

/**
 * The three endings: Silence (the Bell destroyed or silenced for good),
 * Descent (the party goes down and faces the Hollow) and Communion (the
 * party uses the Bell to speak with it).
 */
export type EndingId = 'silence' | 'descent' | 'communion';

export const ENDING_IDS: readonly EndingId[] = ['silence', 'descent', 'communion'];

/** The ending each answer to the final decision leads to. */
export const ENDING_FOR: Record<string, EndingId> = {
	destroy: 'silence',
	silence: 'silence',
	use: 'communion',
	descend: 'descent'
};

/** Saves from before the finale had phases answered the Bell differently. */
export const OLD_BELL_OPTIONS: Record<string, string> = {
	ring: 'use',
	break: 'destroy',
	leave: 'silence'
};

/** And ended differently. */
export const OLD_ENDINGS: Record<string, EndingId> = {
	kept: 'communion',
	silent: 'silence',
	broken: 'silence',
	waking: 'silence',
	spoken: 'communion'
};
