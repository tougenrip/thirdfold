// The story's rules as data: what each chapter does as the party enters it,
// what events do to the table, what each choice does, the fights (and the
// finale's phases), the endings, where people stand, and the words the
// rules speak in. The engine carries them out (see server/adventure/define.ts).

import type {
	DecisionDef,
	EffectsTo,
	EncounterDef,
	EndingsDef,
	HazardDef,
	Rule,
	Voice
} from '../../adventure/define';
import type { Effect } from '../../adventure/define';
import { FIRST_GLIMPSE, IDS, PATH_AREA, WELL_RING } from './bellweather';
import { OUTCOMES, PROMISE_KEPT, SPOKEN_KNOWING, TEXT } from './content';
import { PUP_HP } from './enemies';
import { HEART_GRID, HEART_IDS, HEART_RING } from './heart';
import { CAVERN, CULTIST_ROUNDS, HOLLOW_IDS, KEEPER_POST, PIT_RING } from './hollow';
import { CHAMBER, MONASTERY_IDS, STAIR_RING } from './monastery';
import { SHOTS } from './shots';
import { ENDING_FOR, OLD_BELL_OPTIONS, OLD_ENDINGS } from './story';

const say = (text: string): Effect => ({ say: text });

/** What happens as the party enters each chapter. */
export const OPENINGS: EffectsTo = {
	discover_bell: [{ fight: 'well' }, { settle: true }],
	investigate_monastery: [say(TEXT.leaveVillage)],
	// The signature moment: the tower bell swings, and something answers far below.
	enter_monastery: [say(TEXT.nave), { say: TEXT.firstToll, cue: 'toll', shot: SHOTS.bellRing }],
	bell_rings: [
		say(TEXT.chamber),
		{ set: 'grate', to: 'opened' },
		{ say: TEXT.bellRings, cue: 'toll' },
		{ fight: 'chamber' },
		// The note lights the dark chamber for a moment: long enough to see what came up.
		{ say: TEXT.chamberFlash, cue: 'flash' }
	],
	// The grate slams back down: the lever by the door lifts it (see mechanisms.ts).
	descend: [
		{ set: 'grate', to: 'disabled' },
		say(TEXT.chamberWon),
		{ motion: { prop: MONASTERY_IDS.grate, kind: 'shake', sound: 'clank' } }
	],
	the_hollow: [
		{ npc: 'tobin', becomes: 'entranced' },
		// The Keeper stands watch by the Bell and cultists walk the dark with lanterns: sneak or fight.
		{ post: 'hollow' },
		say(TEXT.downStair),
		say(TEXT.hollow),
		// The Bell sounds as the party arrives: its light shows them the whole Hollow for a
		// moment, and they remember its shape (not who stands in it).
		{ say: TEXT.hollowFlash, cue: 'flash', shot: SHOTS.hollow },
		{ explore: 'all' },
		say(TEXT.hollowWatch)
	],
	// Phase 1: they see what sleeps below, unless they already have.
	the_pit: [
		{
			rules: [
				{ if: { events: ['saw_hollow'] }, do: [{ say: TEXT.pitKnown, shot: SHOTS.pit }] },
				{ do: [{ say: TEXT.pitStirs, shot: SHOTS.pit }] }
			]
		}
	],
	// Phase 2: the Hollow stirs, the island cracks, and its tendrils come up.
	the_waking: [
		{ fight: 'waking' },
		{ rules: [{ if: { objects: { bell: ['used'] } }, do: [say(TEXT.remembersTouch)] }] },
		{ hazard: 'open' }
	],
	// Phase 3: the Bell rings itself each round until someone takes the rope.
	the_ringing: [
		{
			rules: [
				{
					if: { phase: 'waking' },
					do: [
						{ phase: 'ringing' },
						{ set: 'bell-rope', to: 'interactable' },
						say(TEXT.ringing),
						{ rules: [{ if: { events: ['learned_rule'] }, do: [say(TEXT.ringingRule)] }] },
						// Freed by Pell's name, Tobin takes hold of the rope himself.
						{ rules: [{ if: { said: ['tobin:pell'] }, do: [{ count: TEXT.tobinPulls }] }] }
					]
				}
			]
		}
	],
	// Phase 4: what becomes of the Bell.
	final_decision: [{ offer: 'bell' }],
	// The Descent: the Hollow's heart, and what guards it.
	the_descent: [{ fight: 'heart' }]
};

/** What events do to the table when they happen. */
export const EVENT_EFFECTS: EffectsTo = {
	won_well: [
		{ npc: 'maren', becomes: 'hopeful' },
		{ settle: true },
		{ set: 'gate', to: 'opened' },
		{ reveal: PATH_AREA },
		say(TEXT.gateOpens)
	],
	promised: [
		{ npc: 'oswin', becomes: 'trusting' },
		{ set: 'side-door', to: 'closed', if: 'disabled' }
	],
	talked_oswin: [{ offer: 'promise' }]
};

/** What each answer does, and how it reads once the party knows or has done something. */
export const CHOICES: Readonly<
	Record<string, Readonly<Record<string, Pick<DecisionDef['options'][number], 'does' | 'labels'>>>>
