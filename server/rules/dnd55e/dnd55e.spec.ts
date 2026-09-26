import { describe, expect, it } from 'vitest';
import type { CharacterDef } from '../../../src/lib/adventure/characters';
import type { DieRoller } from '../../../src/lib/game/dice';
import { findRuleset, type AttackSituation } from '../ruleset';
import { abilityModifier, modeOf, proficiencyBonus, rollD20, rollDamage } from './core';
import { DND_55E, dnd55e } from './index';
import { readSheet } from './sheet';

/** Rolls these, in order, then 10s. */
function dice(...rolls: number[]): DieRoller {
	return () => rolls.shift() ?? 10;
}

const FIGHTER: CharacterDef = {
	id: 'warden',
	name: 'Test Fighter',
	tagline: '',
	intro: '',
	color: '#336699',
	hp: 12,
	armor: 18,
	speed: 6,
	vision: 6,
	light: 0,
	stats: { might: 0, agility: 0, wits: 0, spirit: 0 },
	actions: [
		{
			id: 'longsword',
			name: 'Longsword',
			about: '',
			kind: 'attack',
			target: 'enemy',
			range: 1,
			stat: 'might',
			dice: '1d8+3',
			uses: null
		},
		{
			id: 'longbow',
			name: 'Longbow',
			about: '',
			kind: 'attack',
			target: 'enemy',
			range: 16,
			stat: 'agility',
			dice: '1d8+1',
			uses: null
		},
		{
			id: 'second-wind',
			name: 'Second Wind',
			about: '',
			kind: 'heal',
			target: 'self',
			range: 0,
			stat: 'might',
			dice: '1d10+1',
			uses: 2
		}
	],
	sheet: {
		level: 1,
		abilities: { str: 17, dex: 12, con: 15, int: 8, wis: 13, cha: 10 },
		saves: ['str', 'con'],
		skills: ['athletics', 'perception'],
		attacks: { longsword: 'str', longbow: 'dex' },
		bonusActions: ['second-wind']
	}
};

const open: AttackSituation = {
	ranged: false,
	hostileBeside: false,
	targetUnseen: false,
	attackerUnseen: false,
	targetStatuses: new Map()
};
const lit = { dark: false, sight: false };

describe('fifth edition numbers (SRD 5.2.1)', () => {
	it('works out ability modifiers and proficiency by level', () => {
		expect([1, 8, 9, 10, 11, 12, 15, 17, 20, 30].map(abilityModifier)).toEqual([
			-5, -1, -1, 0, 0, 1, 2, 3, 5, 10
		]);
		expect([1, 4, 5, 8, 9, 12, 13, 16, 17, 20].map(proficiencyBonus)).toEqual([
			2, 2, 3, 3, 4, 4, 5, 5, 6, 6
		]);
	});

	it('cancels advantage against disadvantage, however many of each', () => {
		expect(modeOf(['a'], [])).toBe('advantage');
		expect(modeOf(['a', 'b'], ['c'])).toBeUndefined();
		expect(modeOf([], ['c', 'd'])).toBe('disadvantage');
		expect(modeOf([], [])).toBeUndefined();
	});

	it('rolls two d20s with advantage or disadvantage and keeps one', () => {
		const high = rollD20(5, 'advantage', dice(4, 17));
		expect(high).toMatchObject({ natural: 17, other: 4, total: 22 });
		expect(high.roll).toMatchObject({ expression: '2d20kh1+5', total: 22 });
		expect(high.roll.terms[0]).toMatchObject({ rolls: [17, 4] });
		const low = rollD20(-1, 'disadvantage', dice(4, 17));
		expect(low).toMatchObject({ natural: 4, other: 17, total: 3 });
		expect(low.roll.expression).toBe('2d20kl1-1');
		expect(rollD20(0, undefined, dice(9)).roll.expression).toBe('1d20');
	});

	it('rolls the damage dice twice on a critical hit, modifiers once', () => {
		expect(rollDamage('1d8+3', true, dice(8, 8))).toMatchObject({
			expression: '2d8+3',
			total: 19
		});
		expect(rollDamage('1d8+3', false, dice(8)).total).toBe(11);
	});
});

