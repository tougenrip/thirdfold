import { describe, expect, it } from 'vitest';
import type { DieRoller } from '../../../src/lib/game/dice';
import type { CharacterState } from '../../adventure/state';
import { srdCatalog } from './catalog';
import { RESISTANCE_PHRASES } from './character/options';
import { coverBonus, damageTaken, deathSave, downedDamage, MANEUVERS, stabilize } from './combat';

const down = (): CharacterState => ({
	tokenId: 't',
	hp: 0,
	statuses: new Map(),
	uses: new Map(),
	downedFor: 0,
	dead: false
});
const d20 =
	(...rolls: number[]): DieRoller =>
	() =>
		rolls.shift() ?? 10;

describe('death saving throws', () => {
	it('succeed on 10 or higher and fail below; three of a kind decide', () => {
		const s = down();
		expect(deathSave(s, d20(10))).toMatchObject({
			dead: false,
			test: { dc: 10, success: true },
			explain: 'Death save: 10: success (1 success, 0 failures)'
		});
		expect(deathSave(s, d20(9))).toMatchObject({ dead: false, turnsLeft: 2 });
		deathSave(s, d20(12));
		expect(deathSave(s, d20(18))).toMatchObject({
			dead: false,
			stable: true,
			explain: 'Death save: 18: success, the third success: Stable'
		});
		// Stable: no more rolls, and the tally is reset.
		expect(s.deathSaves).toEqual({ successes: 0, failures: 0, stable: true });
		expect(deathSave(s, d20(1))).toEqual({ dead: false, turnsLeft: 3, stable: true });

		const t = down();
		deathSave(t, d20(2));
		expect(deathSave(t, d20(1))).toMatchObject({
			dead: true,
			explain: 'Death save: a 1: two failures, the third failure'
		});
	});

	it('bring a character back with 1 HP on a 20', () => {
		const s = down();
		s.deathSaves = { successes: 0, failures: 2 };
		expect(deathSave(s, d20(20))).toMatchObject({ dead: false, revived: true });
		expect(s).toMatchObject({ hp: 1, deathSaves: undefined, downedFor: 0 });
	});

	it('count damage at 0 HP as a failure (two for a Critical Hit), and kill with massive damage', () => {
		const s = down();
		expect(downedDamage(s, { overflow: 3, max: 12, critical: false, already: true })).toMatchObject(
			{ dead: false, turnsLeft: 2 }
		);
		expect(downedDamage(s, { overflow: 3, max: 12, critical: true, already: true })).toMatchObject({
			dead: true
		});
		// A Stable character hurt starts dying again.
		const steady = down();
		stabilize(steady);
		downedDamage(steady, { overflow: 1, max: 12, critical: false, already: true });
		expect(steady.deathSaves).toEqual({ successes: 0, failures: 1 });
		// Dropped to 0 with damage left over at least its maximum: dead outright.
		expect(
			downedDamage(down(), { overflow: 12, max: 12, critical: false, already: false })
		).toMatchObject({ dead: true });
		expect(
			downedDamage(down(), { overflow: 11, max: 12, critical: false, already: false })
		).toBeNull();
		// Damage at 0 equal to its maximum kills too.
		expect(
			downedDamage(down(), { overflow: 12, max: 12, critical: false, already: true })
		).toMatchObject({ dead: true });
	});
});

describe('damage types', () => {
	const traits = { immune: ['poison'], resist: ['cold', 'fire'], vulnerable: ['fire', 'radiant'] };
	it('halve (round down), double, or shrug off by type, once each', () => {
		expect(damageTaken(7, 'cold', traits)).toEqual({
			amount: 3,
			note: 'resistant to cold: halved'
		});
		expect(damageTaken(7, 'Radiant', traits)).toEqual({
			amount: 14,
			note: 'vulnerable to radiant: doubled'
		});
		expect(damageTaken(7, 'fire', traits)).toEqual({
			amount: 6,
			note: 'resistant to fire: halved, vulnerable to fire: doubled'
		});
		expect(damageTaken(7, 'poison', traits)).toEqual({
			amount: 0,
			note: 'immune to poison damage'
		});
		expect(damageTaken(7, 'slashing', traits)).toEqual({ amount: 7 });
		expect(damageTaken(7, undefined, traits)).toEqual({ amount: 7 });
	});
});

describe('cover', () => {
	it('is Half Cover behind creatures or part-hiding things, Three-Quarters behind things hiding more', () => {
		expect(coverBonus({ blocked: 0, objects: 0, lines: 4 })).toBeNull();
		expect(coverBonus({ blocked: 4, objects: 0, lines: 4 })).toEqual({
			bonus: 2,
			name: 'Half Cover'
		});
		expect(coverBonus({ blocked: 2, objects: 2, lines: 4 })).toEqual({
			bonus: 2,
			name: 'Half Cover'
		});
		expect(coverBonus({ blocked: 3, objects: 3, lines: 4 })).toEqual({
			bonus: 5,
			name: 'Three-Quarters Cover'
		});
	});
});

describe('the actions every creature has', () => {
	it('are the Rules Glossary’s Dash, Disengage, Dodge and Help, read from its words', () => {
		const catalog = srdCatalog();
		const rule = (slug: string) => catalog.get('rule', `srd-5.2.1:rule:${slug}`)!.text;
		expect(MANEUVERS.map((m) => m.action.id)).toEqual([
			'dash',
			'disengage',
			'dodge',
			'help',
			'first-aid'
		]);
		expect(rule('dash')).toContain('The increase equals your Speed after applying any modifiers.');
		expect(rule('disengage')).toContain('your movement doesn’t provoke Opportunity Attacks');
		expect(rule('dodge')).toContain('until the start of your next turn');
		expect(rule('opportunity-attacks')).toContain('take a Reaction to make one melee attack');
		expect(rule('reaction')).toContain(
			'Once you take a Reaction, you can’t take another one until the start of your next turn.'
		);
	});

	it('species resistances are the SRD’s', () => {
		const text = srdCatalog()
			.all('species')
			.map((s) => s.text.replace(/\s+/g, ' '))
			.join('\n');
		for (const phrase of RESISTANCE_PHRASES) expect(text, phrase).toContain(phrase);
	});
});
