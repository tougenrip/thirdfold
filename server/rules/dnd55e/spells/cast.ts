// Casting spells under the fifth edition rules (the ruleset contract's
// `Spellcasting`): what a cast costs (a spell slot of its level or higher; a
// cantrip nothing) and what it does to each target, by the mechanics table
// (mechanics.ts) and the catalog's data. The engine picks the targets (in
// range, in the area), spends the slot, and applies what comes back:
// damage, healing, a push, a lasting effect.
//
// As the SRD has it: a spell attack adds the spellcasting modifier and the
// Proficiency Bonus; a target's saving throw is against 8 + that modifier +
// the Proficiency Bonus; a spell that damages several targets at once rolls
// its damage once for all of them; a critical hit rolls a spell's damage
// dice twice; concentration is kept after damage with a Constitution save
// against half the damage (at least 10, at most 30).

import type { Action, CharacterDef } from '../../../../src/lib/adventure/characters';
import type { Ruleset, SpellHit, Spellcasting } from '../../ruleset';
import type { Catalog } from '../catalog';
import {
	abilityModifier,
	abilityName,
	describeD20,
	proficiencyBonus,
	rollD20,
	rollDamage,
	type Ability
} from '../core';
import { sheetOf } from '../sheet';
import {
	cantripTier,
	durationRounds,
	SPELL_MECHANICS,
	timesDice,
	upcast,
	type SpellMechanics
} from './mechanics';

type Refused = { ok: false; problems: string[] };
const refuse = (problem: string): Refused => ({ ok: false, problems: [problem] });

/** A caster's spell save DC and spell attack bonus. */
export function castingNumbers(character: CharacterDef): {
	dc: number;
	attack: number;
	mod: number;
} {
	const sheet = sheetOf(character);
	const ability = sheet.casting ?? 'int';
	const mod = abilityModifier(sheet.abilities[ability]);
	const prof = proficiencyBonus(sheet.level);
	return { dc: 8 + mod + prof, attack: mod + prof, mod };
}

/** The damage dice of a spell cast at a level, by a caster of a character level. */
export function damageDice(
	mech: SpellMechanics,
	spellLevel: number,
	level: number,
	casterLevel: number
): string {
	const d = mech.damage!;
	if (spellLevel === 0 && mech.cantrip === 'dice')
		return timesDice(d.dice, cantripTier(casterLevel));
	return upcast(d.dice, d.perSlot, level - spellLevel);
}

