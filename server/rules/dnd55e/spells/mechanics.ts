// Which SRD 5.2.1 spells the table plays, and how. The catalog (content/srd)
// holds every spell's data and text as the SRD prints it; this table says,
// for the spells the table resolves, what that text means in play: an
// attack roll or a saving throw, the damage or healing and how it grows
// with the slot (or, for a cantrip, the caster's level), how many targets
// or what area, and what lingers (an effect, milestone 49's interface).
// Casting time, range, duration and concentration are read from the
// catalog's data, not repeated here. `phrases` are the SRD's own words each
// entry stands on: a test checks they are in the spell's text, so the table
// can't drift from the source.
//
// Every other spell is listed on the sheet with the reason it isn't cast at
// the table (`unsupported`), never approximated. Material components are
// not tracked (no spell here consumes one).

import type { EffectMods } from '../../ruleset';
import type { Ability } from '../core';
import type { SpellData } from '../srd/records';

/** A cone or cube from the caster (`feet` long), or a sphere around a point in range (`feet` of radius). */
export type Area = { shape: 'cone' | 'cube' | 'sphere'; feet: number };

/** What a failed save leaves on the target, for the spell's duration. */
export interface OnFail {
	conditions: string[];
	/** It saves again at the end of each of its turns (and when hurt, with the upper hand, with `onDamage`). */
	repeat?: { onDamage?: boolean };
	/** A failed repeat save turns it into these conditions for the rest of the spell. */
	worsens?: string[];
	/** It ends when the target takes damage. */
	endsOnDamage?: boolean;
}

/** What lingers on a target after the spell (an effect), and when it ends. */
export interface Linger {
	mods: EffectMods;
	/** Counted on the caster's turns: at the start or the end of its next turn. */
	ends: 'start' | 'end';
}

export interface SpellMechanics {
	/** How the spell comes to bear on each target. */
	resolve: 'attack' | 'save' | 'auto' | 'heal' | 'effect';
	attack?: 'melee' | 'ranged';
	save?: { ability: Ability; half: boolean };
	/** Damage dice and type; grows by `perSlot` for each slot level above the spell's. */
	damage?: { dice: string; type: string; perSlot?: string };
	/** Healing dice, plus the spellcasting modifier; grows by `perSlot`. */
	heal?: { dice: string; perSlot: string };
	/** Targets at the spell's level, and how many more per slot level above it. */
	targets: { count: number; perSlot: number; side: 'enemy' | 'ally'; repeat?: boolean };
	/** A cantrip's damage dice multiply at levels 5, 11 and 17; `beams` multiplies attacks instead. */
	cantrip?: 'dice' | 'beams';
	/** An area from the caster (the spell's range is Self). */
	area?: Area;
	/** Feet a target is pushed away from the caster on a failed save. */
	push?: number;
	/** What a hit (or a failed save) leaves on the target until the caster's next turn. */
	rider?: Linger;
	/** An effect on each target for the spell's duration. */
	effect?: EffectMods;
	/** What a failed save leaves on the target. */
	onFail?: OnFail;
	/** Only creatures of the caster's choice in its area are caught (its foes). */
	chooses?: boolean;
	/** Creatures that don't sleep (an elf's Trance, Immunity to Exhaustion) succeed on the save. */
	sleepless?: boolean;
	/** The SRD's words this entry is read from, each in the spell's text. */
	phrases: readonly string[];
}

const srd = (slug: string) => `srd-5.2.1:spell:${slug}`;

