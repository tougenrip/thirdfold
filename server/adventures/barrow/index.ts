// The Barrow on Cold Hill: a short adventure played by the fifth edition
// rules (ruleset dnd-5.5e, SRD 5.2.1), the play slice that shows those rules
// at the table: an Investigation check to read the ward on the door, an
// Athletics check to force it, a Dexterity saving throw against the darts in
// the threshold (unless the ward was read), and a fight in the dark barrow
// against a Barrow Guard (attack rolls against Armor Class) and a Cold Shade
// (a Constitution saving throw against its chill). The story, people and
// foes are thirdfold's own; the rules are the SRD's.
//
// The four characters are the same four people as ever, built as level 1
// fifth edition characters from the SRD catalog (party.ts).

import type { AdventureDef } from '../../adventure/define';
import { cellsOf, door, light, prop, table, wall } from '../../adventure/tables';
import { DND_55E } from '../../rules/dnd55e';
import { ember, saint, veil, warden } from './party';

/** The table's fixed ids. */
export const BARROW_IDS = {
	door: 'barrow-door',
	carvings: 'barrow-carvings',
	coffin: 'barrow-coffin',
	altar: 'barrow-altar'
} as const;

/** Where the party arrives, on the hillside below the barrow. */
export const BARROW_SPAWN = cellsOf({ x: 6, y: 10 }, { x: 9, y: 11 });
/** The carved stones beside the door. */
export const CARVINGS_AT = { x: 5, y: 9 };
/** The threshold, just inside the door. */
export const THRESHOLD = { x: 7, y: 7 };

const say = (text: string) => ({ say: text });

