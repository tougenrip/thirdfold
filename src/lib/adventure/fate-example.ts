// A short adventure for Fate Condensed (milestone 60), written as a file: the
// second rules system's proof that a creator can build for it without code,
// a built-in adventure (server/adventures/drowned-lantern) and the builder's
// Fate template. The fen's lantern has gone dark: find out why (an overcome
// with Investigate), cross to the drowned chapel, survive the bog wights
// (a conflict with elective turns, stress and consequences) and decide what
// becomes of the lantern. Its party is built by the rules from choices.

import { at, prop, table } from './example';
import {
	ADVENTURE_FILE_FORMAT,
	ADVENTURE_FILE_VERSION,
	type AdventureFile,
	type PlainJson
} from './file';
import { FATE_PREGENS, FATE_RULES } from '../rules/fate/core';

export const FATE_EXAMPLE_TITLE = 'The Drowned Lantern';

export function fateExampleAdventure(): AdventureFile {
	const choices = (id: string) =>
		FATE_PREGENS.find((p) => p.id === id)!.choices as unknown as PlainJson;
	return {
		format: ADVENTURE_FILE_FORMAT,
		version: ADVENTURE_FILE_VERSION,
		title: FATE_EXAMPLE_TITLE,
		about:
			'A short night in the fens for Fate Condensed: find out who put out the lantern, and face what waits in the drowned chapel.',
		rules: { ...FATE_RULES },
		characters: [],
		party: {
			ida: {
				choices: choices('marshal'),
				intro: 'Ida Brann keeps the causeway lanterns lit. Tonight one of them went out.'
			},
			wren: {
				choices: choices('fowler'),
				intro: 'Wren Holloway heard the reeds go quiet an hour before the light died.'
			},
			aldous: {
				choices: choices('scholar'),
				intro: 'Brother Aldous came for the chapel’s ledgers and stayed for the dark.'
			}
		},
		start: {
			location: 'fen',
			chapter: 'the_causeway',
			arrival: [
				{
					say: 'Mist lies on the black water. At the end of the causeway the old lantern stands dark, and past it the drowned chapel leans into the fen.',
					shot: { focus: at(10, 6), frame: 'wide' }
				}
			]
		},
		locations: {
			fen: {
				name: 'The fen causeway',
				welcome: 'A causeway of old stone across the fen, and a lantern that should be lit.',
				spawn: [at(2, 10), at(3, 10), at(2, 9), at(3, 9)],
				scene: table(
					'The fen causeway',
					16,
					12,
					'village',
					{ time: 1260 },
					[
						[at(0, 0), at(15, 11), 'mud'],
						[at(1, 8), at(6, 11), 'grass'],
						[at(4, 8), at(9, 9), 'flagstone'],
						[at(9, 2), at(14, 7), 'stone']
					],
					[
						prop('lantern', 'sconce', 8, 8),
						prop('notice', 'noticeboard', 4, 9),
						prop('altar', 'altar', 12, 3),
						prop('grave', 'gravestone', 6, 4),
						prop('pool', 'water', 1, 2),
						prop('willow', 'tree', 4, 2)
					],
					[
						[at(9, 2), at(15, 2)],
						[at(9, 2), at(9, 8)],
						[at(15, 2), at(15, 8)],
						[at(9, 8), at(11, 8)],
						[at(12, 8), at(15, 8)]
					]
				)
			}
		},
		areas: [
			{
				event: 'entered',
				during: 'the_chapel',
				location: 'fen',
				from: at(11, 6),
				to: at(12, 7)
			}
		],
		chapters: {
			the_causeway: {
				title: 'The causeway',
				location: 'fen',
				objectives: [
					{ id: 'lantern', text: 'Find out why the lantern went dark', done: 'found_trail' },
					{
						id: 'notice',
						text: 'Read the ferry notice',
						done: 'read_notice',
						optional: true
					}
				],
				next: { on: 'found_trail', to: 'the_chapel' }
			},
			the_chapel: {
				title: 'The drowned chapel',
				location: 'fen',
				objectives: [
					{ id: 'enter', text: 'Go into the drowned chapel', done: 'entered' },
					{ id: 'wights', text: 'Survive the bog wights', done: 'wights_down', after: 'entered' }
				],
				next: { on: 'wights_down', to: 'the_lantern' }
			},
			the_lantern: {
				title: 'The lantern',
				location: 'fen',
				objectives: [{ id: 'decide', text: 'Decide what becomes of the lantern', done: 'decided' }],
				next: { on: 'decided', to: null },
				opening: [{ offer: 'lantern' }]
			}
		},
		events: {
			found_trail: { label: 'The snuffed wick points to the chapel' },
			read_notice: { label: 'The ferry notice is read' },
			entered: {
				label: 'The party went into the chapel',
				does: [
					{ say: 'The water in the font stirs. Two shapes of reed and mud stand up out of it.' },
					{ fight: 'wights' }
				]
			},
			wights_down: { label: 'The bog wights are down' },
			decided: { label: 'The lantern is decided' }
		},
		decisions: {
			lantern: {
				prompt: 'The chapel is still. The lantern’s wick is in your hand. What becomes of it?',
				options: [
					{
						id: 'relight',
						label: 'Relight the lantern',
						does: [{ reward: 'The causeway lit again' }, { event: 'decided' }]
					},
					{
						id: 'drown',
						label: 'Give the wick to the fen',
						does: [{ reward: 'The fen’s quiet' }, { event: 'decided' }]
					}
				]
			}
		},
		endings: {
			decision: 'lantern',
			fallback: 'relight',
			names: { lit: { title: 'The Lantern Lit' }, dark: { title: 'The Fen Kept Dark' } },
			byAnswer: {
				relight: {
					ending: 'lit',
					subtitle: 'The lantern burns again',
					headline: 'The lantern is lit',
					text: 'The flame takes. Across the water, a ferry bell answers.',
					scene: 'A small light stands at the end of the causeway, steady in the mist.',
					cue: 'flash',
					result: [{ label: 'The lantern', value: 'Lit' }]
				},
				drown: {
					ending: 'dark',
					subtitle: 'The wick went into the fen',
					headline: 'The fen keeps its dark',
					text: 'The wick sinks without a ripple. Whatever wanted the dark has it, and leaves you be.',
					scene: 'The causeway runs into the mist, unlit, and nothing follows you home.',
					cue: 'toll',
					result: [{ label: 'The lantern', value: 'Given to the fen' }]
				}
			}
		},
		npcs: {},
		peoplePlaces: [],
		reactions: [],
		objects: [
			{
				id: 'lantern',
				name: 'Causeway lantern',
				kind: 'landmark',
				location: 'fen',
				thing: { prop: 'lantern' },
				initial: 'interactable',
				states: ['interactable', 'used'],
				verbs: [
					{
						id: 'examine',
						label: 'Look over the lantern',
						from: ['interactable'],
						to: 'used',
						check: { stat: 'investigate', dc: 2 },
						does: [{ do: [{ clue: 'snuffed' }, { event: 'found_trail' }] }]
					}
				]
			},
			{
				id: 'notice',
				name: 'Ferry notice',
				kind: 'landmark',
				location: 'fen',
				thing: { prop: 'notice' },
				initial: 'interactable',
				states: ['interactable', 'used'],
				verbs: [
					{
						id: 'read',
						label: 'Read the notice',
						from: ['interactable'],
						to: 'used',
						does: [{ do: [{ clue: 'ferry' }, { event: 'read_notice' }] }]
					}
				]
			}
		],
		signs: [],
		clues: {
			snuffed: {
				title: 'A snuffed wick',
				text: 'The wick was pinched out with wet fingers, and the prints in the mud go toward the chapel.',
				kind: 'environment'
			},
			ferry: {
				title: 'The ferry notice',
				text: 'No crossing after dark while the chapel bell is silent. Keep the lantern lit.',
				kind: 'document'
			}
		},
		mechanisms: {},
		enemies: {
			wight: {
				name: 'Bog wight',
				model: 'robed-figure',
				color: '#5a6b4a',
				// Under Fate Condensed: its defence (Athletics), its Notice, two stress boxes.
				armor: 1,
				speed: 4,
				vision: 6,
				light: 0,
				initiative: 1,
				hp: { base: 3, perCharacter: 0 },
				attacks: [{ name: 'Grasping hands', range: 1, toHit: 2, damage: '0' }],
				behavior: 'rush'
			}
		},
		encounters: {
			wights: {
				name: 'The bog wights',
				location: 'fen',
				ring: [at(10, 5), at(14, 5)],
				foes: [{ kind: 'wight' }, { kind: 'wight' }],
				reveal: { from: at(9, 2), to: at(14, 7) },
				won: { text: 'The last wight slumps back into the font.', event: 'wights_down' }
			}
		},
		cues: []
	};
}