describe('the fifth edition ruleset', () => {
	it('is registered by its exact id and version', () => {
		expect(findRuleset(DND_55E)).toBe(dnd55e);
		expect(findRuleset({ id: 'dnd-5.5e', version: 2 })).toBeUndefined();
		expect(dnd55e.attribution).toContain('SRD 5.2.1');
		expect(dnd55e.attribution).toContain('Creative Commons Attribution 4.0');
	});

	it('adds proficiency to skills and saves the character is proficient in, and not otherwise', () => {
		expect(dnd55e.bonus(FIGHTER, 'athletics', 'check')).toBe(5); // +3 Str, +2
		expect(dnd55e.bonus(FIGHTER, 'stealth', 'check')).toBe(1); // +1 Dex
		expect(dnd55e.bonus(FIGHTER, 'str', 'check')).toBe(3); // a plain ability check
		expect(dnd55e.bonus(FIGHTER, 'con', 'save')).toBe(4); // +2 Con, +2
		expect(dnd55e.bonus(FIGHTER, 'dex', 'save')).toBe(1);
		expect(dnd55e.label('perception', 'check')).toBe('Wisdom (Perception)');
		expect(dnd55e.label('dex', 'save')).toBe('Dexterity saving throw');
		expect(dnd55e.label('str', 'check')).toBe('Strength');
	});

	it('tells checks from saves: a skill is no saving throw', () => {
		expect(dnd55e.isStat('perception', 'check')).toBe(true);
		expect(dnd55e.isStat('perception', 'save')).toBe(false);
		expect(dnd55e.isStat('wis', 'save')).toBe(true);
		expect(dnd55e.isStat('might', 'check')).toBe(false);
	});

	it('resolves a check against its DC and explains it', () => {
		const pass = dnd55e.test(FIGHTER, 'perception', 'check', 13, lit, dice(10));
		expect(pass).toMatchObject({ success: true, label: 'Wisdom (Perception)' });
		expect(pass.roll).toMatchObject({ expression: '1d20+3', total: 13 });
		expect(pass.explain).toBe('d20 10 +3 = 13 vs DC 13: success');
		expect(dnd55e.test(FIGHTER, 'perception', 'check', 14, lit, dice(10)).success).toBe(false);
		// No natural-20 rule for checks and saves: a 20 still has to reach the DC.
		expect(dnd55e.test(FIGHTER, 'int', 'check', 25, lit, dice(20)).success).toBe(false);
	});

	it('fails a check that needs sight in the dark, but not a save', () => {
		const blind = dnd55e.test(
			FIGHTER,
			'perception',
			'check',
			5,
			{ dark: true, sight: true },
			dice(20)
		);
		expect(blind.success).toBe(false);
		expect(blind.explain).toContain('in darkness');
		expect(
			dnd55e.test(FIGHTER, 'athletics', 'check', 5, { dark: true, sight: false }, dice(20)).success
		).toBe(true);
		expect(
			dnd55e.test(FIGHTER, 'dex', 'save', 5, { dark: true, sight: false }, dice(20)).success
		).toBe(true);
	});

	it('adds the attack ability and proficiency to hit, and takes Armor Class as defense', () => {
		expect(dnd55e.attackBonus(FIGHTER, FIGHTER.actions[0])).toBe(5);
		expect(dnd55e.attackBonus(FIGHTER, FIGHTER.actions[1])).toBe(3);
		expect(dnd55e.defense(18, new Map([['guarded', 1]]))).toBe(18);
		expect(dnd55e.initiativeBonus(FIGHTER)).toBe(1);
	});

	it('hits at or over AC, crits on a natural 20, and misses on a natural 1', () => {
		expect(dnd55e.strike(5, '1d8+3', 15, open, dice(10, 4))).toMatchObject({
			hit: true,
			damage: { total: 7 }
		});
		expect(dnd55e.strike(5, '1d8+3', 16, open, dice(10)).hit).toBe(false);
		const crit = dnd55e.strike(0, '1d8+3', 30, open, dice(20, 5, 6));
		expect(crit).toMatchObject({
			hit: true,
			critical: true,
			damage: { expression: '2d8+3', total: 14 }
		});
		expect(crit.explain).toContain('critical hit');
		expect(dnd55e.strike(40, '1d8', 2, open, dice(1))).toMatchObject({ hit: false, damage: null });
	});

	it('gives disadvantage from the table: a foe beside an archer, an unseen target, cover', () => {
		const beside = dnd55e.strike(
			5,
			'1d8',
			12,
			{ ...open, ranged: true, hostileBeside: true },
			dice(15, 3)
		);
		expect(beside).toMatchObject({ mode: 'disadvantage', hit: false, toHit: { total: 8 } });
		expect(beside.explain).toContain('ranged, with a foe beside');
		// In melee, a foe beside you is no reason.
		expect(
			dnd55e.strike(5, '1d8', 12, { ...open, hostileBeside: true }, dice(15, 3)).mode
		).toBeUndefined();
		expect(dnd55e.strike(5, '1d8', 12, { ...open, targetUnseen: true }, dice(15, 3)).mode).toBe(
			'disadvantage'
		);
		const cover = { ...open, targetStatuses: new Map([['guarded' as const, 1]]) };
		expect(dnd55e.strike(5, '1d8', 12, cover, dice(15, 3)).mode).toBe('disadvantage');
	});

	it('gives advantage to an unseen attacker, cancelled when the target is unseen too', () => {
		expect(
			dnd55e.strike(5, '1d8', 12, { ...open, attackerUnseen: true }, dice(3, 15))
		).toMatchObject({
			mode: 'advantage',
			hit: true
		});
		const both = dnd55e.strike(
			5,
			'1d8',
			12,
			{ ...open, attackerUnseen: true, targetUnseen: true },
			dice(3, 15)
		);
		expect(both.mode).toBeUndefined();
		expect(both.explain).toContain('cancel');
	});

	it('takes an action and a bonus action a turn', () => {
		expect(dnd55e.actionType(FIGHTER, FIGHTER.actions[0])).toBe('action');
		expect(dnd55e.actionType(FIGHTER, FIGHTER.actions[2])).toBe('bonus');
		expect(dnd55e.actionTypeName('bonus')).toBe('Bonus action');
	});

	it('shows the sheet the rules work out', () => {
		const card = dnd55e.card(FIGHTER, new Map());
		expect(card).toMatchObject({
			defense: { name: 'Armor Class', value: 18 },
			level: 1,
			proficiency: 2
		});
		expect(card.stats[0]).toEqual({
			id: 'str',
			name: 'Strength',
			bonus: 3,
			score: 17,
			proficient: false
		});
		expect(card.saves.find((s) => s.id === 'con')).toMatchObject({ bonus: 4, proficient: true });
		expect(card.skills.find((s) => s.id === 'athletics')).toMatchObject({
			bonus: 5,
			proficient: true
		});
		expect(card.actions).toEqual([
			{
				id: 'longsword',
				summary: 'Melee · +5 to hit · 1d8+3 damage',
				part: 'action',
				partName: 'Action'
			},
			{
				id: 'longbow',
				summary: 'Range 16 · +3 to hit · 1d8+1 damage',
				part: 'action',
				partName: 'Action'
			},
			{
				id: 'second-wind',
				summary: 'Yourself · heals 1d10+1 · 2× per fight',
				part: 'bonus',
				partName: 'Bonus action'
			}
		]);
	});
});