export const SPELL_MECHANICS: Readonly<Record<string, SpellMechanics>> = {
	[srd('fire-bolt')]: {
		resolve: 'attack',
		attack: 'ranged',
		damage: { dice: '1d10', type: 'Fire' },
		targets: { count: 1, perSlot: 0, side: 'enemy' },
		cantrip: 'dice',
		phrases: ['Make a ranged spell attack', '1d10 Fire damage', 'levels 5 (2d10), 11 (3d10)']
	},
	[srd('ray-of-frost')]: {
		resolve: 'attack',
		attack: 'ranged',
		damage: { dice: '1d8', type: 'Cold' },
		targets: { count: 1, perSlot: 0, side: 'enemy' },
		cantrip: 'dice',
		rider: { mods: { slow: 2 }, ends: 'start' },
		phrases: [
			'Make a ranged spell attack',
			'1d8 Cold damage',
			'Speed is reduced by 10 feet until the start of your next turn'
		]
	},
	[srd('shocking-grasp')]: {
		resolve: 'attack',
		attack: 'melee',
		damage: { dice: '1d8', type: 'Lightning' },
		targets: { count: 1, perSlot: 0, side: 'enemy' },
		cantrip: 'dice',
		phrases: ['Make a melee spell attack', '1d8 Lightning damage']
	},
	[srd('chill-touch')]: {
		resolve: 'attack',
		attack: 'melee',
		damage: { dice: '1d10', type: 'Necrotic' },
		targets: { count: 1, perSlot: 0, side: 'enemy' },
		cantrip: 'dice',
		rider: { mods: { noHealing: true }, ends: 'end' },
		phrases: [
			'make a melee spell attack',
			'1d10 Necrotic damage',
			'can’t regain Hit Points until the end of your next turn'
		]
	},
	[srd('starry-wisp')]: {
		resolve: 'attack',
		attack: 'ranged',
		damage: { dice: '1d8', type: 'Radiant' },
		targets: { count: 1, perSlot: 0, side: 'enemy' },
		cantrip: 'dice',
		phrases: ['Make a ranged spell attack', '1d8 Radiant damage']
	},
	[srd('eldritch-blast')]: {
		resolve: 'attack',
		attack: 'ranged',
		damage: { dice: '1d10', type: 'Force' },
		targets: { count: 1, perSlot: 0, side: 'enemy', repeat: true },
		cantrip: 'beams',
		phrases: [
			'Make a ranged spell attack',
			'1d10 Force damage',
			'two beams at level 5, three beams at level 11, and four beams at level 17',
			'Make a separate attack roll for each beam'
		]
	},
	[srd('sacred-flame')]: {
		resolve: 'save',
		save: { ability: 'dex', half: false },
		damage: { dice: '1d8', type: 'Radiant' },
		targets: { count: 1, perSlot: 0, side: 'enemy' },
		cantrip: 'dice',
		phrases: ['must succeed on a Dexterity saving throw or take 1d8 Radiant damage']
	},
	[srd('magic-missile')]: {
		resolve: 'auto',
		damage: { dice: '1d4+1', type: 'Force' },
		targets: { count: 3, perSlot: 1, side: 'enemy', repeat: true },
		phrases: [
			'three glowing darts',
			'A dart deals 1d4 + 1 Force damage',
			'one more dart for each spell slot level above 1'
		]
	},
	[srd('burning-hands')]: {
		resolve: 'save',
		save: { ability: 'dex', half: true },
		damage: { dice: '3d6', type: 'Fire', perSlot: '1d6' },
		targets: { count: 0, perSlot: 0, side: 'enemy' },
		area: { shape: 'cone', feet: 15 },
		phrases: [
			'15-foot Cone makes a Dexterity saving throw',
			'3d6 Fire damage on a failed save or half as much damage on a successful one',
			'increases by 1d6 for each spell slot level above 1'
		]
	},
	[srd('thunderwave')]: {
		resolve: 'save',
		save: { ability: 'con', half: true },
		damage: { dice: '2d8', type: 'Thunder', perSlot: '1d8' },
		targets: { count: 0, perSlot: 0, side: 'enemy' },
		area: { shape: 'cube', feet: 15 },
		push: 10,
		phrases: [
			'15-foot Cube originating from you makes a Constitution saving throw',
			'2d8 Thunder damage and is pushed 10 feet away from you',
			'half as much damage only',
			'increases by 1d8 for each spell slot level above 1'
		]
	},
	[srd('guiding-bolt')]: {
		resolve: 'attack',
		attack: 'ranged',
		damage: { dice: '4d6', type: 'Radiant', perSlot: '1d6' },
		targets: { count: 1, perSlot: 0, side: 'enemy' },
		rider: { mods: { exposed: true }, ends: 'end' },
		phrases: [
			'Make a ranged spell attack',
			'4d6 Radiant damage',
			'the next attack roll made against it before the end of your next turn has Advantage',
			'increases by 1d6 for each spell slot level above 1'
		]
	},
	[srd('inflict-wounds')]: {
		resolve: 'save',
		save: { ability: 'con', half: true },
		damage: { dice: '2d10', type: 'Necrotic', perSlot: '1d10' },
		targets: { count: 1, perSlot: 0, side: 'enemy' },
		phrases: [
			'makes a Constitution saving throw, taking 2d10 Necrotic damage on a failed save or half as much damage on a successful one',
			'increases by 1d10 for each spell slot level above 1'
		]
	},
	[srd('ray-of-sickness')]: {
		resolve: 'attack',
		attack: 'ranged',
		damage: { dice: '2d8', type: 'Poison', perSlot: '1d8' },
		targets: { count: 1, perSlot: 0, side: 'enemy' },
		rider: { mods: { conditions: ['poisoned'] }, ends: 'end' },
		phrases: [
			'Make a ranged spell attack',
			'2d8 Poison damage and has the Poisoned condition until the end of your next turn',
			'increases by 1d8 for each spell slot level above 1'
		]
	},
	[srd('hideous-laughter')]: {
		resolve: 'save',
		save: { ability: 'wis', half: false },
		targets: { count: 1, perSlot: 1, side: 'enemy' },
		onFail: { conditions: ['prone', 'incapacitated'], repeat: { onDamage: true } },
		phrases: [
			'makes a Wisdom saving throw',
			'On a failed save, it has the Prone and Incapacitated conditions for the duration',
			'can’t end the Prone condition on itself',
			'At the end of each of its turns and each time it takes damage, it makes another Wisdom saving throw',
			'Advantage on the save if the save is triggered by damage',
			'On a successful save, the spell ends',
			'one additional creature for each spell slot level above 1'
		]
	},
	[srd('sleep')]: {
		resolve: 'save',
		save: { ability: 'wis', half: false },
		targets: { count: 0, perSlot: 0, side: 'enemy' },
		area: { shape: 'sphere', feet: 5 },
		chooses: true,
		sleepless: true,
		onFail: {
			conditions: ['incapacitated'],
			repeat: {},
			worsens: ['unconscious'],
			endsOnDamage: true
		},
		phrases: [
			'Each creature of your choice in a 5-foot-radius Sphere',
			'must succeed on a Wisdom saving throw or have the Incapacitated condition until the end of its next turn, at which point it must repeat the save',
			'If the target fails the second save, the target has the Unconscious condition for the duration',
			'The spell ends on a target if it takes damage',
			'Creatures that don’t sleep, such as elves, or that have Immunity to the Exhaustion condition automatically succeed'
		]
	},
	[srd('cure-wounds')]: {
		resolve: 'heal',
		heal: { dice: '2d8', perSlot: '2d8' },
		targets: { count: 1, perSlot: 0, side: 'ally' },
		phrases: [
			'2d8 plus your spellcasting ability modifier',
			'healing increases by 2d8 for each spell slot level above 1'
		]
	},
	[srd('healing-word')]: {
		resolve: 'heal',
		heal: { dice: '2d4', perSlot: '2d4' },
		targets: { count: 1, perSlot: 0, side: 'ally' },
		phrases: [
			'2d4 plus your spellcasting ability modifier',
			'healing increases by 2d4 for each spell slot level above 1'
		]
	},
	[srd('bless')]: {
		resolve: 'effect',
		effect: { boon: '1d4' },
		targets: { count: 3, perSlot: 1, side: 'ally' },
		phrases: [
			'up to three creatures within range',
			'adds 1d4 to the attack roll or save',
			'one additional creature for each spell slot level above 1'
		]
	},
	[srd('shield-of-faith')]: {
		resolve: 'effect',
		effect: { defense: 2 },
		targets: { count: 1, perSlot: 0, side: 'ally' },
		phrases: ['a creature of your choice within range', '+2 bonus to AC for the duration']
	}
};

