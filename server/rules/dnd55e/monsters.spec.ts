import { describe, expect, it } from 'vitest';
import { parseDice } from '../../../src/lib/game/dice';
import { srdCatalog } from './catalog';
import { CONDITIONS } from './conditions';
import {
	encounterSummary,
	kindOf,
	readAttack,
	readMonster,
	srdBestiary,
	XP_BUDGET
} from './monsters';
import { DAMAGE_TYPES } from './sheet';

const catalog = srdCatalog();
const all = catalog.all('monster').map(readMonster);
const monster = (name: string) => all.find((m) => m.listing.name === name)!;

describe('the SRD’s monsters at the table', () => {
	it('plays every stat block with an attack the table can make, and offers no other', () => {
		// The count is pinned so a change to the reading is reviewed.
		expect(all.filter((m) => m.enemy)).toHaveLength(313);
		const none = all.filter((m) => !m.enemy).map((m) => m.listing.name);
		expect(none).toContain('Archmage');
		expect(srdBestiary(() => catalog).search('archmage', 5)).toEqual([]);
	});

	it('reads a stat block’s numbers as printed, with where it comes from', () => {
		const goblin = monster('Goblin Warrior');
		expect(goblin.enemy).toMatchObject({
			kind: 'srd-goblin-warrior',
			armor: 15,
			speed: 6,
			initiative: 2,
			behavior: 'skirmish',
			saves: { dex: 2, wis: -1 },
			attacks: [
				{ name: 'Scimitar', range: 1, toHit: 4, damage: '1d6+2', damageType: 'slashing' },
				{ name: 'Shortbow', range: 16, toHit: 4, damage: '1d6+2', damageType: 'piercing' }
			]
		});
		expect(goblin.enemy!.hp(4)).toBe(10);
		expect(goblin.listing).toMatchObject({
			challenge: '1/4',
			xp: 50,
			type: 'Small Fey (Goblinoid)',
			source: 'SRD 5.2.1, Monsters A–Z › Goblins › Goblin Warrior, p. 290'
		});
		// The extra die "if the attack roll had Advantage" isn't played, and says so.
		expect(goblin.listing.notPlayed).toEqual([
			'Scimitar (what follows its damage)',
			'Shortbow (what follows its damage)',
			'Nimble Escape'
		]);
	});

	it('reads what harms a monster, what it shrugs off, and the conditions it can’t be given', () => {
		const skeleton = monster('Skeleton').enemy!;
		expect(skeleton.damage).toEqual({ immune: ['poison'], vulnerable: ['bludgeoning'] });
		expect(skeleton.immune).toEqual(['exhaustion', 'poisoned']);
	});

	it('plays a Multiattack of one attack, more damage of another type, and a knock to the ground', () => {
		expect(monster('Bandit Captain').enemy!.attacks[0]).toMatchObject({
			name: 'Scimitar',
			times: 2
		});
		expect(monster('Bandit Captain').listing.notPlayed).toContain('Multiattack (in part)');
		const dragon = monster('Adult Black Dragon').enemy!;
		expect(dragon.attacks[0]).toMatchObject({
			name: 'Rend',
			range: 2,
			times: 3,
			plus: { damage: '1d8', damageType: 'acid' }
		});
		expect(monster('Wolf').enemy!.attacks[0].inflicts).toEqual({
			conditions: ['prone'],
			ends: null
		});
		expect(monster('Wolf').listing.notPlayed).toEqual(['Pack Tactics']);
	});

	it('takes every number it plays from the stat block’s own text, and only things the rules know', () => {
		const conditions = new Set(CONDITIONS.map((c) => c.id));
		for (const m of all.filter((x) => x.enemy)) {
			const record = catalog.get('monster', m.id)!;
			const e = m.enemy!;
			expect(e.armor, m.id).toBe(record.data.armorClass);
			for (const a of e.attacks) {
				const line = record.data.actions
					.find((x) => x.name === a.name)!
					.text.replace(/[\u2212\u2013]/g, '-');
				expect(line, `${m.id} ${a.name}`).toContain(
					`Attack Roll: ${a.toHit >= 0 ? '+' : ''}${a.toHit}`
				);
				expect(parseDice(a.damage).ok, `${m.id} ${a.damage}`).toBe(true);
				expect(DAMAGE_TYPES, m.id).toContain(a.damageType);
				if (a.plus) expect(DAMAGE_TYPES, m.id).toContain(a.plus.damageType);
			}
			for (const t of [
				...(e.damage?.immune ?? []),
				...(e.damage?.resist ?? []),
				...(e.damage?.vulnerable ?? [])
			])
				expect(DAMAGE_TYPES, m.id).toContain(t);
			for (const c of e.immune ?? []) expect(conditions.has(c), `${m.id} ${c}`).toBe(true);
			expect(e.kind).toBe(kindOf(m.id));
		}
	});

	it('reads only the attack lines it understands', () => {
		expect(
			readAttack('Slam', 'Melee Attack Roll: +3, reach 5 ft. Hit: 5 (1d8 + 1) Bludgeoning damage.')
		).toMatchObject({ attack: { damage: '1d8+1', damageType: 'bludgeoning' }, rider: false });
		expect(
			readAttack('Breath', 'Dexterity Saving Throw: DC 13, each creature in a 15-foot Cone.')
		).toBeNull();
		expect(
			readAttack('Odd', 'Melee Attack Roll: +3, reach 5 ft. Hit: 5 (1d8) Glitter damage.')
		).toBeNull();
	});
});

