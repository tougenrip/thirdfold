// The Last Train to Blackwater: a supernatural western mystery aboard a
// night train, 1889. Written as an adventure file, the same format the
// builder makes (src/lib/adventure/file.ts), and run by the same engine as
// The Hollow Bell: nothing in the engine knows it.
//
// The story: the Southern Pacific night train leaves the main line at
// Cutter's Junction for the Blackwater spur, closed since the bridge fell in
// 1861 with forty souls aboard. A passenger vanishes from his berth; frost
// leads to the baggage car and a coffin that breathes; at midnight the dead
// walk the aisles; the engineer who drove them in 1861 is back at the
// throttle; and the conductor, the only one who survived, has a secret.

import type { AdventureFile } from '../../../src/lib/adventure/file';
import { ADVENTURE_FILE_FORMAT, ADVENTURE_FILE_VERSION } from '../../../src/lib/adventure/file';
import type { Effect } from '../../../src/lib/adventure/define';
import type { GridPos } from '../../../src/lib/game/grid';
import {
	BAGGAGE,
	BLACKWATER_IDS,
	BLACKWATER_SPAWN,
	blackwaterScene,
	ENGINE_IDS,
	ENGINE_RING,
	ENGINE_SPAWN,
	engineScene,
	FRONT,
	RIVER_RING,
	TRAIN_IDS,
	TRAIN_SPAWN,
	trainScene
} from './tables';

const at = (x: number, y: number): GridPos => ({ x, y });
const say = (text: string): Effect => ({ say: text });

export const TITLE = 'The Last Train to Blackwater';