describe('fifth edition sheets', () => {
	it('read a complete sheet', () => {
		expect(readSheet(FIGHTER)).toMatchObject({
			ok: true,
			sheet: { level: 1, saves: ['str', 'con'] }
		});
	});

	it('name everything wrong with a sheet', () => {
		const bad = readSheet({
			...FIGHTER,
			sheet: {
				level: 0,
				abilities: { str: 40, dex: 12, con: 15, int: 8, wis: 13 },
				saves: ['luck'],
				skills: ['perception', 'perception', 'flying'],
				attacks: { longsword: 'str', axe: 'str' },
				bonusActions: ['nap'],
				script: 'alert(1)'
			}
		});
		expect(bad.ok).toBe(false);
		expect(!bad.ok && bad.problems).toEqual([
			'character warden: unknown sheet field "script"',
			'character warden: level must be a whole number from 1 to 20',
			'character warden: str must be a score from 1 to 30',
			'character warden: cha must be a score from 1 to 30',
			'character warden: no ability "luck" to be proficient in saving',
			'character warden: skills lists something twice',
			'character warden: no skill "flying"',
			'character warden: attacks: no action "axe"',
			'character warden: attacks: which ability does "longbow" use?',
			'character warden: bonusActions: no action "nap"'
		]);
		expect(readSheet({ ...FIGHTER, sheet: undefined })).toMatchObject({ ok: false });
	});
});
