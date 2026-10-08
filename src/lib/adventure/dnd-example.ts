// A short adventure for the fifth edition rules (SRD 5.2.1), written as a
// file: the builder's D&D template (milestone 57) and the tests' proof that
// a creator can build one without code. A shrine on a hillside: read its
// inscription (a Religion check), open its offering chest (a Dexterity
// saving throw against a needle trap, and a dagger inside), lay its
// guardians to rest (two SRD Skeletons), take a Short Rest, and decide what
// becomes of the shrine. Its party is built by the rules from choices
// (pregens.ts), and players may also bring their own.

import { at, prop, table } from './example';
import {
	ADVENTURE_FILE_FORMAT,
	ADVENTURE_FILE_VERSION,
	type AdventureFile,
	type PlainJson
} from './file';
import { pregenChoices } from '../rules/dnd55e/pregens';

export const DND_EXAMPLE_TITLE = 'The Hillside Shrine';

export function dndExampleAdventure(): AdventureFile {
	const choices = (id: string) => pregenChoices(id) as unknown as PlainJson;
	return {
		format: ADVENTURE_FILE_FORMAT,
		version: ADVENTURE_FILE_VERSION,
		title: DND_EXAMPLE_TITLE,
		about:
			'A short delve for fifth edition rules (SRD 5.2.1): read an old shrine, brave its trap and lay its guardians to rest.',
		rules: { id: 'dnd-5.5e', version: 1 },
		characters: [],
		party: {
			brakka: {
				choices: choices('fighter'),
				intro: 'A soldier who has carried a shield up too many hills to count.'
			},
			wren: {
				choices: choices('rogue'),
				intro: 'Quick fingers, quicker eyes, and a habit of reading what others miss.'
			},
			ilse: {
				choices: choices('wizard'),
				intro: 'A sage who came for the inscription and stayed for the trouble.'
			}
		},
		openParty: true,
		monsters: ['srd-skeleton'],
		start: {
			location: 'hill',
			chapter: 'the_shrine',
			arrival: [
				{
					say: 'A shrine of grey stone stands on the hillside, half sunk in the turf. Something old is carved over its door.'
				}
			]
		},
		locations: {
			hill: {
				name: 'The hillside shrine',
				welcome: 'An old shrine on a hill, its door open to the wind.',
				spawn: [at(6, 10), at(7, 10), at(5, 10), at(8, 10)],
				scene: table(
					'The hillside shrine',
					14,
					12,
					'village',
					{ time: 1020 },
					[
						[at(0, 0), at(13, 11), 'grass'],
						[at(3, 1), at(10, 6), 'stone']
					],
					[
						prop('inscription', 'carvings', 4, 7),
						prop('chest', 'chest', 9, 2),
						prop('altar', 'altar', 6, 2)
					],
					[
						[at(3, 1), at(11, 1)],
						[at(3, 1), at(3, 7)],
						[at(11, 1), at(11, 7)],
						[at(3, 7), at(6, 7)],
						[at(8, 7), at(11, 7)]
					]
				)
			}
		},
		areas: [
			{
				event: 'entered',
				during: 'the_guardians',
				location: 'hill',
				from: at(6, 6),
				to: at(7, 6),
				after: 'read_rite'
			}
		],
		chapters: {
			the_shrine: {
				title: 'The shrine',
				location: 'hill',
				objectives: [
					{ id: 'read', text: 'Read the inscription over the door', done: 'read_rite' },
					{
						id: 'chest',
						text: 'Open the offering chest',
						done: 'opened_chest',
						optional: true
					}
				],
				next: { on: 'read_rite', to: 'the_guardians' }
			},
			the_guardians: {
				title: 'The guardians',
				location: 'hill',
				objectives: [
					{ id: 'enter', text: 'Step inside the shrine', done: 'entered' },
					{ id: 'rest', text: 'Lay the guardians to rest', done: 'laid_to_rest', after: 'entered' }
				],
				next: { on: 'laid_to_rest', to: 'the_choice' }
			},
			the_choice: {
				title: 'The choice',
				location: 'hill',
				objectives: [{ id: 'decide', text: 'Decide what becomes of the shrine', done: 'decided' }],
				next: { on: 'decided', to: null },
				opening: [{ rest: 'short' }, { offer: 'shrine' }]
			}
		},
		events: {
			read_rite: { label: 'The inscription is read' },
			opened_chest: { label: 'The offering chest is opened' },
			entered: {
				label: 'The party stepped inside',
				does: [{ say: 'Bones stir on the altar steps and rise.' }, { fight: 'guardians' }]
			},
			laid_to_rest: { label: 'The guardians are laid to rest' },
			decided: { label: 'The shrine is decided' }
		},
		decisions: {
			shrine: {
				prompt: 'The guardians are dust. The shrine is quiet. What becomes of it?',
				options: [
					{
						id: 'restore',
						label: 'Restore the shrine',
						does: [{ reward: 'The shrine’s blessing' }, { event: 'decided' }]
					},
					{
						id: 'seal',
						label: 'Seal it and leave',
						does: [{ reward: 'A quiet hillside' }, { event: 'decided' }]
					}
				]
			}
		},
		endings: {
			decision: 'shrine',
			fallback: 'seal',
			names: { restored: { title: 'The Shrine Restored' }, sealed: { title: 'The Shrine Sealed' } },
			byAnswer: {
				restore: {
					ending: 'restored',
					subtitle: 'The shrine was restored',
					headline: 'The shrine is kept',
					text: 'You sweep the steps and relight the lamp. Pilgrims will come again.',
					scene: 'A small flame burns on the altar, steady in the wind.',
					cue: 'flash',
					result: [{ label: 'The shrine', value: 'Restored' }]
				},
				seal: {
					ending: 'sealed',
					subtitle: 'The shrine was sealed',
					headline: 'The shrine is sealed',
					text: 'You roll a stone across the door. Whatever sleeps here sleeps on.',
					scene: 'Grass already bends over the sealed door.',
					cue: 'toll',
					result: [{ label: 'The shrine', value: 'Sealed' }]
				}
			}
		},
		npcs: {},
		peoplePlaces: [],
		reactions: [],
		objects: [
			{
				id: 'inscription',
				name: 'Inscription',
				kind: 'landmark',
				location: 'hill',
				thing: { prop: 'inscription' },
				initial: 'interactable',
				states: ['interactable', 'used'],
				verbs: [
					{
						id: 'examine',
						label: 'Read the inscription',
						from: ['interactable'],
						to: 'used',
						check: { stat: 'religion', dc: 10 },
						does: [{ do: [{ clue: 'rite' }, { event: 'read_rite' }] }]
					}
				]
			},
			{
				id: 'chest',
				name: 'Offering chest',
				kind: 'chest',
				location: 'hill',
				thing: { prop: 'chest' },
				initial: 'interactable',
				states: ['interactable', 'opened'],
				verbs: [
					{
						id: 'open',
						label: 'Open the chest',
						from: ['interactable'],
						to: 'opened',
						does: [
							{
								do: [
									{
										hurt: {
											near: 'chest',
											within: 1,
											dice: '1d6',
											text: 'A needle springs from the lock!',
											save: { stat: 'dex', dc: 12, half: true }
										}
									},
									{ gear: { item: 'srd-5.2.1:weapon:dagger', quantity: 1 } },
									{ event: 'opened_chest' }
								]
							}
						]
					}
				]
			}
		],
		signs: [],
		clues: {
			rite: {
				title: 'The rite of rest',
				text: 'The words over the door ask the dead to keep the shrine until the living come back to it.',
				kind: 'document'
			}
		},
		mechanisms: {},
		enemies: {},
		encounters: {
			guardians: {
				name: 'The shrine’s guardians',
				location: 'hill',
				ring: [at(5, 3), at(8, 3)],
				foes: [{ kind: 'srd-skeleton' }, { kind: 'srd-skeleton' }],
				reveal: { from: at(3, 1), to: at(10, 6) },
				won: { text: 'The last of the bones falls still.', event: 'laid_to_rest' }
			}
		},
		cues: []
	};
}