> = {
	promise: {
		silence: { does: [{ say: TEXT.oswinSilence, speaker: 'Oswin' }, { event: 'promised' }] },
		boy: { does: [{ say: TEXT.oswinBoy, speaker: 'Oswin' }, { event: 'promised' }] }
	},
	bell: {
		// Destroy the Bell, and the Hollow attacks: the story ends only if the party survives it.
		destroy: { does: [say(TEXT.chooseDestroy), { event: 'chose_destroy' }, { fight: 'wrath' }] },
		silence: {
			does: [{ event: 'decided_bell' }],
			labels: [
				{ if: { chose: { promise: 'silence' } }, label: 'Silence the Bell, as you promised Oswin' }
			]
		},
		use: {
			does: [{ event: 'decided_bell' }],
			labels: [
				{
					if: { events: ['learned_rule'] },
					label: 'Use the Bell: ring it as the ringers did, and speak to what is below'
				}
			]
		},
		// Down into the pit: the story ends in the Hollow's heart, if the party comes back up.
		descend: {
			does: [say(TEXT.chooseDescent), { event: 'chose_descent' }, { enter: 'the_descent' }]
		}
	}
};

/** The island's floor giving way under the party as the Hollow wakes. */
const CRACKS: HazardDef = {
	asset: 'crack',
	prefix: 'ho-crack-',
	damage: '1d6',
	opens: TEXT.cracks,
	heaves: TEXT.heave,
	caught: '{name} is caught as the stone gives way',
	avoid: 'bell'
};

/** The story's fights: who comes, where they appear, what lights up. */
export const ENCOUNTERS: Readonly<Record<string, EncounterDef>> = {
	well: {
		name: 'The Hound at the well',
		location: 'bellweather',
		ring: WELL_RING,
		foes: [{ kind: 'hound' }],
		// The square, so the whole party can see the fight.
		reveal: { from: { x: 8, y: 10 }, to: { x: 16, y: 17 } },
		opening: TEXT.houndEmerges,
		won: { event: 'won_well', text: TEXT.houndFalls },
		// The Hound leaves its ashes where it falls.
		remains: { object: 'remains', prop: IDS.remains, asset: 'ashes' }
	},
	chamber: {
		name: 'The ringing chamber',
		location: 'monastery',
		ring: STAIR_RING,
		foes: [{ kind: 'hound', hp: PUP_HP }, { kind: 'hound', hp: PUP_HP }, { kind: 'cultist' }],
		reveal: CHAMBER,
		won: { event: 'won_chamber' }
	},
	hollow: {
		name: 'The Keeper and the watch',
		location: 'hollow',
		ring: [],
		foes: [],
		sentries: [
			{ kind: 'keeper', route: [KEEPER_POST] },
			...CULTIST_ROUNDS.map((route) => ({ kind: 'cultist', route }))
		],
		reveal: CAVERN,
		opening: TEXT.keeper,
		won: { event: 'won_hollow', text: TEXT.keeperFalls }
	},
	// The finale's second and third phases: the Hollow wakes, then the Bell rings itself.
	waking: {
		name: 'The Hollow wakes',
		location: 'hollow',
		ring: PIT_RING,
		foes: [{ kind: 'tendril' }, { kind: 'tendril' }, { kind: 'tendril' }],
		// It remembers a hand that touched the Bell before.
		more: [{ if: { objects: { bell: ['used'] } }, foes: [{ kind: 'tendril' }] }],
		reveal: CAVERN,
		opening: TEXT.waking,
		shot: SHOTS.waking,
		phases: {
			first: 'waking',
			all: {
				// The first wave down, or the third round, and the Bell starts ringing itself.
				waking: {
					cleared: { event: 'bell_rings_itself' },
					until: { round: 3, event: 'bell_rings_itself' },
					hazard: CRACKS
				},
				// Each round nobody pulled its rope it rings itself: it hurts, its light floods the
				// cavern, and more of the Hollow rises. Three pulls hold it.
				ringing: {
					cleared: 'continue',
					hazard: CRACKS,
					counter: { label: 'Bell held', target: 3, reached: [say(TEXT.held)] },
					unanswered: [
						{ say: TEXT.selfRings, cue: 'flash' },
						{
							hurt: { near: 'bell', within: 5, dice: '1d6', text: 'The note goes through {name}' }
						},
						{
							spawn: {
								kind: 'tendril',
								at: PIT_RING,
								text: 'Another tendril comes up out of the pit.'
							}
						}
					],
					answered: [say(TEXT.strains)]
				}
			}
		},
		won: { event: 'bell_held', does: [{ set: 'bell-rope', to: 'used' }] },
		calledOff: [{ set: 'bell-rope', to: 'initial' }]
	},
	// The Bell destroyed: the Hollow rises against the party.
	wrath: {
		name: 'The Hollow’s Hand',
		location: 'hollow',
		ring: PIT_RING,
		foes: [{ kind: 'hand' }, { kind: 'tendril' }, { kind: 'tendril' }],
		reveal: CAVERN,
		opening: TEXT.wrath,
		won: { event: 'decided_bell', text: TEXT.wrathWon }
	},
	// The Descent: the Hollow's Heart on its dais, and what uncurls from the stone around it.
	heart: {
		name: 'The Heart',
		location: 'heart',
		ring: HEART_RING,
		foes: [{ kind: 'heart' }, { kind: 'tendril' }, { kind: 'tendril' }],
		reveal: { from: { x: 0, y: 0 }, to: { x: HEART_GRID.width - 1, y: HEART_GRID.height - 1 } },
		opening: TEXT.heart,
		won: { event: 'decided_bell', text: TEXT.heartWon }
	}
};

