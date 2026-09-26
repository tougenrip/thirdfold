import { describe, expect, it } from 'vitest';
import type { CharacterStatus } from '../adventure/adventure';
import { CHARACTERS } from '../adventure/characters';
import { namesList, survivalLine, timePlayed } from './session-end';

const character = (patch: Partial<CharacterStatus>): CharacterStatus => ({
	id: 'warden',
	inPlay: true,
	playerId: 'p',
	tokenId: 't',
	hp: 10,
	maxHp: 10,
	downed: false,
	dead: false,
	downedFor: 0,
	statuses: [],
	usesLeft: {},
	carrying: [],
	def: CHARACTERS.warden,
	card: {
		defense: { name: 'Defense', value: 13 },
		level: null,
		proficiency: null,
		stats: [],
		saves: [],
		skills: [],
		actions: []
	},
	spent: [],
	...patch
});

describe('survivalLine', () => {
	it('says the party survived when nobody died, downed or not', () => {
		const party = [character({}), character({ id: 'veil', downed: true, hp: 0 })];
		expect(survivalLine(party, true)).toBe('The party survived.');
	});

	it('counts the survivors when some died', () => {
		const party = [
			character({}),
			character({ id: 'veil', dead: true }),
			character({ id: 'ember' }),
			character({ id: 'saint', inPlay: false })
		];
		expect(survivalLine(party, true)).toBe('Two of the three survived.');
	});

	it('tells a defeat', () => {
		expect(survivalLine([character({ downed: true })], false)).toBe('The party fell.');
		expect(survivalLine([character({ dead: true })], false)).toBe('None of the party survived.');
	});

	it('has a line for a story ended with nobody in play', () => {
		expect(survivalLine([character({ inPlay: false })], true)).toBe('The story is told.');
	});
});

describe('timePlayed', () => {
	it('formats hours, minutes and seconds', () => {
		expect(timePlayed(0, (1 * 3600 + 17 * 60 + 32) * 1000)).toBe('01:17:32');
		expect(timePlayed(1000, 1000)).toBe('00:00:00');
	});

	it('is null until the story has begun and ended', () => {
		expect(timePlayed(null, 5)).toBeNull();
		expect(timePlayed(5, null)).toBeNull();
	});
});

describe('namesList', () => {
	it('joins names in plain English', () => {
		expect(namesList([])).toBe('');
		expect(namesList(['Mira'])).toBe('Mira');
		expect(namesList(['Mira', 'Tom'])).toBe('Mira and Tom');
		expect(namesList(['Mira', 'Tom', 'Ada'])).toBe('Mira, Tom and Ada');
	});
});
