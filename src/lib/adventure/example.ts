// A small adventure written as a file, the builder's starting point (and
// the tests' example): a miller's lost key, a cellar full of rats, and what
// becomes of a hoard of flour. It uses every part a creator can build:
// tables, a person and their dialogue, a trigger area and an object to
// search, a clue, objectives, a fight, a branch, rewards and two endings.

import { ADVENTURE_FILE_FORMAT, ADVENTURE_FILE_VERSION, type AdventureFile } from './file';
import { encodeFloor, withFloor, type FloorId, type FloorMap } from '../game/floor';
import type { GridPos, SquareGrid } from '../game/grid';
import type { Prop } from '../game/props';
import { blankScene, type SceneFile } from '../game/scene-file';

function table(
	name: string,
	width: number,
	height: number,
	environment: string,
	floors: [GridPos, GridPos, FloorId][],
	props: Prop[],
	walls: [GridPos, GridPos][] = []
): SceneFile {
	const scene = blankScene(name, width, height, environment, new Date(0));
	const grid: SquareGrid = scene.grid;
	let floor: FloorMap | null = null;
	for (const [from, to, id] of floors) floor = withFloor(floor, grid, from, to, id);
	return {
		...scene,
		floor: floor ? encodeFloor(floor) : null,
		props,
		objects: walls.map(([a, b], i) => ({ id: `wall-${i}`, kind: 'wall' as const, a, b })),
		fog: { ...scene.fog, enabled: true }
	};
}

const at = (x: number, y: number): GridPos => ({ x, y });
const prop = (id: string, assetId: Prop['assetId'], x: number, y: number): Prop => ({
	id,
	assetId,
	pos: { x, y },
	rotation: 0,
	scale: 1
});

