// A fifth edition character's gear: what it owns (catalog weapons, armor and
// ammunition, each entry with a quantity and where it came from) and what of
// it is equipped: worn armor, a Shield, and weapons in hand. Every function
// here is pure: it takes a character and returns a changed copy, or what
// stops the change. The rules they follow, from the SRD 5.2.1:
//
// - Armor and Shields: one suit of armor worn and one Shield at a time, and
//   only ones the class is trained in (the SRD lets a character wear armor it
//   lacks training with, at a cost; thirdfold refuses it instead).
// - Hands: a weapon takes a hand, a Two-Handed weapon both, a Shield one.
// - Versatile: a Versatile weapon alone in the hands deals its two-handed damage.
// - Ammunition: a weapon with the Ammunition property fires only while its
//   ammunition is carried, and each attack expends a piece; after a fight,
//   half the expended ammunition (round down) is recovered.
// - Carrying Capacity: Strength × 15 lb. for a Small or Medium creature
//   (every SRD species is one or the other); nothing may be taken past it.
//
// Weights come from the catalog ("1½ lb."); a bundle of ammunition weighs
// what the Ammunition table says for its amount, so each piece a share.

import type { CardItem } from '../../../../src/lib/adventure/adventure';
import type { Catalog } from '../catalog';
import type { AmmunitionData, ArmorData, WeaponData } from '../srd/records';
import type { DndCharacter } from './model';
import { armorTraining } from './options';

/** The most entries an inventory holds. */
export const INVENTORY_MAX = 40;
/** The most of one thing in an entry. */
export const QUANTITY_MAX = 999;
/** Entry ids, unique in an inventory: item-1, item-2, … */
export const ITEM_ID = /^item-[1-9][0-9]{0,3}$/;
/** Pounds a point of Strength carries (Small or Medium). */
export const CARRY_PER_STRENGTH = 15;

export type Slot = 'armor' | 'shield' | 'hand';

/** Where an item came from. */
export type ItemSource =
	| { how: 'starting' }
	| { how: 'found'; where: string }
	| { how: 'given'; by: string }
	| { how: 'granted' }
	| { how: 'recovered' };

export interface InventoryItem {
	id: string;
	/** A weapon, armor or ammunition record's id. */
	item: string;
	quantity: number;
	/** Where it is equipped, or null when it is only carried. */
	equipped: Slot | null;
	source: ItemSource;
}

/** An item taken out of an inventory (to drop or to give): plain data. */
export interface LooseItem {
	item: string;
	quantity: number;
	source: ItemSource;
}

export type Gear =
	| { kind: 'weapon'; id: string; name: string; data: WeaponData }
	| { kind: 'armor'; id: string; name: string; data: ArmorData }
	| { kind: 'ammunition'; id: string; name: string; data: AmmunitionData };

type Result<T> = { ok: true; value: T } | { ok: false; problems: string[] };
const fail = <T>(problem: string): Result<T> => ({ ok: false, problems: [problem] });

/** The catalog record an item names, if it is gear. */
export function gearOf(catalog: Catalog, id: string): Gear | null {
	const kind = id.split(':')[1];
	if (kind === 'weapon') {
		const r = catalog.get('weapon', id);
		return r ? { kind, id, name: r.name, data: r.data } : null;
	}
	if (kind === 'armor') {
		const r = catalog.get('armor', id);
		return r ? { kind, id, name: r.name, data: r.data } : null;
	}
	if (kind === 'ammunition') {
		const r = catalog.get('ammunition', id);
		return r ? { kind, id, name: r.name, data: r.data } : null;
	}
	return null;
}

/** Where a piece of gear is equipped: armor is worn, a Shield carried, a weapon held; ammunition isn't. */
export function slotFor(gear: Gear): Slot | null {
	if (gear.kind === 'weapon') return 'hand';
	if (gear.kind === 'armor') return gear.data.category === 'shield' ? 'shield' : 'armor';
	return null;
}

/** Pounds in a catalog weight: "3 lb.", "1½ lb.", "5 lb. (full)", "—". */
export function pounds(weight: string): number {
	const m = /^(\d+)?(½|¼)? lb\./.exec(weight);
	if (!m) return 0;
	return Number(m[1] ?? 0) + (m[2] === '½' ? 0.5 : m[2] === '¼' ? 0.25 : 0);
}

/** What `quantity` of a piece of gear weighs. */
export function weightOf(gear: Gear, quantity: number): number {
	const each =
		gear.kind === 'ammunition'
			? pounds(gear.data.weight) / gear.data.amount
			: pounds(gear.data.weight);
	return each * quantity;
}

