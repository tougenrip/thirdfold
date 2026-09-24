import { describe, expect, it } from 'vitest';
import type { AdventureView } from '../adventure/adventure';
import type { ChatMessage } from '../game/chat';
import type { DiceRoll } from '../game/dice';
import type { Token } from '../game/token';
import {
	ambienceFor,
	musicChanged,
	musicFor,
	SILENCE,
	soundsFor,
	walkMs,
	type AudioState
} from './cues';

const token = (id: string, x: number, y: number, ownerId: string | null = null): Token => ({
	id,
	name: id,
	color: '#ffffff',
	pos: { x, y },
	ownerId,
	vision: 6,
	light: 0
});

/** Just the parts of the adventure view the audio reads. */
function story(patch: Partial<AdventureView> = {}): AdventureView {
	return {
		stage: 'playing',
		chapter: { id: 'village', title: 'The quiet village', number: 1, of: 13 },
		location: { id: 'bellweather', name: 'Bellweather' },
		characters: [
			{ id: 'warden', playerId: 'me', tokenId: 'w', downed: false, dead: false },
			{ id: 'veil', playerId: 'you', tokenId: 'v', downed: false, dead: false }
		],
		clues: [],
		decision: null,
		encounter: null,
		ending: null,
		...patch
	} as unknown as AdventureView;
}

const state = (patch: Partial<AudioState> = {}): AudioState => ({
	me: 'me',
	tokens: [token('w', 5, 5, 'me'), token('v', 6, 5, 'you')],
	objects: [{ id: 'd', kind: 'door', a: { x: 1, y: 1 }, b: { x: 2, y: 1 }, open: false }],
	ambient: 'dusk',
	adventure: story(),
	...patch
});

const roll = (total: number, dice = 1): DiceRoll =>
	({
		expression: `${dice}d20`,
		total,
		terms: [{ kind: 'dice', sign: 1, count: dice, sides: 20, rolls: Array(dice).fill(total) }]
	}) as unknown as DiceRoll;

const entry = (m: Record<string, unknown>) => ({ seq: 1, at: 0, ...m }) as unknown as ChatMessage;

describe('what the table sounds like', () => {
	it('makes no sound of its own when the table is first loaded', () => {
		expect(soundsFor(null, state(), [])).toEqual([]);
	});

	it('walks: a step per cell over the glide, the listener’s own louder, on the ground underfoot', () => {
		const after = state({ tokens: [token('w', 5, 2, 'me'), token('v', 6, 5, 'you')] });
		expect(soundsFor(state(), after, [])).toEqual([
			{ kind: 'footsteps', steps: 3, ms: walkMs(3), mine: true, surface: 'earth' }
		]);
		const far = state({ tokens: [token('w', 5, 5, 'me'), token('v', 20, 5, 'you')] });
		expect(soundsFor(state(), far, [])[0]).toMatchObject({ steps: 6, mine: false });
		const stone = (s: AudioState) => ({
			...s,
			adventure: story({ location: { id: 'monastery', name: 'The Monastery' } })
		});
		expect(soundsFor(stone(state()), stone(after), [])[0]).toMatchObject({ surface: 'stone' });
	});

	it('does not walk everyone across the world when the party travels to a new table', () => {
		const there = {
			...state({ tokens: [token('w', 1, 1, 'me'), token('v', 2, 1, 'you')] }),
			adventure: story({ location: { id: 'monastery', name: 'The Monastery' } })
		};
		expect(soundsFor(state(), there, []).filter((e) => e.kind === 'footsteps')).toEqual([]);
	});

	it('opens and shuts doors', () => {
		const opened = state({
			objects: [{ id: 'd', kind: 'door', a: { x: 1, y: 1 }, b: { x: 2, y: 1 }, open: true }]
		});
		expect(soundsFor(state(), opened, [])).toEqual([{ kind: 'door', open: true }]);
		expect(soundsFor(opened, state(), [])).toEqual([{ kind: 'door', open: false }]);
	});

	it('rings the bell when the story tolls or flashes', () => {
		const s = state();
		expect(soundsFor(s, s, [entry({ kind: 'narration', text: 'The bell.', cue: 'toll' })])).toEqual(
			[{ kind: 'bell', size: 'great' }]
		);
		expect(soundsFor(s, s, [entry({ kind: 'narration', text: 'Light.', cue: 'flash' })])).toEqual([
			{ kind: 'bell', size: 'flash' }
		]);
		expect(soundsFor(s, s, [entry({ kind: 'narration', text: 'Quiet.' })])).toEqual([]);
	});

	it('throws dice, and fights: hits heavy and light, misses, healing, guarding, fire, the fallen', () => {
		const s = state();
		expect(soundsFor(s, s, [entry({ kind: 'roll', roll: roll(12, 3) })])).toEqual([
			{ kind: 'dice', count: 3 }
		]);
		const attack = (hit: boolean, damage: number | null) =>
			entry({
				kind: 'attack',
				hit,
				toHit: roll(15),
				damage: damage === null ? null : roll(damage)
			});
		expect(soundsFor(s, s, [attack(true, 10)])).toEqual([
			{ kind: 'dice', count: 2 },
			{ kind: 'hit', heavy: true }
		]);
		expect(soundsFor(s, s, [attack(true, 3)])[1]).toEqual({ kind: 'hit', heavy: false });
		expect(soundsFor(s, s, [attack(false, null)])[1]).toEqual({ kind: 'miss' });
		const ability = (a: string, amount: number | null, text = '') =>
			entry({ kind: 'ability', ability: a, text, amount, roll: null });
		expect(soundsFor(s, s, [ability('Mend', 5)])).toEqual([{ kind: 'heal' }]);
		expect(soundsFor(s, s, [ability('Shield wall', null, 'The Warden is guarded.')])).toEqual([
			{ kind: 'guard' }
		]);
		expect(soundsFor(s, s, [ability('Toll', -4)])).toEqual([{ kind: 'bell', size: 'great' }]);
		expect(soundsFor(s, s, [ability('Burning', -2)])).toEqual([{ kind: 'burn' }]);

		const downed = state({
			adventure: story({
				characters: [
					{ id: 'warden', playerId: 'me', tokenId: 'w', downed: true, dead: false },
					{ id: 'veil', playerId: 'you', tokenId: 'v', downed: false, dead: false }
				] as AdventureView['characters']
			})
		});
		expect(soundsFor(s, downed, [])).toEqual([{ kind: 'fall', enemy: false }]);
	});

	it('marks a check the listener made, found or not, and not other people’s', () => {
		const s = state();
		const check = (authorId: string, success: boolean) =>
			entry({ kind: 'check', authorId, success, roll: roll(14), dc: 12 });
		expect(soundsFor(s, s, [check('me', true)])).toEqual([
			{ kind: 'dice', count: 1 },
			{ kind: 'check', success: true }
		]);
		expect(soundsFor(s, s, [check('you', true)])).toEqual([{ kind: 'dice', count: 1 }]);
	});

	it('sounds the UI: the listener’s turn, a clue, a choice, a new chapter', () => {
		const fight = (current: number) =>
			story({
				encounter: {
					current,
					order: [{ characterId: null }, { characterId: 'warden' }],
					enemies: [{ tokenId: 'h' }]
				} as unknown as AdventureView['encounter']
			});
		const before = state({ adventure: fight(0) });
		const mine = state({ adventure: fight(1) });
		expect(soundsFor(before, mine, [])).toEqual([{ kind: 'ui', sound: 'turn' }]);
		// The hound falls: it leaves the fight.
		const won = state({
			adventure: story({
				encounter: {
					current: 1,
					order: [{ characterId: 'warden' }],
					enemies: []
				} as unknown as AdventureView['encounter']
			})
		});
		expect(soundsFor(mine, won, [])).toContainEqual({ kind: 'fall', enemy: true });

		const found = state({ adventure: story({ clues: [{ id: 'x' }] as AdventureView['clues'] }) });
		expect(soundsFor(state(), found, [])).toEqual([{ kind: 'ui', sound: 'clue' }]);
		const asked = state({
			adventure: story({ decision: { id: 'bell' } as AdventureView['decision'] })
		});
		expect(soundsFor(state(), asked, [])).toEqual([{ kind: 'ui', sound: 'decision' }]);
		const next = state({
			adventure: story({
				chapter: { id: 'discover_bell', title: '', number: 2, of: 13 } as AdventureView['chapter']
			})
		});
		expect(soundsFor(state(), next, [])).toEqual([{ kind: 'ui', sound: 'chapter' }]);
	});
});

