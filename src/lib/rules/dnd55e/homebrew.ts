// Homebrew packs for the fifth edition rules (milestone 52): a creator's own
// weapons, armor, spells and monsters, as typed plain data that extends the
// SRD catalog without touching it. A pack is checked in full on the server
// (server/rules/dnd55e/homebrew/), which gives it an id from its content, so
// the same pack is the same id wherever it goes and a changed pack is a new
// one; its records' ids start with that id, never with an SRD source's.
// Nothing here is code: dice are dice, numbers are numbers, words are words.
// Relative imports only.

import { CONTENT_PACK_MAX_BYTES } from '../../game/file-limits';

export const HOMEBREW_FORMAT = 'thirdfold-homebrew';
export const HOMEBREW_FORMAT_VERSION = 1;

/** Bounds on a pack: its size as JSON, its records, and each text. */
export const HOMEBREW_LIMITS = {
	bytes: CONTENT_PACK_MAX_BYTES,
	records: 64,
	name: 60,
	text: 2000,
	about: 500
} as const;

export type HomebrewKind = 'weapon' | 'armor' | 'spell' | 'monster';
export const HOMEBREW_KINDS: readonly HomebrewKind[] = ['weapon', 'armor', 'spell', 'monster'];

/** The weapon properties a homebrew weapon may have; range, Versatile dice and ammunition are fields of their own. */
export const WEAPON_PROPERTIES = [
	'Ammunition',
	'Finesse',
	'Heavy',
	'Light',
	'Loading',
	'Reach',
	'Thrown',
	'Two-Handed',
	'Versatile'
] as const;

interface RecordBase {
	/** Lowercase words joined by hyphens, unique among the pack's records of its kind. */
	slug: string;
	name: string;
	/** The creator's description, shown with the record. */
	text?: string;
}

export interface HomebrewWeapon extends RecordBase {
	kind: 'weapon';
	category: 'simple' | 'martial';
	type: 'melee' | 'ranged';
	/** "1d8", or a flat "1". */
	damage: string;
	/** A damage type, e.g. "Slashing". */
	damageType: string;
	properties: (typeof WEAPON_PROPERTIES)[number][];
	/** Normal and long range in feet: for a ranged, Thrown or Ammunition weapon. */
	range?: { normal: number; long: number };
	/** Two-handed damage, for a Versatile weapon. */
	versatile?: string;
	/** What it fires, for an Ammunition weapon: Arrow, Bolt or Needle. */
	ammunition?: string;
	/** One of the SRD's mastery properties. */
	mastery: string;
	/** Pounds. */
	weight: number;
	/** In gold pieces. */
	cost: number;
}

export interface HomebrewArmor extends RecordBase {
	kind: 'armor';
	category: 'light' | 'medium' | 'heavy' | 'shield';
	/** The base Armor Class (a Shield's bonus). Dexterity counts by category, as in the SRD. */
	base: number;
	/** Strength score needed to move freely in it (heavy armor), or none. */
	strength?: number;
	stealthDisadvantage: boolean;
	weight: number;
	cost: number;
}

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

/** How a homebrew spell plays at the table: the same terms the SRD's spells are played by. */
export interface HomebrewSpellMechanics {
	resolve: 'attack' | 'save' | 'heal' | 'auto';
	attack?: 'melee' | 'ranged';
	save?: { ability: AbilityKey; half: boolean };
	damage?: { dice: string; type: string; perSlot?: string };
	heal?: { dice: string; perSlot: string };
	targets: { count: number; perSlot: number; side: 'enemy' | 'ally' };
	/** A damage cantrip's dice grow at levels 5, 11 and 17. */
	cantrip?: boolean;
	area?: { shape: 'cone' | 'cube' | 'sphere'; feet: number };
	/** Feet a target is pushed away on a failed save. */
	push?: number;
	/** Conditions a failed save leaves on the target for the spell's duration. */
	onFail?: { conditions: string[] };
}