/** Hands a piece of gear takes when equipped. */
export function handsFor(gear: Gear): number {
	if (gear.kind === 'weapon') return gear.data.properties.includes('Two-Handed') ? 2 : 1;
	if (gear.kind === 'armor' && gear.data.category === 'shield') return 1;
	return 0;
}

/** What the character carries, in pounds. */
export function carriedWeight(c: DndCharacter, catalog: Catalog): number {
	let total = 0;
	for (const e of c.inventory) {
		const g = gearOf(catalog, e.item);
		if (g) total += weightOf(g, e.quantity);
	}
	return Math.round(total * 100) / 100;
}

/** Carrying Capacity in pounds, from the Strength score. */
export const capacityOf = (strength: number) => strength * CARRY_PER_STRENGTH;

/** The ammunition a weapon fires: its type from the Ammunition table (Bullets by firearm or sling). */
export function ammunitionFor(weapon: Gear & { kind: 'weapon' }, catalog: Catalog): string | null {
	const type = weapon.data.ammunition;
	if (!type) return null;
	const all = catalog.all('ammunition').filter((a) => a.data.type === type);
	if (all.length <= 1) return all[0]?.id ?? null;
	// The SRD names both kinds of bullet "Bullet"; a Sling fires sling bullets, the firearms the others.
	const kind = weapon.name === 'Sling' ? 'sling' : 'firearm';
	return all.find((a) => a.data.kind === kind)?.id ?? null;
}

/** The entries equipped in a slot. */
export const equippedIn = (c: DndCharacter, slot: Slot) =>
	c.inventory.filter((e) => e.equipped === slot);

/** Hands in use. */
export function handsInUse(c: DndCharacter, catalog: Catalog): number {
	let n = 0;
	for (const e of c.inventory) {
		if (!e.equipped) continue;
		const g = gearOf(catalog, e.item);
		if (g) n += handsFor(g);
	}
	return n;
}

/** Everything wrong with what the character has equipped and carries. */
export function gearProblems(
	c: DndCharacter,
	catalog: Catalog,
	strength: number,
	className: string,
	training: ReturnType<typeof armorTraining>
): string[] {
	const out: string[] = [];
	if (equippedIn(c, 'armor').length > 1) out.push('more than one suit of armor worn');
	if (equippedIn(c, 'shield').length > 1) out.push('more than one Shield carried');
	for (const slot of ['armor', 'shield'] as const)
		for (const e of equippedIn(c, slot)) {
			const g = gearOf(catalog, e.item);
			if (g?.kind === 'armor' && !training.has(g.data.category))
				out.push(
					`${className} isn't trained ${slot === 'shield' ? 'with Shields' : `in ${g.name}`}`
				);
		}
	if (handsInUse(c, catalog) > 2) out.push('more held than two hands can hold');
	const weight = carriedWeight(c, catalog);
	if (weight > capacityOf(strength))
		out.push(`carries ${weight} lb., more than its capacity of ${capacityOf(strength)} lb.`);
	return out;
}

/** The first free entry id. */
export function nextItemId(c: Pick<DndCharacter, 'inventory'>): string {
	const used = new Set(c.inventory.map((e) => e.id));
	for (let n = 1; ; n++) if (!used.has(`item-${n}`)) return `item-${n}`;
}

/** Where an item came from, in words. */
export function sourceText(s: ItemSource): string {
	switch (s.how) {
		case 'starting':
			return 'Starting equipment';
		case 'found':
			return `Found: ${s.where}`;
		case 'given':
			return `Given by ${s.by}`;
		case 'granted':
			return 'From the GM';
		case 'recovered':
			return 'Recovered after a fight';
	}
}

const sameSource = (a: ItemSource, b: ItemSource) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A new character's gear: the armor worn, the Shield carried, each weapon
 * held while hands are free (in the order given; the rest carried), and a
 * bundle of each ammunition its weapons fire, as the classes' starting
 * equipment gives (a Shortbow comes with 20 Arrows).
 */
export function startingInventory(
	gear: { armor: string | null; shield: boolean; weapons: readonly string[] },
	catalog: Catalog
): InventoryItem[] {
	const out: InventoryItem[] = [];
	const add = (item: string, quantity: number, equipped: Slot | null) =>
		out.push({
			id: `item-${out.length + 1}`,
			item,
			quantity,
			equipped,
			source: { how: 'starting' }
		});
	if (gear.armor) add(gear.armor, 1, 'armor');
	let hands = 0;
	if (gear.shield) {
		const shield = catalog.named('armor', 'Shield');
		if (shield) {
			add(shield.id, 1, 'shield');
			hands++;
		}
	}
	const ammo: string[] = [];
	for (const id of gear.weapons) {
		const g = gearOf(catalog, id);
		// Not a weapon: carried as it is, for the checks to name.
		if (g?.kind !== 'weapon') {
			add(id, 1, null);
			continue;
		}
		const need = handsFor(g);
		add(id, 1, hands + need <= 2 ? 'hand' : null);
		if (hands + need <= 2) hands += need;
		const a = ammunitionFor(g, catalog);
		if (a && !ammo.includes(a)) ammo.push(a);
	}
	for (const a of ammo) add(a, catalog.get('ammunition', a)!.data.amount, null);
	return out;
}

