// A caster's spells as its actions at the table: each cantrip and prepared
// spell the table plays (mechanics.ts) becomes an action with its aim
// (`Action.cast`); every other one is listed on the sheet with the reason
// it isn't cast here. Casting time, range, duration and concentration come
// from the catalog's data.

import type { Action } from '../../../../src/lib/adventure/characters';
import type { SheetSpell } from '../../../../src/lib/rules/dnd55e/sheet';
import type { Catalog } from '../catalog';
import type { Ability } from '../core';
import type { DerivedCharacter } from '../character/derive';
import type { DndCharacter } from '../character/model';
import {
	cantripTier,
	CASTING_TIMES,
	rangeCells,
	SPELL_MECHANICS,
	timesDice,
	unsupported,
	type SpellMechanics
} from './mechanics';

const FEET_PER_CELL = 5;
const slug = (id: string) => id.slice(id.lastIndexOf(':') + 1);
const signed = (n: number) => (n < 0 ? `${n}` : `+${n}`);
const titled = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

export interface CasterActions {
	actions: Action[];
	/** Spell attacks' ability (the spellcasting ability), by action id. */
	attacks: Record<string, Ability>;
	bonusActions: string[];
	/** The catalog spell each action casts. */
	spells: Record<string, string>;
	/** The slot level of each slot resource. */
	slots: Record<string, number>;
	/** Every spell it knows or has prepared, as the sheet lists them. */
	list: SheetSpell[];
}

/** What a spell does, in a line: "+5 to hit, 1d10 fire", "DC 13 Dexterity save, 3d6 fire, half on a success". */
function resolves(
	mech: SpellMechanics,
	dice: string | null,
	numbers: { dc: number; attack: number; mod: number }
): string {
	const damage = mech.damage && dice ? `${dice} ${mech.damage.type.toLowerCase()}` : '';
	switch (mech.resolve) {
		case 'attack':
			return `${signed(numbers.attack)} to hit, ${damage}`;
		case 'save': {
			const ability = {
				str: 'Strength',
				dex: 'Dexterity',
				con: 'Constitution',
				int: 'Intelligence',
				wis: 'Wisdom',
				cha: 'Charisma'
			}[mech.save!.ability];
			const fail = mech.onFail
				? `, or ${mech.onFail.conditions.map(titled).join(' and ')}${mech.onFail.worsens ? `, then ${mech.onFail.worsens.map(titled).join(' and ')}` : ''}`
				: '';
			return `DC ${numbers.dc} ${ability} save${damage ? `, ${damage}` : ''}${mech.save!.half ? ', half on a success' : ''}${mech.push ? `, pushed ${mech.push} feet` : ''}${fail}`;
		}
		case 'auto':
			return `${mech.targets.count} darts of ${damage}, never missing`;
		case 'heal':
			return `heals ${mech.heal!.dice}${signed(numbers.mod)}`;
		case 'effect': {
			const e = mech.effect!;
			return e.boon
				? `+${e.boon} to attack rolls and saves`
				: e.defense
					? `+${e.defense} Armor Class`
					: 'a lasting effect';
		}
	}
}

export function casterActions(
	character: DndCharacter,
	derived: DerivedCharacter,
	catalog: Catalog,
	taken: ReadonlySet<string>
): CasterActions {
	const out: CasterActions = {
		actions: [],
		attacks: {},
		bonusActions: [],
		spells: {},
		slots: {},
		list: []
	};
	const casting = derived.spellcasting;
	if (!casting) return out;
	for (const r of derived.resources) {
		const level = /^spell-slots-(\d)$/.exec(r.id);
		if (level) out.slots[r.id] = Number(level[1]);
		else if (r.id === 'pact-slots' && casting.pact) out.slots[r.id] = casting.pact.level;
	}
	const upTo = Math.max(0, ...Object.values(out.slots));
	const numbers = {
		dc: casting.saveDc,
		attack: casting.attackBonus,
		mod: derived.modifiers[casting.ability]
	};
	const tier = cantripTier(character.level);
	for (const id of [...character.spells.cantrips, ...character.spells.prepared]) {
		const record = catalog.get('spell', id);
		if (!record) continue;
		const data = record.data;
		const why = unsupported(id, data);
		const mech = SPELL_MECHANICS[id];
		let action: string | null = null;
		if (!why && mech) {
			action = slug(id);
			for (let n = 2; taken.has(action) || out.spells[action]; n++) action = `${slug(id)}-${n}`;
			const dice = mech.damage
				? data.level === 0 && mech.cantrip === 'dice'
					? timesDice(mech.damage.dice, tier)
					: mech.damage.dice
				: null;
			const range = rangeCells(data.range) ?? 0;
			const area = mech.area
				? { shape: mech.area.shape, size: mech.area.feet / FEET_PER_CELL }
				: null;
			const heals = mech.resolve === 'heal';
			const boon = mech.resolve === 'effect';
			out.actions.push({
				id: action,
				name: record.name,
				about: record.text.split('\n\n')[0],
				kind: heals ? 'heal' : boon ? 'boon' : 'attack',
				target: mech.targets.side === 'ally' ? 'ally' : 'enemy',
				// A cone or cube runs from the caster; a sphere is aimed at a point within the spell's range.
				range: area && area.shape !== 'sphere' ? area.size : range,
				stat: 'wits',
				...(dice ? { dice } : mech.heal ? { dice: `${mech.heal.dice}${signed(numbers.mod)}` } : {}),
				uses: null,
				cast: {
					level: data.level,
					upTo: data.level === 0 ? 0 : upTo,
					targets: mech.cantrip === 'beams' ? tier : mech.targets.count,
					perLevel: mech.targets.perSlot,
					repeat: !!mech.targets.repeat,
					area,
					...(mech.chooses ? { chooses: true } : {}),
					concentration: data.concentration,
					resolves: resolves(mech, dice, numbers)
				}
			});
			out.spells[action] = id;
			// Its spell attacks (and its sheet's account of every harmful spell) use the casting ability.
			if (!heals && !boon) out.attacks[action] = casting.ability;
			if (CASTING_TIMES[data.castingTime] === 'bonus') out.bonusActions.push(action);
		}
		out.list.push({
			id,
			name: record.name,
			level: data.level,
			school: data.school,
			castingTime: data.castingTime,
			range: data.range,
			components: [
				data.components.verbal ? 'V' : '',
				data.components.somatic ? 'S' : '',
				data.components.material ? `M (${data.components.material})` : ''
			]
				.filter(Boolean)
				.join(', '),
			duration: data.duration,
			concentration: data.concentration,
			text: record.text,
			action,
			why
		});
	}
	return out;
}