export interface HomebrewSpell extends RecordBase {
	kind: 'spell';
	/** 0 for a cantrip. */
	level: number;
	school: string;
	/** The SRD classes that may prepare it, by name ("Wizard"). */
	classes: string[];
	castingTime: 'Action' | 'Bonus Action';
	/** "Self", "Touch" or "<n> feet". */
	range: string;
	/** "Instantaneous", or "<n> rounds|minutes|hours" ("up to …" when it needs concentration). */
	duration: string;
	concentration: boolean;
	components: { verbal: boolean; somatic: boolean; material: string | null };
	/** How it is cast at the table; without it the spell is listed but not cast. */
	mechanics?: HomebrewSpellMechanics;
}

export interface HomebrewAttack {
	name: string;
	kind: 'melee' | 'ranged';
	toHit: number;
	/** Melee reach in feet. */
	reach?: number;
	/** Ranged normal and long range in feet. */
	range?: { normal: number; long: number };
	damage: string;
	damageType: string;
	/** More damage of another type with every hit. */
	plus?: { damage: string; damageType: string };
	/** A hit knocks a target of its size or smaller Prone. */
	prone?: boolean;
}

export interface HomebrewMonster extends RecordBase {
	kind: 'monster';
	size: 'Tiny' | 'Small' | 'Medium' | 'Large' | 'Huge' | 'Gargantuan';
	/** Its creature type, as the SRD writes it ("Undead", "Beast"). */
	type: string;
	alignment?: string;
	armorClass: number;
	hitPoints: number;
	/** Walking speed in feet. */
	speed: number;
	abilities: Record<AbilityKey, number>;
	/** Saving throw bonuses it is proficient in (the rest are its modifiers). */
	saves?: Partial<Record<AbilityKey, number>>;
	/** A challenge rating the SRD has ("1/4", "3"): its XP and Proficiency Bonus come from the SRD. */
	challenge: string;
	/** Darkvision in feet. */
	darkvision?: number;
	immune?: string[];
	resist?: string[];
	vulnerable?: string[];
	conditionImmune?: string[];
	/** Traits, shown and listed as not played. */
	traits?: { name: string; text: string }[];
	attacks: HomebrewAttack[];
	/** It makes this many of one of its attacks with its action. */
	multiattack?: { attack: string; times: number };
}

export type HomebrewRecord = HomebrewWeapon | HomebrewArmor | HomebrewSpell | HomebrewMonster;

/** A pack as a creator writes it. */
export interface HomebrewPack {
	format: typeof HOMEBREW_FORMAT;
	formatVersion: typeof HOMEBREW_FORMAT_VERSION;
	name: string;
	/** The creator's own version of it ("1.0", "2.1.3"). */
	version: string;
	/** The rules it is for. */
	rules: { id: 'dnd-5.5e'; version: 1 };
	/** The SRD it extends, pinned by its source file's hash. */
	base: { source: string; version: string; sha256: string };
	/** Who made it, as they want to be credited. */
	creator?: string;
	about?: string;
	/** The licence the creator gives it, e.g. "CC-BY-4.0", or "All rights reserved". */
	license?: string;
	records: HomebrewRecord[];
}

/**
 * Content packs' ids: `hb-` for a creator's homebrew, `lc-` for a licensed
 * source's (milestone 59, src/lib/content/licence.ts), then 16 hex digits of
 * the pack's content hash. A record's id is the pack's id, the kind and the
 * slug, so an id always says which kind of source it comes from.
 */
export const HOMEBREW_PACK_ID = /^(?:hb|lc)-[0-9a-f]{16}$/;
export const isHomebrewId = (id: string) => /^(?:hb|lc)-[0-9a-f]{16}:/.test(id);
export const packOfId = (id: string) => (isHomebrewId(id) ? id.slice(0, 19) : null);
/** A licensed source's pack, record or monster kind. */
export const isLicensedId = (id: string) => id.startsWith('lc-');