export function exampleAdventure(): AdventureFile {
	return {
		format: ADVENTURE_FILE_FORMAT,
		version: ADVENTURE_FILE_VERSION,
		title: 'The Miller’s Key',
		about: 'A short first adventure: find the miller’s key, clear the cellar, decide what is fair.',
		characters: ['warden', 'veil', 'ember', 'saint'],
		start: {
			location: 'yard',
			chapter: 'the_mill',
			arrival: [
				{
					say: 'The mill wheel turns slowly in the stream. The miller waves you over, flour to the elbows.'
				}
			]
		},
		locations: {
			yard: {
				name: 'The mill yard',
				welcome: 'A mill by a stream, and a worried miller.',
				spawn: [at(1, 10), at(2, 10), at(1, 9), at(2, 9)],
				scene: table(
					'The mill yard',
					14,
					12,
					'village',
					[
						[at(0, 0), at(13, 11), 'grass'],
						[at(0, 9), at(13, 10), 'dirt'],
						[at(11, 0), at(13, 11), 'water'],
						[at(3, 1), at(8, 5), 'wood']
					],
					[prop('sack', 'crate', 6, 3), prop('stair', 'hatch', 4, 2)],
					[
						[at(3, 1), at(9, 1)],
						[at(9, 1), at(9, 6)],
						[at(3, 1), at(3, 6)]
					]
				)
			},
			cellar: {
				name: 'The cellar',
				welcome: 'Under the mill, where the flour is kept, and something else.',
				spawn: [at(1, 1), at(2, 1), at(1, 2), at(2, 2)],
				scene: table(
					'The cellar',
					10,
					8,
					'stone-halls',
					[[at(0, 0), at(9, 7), 'stone']],
					[prop('hoard', 'barrel', 7, 5), prop('hoard-2', 'barrel', 8, 5)]
				)
			}
		},
		areas: [
			// Down the stair once the key is found: the cellar.
			{ event: 'went_down', during: 'the_key', location: 'yard', from: at(4, 2), to: at(4, 2) }
		],
		chapters: {
			the_mill: {
				title: 'The mill',
				location: 'yard',
				objectives: [{ id: 'ask', text: 'Ask the miller what is wrong', done: 'asked' }],
				next: { on: 'asked', to: 'the_key' }
			},
			the_key: {
				title: 'The lost key',
				location: 'yard',
				objectives: [
					{ id: 'find', text: 'Find the cellar key', done: 'found_key' },
					{ id: 'down', text: 'Go down to the cellar', done: 'went_down', after: 'found_key' }
				],
				next: { on: 'went_down', to: 'the_cellar' }
			},
			the_cellar: {
				title: 'The cellar',
				location: 'cellar',
				objectives: [
					{ id: 'rats', text: 'Clear the cellar', done: 'rats_gone' },
					{
						id: 'flour',
						text: 'Decide what becomes of the flour',
						done: 'decided',
						after: 'rats_gone'
					}
				],
				next: { on: 'decided', to: null },
				opening: [{ say: 'Something squeaks in the dark between the barrels.' }, { fight: 'rats' }]
			}
		},
		events: {
			asked: { label: 'The miller asked for help' },
			found_key: { label: 'The key is found', does: [{ reward: 'The cellar key' }] },
			went_down: { label: 'The party went down to the cellar' },
			rats_gone: { label: 'The rats are gone', does: [{ offer: 'flour' }] },
			decided: { label: 'The flour is decided' }
		},
		decisions: {
			flour: {
				prompt: 'Behind the barrels: a hoard of flour, far more than one mill needs. What of it?',
				options: [
					{
						id: 'keep',
						label: 'Keep it for yourselves',
						does: [{ reward: 'Sacks of flour' }, { event: 'decided' }]
					},
					{
						id: 'share',
						label: 'Give it to the village',
						does: [{ reward: 'The miller’s thanks' }, { event: 'decided' }]
					}
				]
			}
		},
		endings: {
			decision: 'flour',
			fallback: 'share',
			names: { greed: { title: 'Full Sacks' }, honour: { title: 'A Good Winter' } },
			byAnswer: {
				keep: {
					ending: 'greed',
					subtitle: 'The flour was kept',
					headline: 'You kept it',
					text: 'You carry the sacks off by night. The mill wheel turns on without you.',
					scene: 'The cellar is empty but for a few grey rats, watching.',
					cue: 'toll',
					result: [
						{ label: 'The flour', value: 'Yours' },
						{ label: 'The village', value: 'A hungry winter' }
					]
				},
				share: {
					ending: 'honour',
					subtitle: 'The flour was shared',
					headline: 'You gave it back',
					text: 'The village eats well this winter, and the miller never forgets it.',
					scene: 'The cellar is swept and quiet, the barrels rolled out into the light.',
					cue: 'flash',
					result: [
						{ label: 'The flour', value: 'The village’s' },
						{ label: 'The village', value: 'A good winter' }
					]
				}
			}
		},
		npcs: {
			miller: {
				name: 'The miller',
				role: 'Owns the mill; lost the cellar key',
				speaker: 'Miller',
				color: '#b08850',
				model: 'villager',
				location: 'yard',
				home: 'The yard, by the wheel',
				places: { calm: at(6, 8) },
				states: ['worried', 'hopeful', 'glad'],
				lines: [
					{
						id: 'ask',
						text: 'Rats in my cellar, and I have lost the key. I had it when I carried the last sack in.',
						if: { not: ['asked'] },
						becomes: 'hopeful',
						event: 'asked'
					},
					{
						id: 'found',
						text: 'You found it! The stair is in the mill, by the wall. Mind the rats.',
						if: { found: ['key'], state: ['hopeful'] },
						becomes: 'glad'
					},
					{ id: 'again', text: 'The sacks, by the grindstone. Look in the sacks.' }
				]
			}
		},
		peoplePlaces: [],
		reactions: [
			{ id: 'miller-sack', npc: 'miller', on: 'sack:search', text: 'That’s the one!', within: 8 }
		],
		objects: [
			{
				id: 'sack',
				name: 'Flour sack',
				kind: 'container',
				location: 'yard',
				thing: { prop: 'sack' },
				initial: 'interactable',
				states: ['interactable', 'used'],
				verbs: [
					{
						id: 'search',
						label: 'Search the sack',
						from: ['interactable', 'used'],
						to: 'used',
						does: [
							{ if: { state: ['used'] }, do: [{ say: 'Only flour now.' }] },
							{ do: [{ clue: 'key' }] }
						]
					}
				]
			}
		],
		signs: [],
		clues: {
			key: {
				title: 'The cellar key',
				text: 'An iron key, white with flour, at the bottom of the sack.',
				kind: 'object',
				unlocks: 'found_key'
			}
		},
		mechanisms: {},
		enemies: {
			rat: {
				name: 'Giant rat',
				model: 'hound',
				color: '#6b6b6b',
				armor: 0,
				speed: 5,
				vision: 6,
				light: 0,
				initiative: 1,
				hp: { base: 3, perCharacter: 1 },
				attacks: [{ name: 'Bite', range: 1, toHit: 2, damage: '1d4' }],
				behavior: 'rush'
			}
		},
		encounters: {
			rats: {
				name: 'Rats in the cellar',
				location: 'cellar',
				ring: [at(6, 4), at(8, 3), at(5, 6)],
				foes: [{ kind: 'rat' }, { kind: 'rat' }],
				reveal: { from: at(0, 0), to: at(9, 7) },
				won: { text: 'The last rat flees into a crack in the wall.', event: 'rats_gone' }
			}
		},
		cues: [
			{
				id: 'mill',
				title: 'The mill',
				text: 'Water turns the great wheel, and the whole mill creaks with it.'
			}
		]
	};
}
