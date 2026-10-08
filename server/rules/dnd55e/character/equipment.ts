// The fifth edition rules' part of the equipment contract (ruleset.ts
// `Equipment`): each change reads the character a definition carries
// (`sheet.saved`, written by tableCharacter), changes its inventory with
// inventory.ts and gives back its next saved form, which the engine
// restores through the builder, so every rule is checked again and every
// number (Armor Class, attacks, speed) comes from the rules.

import type { Action, CharacterDef } from '../../../../src/lib/adventure/characters';
import type { Equipment, ItemOrigin, JsonData, RulesetRef } from '../../ruleset';
import type { Catalog } from '../catalog';
import { sheetOf } from '../sheet';
import { actionsOf, savedOf } from './builder';
import {
	equip,
	expend,
	gearOf,
	nameOf,
	putIn,
	QUANTITY_MAX,
	recover,
	takeOut,
	unequip,
	type ItemSource,
	type LooseItem
} from './inventory';
import type { DndCharacter } from './model';
import { armorTraining } from './options';
import { deriveCharacter, scoresOf } from './derive';
import { readCharacter } from './validate';

type Refused = { ok: false; problems: string[] };
const refuse = (problem: string): Refused => ({ ok: false, problems: [problem] });

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

export function dndEquipment(catalog: () => Catalog, rules: RulesetRef): Equipment {
	/** The character a definition carries, and its colour. */
	function characterOf(def: CharacterDef): { character: DndCharacter; color: string } | null {
		const saved = def.sheet ? sheetOf(def).saved : null;
		if (!saved || typeof saved.color !== 'string') return null;
		const read = readCharacter(saved.character, catalog(), rules);
		return read.ok ? { character: read.character, color: saved.color } : null;
	}
	const saved = (c: DndCharacter, color: string) => savedOf(c, color) as JsonData;

	/** An item as `remove` and `grant` give it: checked, since it may come back from a save. */
	function looseOf(raw: unknown): LooseItem | null {
		if (!isObject(raw) || typeof raw.item !== 'string') return null;
		const g = gearOf(catalog(), raw.item);
		const q = raw.quantity;
		if (!g || typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > QUANTITY_MAX)
			return null;
		return { item: raw.item, quantity: q, source: { how: 'granted' } };
	}
	const sourceOf = (origin: ItemOrigin): ItemSource =>
		origin.how === 'found'
			? { how: 'found', where: origin.where.slice(0, 80) }
			: origin.how === 'given'
				? { how: 'given', by: origin.by.slice(0, 60) }
				: { how: 'granted' };

	return {
		has: (def) => !!def.sheet && !!sheetOf(def).saved,
		wield(def, entry, on) {
			const it = characterOf(def);
			if (!it) return refuse(`${def.name} carries nothing the rules keep.`);
			const { character, color } = it;
			const e = character.inventory.find((x) => x.id === entry);
			const g = e && gearOf(catalog(), e.item);
			if (!e || !g) return refuse('No such item.');
			const klass = catalog().get('class', character.class.id)!;
			const next = on
				? equip(character, entry, catalog(), armorTraining(klass.data))
				: unequip(character, entry, catalog());
			if (!next.ok) return next;
			const verb = on
				? g.kind === 'weapon'
					? 'takes up'
					: g.kind === 'armor' && g.data.category === 'shield'
						? 'raises'
						: 'puts on'
				: g.kind === 'weapon'
					? 'puts away'
					: 'takes off';
			return {
				ok: true,
				saved: saved(next.value, color),
				text: `${character.name} ${verb} the ${g.name}.`,
				weapon: g.kind === 'weapon'
			};
		},
		remove(def, entry, quantity) {
			const it = characterOf(def);
			if (!it) return refuse(`${def.name} carries nothing the rules keep.`);
			const out = takeOut(it.character, entry, quantity, catalog());
			if (!out.ok) return out;
			return {
				ok: true,
				saved: saved(out.value.character, it.color),
				item: { item: out.value.item.item, quantity: out.value.item.quantity },
				name: out.value.name
			};
		},
		add(def, raw, origin) {
			const it = characterOf(def);
			if (!it) return refuse(`${def.name} carries nothing the rules keep.`);
			const item = looseOf(raw);
			if (!item) return refuse('Not something to carry.');
			item.source = sourceOf(origin);
			const strength = scoresOf(it.character, catalog()).str;
			const next = putIn(it.character, item, catalog(), strength);
			if (!next.ok) return next;
			return {
				ok: true,
				saved: saved(next.value, it.color),
				name: nameOf(gearOf(catalog(), item.item)!, item.quantity)
			};
		},
		grant(id, quantity) {
			const g = gearOf(catalog(), id);
			if (!g) return refuse(`No weapon, armor or ammunition "${id.slice(0, 80)}" in the catalog.`);
			if (!Number.isInteger(quantity) || quantity < 1 || quantity > QUANTITY_MAX)
				return refuse(`A quantity from 1 to ${QUANTITY_MAX}.`);
			return { ok: true, item: { item: id, quantity }, name: nameOf(g, quantity) };
		},
		nameOf(raw) {
			const item = looseOf(raw);
			return item ? nameOf(gearOf(catalog(), item.item)!, item.quantity) : null;
		},
		use(def, action: Action) {
			if (action.kind !== 'attack') return null;
			const it = characterOf(def);
			if (!it) return null;
			const derived = deriveCharacter(it.character, catalog());
			const weapon = actionsOf(it.character, derived, catalog()).weapons[action.id];
			if (!weapon) return null;
			const spent = expend(it.character, weapon, catalog());
			if (!spent) return null;
			if (!spent.ok) return spent;
			return {
				ok: true,
				saved: saved(spent.value.character, it.color),
				text:
					spent.value.left > 0
						? null
						: `${it.character.name} has used the last of the ${spent.value.ammunition}.`
			};
		},
		recover(def) {
			const it = characterOf(def);
			if (!it) return null;
			const back = recover(it.character, catalog());
			if (!back) return null;
			return {
				saved: saved(back.character, it.color),
				text: back.recovered.length
					? `${it.character.name} recovers ${back.recovered.map((r) => `${r.count} ${r.name}`).join(' and ')}.`
					: ''
			};
		}
	};
}
