import { describe, expect, it } from 'vitest';
import { partyMember } from '../../../adventures/barrow/party';
import { srdCatalog } from '../catalog';
import {
	ammunitionFor,
	capacityOf,
	carriedWeight,
	equip,
	expend,
	gearOf,
	pounds,
	putIn,
	recover,
	startingInventory,
	takeOut,
	unequip
} from './inventory';
import { armorTraining } from './options';

const catalog = srdCatalog();
const srd = (kind: string, slug: string) => `srd-5.2.1:${kind}:${slug}`;
const fighter = armorTraining(catalog.get('class', srd('class', 'fighter'))!.data);
const weapon = (slug: string) =>
	gearOf(catalog, srd('weapon', slug)) as Extract<ReturnType<typeof gearOf>, { kind: 'weapon' }>;
const ok = <T>(r: { ok: true; value: T } | { ok: false; problems: string[] }): T => {
	if (!r.ok) throw new Error(r.problems.join('; '));
	return r.value;
};

describe('fifth edition gear', () => {
	it('reads the catalog’s weights, and carries Strength × 15 lb.', () => {
		expect([pounds('3 lb.'), pounds('1½ lb.'), pounds('5 lb. (full)'), pounds('—')]).toEqual([
			3, 1.5, 5, 0
		]);
		expect(capacityOf(17)).toBe(255);
		// Chain Mail 55, Shield 6, Longsword 3.
		expect(carriedWeight(partyMember('warden').character, catalog)).toBe(64);
	});

	it('fires the ammunition a weapon names: a Sling its bullets, a Musket the firearm kind', () => {
		expect(ammunitionFor(weapon('shortbow'), catalog)).toBe(srd('ammunition', 'arrows'));
		expect(ammunitionFor(weapon('sling'), catalog)).toBe(srd('ammunition', 'bullets-sling'));
		expect(ammunitionFor(weapon('musket'), catalog)).toBe(srd('ammunition', 'bullets-firearm'));
		expect(ammunitionFor(weapon('longsword'), catalog)).toBeNull();
	});

	it('starts with its weapons in hand while hands are free, and a bundle of what they fire', () => {
		const gear = startingInventory(
			{
				armor: null,
				shield: true,
				weapons: [srd('weapon', 'handaxe'), srd('weapon', 'light-crossbow')]
			},
			catalog
		);
		expect(gear.map((e) => [e.item.split(':')[2], e.quantity, e.equipped])).toEqual([
			['shield', 1, 'shield'],
			['handaxe', 1, 'hand'],
			['light-crossbow', 1, null],
			['bolts', 20, null]
		]);
	});

	it('splits one off a stack to equip, and stacks it back when put away', () => {
		const warden = partyMember('warden').character;
		const two = ok(
			putIn(
				warden,
				{ item: srd('weapon', 'dagger'), quantity: 2, source: { how: 'granted' } },
				catalog,
				17
			)
		);
		const daggers = two.inventory.find((e) => e.item === srd('weapon', 'dagger'))!;
		// The Longsword and the Shield fill both hands.
		expect(equip(two, daggers.id, catalog, fighter)).toMatchObject({ ok: false });
		const freed = ok(unequip(two, 'item-3', catalog));
		const held = ok(equip(freed, daggers.id, catalog, fighter));
		expect(
			held.inventory
				.filter((e) => e.item === srd('weapon', 'dagger'))
				.map((e) => [e.quantity, e.equipped])
		).toEqual([
			[1, null],
			[1, 'hand']
		]);
		const back = ok(unequip(held, held.inventory.find((e) => e.equipped === 'hand')!.id, catalog));
		expect(
			back.inventory.filter((e) => e.item === srd('weapon', 'dagger')).map((e) => e.quantity)
		).toEqual([2]);
		// Taking all of an entry out removes it; more than there is is refused.
		expect(takeOut(back, daggers.id, 3, catalog)).toMatchObject({ ok: false });
		const out = ok(takeOut(back, daggers.id, 2, catalog));
		expect(out.name).toBe('2 Dagger');
		expect(out.character.inventory.some((e) => e.item === srd('weapon', 'dagger'))).toBe(false);
	});

	it('expends a piece a shot and recovers half, rounded down, after the fight', () => {
		let veil = partyMember('veil').character;
		for (let i = 0; i < 5; i++) {
			const shot = expend(veil, srd('weapon', 'shortbow'), catalog)!;
			veil = ok(shot).character;
		}
		expect(veil.state.expended).toEqual({ [srd('ammunition', 'arrows')]: 5 });
		expect(veil.inventory.find((e) => e.item === srd('ammunition', 'arrows'))!.quantity).toBe(15);
		const back = recover(veil, catalog)!;
		expect(back.recovered).toEqual([{ name: 'Arrows', count: 2 }]);
		expect(
			back.character.inventory.find((e) => e.item === srd('ammunition', 'arrows'))!.quantity
		).toBe(17);
		expect(back.character.state.expended).toEqual({});
		expect(recover(back.character, catalog)).toBeNull();
		// A melee weapon spends nothing.
		expect(expend(veil, srd('weapon', 'shortsword'), catalog)).toBeNull();
	});
});
