import { describe, expect, it } from 'vitest';
import { areaCells } from '../../../../src/lib/adventure/adventure';
import { srdCatalog } from '../catalog';
import {
	CASTING_TIMES,
	cantripTier,
	durationRounds,
	rangeCells,
	SPELL_MECHANICS,
	timesDice,
	unsupported,
	upcast
} from './mechanics';

const catalog = srdCatalog();
const srd = (slug: string) => `srd-5.2.1:spell:${slug}`;
const why = (slug: string) => {
	const s = catalog.get('spell', srd(slug))!;
	return unsupported(s.id, s.data, s.text);
};

describe('the spells the table plays', () => {
	it('reads each entry from the SRD’s own words, and casts it as the catalog says', () => {
		for (const [id, mech] of Object.entries(SPELL_MECHANICS)) {
			const spell = catalog.get('spell', id);
			expect(spell, id).toBeDefined();
			for (const phrase of mech.phrases) expect(spell!.text, `${id}: ${phrase}`).toContain(phrase);
			expect(CASTING_TIMES[spell!.data.castingTime], id).toBeDefined();
			expect(rangeCells(spell!.data.range), id).not.toBeNull();
			if (mech.area) expect(spell!.data.range, id).toBe('Self');
			if (mech.cantrip) expect(spell!.data.level, id).toBe(0);
			if (mech.damage?.perSlot) expect(spell!.data.higherLevels, id).toContain(mech.damage.perSlot);
			if (mech.effect) expect(durationRounds(spell!.data.duration), id).not.toBeNull();
			expect(unsupported(id, spell!.data, spell!.text), id).toBeNull();
		}
		// The representative kinds: attack rolls, saves, healing, areas, concentration.
		const kinds = new Set(Object.values(SPELL_MECHANICS).map((m) => m.resolve));
		expect([...kinds].sort()).toEqual(['attack', 'auto', 'effect', 'heal', 'save']);
		expect(Object.values(SPELL_MECHANICS).some((m) => m.area)).toBe(true);
	});

	it('says why every other spell isn’t cast here, never approximating it', () => {
		expect(why('sleep')).toBe(
			'Gives the Incapacitated condition: conditions come with milestone 49.'
		);
		expect(why('shield')).toBe('Cast as a reaction: reactions come with a later milestone.');
		expect(why('alarm')).toMatch(/^Takes 1 minute to cast/);
		expect(why('light')).toBe('Its effects aren’t played at the table yet.');
		const all = catalog.all('spell');
		expect(all.filter((s) => !unsupported(s.id, s.data, s.text))).toHaveLength(
			Object.keys(SPELL_MECHANICS).length
		);
	});

	it('measures ranges and durations, and grows dice by level and slot', () => {
		expect([
			rangeCells('120 feet'),
			rangeCells('Touch'),
			rangeCells('Self'),
			rangeCells('Sight')
		]).toEqual([24, 1, 0, null]);
		expect([durationRounds('up to 1 minute'), durationRounds('Instantaneous')]).toEqual([10, null]);
		expect([1, 4, 5, 11, 17].map(cantripTier)).toEqual([1, 1, 2, 3, 4]);
		expect(timesDice('1d10', 3)).toBe('3d10');
		expect(upcast('3d6', '1d6', 2)).toBe('5d6');
		expect(upcast('2d8', undefined, 2)).toBe('2d8');
	});

	it('shapes areas from the caster: a widening cone, a cube with its face at the caster', () => {
		const bounds = { width: 20, height: 20 };
		const at = { x: 10, y: 10 };
		const key = (cells: { x: number; y: number }[]) =>
			cells.map((c) => `${c.x - at.x},${c.y - at.y}`).sort();
		expect(key(areaCells(at, { x: 15, y: 10 }, { shape: 'cone', size: 3 }, bounds))).toEqual(
			['1,0', '2,-1', '2,0', '2,1', '3,-1', '3,0', '3,1'].sort()
		);
		expect(key(areaCells(at, { x: 10, y: 5 }, { shape: 'cube', size: 3 }, bounds))).toEqual(
			['-1,-1', '0,-1', '1,-1', '-1,-2', '0,-2', '1,-2', '-1,-3', '0,-3', '1,-3'].sort()
		);
		// Aimed diagonally, the cube's corner is at the caster.
		expect(key(areaCells(at, { x: 13, y: 13 }, { shape: 'cube', size: 3 }, bounds))).toEqual(
			['1,1', '1,2', '1,3', '2,1', '2,2', '2,3', '3,1', '3,2', '3,3'].sort()
		);
		// Never the caster's own cell, never off the table.
		expect(areaCells({ x: 0, y: 0 }, { x: -3, y: 0 }, { shape: 'cube', size: 3 }, bounds)).toEqual(
			[]
		);
	});
});