export function blackwaterFile(): AdventureFile {
	return {
		format: ADVENTURE_FILE_FORMAT,
		version: ADVENTURE_FILE_VERSION,
		title: TITLE,
		about:
			'Arizona Territory, 1889. The night train leaves the main line for a town that died thirty years ago. A supernatural western mystery for 1–4 players, aboard a moving train.',
		characters: ['warden', 'veil', 'ember', 'saint'],
		intros: {
			warden:
				'The Warden rides with a shotgun across the knees and a badge nobody asked about. Trouble finds the Warden; the Warden stays put.',
			veil: 'The Veil boarded at Tucson without a ticket, and the conductor never thought to ask. Two knives, no questions.',
			ember:
				'Sparks drift from the Ember’s fingertips and die in the cold air. The coach lamps lean toward them, just slightly.',
			saint:
				'The Saint carries a worn Bible and a doctor’s bag, and has buried more folk than they have healed. Not for lack of trying.'
		},
		start: {
			location: 'train',
			chapter: 'all_aboard',
			arrival: [
				{
					say: 'Dusk over the Arizona Territory, 1889. The Southern Pacific night train rattles east through the scrub, lamps swaying. At the front of the coach, the conductor checks his watch, and checks it again.',
					shot: { focus: FRONT, frame: 'wide' }
				}
			]
		},
		locations: {
			train: {
				name: 'The night train',
				welcome:
					'The Southern Pacific night train, four cars long, running east through the dark. The party rides in the coach.',
				spawn: TRAIN_SPAWN,
				scene: trainScene()
			},
			engine: {
				name: 'The locomotive',
				welcome:
					'The tender and the cab, the firebox roaring, the rails running out into the dark.',
				spawn: ENGINE_SPAWN,
				scene: engineScene()
			},
			blackwater: {
				name: 'Blackwater',
				welcome: 'Blackwater, the town at the end of the line. Nobody has lived here since 1861.',
				spawn: BLACKWATER_SPAWN,
				scene: blackwaterScene()
			}
		},
		areas: [{ event: 'reached_front', during: 'midnight', location: 'train', ...rect(FRONT) }],
		chapters: {
			all_aboard: {
				title: 'All aboard',
				location: 'train',
				objectives: [{ id: 'conductor', text: 'Speak with the conductor', done: 'met_conductor' }],
				next: { on: 'met_conductor', to: 'the_vanishing' }
			},
			the_vanishing: {
				title: 'The empty berth',
				location: 'train',
				objectives: [
					{ id: 'berth', text: 'Search berth three in the sleeper', done: 'searched_berth' },
					{ id: 'ask', text: 'Ask the passengers what they saw', done: 'asked_around' },
					{
						id: 'where',
						text: 'Find where the missing man went',
						done: 'trail_found',
						after: 'searched_berth'
					},
					{
						id: 'spur',
						text: 'Find out why the train left the main line',
						done: 'learned_spur',
						optional: true
					}
				],
				next: { on: 'trail_found', to: 'the_baggage_car' },
				opening: [
					{
						say: 'A passenger’s gone. Mr. Ellis Grant, berth three in the sleeper. His boots are still under the bunk. Nobody leaves a moving train in their stocking feet.',
						speaker: 'Pike'
					}
				]
			},
			the_baggage_car: {
				title: 'The baggage car',
				location: 'train',
				objectives: [
					{ id: 'key', text: 'Get the conductor’s key', done: 'got_key' },
					{ id: 'open', text: 'Unlock the baggage car', done: 'opened_baggage', after: 'got_key' },
					{
						id: 'grant',
						text: 'Find Mr. Grant',
						done: 'won_coffin',
						after: 'opened_baggage'
					},
					{
						id: 'manifest',
						text: 'Find out what the conductor keeps locked away',
						done: 'read_manifest',
						after: 'opened_baggage',
						optional: true
					}
				],
				next: { on: 'won_coffin', to: 'midnight' },
				opening: [
					{
						say: 'The trail leads to the rear of the train. Pike lays his brass key on the seat by the coach door. “Baggage car’s locked for the night. I don’t go back there after dark.”',
						speaker: 'Pike'
					},
					{ set: 'brass-key', to: 'interactable', if: 'hidden' }
				]
			},
			midnight: {
				title: 'Midnight',
				location: 'train',
				objectives: [
					{ id: 'engine', text: 'Get forward to the engine', done: 'reached_front' },
					{
						id: 'truth',
						text: 'Make the conductor tell the truth',
						done: 'pike_confessed',
						optional: true
					},
					{
						id: 'dead',
						text: 'Lay the dead passengers to rest',
						done: 'dead_dispersed',
						optional: true
					}
				],
				next: { on: 'reached_front', to: 'the_engine' },
				opening: [
					{ ambient: 'dark' },
					{ light: TRAIN_IDS.coachLamps[0], on: false },
					{ light: TRAIN_IDS.diningLamp, on: false },
					{ light: TRAIN_IDS.sleeperLamp, on: false },
					{
						say: 'Somewhere forward, a clock strikes twelve. The wheels change their song as the train swings off the main line, and every lamp aboard gutters low.',
						cue: 'toll'
					},
					{ settle: true },
					{ post: 'the_dead' },
					say(
						'In the aisles, passengers who were not there at supper are walking slowly toward the front of the train, lanterns in their hands. Their clothes are thirty years out of date. Their feet leave frost.'
					)
				]
			},
			the_engine: {
				title: 'The dead engineer',
				location: 'engine',
				objectives: [
					{
						id: 'engineer',
						text: 'Take the train back from the dead engineer',
						done: 'won_engineer'
					},
					{ id: 'whistle', text: 'Sound the whistle', done: 'whistle_blown', optional: true }
				],
				next: { on: 'won_engineer', to: 'the_bridge' },
				opening: [
					say(
						'Over the coal of the tender and into the cab. The firebox roars. At the throttle stands a man in a scorched engineer’s cap, and through him you can see the gauges.'
					),
					{ fight: 'engineer' }
				]
			},
			the_bridge: {
				title: 'The Blackwater bridge',
				location: 'engine',
				objectives: [{ id: 'decide', text: 'Decide the last train’s fate', done: 'decided' }],
				next: { on: 'decided', to: null },
				opening: [
					{
						say: 'Ahead, in the moonlight, the Blackwater bridge: black timbers over the river, and a gap in the middle where the rails hang down into the dark. Behind you, down the length of the train, the dead are standing at the windows. Waiting.',
						cue: 'flash'
					},
					{ offer: 'reckoning' }
				]
			},
			to_blackwater: {
				title: 'End of the line',
				location: 'blackwater',
				objectives: [{ id: 'survive', text: 'Face what waits in the river', done: 'decided' }],
				next: { on: 'decided', to: null },
				opening: [
					say(
						'The train crosses the gap on rails that are not there, and rolls to a stop at Blackwater station at a quarter past midnight, 1861. The dead step down onto the platform and walk toward the river, where something vast is rising to meet them.'
					),
					{ fight: 'wreck' }
				]
			}
		},
		events: {
			met_conductor: { label: 'The party met the conductor' },
			asked_around: { label: 'The party asked the passengers' },
			learned_spur: { label: 'The party learned the train is on the Blackwater spur' },
			searched_berth: { label: 'Berth three was searched' },
			trail_found: { label: 'The frost trail was followed' },
			got_key: { label: 'The party took the conductor’s key' },
			opened_baggage: { label: 'The baggage car was unlocked' },
			read_manifest: {
				label: 'The party read the 1861 manifest',
				does: [{ reward: 'The 1861 manifest' }]
			},
			won_coffin: {
				label: 'The coffins’ dead were beaten',
				does: [
					say(
						'In the third coffin, wrapped in a shroud and white with frost, Mr. Ellis Grant opens his eyes and asks what year it is.'
					),
					{ reward: 'Mr. Grant, alive' }
				]
			},
			dead_dispersed: { label: 'The dead passengers were laid low' },
			reached_front: { label: 'The party reached the front of the train' },
			pike_confessed: { label: 'The conductor confessed' },
			won_engineer: { label: 'The dead engineer was stopped' },
			whistle_blown: {
				label: 'The whistle was sounded',
				does: [{ reward: 'The last whistle' }]
			},
			chose_ride: { label: 'The party chose to ride on to Blackwater' },
			decided: { label: 'The last train’s fate was decided' }
		},
		decisions: {
			reckoning: {
				prompt:
					'The bridge is out ahead, and the dead are waiting. What becomes of the last train?',
				options: [
					{
						id: 'brake',
						label: 'Throw the brake and stop short of the bridge',
						does: [
							say(
								'You throw your weight on the brake. The wheels shriek and throw sparks the length of the train, and the engine stops with her cowcatcher over the river.'
							),
							{ event: 'decided' }
						]
					},
					{
						id: 'confess',
						label: 'Make Pike face the dead',
						labels: [
							{
								if: { events: ['pike_confessed'] },
								label: 'Let Pike finish his confession, to the dead this time'
							}
						],
						does: [
							{
								rules: [
									{
										if: { not: ['pike_confessed'] },
										do: [
											say(
												'You haul Pike forward to the cab. He looks down the train at the dead at the windows, and the whole story comes out of him at once.'
											),
											{ tell: 'confession' }
										]
									}
								]
							},
							say(
								'Pike climbs down onto the track and walks back along the train, saying their names, one by one, the way he read them off the manifest thirty years ago.'
							),
							{ event: 'decided' }
						]
					},
					{
						id: 'ride',
						label: 'Ride on to Blackwater with the dead',
						does: [
							say(
								'You open the throttle. The engine leaps forward toward the gap in the bridge, and does not fall.'
							),
							{ event: 'chose_ride' },
							{ enter: 'to_blackwater' }
						]
					}
				]
			}
		},
		endings: {
			decision: 'reckoning',
			fallback: 'brake',
			names: {
				stopped: { title: 'Stopped Short' },
				rest: { title: 'Laid to Rest' },
				line: { title: 'End of the Line' }
			},
			byAnswer: {
				brake: {
					ending: 'stopped',
					subtitle: 'The train stopped at the bridge',
					headline: 'The living got off the train',
					text: 'Dawn finds the night train at the edge of the Blackwater bridge, and its passengers walking back along the spur toward Cutter’s Junction. The dead are gone from the cars. Next March, on the anniversary, the Southern Pacific will lose a train again.',
					scene:
						'The engine stands over the river, steam leaking from her cylinders, and every seat in the coach is empty.',
					cue: 'toll',
					result: [
						{ label: 'The passengers', value: 'Alive, and walking home' },
						{ label: 'The dead', value: 'Still riding, every March' },
						{ label: 'Amos Pike', value: 'Keeping his secret' }
					],
					lines: [
						{
							if: { events: ['pike_confessed'] },
							do: [
								say(
									'Pike walks at the back of the line, and at the junction he turns and goes back along the rails alone.'
								)
							]
						}
					],
					does: [{ ambient: 'dusk' }]
				},
				confess: {
					ending: 'rest',
					subtitle: 'The dead heard the truth',
					headline: 'The dead are laid to rest',
					text: 'One by one, as Pike says their names, the dead at the windows nod and are gone, like breath off glass. The last to go is the engineer, Wade Dollar, who tips his scorched cap to the man who left him on the bridge.',
					scene:
						'The lamps burn steady again the length of the train, warm and yellow, and the carriages are only carriages.',
					cue: 'flash',
					result: [
						{ label: 'The passengers', value: 'Alive, at dawn at Cutter’s Junction' },
						{ label: 'The dead', value: 'At rest, after thirty years' },
						{ label: 'Amos Pike', value: 'Forgiven, if not by himself' }
					],
					lines: [
						{
							if: { found: ['dollar'] },
							do: [
								say(
									'Jack Dollar watches his grandfather go, and deals himself a hand of patience all the way back to Tucson.'
								)
							]
						}
					],
					does: [
						{ ambient: 'dusk' },
						{ light: TRAIN_IDS.coachLamps[0], on: true },
						{ light: TRAIN_IDS.diningLamp, on: true }
					]
				},
				ride: {
					ending: 'line',
					subtitle: 'The last train reached Blackwater',
					headline: 'The last train came in',
					text: 'The thing in the river sinks back into the dark, and the dead of Blackwater walk up from the platform into their town, home at last. The train waits with steam up. In the morning it is standing at Cutter’s Junction, and nobody can say how it got there.',
					scene:
						'Blackwater under a white moon: an empty platform, an empty street, and forty new names cut sharp into the old stones.',
					cue: 'toll',
					result: [
						{ label: 'The passengers', value: 'Back at Cutter’s Junction' },
						{ label: 'The dead', value: 'Home in Blackwater' },
						{ label: 'The line', value: 'Closed, for good this time' }
					],
					lines: [
						{
							if: { events: ['whistle_blown'] },
							do: [
								say(
									'Far off down the line, a train whistle sounds once, in answer to yours, and then never again.'
								)
							]
						}
					]
				}
			}
		},
		npcs: {
			pike: {
				name: 'Amos Pike',
				role: 'The conductor. The only survivor of the 1861 Blackwater train, which he left to its fate.',
				speaker: 'Pike',
				color: '#3b4a6b',
				model: 'watchman',
				location: 'train',
				home: 'The front of the coach',
				places: { calm: at(65, 2), huddled: at(65, 4) },
				states: ['calm', 'worried', 'broken'],
				lines: [
					{
						id: 'hello',
						text: 'Evening. Amos Pike, conductor. I’d be grateful for help, if you’re the kind that gives it. A passenger has gone missing, and this is no night to be missing on.',
						if: { not: ['met_conductor'] },
						becomes: 'worried',
						event: 'met_conductor'
					},
					{
						id: 'confess',
						text: 'You found the manifest. Then you know. Blackwater, March of ’61. I was brakeman. The bridge was groaning under us and I pulled the coupling pin on the last car and rode it back to safety. I left forty people on that bridge. Every March I ride this line, and every March they come looking for me.',
						if: { clues: ['manifest'], not: ['pike_confessed'] },
						becomes: 'broken',
						clue: 'confession',
						event: 'pike_confessed'
					},
					{
						id: 'switch',
						text: 'We should have stayed on the main line at Cutter’s Junction. Somebody threw the switch for the Blackwater spur. I was on the platform; I saw the lever move. There was nobody holding it.',
						if: { not: ['learned_spur'] },
						once: true,
						clue: 'switch'
					},
					{
						id: 'midnight',
						text: 'Don’t look at them. Don’t look at the passengers who weren’t aboard at supper.',
						if: { chapter: ['midnight'] }
					},
					{
						id: 'otherwise',
						text: 'Blackwater’s a dead town. There’s no reason on God’s earth for this train to be going there.'
					}
				]
			},
			elias: {
				name: 'Brother Elias Crow',
				role: 'A travelling preacher who knows the dead are riding',
				speaker: 'Brother Elias',
				color: '#2b2b2b',
				model: 'priest',
				location: 'train',
				home: 'The coach',
				places: { calm: at(50, 2), huddled: at(50, 3) },
				states: ['calm'],
				lines: [
					{
						id: 'bless',
						text: 'Come here, child. Let me say a word over you before the night gets any older.',
						once: true,
						heals: 3,
						event: 'asked_around'
					},
					{
						id: 'cold',
						text: 'That cold is the breath of the dead. They’re riding with us tonight, and they’re going home.',
						if: { found: ['frost'] }
					},
					{
						id: 'otherwise',
						text: 'Every soul aboard is bound somewhere. Not all of us are bound where we bought a ticket to.',
						event: 'asked_around'
					}
				]
			},
			jack: {
				name: 'Lucky Jack Dollar',
				role: 'A gambler; grandson of Wade Dollar, the engineer who died at Blackwater',
				speaker: 'Jack Dollar',
				color: '#6b3b2b',
				model: 'wide-hat',
				location: 'train',
				home: 'The dining car, over a hand of cards',
				places: { calm: at(36, 2) },
				states: ['calm', 'shaken'],
				lines: [
					{
						id: 'granddad',
						text: 'Lucky Jack Dollar, at your service. Blackwater? My granddad drove the train on that line, till the bridge took him. Family never had much luck since. Except me, at cards.',
						once: true,
						clue: 'dollar',
						event: 'asked_around'
					},
					{
						id: 'whistle',
						text: 'That’s granddad’s whistle. I’d know it anywhere. He’s up front, isn’t he?',
						if: { chapter: ['midnight'] },
						becomes: 'shaken'
					},
					{ id: 'otherwise', text: 'Cards don’t lie, friend. They just don’t say much.' }
				]
			},
			hattie: {
				name: 'Mrs. Hattie Moss',
				role: 'A widow in black; one of the Blackwater dead, riding home',
				speaker: 'Mrs. Moss',
				color: '#1b1b22',
				model: 'elder',
				location: 'train',
				home: 'The dining car',
				places: { calm: at(41, 4) },
				states: ['calm', 'revealed'],
				lines: [
					{
						id: 'known',
						text: 'My name’s on that paper, isn’t it? Hattie Moss, seat twelve. I’ve been going home to Blackwater a long time now.',
						if: { found: ['manifest'] },
						becomes: 'revealed'
					},
					{
						id: 'home',
						text: 'I’m going home to Blackwater. I’ve been going home a long time.',
						clue: 'hattie',
						event: 'asked_around'
					}
				]
			},
			tommy: {
				name: 'Tommy Reyes',
				role: 'The newsboy, who sees more than the grown-ups',
				speaker: 'Tommy',
				color: '#8a6a2b',
				model: 'child',
				location: 'train',
				home: 'The coach, selling papers',
				places: { calm: at(56, 2), huddled: at(61, 4) },
				states: ['calm', 'scared'],
				lines: [
					{
						id: 'papers',
						text: 'Mister! Look at my papers! They all say 1861!',
						if: { chapter: ['midnight'] },
						once: true,
						clue: 'newspaper',
						becomes: 'scared'
					},
					{
						id: 'lady',
						text: 'I saw a lady in black walk right through the baggage car door. Through it, mister, not in it.',
						if: { found: ['frost'] },
						once: true,
						clue: 'lady'
					},
					{ id: 'otherwise', text: 'Paper, mister? Two cents.', event: 'asked_around' }
				]
			},
			doc: {
				name: 'Doc Harlan',
				role: 'A country doctor going east',
				speaker: 'Doc Harlan',
				color: '#4b5b3b',
				model: 'villager',
				location: 'train',
				home: 'The coach',
				places: { calm: at(53, 4), huddled: at(52, 3) },
				states: ['calm'],
				lines: [
					{ id: 'patch', text: 'Hold still. This will sting.', once: true, heals: 4 },
					{
						id: 'otherwise',
						text: 'The dead don’t need a doctor. The living might, before morning.'
					}
				]
			}
		},
		peoplePlaces: [{ place: 'huddled', if: { chapter: ['midnight'] } }],
		reactions: [
			{
				id: 'pike-unlock',
				npc: 'pike',
				on: 'baggage-door:unlock',
				text: 'Mind yourselves in there.'
			},
			{
				id: 'tommy-won',
				npc: 'tommy',
				on: 'event:won_coffin',
				text: 'The lamps are going out! All down the train!'
			}
		],
		objects: [
			{
				id: 'ticket',
				name: 'Torn ticket',
				kind: 'book',
				location: 'train',
				thing: { prop: TRAIN_IDS.ticket },
				initial: 'interactable',
				states: ['interactable', 'used'],
				firstFind: 'ticket',
				noticed: 'Something pale lies in the aisle a few rows back, fluttering in the draught.',
				verbs: [
					{
						id: 'examine',
						label: 'Pick up the ticket',
						from: ['interactable', 'used'],
						to: 'used',
						does: [{ do: [{ clue: 'ticket' }] }]
					}
				]
			},
			{
				id: 'timetable',
				name: 'Timetable',
				kind: 'book',
				location: 'train',
				thing: { prop: TRAIN_IDS.timetable },
				initial: 'interactable',
				states: ['interactable', 'used'],
				verbs: [
					{
						id: 'read',
						label: 'Read the timetable',
						from: ['interactable', 'used'],
						to: 'used',
						does: [{ do: [{ clue: 'timetable' }] }]
					}
				]
			},
			{
				id: 'berth',
				name: 'Berth three',
				kind: 'container',
				location: 'train',
				thing: { prop: TRAIN_IDS.berth },
				initial: 'interactable',
				states: ['interactable', 'used'],
				verbs: [
					{
						id: 'search',
						label: 'Search the berth',
						from: ['interactable', 'used'],
						to: 'used',
						check: { stat: 'wits', dc: 10 },
						does: [
							{ if: { state: ['used'] }, do: [say('Boots, a valise, a Bible never opened.')] },
							{ do: [{ clue: 'frost' }] }
						]
					}
				]
			},
			{
				id: 'brass-key',
				name: 'Brass key',
				kind: 'item',
				location: 'train',
				thing: { prop: TRAIN_IDS.key },
				initial: 'hidden',
				states: ['hidden', 'interactable'],
				carry: true,
				verbs: [
					{
						id: 'take',
						label: 'Take the key',
						from: ['interactable'],
						to: 'carried',
						physical: 'pick_up',
						does: [{ do: [{ event: 'got_key' }] }]
					},
					{
						id: 'drop',
						label: 'Put the key down',
						from: ['carried'],
						to: 'interactable',
						physical: 'drop'
					}
				]
			},
			{
				id: 'baggage-door',
				name: 'Baggage car door',
				kind: 'door',
				location: 'train',
				thing: { door: TRAIN_IDS.baggageDoor },
				initial: 'disabled',
				states: ['disabled', 'closed', 'opened'],
				disabledText: 'Locked. Mr. Pike has the key.',
				verbs: [
					{
						id: 'unlock',
						label: 'Unlock the door',
						from: ['disabled'],
						to: 'closed',
						needs: 'brass-key',
						sound: 'clank',
						does: [
							{
								do: [
									say('The brass key turns. Cold air breathes out around the door.'),
									{ event: 'opened_baggage' }
								]
							}
						]
					}
				]
			},
			{
				id: 'coffin',
				name: 'Third coffin',
				kind: 'corpse',
				location: 'train',
				thing: { prop: TRAIN_IDS.coffin },
				initial: 'interactable',
				states: ['interactable', 'used'],
				looks: { used: { assetId: 'coffin-open' } },
				verbs: [
					{
						id: 'open',
						label: 'Open the coffin',
						from: ['interactable'],
						to: 'used',
						physical: 'open',
						does: [
							{
								do: [
									say(
										'The lid is lighter than it should be. As it slides aside, the other lids slide aside too.'
									),
									{ fight: 'coffins' }
								]
							}
						]
					}
				]
			},
			{
				id: 'strongbox',
				name: 'Strongbox',
				kind: 'chest',
				location: 'train',
				thing: { prop: TRAIN_IDS.strongbox },
				initial: 'interactable',
				states: ['interactable', 'used'],
				verbs: [
					{
						id: 'search',
						label: 'Open the strongbox',
						from: ['interactable', 'used'],
						to: 'used',
						needs: 'brass-key',
						does: [
							{
								if: { state: ['used'] },
								do: [say('Only the old manifest, and a coupling pin gone black with age.')]
							},
							{ do: [{ clue: 'manifest' }] }
						]
					}
				]
			},
			{
				id: 'stove',
				name: 'Stove',
				kind: 'landmark',
				location: 'train',
				thing: { prop: TRAIN_IDS.stove },
				light: TRAIN_IDS.stoveGlow,
				initial: 'interactable',
				states: ['interactable'],
				verbs: [
					{
						id: 'warm',
						label: 'Warm your hands',
						from: ['interactable'],
						does: [
							{
								if: { said: ['stove:warmed'] },
								do: [say('The stove is the only warm thing aboard.')]
							},
							{
								do: [
									{ remember: 'stove:warmed' },
									say('You stand at the stove until the feeling comes back into your fingers.'),
									{ heal: 2 }
								]
							}
						]
					}
				]
			},
			{
				id: 'throttle',
				name: 'Throttle',
				kind: 'mechanism',
				location: 'engine',
				thing: { prop: ENGINE_IDS.throttle },
				initial: 'interactable',
				states: ['interactable', 'used'],
				verbs: [
					{
						id: 'seize',
						label: 'Seize the throttle',
						from: ['interactable'],
						to: 'used',
						inFight: true,
						does: [
							{
								do: [
									say(
										'You wrench the throttle back. The dead engineer turns on you with a howl like a boiler letting go.'
									)
								]
							}
						]
					}
				]
			},
			{
				id: 'brake',
				name: 'Brake',
				kind: 'mechanism',
				location: 'engine',
				thing: { prop: ENGINE_IDS.brake },
				initial: 'interactable',
				states: ['interactable'],
				verbs: [
					{
						id: 'pull',
						label: 'Try the brake',
						from: ['interactable'],
						does: [
							{
								if: { chapter: ['the_bridge'] },
								do: [say('Your hand is on the brake. All that is left is to decide.')]
							},
							{ do: [say('It will not budge while the dead man drives.')] }
						]
					}
				]
			},
			{
				id: 'whistle',
				name: 'Whistle cord',
				kind: 'mechanism',
				location: 'engine',
				thing: { prop: ENGINE_IDS.whistle },
				initial: 'interactable',
				states: ['interactable', 'used'],
				verbs: [
					{
						id: 'pull',
						label: 'Pull the whistle cord',
						from: ['interactable'],
						to: 'used',
						inFight: true,
						triggers: 'whistle'
					}
				]
			},
			{
				id: 'graves',
				name: 'Graves of 1861',
				kind: 'landmark',
				location: 'blackwater',
				thing: { prop: BLACKWATER_IDS.grave },
				initial: 'interactable',
				states: ['interactable'],
				verbs: [
					{
						id: 'read',
						label: 'Read the stones',
						from: ['interactable'],
						does: [
							{
								if: { found: ['dollar'] },
								do: [
									say(
										'The stones have no names on them, but one: Wade Dollar, engineer. The rest are blank, waiting.'
									)
								]
							},
							{ do: [say('Forty stones, and no names on any of them. Waiting.')] }
						]
					}
				]
			}
		],
		signs: [
			{
				id: 'trail',
				location: 'train',
				sense: 'observe',
				at: at(16, 3),
				range: 5,
				check: { stat: 'wits', dc: 9 },
				clue: 'trail'
			},
			{
				id: 'breathing',
				location: 'train',
				sense: 'listen',
				at: at(7, 2),
				range: 5,
				check: { stat: 'spirit', dc: 10 },
				clue: 'breathing'
			},
			{
				id: 'wheels',
				location: 'train',
				sense: 'listen',
				at: at(40, 3),
				range: 20,
				check: { stat: 'wits', dc: 12 },
				clue: 'wheels'
			}
		],
		clues: {
			ticket: {
				title: 'A torn ticket',
				text: 'A torn ticket: “Tucson to Blackwater, single. 14 March 1861.” The ink is fresh, and the paper is cold as ice.',
				kind: 'document'
			},
			timetable: {
				title: 'The timetable',
				text: 'Pasted over the timetable, an old notice: “BLACKWATER SPUR. CLOSED. BRIDGE OUT, MARCH 1861.” Beneath it someone has scratched a new departure: “Tonight.”',
				kind: 'document',
				unlocks: 'learned_spur'
			},
			switch: {
				title: 'The switch at Cutter’s Junction',
				text: 'Pike saw the switch for the Blackwater spur thrown at Cutter’s Junction, with nobody at the lever.',
				kind: 'testimony',
				unlocks: 'learned_spur'
			},
			frost: {
				title: 'Frost in berth three',
				text: 'Frost on the inside of berth three’s window in the shape of a hand, and a trail of it across the floor toward the rear of the train.',
				kind: 'environment',
				unlocks: 'searched_berth'
			},
			trail: {
				title: 'The frost trail',
				text: 'The frost trail runs along the sleeper’s corridor, across the gangway and under the locked baggage car door.',
				kind: 'environment',
				unlocks: 'trail_found'
			},
			lady: {
				title: 'The lady in black',
				text: 'Tommy saw a lady in black walk straight through the baggage car door, as if it were not there.',
				kind: 'testimony',
				unlocks: 'trail_found'
			},
			dollar: {
				title: 'Wade Dollar',
				text: 'Jack Dollar’s grandfather, Wade Dollar, drove the Blackwater train in 1861 and died when the bridge fell.',
				kind: 'testimony'
			},
			hattie: {
				title: 'Mrs. Moss is going home',
				text: 'Mrs. Hattie Moss says she has been going home to Blackwater “a long time”.',
				kind: 'testimony'
			},
			breathing: {
				title: 'A breathing coffin',
				text: 'Under the rattle of the baggage car: slow, shallow breathing, from inside the third coffin.',
				kind: 'environment'
			},
			wheels: {
				title: 'A second set of wheels',
				text: 'Under the clatter of the wheels, a second set of wheels, running on rails that aren’t there.',
				kind: 'environment'
			},
			manifest: {
				title: 'The 1861 manifest',
				text: 'The Blackwater train’s manifest, March 1861: forty names, among them Mrs. Hattie Moss, seat twelve, and Engineer W. Dollar. Only one is marked survived: A. Pike, brakeman.',
				kind: 'document',
				unlocks: 'read_manifest'
			},
			newspaper: {
				title: 'Tomorrow’s papers',
				text: 'Every paper in Tommy’s bag reads 15 March 1861: “BLACKWATER BRIDGE FALLS. ALL LOST BUT ONE.”',
				kind: 'document'
			},
			confession: {
				title: 'Pike’s confession',
				text: 'Amos Pike was brakeman on the Blackwater train. As the bridge gave way he pulled the coupling pin on the last car and rode it back to safety, leaving the rest to fall.',
				kind: 'testimony'
			}
		},
		mechanisms: {
			whistle: {
				location: 'engine',
				steps: [
					{
						after: 0,
						motion: { prop: ENGINE_IDS.whistle, kind: 'shake', sound: 'chime' },
						text: 'The whistle screams out over the dark prairie.'
					},
					{
						after: 1200,
						text: 'All down the train, every lamp flares at once, and the dead at the windows turn toward the engine.',
						event: 'whistle_blown'
					}
				]
			}
		},
		enemies: {
			shade: {
				name: 'Dead passenger',
				model: 'robed-figure',
				color: '#8fa9b2',
				armor: 1,
				speed: 4,
				vision: 6,
				light: 3,
				initiative: 0,
				hp: { base: 5, perCharacter: 2 },
				attacks: [{ name: 'Cold grip', range: 1, toHit: 3, damage: '1d6' }],
				behavior: 'rush'
			},
			revenant: {
				name: 'Revenant gunman',
				model: 'hatted-shade',
				color: '#5e6d70',
				armor: 2,
				speed: 4,
				vision: 8,
				light: 0,
				initiative: 2,
				hp: { base: 6, perCharacter: 2 },
				attacks: [
					{ name: 'Pistol-whip', range: 1, toHit: 3, damage: '1d6' },
					{ name: 'Six-gun', range: 7, toHit: 4, damage: '1d8' }
				],
				behavior: 'skirmish'
			},
			engineer: {
				name: 'The dead engineer',
				model: 'armored-brute',
				color: '#3d3f41',
				armor: 3,
				speed: 3,
				vision: 8,
				light: 3,
				initiative: 1,
				hp: { base: 16, perCharacter: 6 },
				attacks: [{ name: 'Coal shovel', range: 1, toHit: 5, damage: '1d10+2' }],
				behavior: 'guardian',
				toll: {
					range: 2,
					damage: '1d6',
					rounds: 1,
					every: 2,
					text: 'The dead engineer hauls on the whistle, and the scream of it staggers everyone near.',
					flash: 'Steam and firelight flood the cab.'
				}
			},
			wreck: {
				name: 'The Blackwater wreck',
				model: 'pulsing-mass',
				color: '#2f3f46',
				armor: 2,
				speed: 0,
				vision: 12,
				light: 0,
				initiative: 0,
				hp: { base: 18, perCharacter: 8 },
				attacks: [{ name: 'Drowning weight', range: 2, toHit: 5, damage: '2d6' }],
				behavior: 'grasp'
			},
			drowned: {
				name: 'Drowned hands',
				model: 'tentacle',
				color: '#3f5a66',
				armor: 1,
				speed: 0,
				vision: 10,
				light: 0,
				initiative: 1,
				hp: { base: 5, perCharacter: 2 },
				attacks: [{ name: 'Cold hands', range: 1, toHit: 4, damage: '1d6' }],
				behavior: 'grasp'
			}
		},
		encounters: {
			coffins: {
				name: 'The coffins’ dead',
				location: 'train',
				ring: [at(9, 3), at(9, 4), at(10, 2)],
				foes: [{ kind: 'revenant' }, { kind: 'revenant' }],
				reveal: BAGGAGE,
				opening:
					'Two dead men in Sunday suits sit up out of their coffins, pistols in their hands.',
				won: {
					text: 'The revenants fold back into their coffins like dropped coats.',
					event: 'won_coffin'
				}
			},
			the_dead: {
				name: 'The dead passengers',
				location: 'train',
				ring: [],
				foes: [],
				sentries: [
					{ kind: 'shade', route: [at(17, 3), at(27, 3)] },
					{ kind: 'shade', route: [at(32, 3), at(44, 3)] },
					{ kind: 'shade', route: [at(49, 3), at(57, 3)] }
				],
				opening: 'The dead passengers turn toward you as one, and their lanterns swing up.',
				won: { text: 'The dead passengers fade like breath off glass.', event: 'dead_dispersed' }
			},
			engineer: {
				name: 'The dead engineer',
				location: 'engine',
				ring: ENGINE_RING,
				foes: [{ kind: 'engineer' }, { kind: 'shade' }, { kind: 'shade' }],
				reveal: { from: at(0, 0), to: at(21, 8) },
				opening:
					'The engineer turns from the throttle. Behind him, two of the dead climb in over the tender.',
				won: {
					text: 'The engineer’s ghost lets go of the throttle, and is gone in a gust of steam.',
					event: 'won_engineer',
					does: [{ reward: 'Wade Dollar’s scorched cap' }]
				}
			},
			wreck: {
				name: 'The Blackwater wreck',
				location: 'blackwater',
				ring: RIVER_RING,
				foes: [{ kind: 'wreck' }, { kind: 'drowned' }, { kind: 'drowned' }],
				reveal: { from: at(0, 0), to: at(25, 15) },
				opening:
					'Out of the river rises the wreck of the 1861 train, carriages and bones and all, and reaches for the platform.',
				won: {
					text: 'The wreck sinks back beneath the black water, and is still.',
					event: 'decided'
				}
			}
		},
		ward: { object: 'throttle', touched: 'used' },
		cues: [
			{
				id: 'history',
				title: 'The Blackwater bridge, 1861',
				text: 'On the fourteenth of March, 1861, the Blackwater bridge gave way under the evening train. Forty passengers and the engineer, Wade Dollar, went into the river. The brakeman, Amos Pike, was found alive a mile back along the line, alone in the last car. The spur was closed and the town died within the year.'
			},
			{
				id: 'midnight',
				title: 'Midnight on the spur',
				text: 'The lamps burn blue. Frost crawls up the inside of every window. In the aisle, a dead woman in black sets down her carpetbag and sits, and looks straight ahead, and waits to be home.'
			}
		],
		voice: {
			started: 'All aboard. Choose your characters.',
			nothingFound: 'Nothing but cinders and dust.',
			hearNothing: 'Only the wheels on the rails.',
			seeNothing: 'Nothing but the dark prairie going by.',
			revive: 'You drag each other up off the floor of the swaying car.',
			defeat: 'The last train runs on into the dark, and you ride it forever.',
			gone: '{name} is gone, left behind somewhere on the line.'
		}
	};
}

function rect(c: GridPos) {
	return { from: { ...c }, to: { ...c } };
}