/** Where the village's people stand: indoors while the Hound is loose, back out after. */
export const PEOPLE_PLACES = [
	{ place: 'hiding', if: { fights: { well: 'active' } } },
	{ place: 'after', if: { events: ['won_well'] } }
] as const;

/** The party arrives: the first bell draws every eye up the mountain, to the monastery. */
export const ARRIVAL: readonly Effect[] = [
	{ say: TEXT.arrival, shot: SHOTS.firstBell },
	{ explore: FIRST_GLIMPSE }
];

/** What the promise to Oswin makes of each ending, said last. */
const codas = (answer: string): Rule[] =>
	Object.entries(PROMISE_KEPT).map(([promise, by]) => ({
		if: { chose: { promise } },
		do: [say(by[answer as keyof typeof by])]
	}));

/** The Hollow's own lights, out or blue by the ending. */
const GLOWS = ['ho-lake-glow-1', 'ho-lake-glow-2', 'ho-lake-glow-3', 'ho-watch-glow'];

/** The three endings, by the answer to what becomes of the Bell. */
export const ENDINGS_DEF: EndingsDef = {
	decision: 'bell',
	fallback: 'silence',
	names: {
		silence: { title: 'Silence' },
		descent: { title: 'Descent' },
		communion: { title: 'Communion' }
	},
	byAnswer: {
		// The Bell split on the floor, and every light the Hollow gave gone out.
		destroy: {
			ending: ENDING_FOR.destroy,
			...OUTCOMES.destroy,
			cue: 'toll',
			lines: codas('destroy'),
			does: [
				{ npc: 'tobin', becomes: 'safe' },
				{ prop: HOLLOW_IDS.bell, asset: 'broken-bell' },
				...['ho-bell-glow', 'ho-pit-glow', ...GLOWS].map((light) => ({ light, on: false }))
			]
		},
		// The Bell dark in its frame; the eye below red, and open.
		silence: {
			ending: ENDING_FOR.silence,
			...OUTCOMES.silence,
			cue: 'toll',
			lines: codas('silence'),
			does: [
				{ npc: 'tobin', becomes: 'safe' },
				{ light: 'ho-bell-glow', on: false },
				{ light: 'ho-pit-glow', color: '#c0392b', radius: 5, on: true }
			]
		},
		// The whole Hollow lit a calm blue: nothing in it hides from anyone now.
		use: {
			ending: ENDING_FOR.use,
			...OUTCOMES.use,
			cue: 'flash',
			lines: [
				// What the Hollow makes of them depends on what they know.
				{ if: { events: ['learned_rule'] }, do: [say(SPOKEN_KNOWING.rule)] },
				{ if: { found: ['sleeper'] }, do: [say(SPOKEN_KNOWING.sleeper)] },
				{ if: { not: ['learned_rule'], unfound: ['sleeper'] }, do: [say(SPOKEN_KNOWING.neither)] },
				...codas('use')
			],
			does: [
				{ npc: 'tobin', becomes: 'safe' },
				{ ambient: 'dusk' },
				{ light: 'ho-bell-glow', color: '#9fd0ff', radius: 12, on: true },
				{ light: 'ho-pit-glow', color: '#7fb6ff', radius: 4, on: true },
				...GLOWS.map((light) => ({ light, radius: 4, on: true }))
			]
		},
		// The Heart still and grey, its glow gone out.
		descend: {
			ending: ENDING_FOR.descend,
			...OUTCOMES.descend,
			cue: 'toll',
			lines: codas('descend'),
			does: [
				{ npc: 'tobin', becomes: 'safe' },
				{ light: HEART_IDS.heartLight, on: false }
			]
		}
	}
};

export const RENAMED = { options: OLD_BELL_OPTIONS, endings: OLD_ENDINGS };

/** Words the rules speak in The Hollow Bell's voice. */
export const VOICE: Voice = {
	started: TEXT.started,
	notNow: TEXT.notNow,
	nothingFound: TEXT.nothingFound,
	hearNothing: TEXT.hearNothing,
	seeNothing: TEXT.seeNothing,
	cantMakeOut: TEXT.cantMakeOut,
	blocked: TEXT.crateBlocked.replace('crate', '{name}'),
	revive: TEXT.revive,
	defeat: TEXT.defeat,
	gone: "{name} is gone. The lamplight doesn't reach them any more."
};
