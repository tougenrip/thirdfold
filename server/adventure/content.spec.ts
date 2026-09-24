import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../../src/lib/adventure/characters';
import type { DieRoller } from '../../src/lib/game/dice';
import { RoomManager } from '../rooms';
import { exportScene } from '../scene-io';
import { HOLLOW_BELL } from '../adventures/hollow-bell';
import type { AdventureDef } from './define';
import {
	beginAdventure,
	characterOf,
	claimCharacter,
	decide,
	direct,
	interact,
	share,
	startAdventure
} from './engine';
import { readAdventure } from './persist';
import { addAdventure } from './registry';
import { table } from './tables';
import { validateAdventure } from './validate';
import { adventureView } from './view';

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
	return result as Extract<T, { ok: true }>;
}

const ENGINE_DIR = path.dirname(new URL(import.meta.url).pathname);

describe('the engine and the content', () => {
	it('keeps the engine free of any adventure: only the registry knows where they are', () => {
		const files = readdirSync(ENGINE_DIR).filter(
			(f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')
		);
		expect(files).toContain('engine.ts');
		for (const file of files) {
			const source = readFileSync(path.join(ENGINE_DIR, file), 'utf8');
			const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
			const content = imports.filter((i) => i.includes('adventures'));
			expect({ file, content }).toEqual({
				file,
				content: file === 'registry.ts' ? ['../adventures'] : []
			});
		}
	});

	it('finds nothing wrong with The Hollow Bell', () => {
		expect(validateAdventure(HOLLOW_BELL)).toEqual([]);
	});

	it('names what is wrong with an adventure whose references go nowhere', () => {
		const broken: AdventureDef = {
			...HOLLOW_BELL,
			start: { ...HOLLOW_BELL.start, arrival: [{ event: 'no_such_event' }] },
			clues: { ...HOLLOW_BELL.clues, notice: { ...HOLLOW_BELL.clues.notice, unlocks: 'nowhere' } },
			enemies: {
				...HOLLOW_BELL.enemies,
				hound: {
					...HOLLOW_BELL.enemies.hound,
					attacks: [{ ...HOLLOW_BELL.enemies.hound.attacks[0], damage: 'lots' }]
				}
			}
		};
		expect(validateAdventure(broken)).toEqual([
			'arrival: no event "no_such_event"',
			'clue notice: no event "nowhere"',
			'enemy hound: bad dice "lots"'
		]);
	});
});

/**
 * A second, tiny adventure, written only as data: a miller's lost key, found
 * in a sack in the yard, which opens the cellar, where rats wait; then a
 * choice, and one of two endings. The same engine plays it.
 */
const MILL: AdventureDef = {
	id: 'mill',
	title: 'The Mill',
	version: 1,
	characters: { warden: CHARACTERS.warden, veil: CHARACTERS.veil },
	start: {
		location: 'yard',
		chapter: 'arrive',
		arrival: [{ say: 'The mill wheel turns. The miller waves you over.' }]
	},
	locations: {
		yard: {
			name: 'The mill yard',
			spawn: [
				{ x: 1, y: 1 },
				{ x: 1, y: 2 }
			],
			welcome: 'A mill by a stream.',
			scene: () =>
				table({
					name: 'The mill yard',
					grid: { kind: 'square', cellSize: 1, width: 10, height: 8 },
					objects: [],
					props: [{ id: 'sack', assetId: 'crate', pos: { x: 3, y: 1 }, rotation: 0, scale: 1 }],
					lights: [],
					tokens: [
						{
							id: 'miller-token',
							name: 'The miller',
							color: '#aa8844',
							pos: { x: 1, y: 4 },
							vision: 6,
							light: 0,
							owner: null
						}
					],
					ambient: 'day',
					arrival: { from: { x: 0, y: 0 }, to: { x: 9, y: 7 } },
					environment: 'village'
				})
		},
		cellar: {
			name: 'The cellar',
			spawn: [
				{ x: 1, y: 1 },
				{ x: 2, y: 1 }
			],
			welcome: 'Under the mill.',
			scene: () =>
				table({
					name: 'The cellar',
					grid: { kind: 'square', cellSize: 1, width: 8, height: 6 },
					objects: [],
					props: [],
					lights: [],
					tokens: [],
					ambient: 'dark',
					arrival: { from: { x: 0, y: 0 }, to: { x: 7, y: 5 } },
					environment: 'stone-halls'
				})
		}
	},
	areas: [],
	chapters: {
		arrive: {
			id: 'arrive',
			title: 'The mill',
			location: 'yard',
			objectives: [
				{ id: 'ask', text: 'Ask the miller what is wrong', done: 'asked' },
				{ id: 'key', text: 'Find the cellar key', done: 'found_key', after: 'asked' }
			],
			next: { on: 'found_key', to: 'below' }
		},
		below: {
			id: 'below',
			title: 'The cellar',
			location: 'cellar',
			objectives: [{ id: 'rats', text: 'Clear the cellar', done: 'rats_gone' }],
			next: { on: 'decided', to: null },
			opening: [{ say: 'Something squeaks in the dark.' }, { fight: 'rats' }]
		}
	},
	events: {
		asked: { label: 'The miller asked for help' },
		found_key: { label: 'The key is found' },
		rats_gone: { label: 'The rats are gone', does: [{ offer: 'fate' }] },
		decided: { label: 'The flour is decided' }
	},
	decisions: {
		fate: {
			id: 'fate',
			prompt: 'The cellar holds a hoard of flour. What of it?',
			options: [
				{ id: 'keep', label: 'Keep it', does: [{ event: 'decided' }] },
				{ id: 'return', label: 'Give it to the village', does: [{ event: 'decided' }] }
			]
		}
	},
	endings: {
		decision: 'fate',
		fallback: 'keep',
		names: { greed: { title: 'Greed' }, honour: { title: 'Honour' } },
		byAnswer: {
			keep: {
				ending: 'greed',
				subtitle: 'The flour was kept',
				headline: 'You kept it',
				text: 'You carry the sacks off by night.',
				scene: 'The mill stands dark.',
				cue: 'toll',
				result: [{ label: 'The village', value: 'Hungry' }]
			},
			return: {
				ending: 'honour',
				subtitle: 'The flour was shared',
				headline: 'You gave it back',
				text: 'The village eats well this winter.',
				scene: 'The mill wheel turns in the sun.',
				cue: 'flash',
				result: [{ label: 'The village', value: 'Fed' }]
			}
		}
	},
	npcs: {
		miller: {
			id: 'miller',
			name: 'The miller',
			role: 'Owns the mill',
			speaker: 'Miller',
			token: 'miller-token',
			color: '#aa8844',
			model: 'villager',
			location: 'yard',
			home: 'The yard',
			places: { calm: { x: 1, y: 4 } },
			states: ['worried', 'hopeful'],
			lines: [
				{
					id: 'ask',
					text: 'Rats in my cellar, and I have lost the key. Look in the sack.',
					if: { not: ['asked'] },
					becomes: 'hopeful',
					event: 'asked'
				},
				{ id: 'again', text: 'The sack, by the wheel.' }
			]
		}
	},
	peoplePlaces: [],
	reactions: [
		{ id: 'miller-sack', npc: 'miller', on: 'sack:search', text: 'That is my sack!', within: 6 }
	],
	objects: [
		{
			id: 'miller',
			name: 'The miller',
			kind: 'npc',
			location: 'yard',
			thing: { token: 'miller-token' },
			initial: 'interactable',
			states: ['interactable'],
			verbs: [{ id: 'talk', label: 'Talk to the miller', from: ['interactable'] }]
		},
		{
			id: 'sack',
			name: 'Sack',
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
						{ if: { state: ['used'] }, do: [{ say: 'Only flour.' }] },
						{ do: [{ clue: 'key' }] }
					]
				}
			]
		}
	],
	signs: [],
	clues: {
		key: {
			id: 'key',
			title: 'The cellar key',
			text: 'An iron key, floury, at the bottom of the sack.',
			kind: 'object',
			unlocks: 'found_key'
		}
	},
	mechanisms: {},
	enemies: {
		rat: {
			kind: 'rat',
			name: 'Giant Rat',
			model: 'hound',
			color: '#555555',
			armor: 0,
			speed: 5,
			vision: 6,
			light: 0,
			initiative: 0,
			hp: () => 3,
			attacks: [{ name: 'Bite', toHit: 2, damage: '1d3', range: 1 }],
			behavior: 'rush'
		}
	},
	encounters: {
		rats: {
			name: 'Rats in the cellar',
			location: 'cellar',
			ring: [
				{ x: 6, y: 4 },
				{ x: 5, y: 4 }
			],
			foes: [{ kind: 'rat' }, { kind: 'rat' }],
			won: { text: 'The last rat flees squeaking.', event: 'rats_gone' }
		}
	},
	cues: [],
	voice: {
		started: 'The mill is waiting.',
		notNow: 'Not now.',
		nothingFound: 'Nothing.',
		hearNothing: 'Only the wheel.',
		seeNothing: 'Only flour dust.',
		cantMakeOut: 'You can’t make it out.',
		blocked: 'The {name} won’t go there.',
		revive: 'You help each other up.',
		defeat: 'The rats have the mill.',
		gone: '{name} is gone.'
	}
};