export const BARROW: AdventureDef = {
	id: 'barrow',
	title: 'The Barrow on Cold Hill',
	about:
		'A short delve for fifth edition rules (SRD 5.2.1): read an old ward, force a barrow door, and lay its guardians to rest.',
	version: 1,
	rules: { ...DND_55E },
	characters: { warden, veil, ember, saint },
	start: {
		location: 'hill',
		chapter: 'door',
		arrival: [
			say(
				'Dusk on Cold Hill. The barrow door is a slab of grey stone in the turf, carved all over, and the air that seeps around it is colder than the wind.'
			)
		]
	},
	locations: {
		hill: {
			name: 'Cold Hill',
			spawn: BARROW_SPAWN,
			welcome: 'An old barrow in the hillside, and a door nobody has opened in a long time.',
			scene: () =>
				table({
					name: 'Cold Hill',
					grid: { kind: 'square', cellSize: 1, width: 16, height: 12 },
					objects: [
						wall('barrow-n', { x: 2, y: 1 }, { x: 14, y: 1 }),
						wall('barrow-w', { x: 2, y: 1 }, { x: 2, y: 8 }),
						wall('barrow-e', { x: 14, y: 1 }, { x: 14, y: 8 }),
						wall('barrow-sw', { x: 2, y: 8 }, { x: 7, y: 8 }),
						door(BARROW_IDS.door, { x: 7, y: 8 }, { x: 8, y: 8 }),
						wall('barrow-se', { x: 8, y: 8 }, { x: 14, y: 8 })
					],
					props: [
						prop(BARROW_IDS.carvings, 'carvings', CARVINGS_AT.x, CARVINGS_AT.y),
						prop(BARROW_IDS.coffin, 'coffin', 10, 2),
						prop(BARROW_IDS.altar, 'altar', 5, 2),
						prop('barrow-pillar-w', 'pillar', 4, 5),
						prop('barrow-pillar-e', 'pillar', 11, 5),
						prop('barrow-stone-1', 'gravestone', 1, 10),
						prop('barrow-stone-2', 'gravestone', 14, 10)
					],
					lights: [
						light('barrow-candle', 5, 3, 1, '#ffb347'),
						light('barrow-grave-light', 11, 3, 2, '#9fd3ff')
					],
					tokens: [],
					ambient: 'dusk',
					arrival: { from: { x: 0, y: 8 }, to: { x: 15, y: 11 } },
					dark: [{ from: { x: 2, y: 1 }, to: { x: 13, y: 7 } }],
					environment: 'stone-halls'
				})
		}
	},
	areas: [
		{
			event: 'crossed_threshold',
			during: 'inside',
			location: 'hill',
			from: THRESHOLD,
			to: THRESHOLD
		},
		{
			event: 'woke_guardians',
			during: 'inside',
			location: 'hill',
			from: { x: 3, y: 2 },
			to: { x: 13, y: 5 }
		}
	],
	chapters: {
		door: {
			id: 'door',
			title: 'The barrow door',
			location: 'hill',
			objectives: [
				{ id: 'ward', text: 'Read the carvings by the door', done: 'read_ward' },
				{ id: 'force', text: 'Force the barrow door', done: 'door_forced' }
			],
			next: { on: 'door_forced', to: 'inside' }
		},
		inside: {
			id: 'inside',
			title: 'Under the hill',
			location: 'hill',
			objectives: [{ id: 'rest', text: 'Lay the barrow’s guardians to rest', done: 'won_barrow' }],
			next: { on: 'decided', to: null }
		}
	},
	events: {
		read_ward: { label: 'The ward on the door is read' },
		door_forced: { label: 'The barrow door is forced' },
		crossed_threshold: {
			label: 'Someone crossed the threshold',
			does: [
				{
					rules: [
						{
							if: { events: ['read_ward'] },
							do: [
								say(
									'The ward said it plainly: step over the third stone. The party does, and the darts in the lintel stay where they are.'
								)
							]
						},
						{
							do: [
								say('A stone shifts underfoot. Darts hiss from the lintel!'),
								{
									hurt: {
										near: BARROW_IDS.door,
										within: 1,
										dice: '2d6',
										text: 'Darts from the lintel strike {name}',
										save: { stat: 'dex', dc: 12, half: true }
									}
								}
							]
						}
					]
				}
			]
		},
		woke_guardians: {
			label: 'The guardians wake',
			does: [
				say(
					'The lid of the coffin grinds aside. Something in rusted mail sits up, and the cold takes shape beside it.'
				),
				{ fight: 'guardians' }
			]
		},
		won_barrow: { label: 'The guardians are at rest', does: [{ offer: 'grave-goods' }] },
		decided: { label: 'The grave goods are decided' }
	},
	decisions: {
		'grave-goods': {
			id: 'grave-goods',
			prompt:
				'Grave goods lie on the altar: a silver torc, old coins, a sword in its scabbard. What of them?',
			options: [
				{ id: 'take', label: 'Take them', does: [{ event: 'decided' }] },
				{ id: 'leave', label: 'Leave them with the dead', does: [{ event: 'decided' }] }
			]
		}
	},
	endings: {
		decision: 'grave-goods',
		fallback: 'leave',
		names: { spoils: { title: 'Spoils' }, respect: { title: 'Respect' } },
		byAnswer: {
			take: {
				ending: 'spoils',
				subtitle: 'The grave goods were taken',
				headline: 'The barrow is empty',
				text: 'You carry the silver down the hill. Behind you, the cold settles back into the stones, waiting.',
				scene: 'The barrow door stands open on an empty dark.',
				cue: 'toll',
				result: [
					{ label: 'The grave goods', value: 'Taken' },
					{ label: 'The barrow', value: 'Open, and cold' }
				]
			},
			leave: {
				ending: 'respect',
				subtitle: 'The dead were left their own',
				headline: 'The barrow sleeps',
				text: 'You set the lid back on the coffin and close the door behind you. The hill is only a hill again.',
				scene: 'The barrow door is shut, and the carvings seem older and quieter.',
				cue: 'flash',
				result: [
					{ label: 'The grave goods', value: 'Left with the dead' },
					{ label: 'The barrow', value: 'At rest' }
				]
			}
		}
	},
	npcs: {},
	peoplePlaces: [],
	reactions: [],
	objects: [
		{
			id: 'carvings',
			name: 'Carved stones',
			kind: 'book',
			location: 'hill',
			thing: { prop: BARROW_IDS.carvings },
			initial: 'interactable',
			states: ['interactable', 'used'],
			verbs: [
				{
					id: 'examine',
					label: 'Study the carvings',
					from: ['interactable'],
					to: 'used',
					check: { stat: 'investigation', dc: 12 },
					does: [{ do: [{ clue: 'ward' }] }]
				}
			]
		},
		{
			id: 'barrow-door',
			name: 'Barrow door',
			kind: 'door',
			location: 'hill',
			thing: { door: BARROW_IDS.door },
			initial: 'disabled',
			states: ['disabled', 'closed', 'opened'],
			disabledText: 'The slab is stuck fast in its frame. It would take real strength to shift it.',
			verbs: [
				{
					id: 'force',
					label: 'Force the door',
					from: ['disabled'],
					to: 'closed',
					check: { stat: 'athletics', dc: 13 },
					sound: 'grind',
					does: [
						{
							do: [
								say('The slab grinds loose in its frame. It will open now.'),
								{ event: 'door_forced' }
							]
						}
					]
				}
			]
		}
	],
	signs: [
		{
			id: 'cold-air',
			location: 'hill',
			sense: 'listen',
			at: { x: 7, y: 8 },
			range: 3,
			check: { stat: 'perception', dc: 10 },
			clue: 'breathing'
		}
	],
	clues: {
		ward: {
			id: 'ward',
			title: 'The ward on the door',
			text: 'The carvings are a warning and a way in: “Who comes to wake the watch, step over the third stone.”',
			kind: 'document',
			unlocks: 'read_ward'
		},
		breathing: {
			id: 'breathing',
			title: 'Something breathing',
			text: 'Behind the door, slow as the tide: something that should not breathe, breathing.',
			kind: 'environment'
		}
	},
	mechanisms: {},
	enemies: {
		guard: {
			kind: 'guard',
			name: 'Barrow Guard',
			model: 'armored-brute',
			color: '#7f8c8d',
			armor: 15,
			speed: 5,
			vision: 6,
			light: 0,
			initiative: 0,
			hp: (characters) => 9 + 4 * characters,
			attacks: [{ name: 'Rusted blade', range: 1, toHit: 4, damage: '1d8+2' }],
			behavior: 'rush'
		},
		shade: {
			kind: 'shade',
			name: 'Cold Shade',
			model: 'hatted-shade',
			color: '#5dade2',
			armor: 12,
			speed: 6,
			vision: 8,
			light: 0,
			initiative: 2,
			hp: (characters) => 4 + 2 * characters,
			attacks: [
				{ name: 'Freezing touch', range: 1, toHit: 4, damage: '1d6+2' },
				{
					name: 'Grave chill',
					range: 5,
					toHit: 0,
					damage: '2d6',
					save: { stat: 'con', dc: 12, half: true }
				}
			],
			behavior: 'skirmish'
		}
	},
	encounters: {
		guardians: {
			name: 'The barrow’s guardians',
			location: 'hill',
			ring: [
				{ x: 10, y: 4 },
				{ x: 12, y: 3 },
				{ x: 9, y: 3 },
				{ x: 12, y: 2 }
			],
			foes: [{ kind: 'guard' }, { kind: 'shade' }],
			won: {
				text: 'The guard folds back into its coffin, and the cold goes out of the air.',
				event: 'won_barrow'
			}
		}
	},
	cues: [],
	voice: {
		started: 'The story is ready. Choose your characters.',
		notNow: 'Not now: there is a fight on.',
		nothingFound: 'You find nothing.',
		hearNothing: 'Only the wind over the hill.',
		seeNothing: 'Only turf and old stone.',
		cantMakeOut: 'You can’t make it out.',
		blocked: 'The {name} won’t go there.',
		revive: 'You help each other up.',
		defeat: 'The barrow keeps its dead, and you among them.',
		gone: '{name} is gone.'
	}
};