const entry = (c: DndCharacter, id: string) => c.inventory.find((e) => e.id === id);

/**
 * Equips an entry: armor worn, a Shield or a weapon taken in hand. One piece
 * of a stack is split off to equip. Armor needs no other armor worn, and a
 * weapon or Shield enough free hands.
 */
export function equip(
	c: DndCharacter,
	id: string,
	catalog: Catalog,
	training: ReturnType<typeof armorTraining>
): Result<DndCharacter> {
	const e = entry(c, id);
	if (!e) return fail('No such item.');
	const g = gearOf(catalog, e.item);
	if (!g) return fail('No such item.');
	const slot = slotFor(g);
	if (!slot) return fail(`${g.name} isn't something to equip.`);
	if (e.equipped) return fail(`${g.name} is already equipped.`);
	if (e.quantity < 1) return fail(`No ${g.name} left.`);
	if (g.kind === 'armor' && !training.has(g.data.category))
		return fail(`${c.name} isn't trained ${slot === 'shield' ? 'with Shields' : `in ${g.name}`}.`);
	if (slot === 'armor') {
		const worn = equippedIn(c, 'armor')[0];
		if (worn) return fail(`Take off the ${gearOf(catalog, worn.item)?.name ?? 'armor'} first.`);
	}
	if (slot === 'shield' && equippedIn(c, 'shield').length)
		return fail('A Shield is already carried.');
	if (slot !== 'armor' && handsInUse(c, catalog) + handsFor(g) > 2)
		return fail(
			`${c.name}'s hands are full: ${handsFor(g) === 2 ? `${g.name} takes both hands` : 'put something away first'}.`
		);
	const next = structuredClone(c);
	const at = next.inventory.findIndex((x) => x.id === id);
	if (e.quantity > 1) {
		if (next.inventory.length >= INVENTORY_MAX)
			return fail('Too many things carried to split one off.');
		next.inventory[at].quantity--;
		next.inventory.splice(at + 1, 0, {
			id: nextItemId(next),
			item: e.item,
			quantity: 1,
			equipped: slot,
			source: structuredClone(e.source)
		});
	} else next.inventory[at].equipped = slot;
	return { ok: true, value: next };
}

/** Takes an entry off, or out of hand; it joins a stack of the same thing from the same place. */
export function unequip(c: DndCharacter, id: string, catalog: Catalog): Result<DndCharacter> {
	const e = entry(c, id);
	const g = e && gearOf(catalog, e.item);
	if (!e || !g) return fail('No such item.');
	if (!e.equipped) return fail(`${g.name} isn't equipped.`);
	const next = structuredClone(c);
	const at = next.inventory.findIndex((x) => x.id === id);
	const stack = next.inventory.find(
		(x) => x.id !== id && !x.equipped && x.item === e.item && sameSource(x.source, e.source)
	);
	if (stack) {
		stack.quantity += e.quantity;
		next.inventory.splice(at, 1);
	} else next.inventory[at].equipped = null;
	return { ok: true, value: next };
}

/** Takes `quantity` of an entry out of the inventory (to drop or give); equipped gear comes off first. */
export function takeOut(
	c: DndCharacter,
	id: string,
	quantity: number,
	catalog: Catalog
): Result<{ character: DndCharacter; item: LooseItem; name: string }> {
	const e = entry(c, id);
	const g = e && gearOf(catalog, e.item);
	if (!e || !g) return fail('No such item.');
	if (!Number.isInteger(quantity) || quantity < 1 || quantity > e.quantity)
		return fail(`${c.name} has ${e.quantity} ${g.name}.`);
	const next = structuredClone(c);
	const at = next.inventory.findIndex((x) => x.id === id);
	if (quantity === e.quantity) next.inventory.splice(at, 1);
	else next.inventory[at].quantity -= quantity;
	return {
		ok: true,
		value: {
			character: next,
			item: { item: e.item, quantity, source: structuredClone(e.source) },
			name: nameOf(g, quantity)
		}
	};
}

