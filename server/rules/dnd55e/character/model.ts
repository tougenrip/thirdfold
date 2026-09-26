// A fifth edition character (SRD 5.2.1) as the server keeps it: the choices
// a player made and the state of play, never a number the rules can work
// out (those come from derive.ts, every time). Versioned on its own
// (`version`, migrated forward by persist.ts), bound to the rules it plays
// by and the catalog its choices name, and holding no owner: who a
// character belongs to is kept beside it (roster.ts), so a character can be
// shared, copied or shown without saying whose it is.
//
// Every choice names a catalog record by id (`srd-5.2.1:class:fighter`), so
// a character stays readable across re-imports of the same source.

import type { RulesetRef } from '../../ruleset';
import type { CatalogPin } from '../catalog';
import type { Ability } from '../core';

/** The version of the stored shape. Bump it and add a migration in persist.ts when it changes. */
export const CHARACTER_VERSION = 1;

/** How the six base scores were generated (SRD: "Generate Your Scores"). */
export type ScoreMethod = 'standard-array' | 'point-buy' | 'rolled';

/** The +2/+1 (or +1/+1/+1) a background gives, by ability. */
export type Increases = Partial<Record<Ability, number>>;

/** A feat and the choices it asks for. */
export interface FeatChoice {
	/** A feat record's id. */
	feat: string;
	/** The ability scores it raises, for feats that raise any. */
	increases?: Increases;
	/** Skill ids it makes the character proficient in (Skilled). */
	skills?: string[];
}

/** A feat taken at a level that grants one (Ability Score Improvement, Epic Boon). */
export interface LevelFeat extends FeatChoice {
	level: number;
}

export interface DndCharacter {
	version: typeof CHARACTER_VERSION;
	/** Unique among a player's characters; `[a-z0-9-]`, up to 64 characters. */
	id: string;
	name: string;
	rules: RulesetRef;
	catalog: CatalogPin;
	level: number;

	species: {
		/** A species record's id. */
		id: string;
		/** The species' own choices, by option key (see options.ts), e.g. { lineage: "high-elf" }. */
		options: Record<string, string>;
		/** The Origin feat a species gives a choice of (Human: Versatile), else null. */
		feat: FeatChoice | null;
	};
	background: {
		id: string;
		increases: Increases;
	};
	class: {
		id: string;
		/** A subclass record's id, from level 3; null before. */
		subclass: string | null;
		/** Skill ids chosen from the class's list. */
		skills: string[];
		/** Skill ids given Expertise (proficient ones only). */
		expertise: string[];
		/** The Fighting Style feat, for classes whose features give one by this level. */
		fightingStyle: string | null;
		/** Weapon record ids whose mastery properties the character uses. */
		weaponMasteries: string[];
	};

	abilities: {
		method: ScoreMethod;
		/** The base scores, before the background's increases and feats. */
		base: Record<Ability, number>;
	};
	feats: LevelFeat[];
	/** Hit points past level 1: the fixed average each level, or the die rolled at each level (2 up). */
	hitPoints: { method: 'average' } | { method: 'rolled'; rolls: number[] };
	/** What the character wears, for Armor Class. Milestone 47 brings the rest of the gear. */
	armor: { worn: string | null; shield: boolean };
	/**
	 * Choices the rules keep but don't check yet, by name (spells from Magic
	 * Initiate, tools, instruments): later milestones check them.
	 */
	notes: Record<string, string>;

	/** The state of play. */
	state: {
		hp: number;
		tempHp: number;
		hitDiceSpent: number;
		/** Uses spent of each resource, by the resource id derive.ts gives it. */
		spent: Record<string, number>;
	};
}

/** What a player chooses to make a character; creating it adds the version, pins and a fresh state. */
export type CharacterChoices = Omit<DndCharacter, 'version' | 'rules' | 'catalog' | 'state'>;