describe('a second adventure, made only of data', () => {
	it('is valid content', () => {
		expect(validateAdventure(MILL)).toEqual([]);
	});

	it('plays start to finish on the same engine, and saves and loads', () => {
		addAdventure(MILL);
		const low: DieRoller = () => 1;
		const rooms = new RoomManager();
		const created = ok(rooms.create('Gia'));
		const room = created.room;
		room.dice = low;
		const gm = created.player;
		const ana = ok(rooms.join(room.id, 'Ana', 'player')).player;

		ok(startAdventure(room, gm, 'mill'));
		expect(room.adventure).toMatchObject({ id: 'mill', chapter: 'arrive', location: 'yard' });
		ok(claimCharacter(room, ana, 'warden'));
		// Not one of this adventure's characters.
		expect(claimCharacter(room, ana, 'ember')).toMatchObject({ ok: false });
		ok(beginAdventure(room, gm));

		const me = () => characterOf(room, ana.id)!;
		me().token.pos = { x: 1, y: 3 };
		const talked = ok(interact(room, ana, 'miller'));
		expect(talked.log.map((e) => ('text' in e ? e.text : ''))).toContain(
			'Rats in my cellar, and I have lost the key. Look in the sack.'
		);
		expect(room.adventure!.npcs.get('miller')).toBe('hopeful');

		me().token.pos = { x: 2, y: 1 };
		const searched = ok(interact(room, ana, 'sack', 'search', low));
		// Found alone, the key is Ana's to share; the miller calls out, to her only.
		expect(room.adventure!.evidence.get('key')).toEqual({ by: ['warden'], shared: false });
		expect(searched.log.some((e) => 'text' in e && e.text === 'That is my sack!')).toBe(true);
		expect(room.adventure!.chapter).toBe('arrive');

		const shared = ok(share(room, ana, 'key'));
		expect(shared.reset).toBe(true);
		expect(room.adventure).toMatchObject({ chapter: 'below', location: 'cellar' });
		expect(room.grid.width).toBe(8);
		expect(room.adventure!.encounter?.id).toBe('rats');
		expect(room.adventure!.encounter!.enemies.size).toBe(2);

		// Saved mid-fight and read back against its own content.
		const saved = exportScene(room, 'The mill');
		const read = readAdventure(saved.adventure!, saved);
		expect(read.ok).toBe(true);

		const view = adventureView(room, ana, new Set(room.tokens.keys()), null)!;
		expect(view).toMatchObject({
			id: 'mill',
			title: 'The Mill',
			chapter: { id: 'below', number: 2, of: 2 },
			location: { name: 'The cellar' }
		});
		expect(view.characters.map((c) => c.id)).toEqual(['warden', 'veil']);

		ok(direct(room, gm, { op: 'encounter_end', result: 'won' }));
		expect(room.adventure!.pending).toBe('fate');
		ok(decide(room, ana, 'fate', 'return'));
		expect(room.adventure).toMatchObject({ stage: 'complete', ending: 'honour' });
		const end = adventureView(room, ana, new Set(room.tokens.keys()), null)!;
		expect(end.ending).toMatchObject({
			id: 'honour',
			title: 'Honour',
			headline: 'You gave it back',
			result: [{ label: 'The village', value: 'Fed' }]
		});
	});
});