describe('the encounter summary', () => {
	const listing = (name: string) => monster(name).listing;

	it('is the SRD’s XP budget per character, added up for the party, against the monsters’ XP', () => {
		// The SRD's own Example 1: four level 1 characters, Low is 200 XP; one Bugbear Warrior is 200.
		const one = encounterSummary([listing('Bugbear Warrior')], [1, 1, 1, 1]);
		expect(one).toMatchObject({
			xp: 200,
			party: { characters: 4, levels: [1, 1, 1, 1] },
			budgets: [
				{ name: 'Low', xp: 200 },
				{ name: 'Moderate', xp: 300 },
				{ name: 'High', xp: 400 }
			],
			band: 'Low'
		});
		expect(one.notes[0]).toContain('Combat Encounter Difficulty');
		expect(one.notes[1]).toContain('Advisory only');
		// Example 2: five level 3 characters, Moderate is 1,125 XP: 2 Druids and 9 Stirges.
		const two = encounterSummary(
			[...Array(2).fill(listing('Druid')), ...Array(9).fill(listing('Stirge'))],
			[3, 3, 3, 3, 3]
		);
		expect(two).toMatchObject({ xp: 1125, band: 'Moderate' });
		expect(two.monsters).toEqual([
			{ name: 'Druid', count: 2, xp: 450 },
			{ name: 'Stirge', count: 9, xp: 25 }
		]);
		// More than two creatures per character: the SRD's warning.
		expect(two.notes.some((n) => n.includes('More than two creatures per character'))).toBe(true);
		// Mixed levels add each character's budget; beyond High is said so.
		expect(encounterSummary([listing('Ogre')], [1, 2]).budgets[2].xp).toBe(100 + 200);
		expect(encounterSummary([listing('Ogre')], [1, 2]).band).toBe('Beyond High');
		expect(encounterSummary([listing('Ogre')], []).band).toBe('No party');
		expect(XP_BUDGET).toHaveLength(20);
	});

	it('warns when monsters have what the table doesn’t play yet', () => {
		const s = encounterSummary([listing('Goblin Warrior')], [1, 1, 1, 1]);
		expect(s.band).toBe('Below Low');
		expect(s.notes.some((n) => n.includes('may be weaker than their XP says'))).toBe(true);
	});

	it('finds monsters by name, type or challenge', () => {
		const bestiary = srdBestiary(() => catalog);
		expect(bestiary.search('goblin', 10).map((m) => m.name)).toEqual(
			expect.arrayContaining(['Goblin Warrior', 'Goblin Boss'])
		);
		expect(bestiary.search('undead', 50).every((m) => m.type.includes('Undead'))).toBe(true);
		expect(bestiary.search('1/4', 100).every((m) => m.challenge === '1/4')).toBe(true);
		expect(bestiary.search('', 5)).toHaveLength(5);
		expect(bestiary.enemy('srd-wolf')?.name).toBe('Wolf');
		expect(bestiary.enemy('srd-nothing')).toBeNull();
	});
});