describe('the music', () => {
	it('is silent until the story is played, and takes its mood from where the party is', () => {
		expect(musicFor(null, 'day')).toEqual(SILENCE);
		expect(musicFor(story({ stage: 'choosing' }), 'day')).toEqual(SILENCE);
		expect(musicFor(story(), 'dusk')).toEqual({ mood: 'village', intensity: 0, ending: null });
		expect(
			musicFor(story({ location: { id: 'hollow', name: 'The Hollow' } }), 'dark')
		).toMatchObject({ mood: 'hollow', intensity: 1 });
	});

	it('rises for a choice and a fight, and highest in the finale', () => {
		expect(
			musicFor(story({ decision: { id: 'promise' } as AdventureView['decision'] }), 'dusk')
		).toMatchObject({ intensity: 1 });
		const encounter = {
			current: 0,
			order: [],
			enemies: [],
			bell: null
		} as unknown as AdventureView['encounter'];
		expect(musicFor(story({ encounter }), 'dusk')).toMatchObject({ intensity: 2 });
		const finale = story({
			encounter,
			chapter: { id: 'the_waking', title: '', number: 10, of: 13 } as AdventureView['chapter']
		});
		expect(musicFor(finale, 'dark')).toMatchObject({ intensity: 3 });
	});

	it('resolves at the ending, each in its own way, and mourns a party that fell', () => {
		const over = story({
			stage: 'complete',
			ending: { id: 'communion' } as AdventureView['ending']
		});
		expect(musicFor(over, 'dusk')).toEqual({ mood: 'ending', intensity: 0, ending: 'communion' });
		expect(musicFor(story({ stage: 'defeat' }), 'dusk')).toMatchObject({ mood: 'defeat' });
	});

	it('only changes when the mood, the intensity or the ending does', () => {
		const calm = musicFor(story(), 'dusk');
		expect(musicChanged(calm, { ...calm })).toBe(false);
		expect(musicChanged(calm, { ...calm, intensity: 2 })).toBe(true);
	});
});

describe('the ambience', () => {
	it('follows the place and the hour', () => {
		expect(ambienceFor(null, 'day')).toEqual({ place: 'open', time: 'day' });
		expect(ambienceFor(story(), 'dusk')).toEqual({ place: 'village', time: 'dusk' });
		expect(ambienceFor(story({ location: { id: 'heart', name: 'The Heart' } }), 'dark')).toEqual({
			place: 'heart',
			time: 'dark'
		});
	});
});