/** The parts of a turn a spell may be cast with at the table. */
export const CASTING_TIMES: Readonly<Record<string, 'action' | 'bonus'>> = {
	Action: 'action',
	'Bonus Action': 'bonus'
};

/** Why a spell isn't cast at the table, or null when it is. */
export function unsupported(id: string, data: SpellData): string | null {
	if (SPELL_MECHANICS[id]) return null;
	const time = data.castingTime;
	if (!CASTING_TIMES[time.replace(/ or Ritual$/, '')])
		return time.startsWith('Reaction')
			? 'Cast as a reaction: reactions come with a later milestone.'
			: `Takes ${time.toLowerCase()} to cast: only spells cast as an action or a bonus action are cast at the table.`;
	return 'Its effects aren’t played at the table yet.';
}

/** Cells of a range the catalog gives ("120 feet", "Touch", "Self"), or null for one the table can't measure. */
export function rangeCells(range: string): number | null {
	if (range === 'Touch') return 1;
	if (range === 'Self' || range.startsWith('Self (')) return 0;
	const feet = /^(\d+) feet$/.exec(range);
	return feet ? Math.max(1, Math.floor(Number(feet[1]) / 5)) : null;
}

/** Rounds a concentration spell lasts ("up to 1 minute" is 10), from the catalog's duration. */
export function durationRounds(duration: string): number | null {
	const m = /^(?:up to )?(\d+) (round|minute|hour)s?$/.exec(duration);
	if (!m) return null;
	const n = Number(m[1]);
	return m[2] === 'round' ? n : m[2] === 'minute' ? n * 10 : n * 600;
}

/** A cantrip's multiplier at a character level: 1, then 2 at 5, 3 at 11, 4 at 17. */
export function cantripTier(level: number): number {
	return 1 + (level >= 5 ? 1 : 0) + (level >= 11 ? 1 : 0) + (level >= 17 ? 1 : 0);
}

/** Dice times a count: ("1d10", 2) is "2d10"; ("1d4+1", …) stays as it is. */
export function timesDice(dice: string, n: number): string {
	const m = /^(\d+)d(\d+)$/.exec(dice);
	return m ? `${Number(m[1]) * n}d${m[2]}` : dice;
}

/** Dice with more added for each slot level above the spell's: ("3d6", "1d6", 2) is "5d6". */
export function upcast(dice: string, per: string | undefined, above: number): string {
	if (!per || above <= 0) return dice;
	const a = /^(\d+)d(\d+)$/.exec(dice);
	const b = /^(\d+)d(\d+)$/.exec(per);
	if (a && b && a[2] === b[2]) return `${Number(a[1]) + Number(b[1]) * above}d${a[2]}`;
	return `${dice}+${timesDice(per, above)}`;
}