/** Puts an item in the inventory, carried: stacked with the same thing from the same place. */
export function putIn(
	c: DndCharacter,
	item: LooseItem,
	catalog: Catalog,
	strength: number
): Result<DndCharacter> {
	const g = gearOf(catalog, item.item);
	if (!g) return fail('No such item.');
	if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > QUANTITY_MAX)
		return fail('Not a quantity of anything.');
	const weight = carriedWeight(c, catalog) + weightOf(g, item.quantity);
	if (weight > capacityOf(strength))
		return fail(
			`${c.name} can't carry ${nameOf(g, item.quantity)}: ${Math.round(weight * 100) / 100} lb. is past ${c.name}'s capacity of ${capacityOf(strength)} lb.`
		);
	const next = structuredClone(c);
	const stack = next.inventory.find(
		(x) => !x.equipped && x.item === item.item && sameSource(x.source, item.source)
	);
	if (stack) {
		if (stack.quantity + item.quantity > QUANTITY_MAX)
			return fail(`That's more ${g.name} than one can count.`);
		stack.quantity += item.quantity;
	} else {
		if (next.inventory.length >= INVENTORY_MAX) return fail(`${c.name} carries too many things.`);
		next.inventory.push({
			id: nextItemId(next),
			item: item.item,
			quantity: item.quantity,
			equipped: null,
			source: structuredClone(item.source)
		});
	}
	return { ok: true, value: next };
}

/**
 * An attack with a weapon expends a piece of its ammunition, if it has the
 * Ammunition property: null for a weapon that doesn't, else the character
 * with one piece fewer, or why it can't fire.
 */
export function expend(
	c: DndCharacter,
	weaponId: string,
	catalog: Catalog
): Result<{ character: DndCharacter; ammunition: string; left: number }> | null {
	const w = gearOf(catalog, weaponId);
	if (w?.kind !== 'weapon') return null;
	const ammo = ammunitionFor(w, catalog);
	if (!ammo) return null;
	const name = catalog.get('ammunition', ammo)!.name;
	const next = structuredClone(c);
	const stack = next.inventory.find((e) => e.item === ammo && e.quantity > 0);
	if (!stack) return fail(`${c.name} has no ${name} for the ${w.name}.`);
	stack.quantity--;
	next.state.expended[ammo] = (next.state.expended[ammo] ?? 0) + 1;
	const left = next.inventory.filter((e) => e.item === ammo).reduce((n, e) => n + e.quantity, 0);
	return { ok: true, value: { character: next, ammunition: name, left } };
}

/** After a fight: half of each expended ammunition back (round down). Null when none was expended. */
export function recover(
	c: DndCharacter,
	catalog: Catalog
): { character: DndCharacter; recovered: { name: string; count: number }[] } | null {
	const spent = Object.entries(c.state.expended).filter(([, n]) => n > 0);
	if (!spent.length) return null;
	const next = structuredClone(c);
	const recovered: { name: string; count: number }[] = [];
	for (const [ammo, n] of spent) {
		const back = Math.floor(n / 2);
		const g = gearOf(catalog, ammo);
		if (!g || !back) continue;
		const stack = next.inventory.find((e) => e.item === ammo);
		if (stack) stack.quantity = Math.min(QUANTITY_MAX, stack.quantity + back);
		else if (next.inventory.length < INVENTORY_MAX)
			next.inventory.push({
				id: nextItemId(next),
				item: ammo,
				quantity: back,
				equipped: null,
				source: { how: 'recovered' }
			});
		recovered.push({ name: g.name, count: back });
	}
	next.state.expended = {};
	return { character: next, recovered };
}

/** "Longsword", "20 Arrows". */
export function nameOf(gear: Gear, quantity: number): string {
	return quantity === 1 && gear.kind !== 'ammunition' ? gear.name : `${quantity} ${gear.name}`;
}

const SLOT_WORDS: Record<Slot, string> = {
	armor: 'Worn',
	shield: 'Carried as a Shield',
	hand: 'In hand'
};

/** What a piece of gear is, in words. */
export function kindText(gear: Gear): string {
	if (gear.kind === 'weapon')
		return `${gear.data.category[0].toUpperCase()}${gear.data.category.slice(1)} ${gear.data.type} weapon`;
	if (gear.kind === 'armor')
		return gear.data.category === 'shield'
			? 'Shield'
			: `${gear.data.category[0].toUpperCase()}${gear.data.category.slice(1)} armor`;
	return 'Ammunition';
}

/** The inventory as the card shows it. */
export function inventoryCard(c: DndCharacter, catalog: Catalog): CardItem[] {
	return c.inventory.flatMap((e) => {
		const g = gearOf(catalog, e.item);
		if (!g) return [];
		return [
			{
				id: e.id,
				name: g.name,
				quantity: e.quantity,
				equipped: e.equipped ? SLOT_WORDS[e.equipped] : null,
				kind: kindText(g),
				weight: Math.round(weightOf(g, e.quantity) * 100) / 100,
				source: sourceText(e.source),
				equippable: slotFor(g) !== null
			}
		];
	});
}