export function dndSpells(catalog: () => Catalog, strike: () => Ruleset['strike']): Spellcasting {
	const spellOf = (character: CharacterDef, action: Action) => {
		const id = sheetOf(character).spells[action.id];
		const record = id ? catalog().get('spell', id) : undefined;
		const mech = id ? SPELL_MECHANICS[id] : undefined;
		return record && mech ? { id, record, mech } : null;
	};

	return {
		plan(character, action, slot, spent) {
			const spell = spellOf(character, action);
			if (!spell) return refuse(`${action.name} isn't a spell ${character.name} can cast.`);
			const sheet = sheetOf(character);
			const { record, mech } = spell;
			const base = record.data.level;
			const targetsAt = (level: number) =>
				mech.cantrip === 'beams'
					? cantripTier(sheet.level)
					: mech.targets.count + mech.targets.perSlot * Math.max(0, level - base);
			if (base === 0) {
				if (slot !== null && slot !== 0)
					return refuse(`${record.name} is a cantrip: it takes no spell slot.`);
				return { ok: true, level: 0, resource: null, targets: targetsAt(0) };
			}
			const left = (id: string) => (sheet.resources.find((r) => r.id === id)?.max ?? 0) - spent(id);
			const slotsAt = (level: number) =>
				Object.entries(sheet.slots)
					.filter(([id, l]) => l === level && left(id) > 0)
					.map(([id]) => id);
			if (slot !== null) {
				if (!Number.isInteger(slot) || slot < base || slot > 9)
					return refuse(
						`${record.name} is a level ${base} spell: cast it with a slot of level ${base} or higher.`
					);
				const resource = slotsAt(slot)[0];
				if (!resource) return refuse(`${character.name} has no level ${slot} spell slots left.`);
				return { ok: true, level: slot, resource, targets: targetsAt(slot) };
			}
			for (let level = base; level <= 9; level++) {
				const resource = slotsAt(level)[0];
				if (resource) return { ok: true, level, resource, targets: targetsAt(level) };
			}
			return refuse(`${character.name} has no spell slots left for ${record.name}.`);
		},

		resolve(character, action, level, targets, roller) {
			const spell = spellOf(character, action);
			if (!spell) return [];
			const { record, mech } = spell;
			const sheet = sheetOf(character);
			const base = record.data.level;
			const { dc, attack, mod } = castingNumbers(character);
			const dice = mech.damage ? damageDice(mech, base, level, sheet.level) : null;
			// Several targets at once: the damage is rolled once for all.
			const shared = dice && mech.resolve === 'save' ? rollDamage(dice, false, roller) : null;
			const rounds = durationRounds(record.data.duration);
			const effect =
				mech.effect && rounds !== null
					? {
							name: record.name,
							mods: { ...mech.effect },
							ends: { at: 'start' as const, turns: rounds },
							concentration: record.data.concentration
						}
					: null;
			const rider = mech.rider
				? {
						name: record.name,
						mods: { ...mech.rider.mods },
						ends: { at: mech.rider.ends, turns: 1 },
						concentration: false
					}
				: null;
			return targets.map((t): SpellHit => {
				const hit: SpellHit = {
					targetId: t.id,
					strikes: [],
					save: null,
					dc: null,
					damage: null,
					heal: null,
					push: 0,
					effect: null
				};
				const type = mech.damage?.type ?? '';
				if (mech.resolve === 'attack' && dice) {
					let total = 0;
					for (let i = 0; i < Math.max(1, t.times); i++) {
						const s = strike()(
							attack,
							dice,
							t.defense,
							// A melee spell attack is not a ranged one, whatever its range.
							{ ...t.situation, ranged: mech.attack === 'ranged' },
							roller
						);
						hit.strikes.push(s);
						total += s.damage?.total ?? 0;
					}
					const landed = hit.strikes.filter((s) => s.damage);
					if (landed.length) {
						hit.damage = { roll: landed[0].damage!, amount: total, type };
						hit.effect = rider;
					}
				} else if (mech.resolve === 'save' && shared && mech.save) {
					const ability = mech.save.ability;
					const bonus = t.saveBonus(ability);
					const d20 = rollD20(bonus, undefined, roller, t.boon);
					const success = d20.total >= dc;
					hit.dc = dc;
					hit.save = {
						roll: d20.roll,
						success,
						label: `${abilityName(ability as Ability)} saving throw`,
						explain: `${describeD20(d20, bonus)} vs DC ${dc}: ${success ? 'success' : 'failure'}`
					};
					const amount = success
						? mech.save.half
							? Math.floor(shared.total / 2)
							: 0
						: shared.total;
					hit.damage = { roll: shared, amount, type };
					if (!success && mech.push) hit.push = Math.floor(mech.push / 5);
				} else if (mech.resolve === 'auto' && dice) {
					// Each dart deals 1d4 + 1: n darts, n d4 and n more.
					const n = Math.max(1, t.times);
					const m = /^(\d+)d(\d+)\+(\d+)$/.exec(dice);
					const expr = m ? `${n * Number(m[1])}d${m[2]}+${n * Number(m[3])}` : dice;
					const roll = rollDamage(expr, false, roller);
					hit.damage = { roll, amount: roll.total, type };
				} else if (mech.resolve === 'heal' && mech.heal) {
					const healDice = upcast(mech.heal.dice, mech.heal.perSlot, level - base);
					hit.heal = rollDamage(`${healDice}${mod >= 0 ? '+' : ''}${mod}`, false, roller);
				} else if (mech.resolve === 'effect') {
					hit.effect = effect;
				}
				return hit;
			});
		},

		concentration: (damage) => ({
			stat: 'con',
			dc: Math.min(30, Math.max(10, Math.floor(damage / 2)))
		})
	};
}
