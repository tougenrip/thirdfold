// Saving and restoring fifth edition characters: plain JSON of the stored
// character (choices and state, no owner, no derived number), and reading
// it back through every check validate.ts makes. A character saved in an
// older shape is migrated forward one version at a time before it is
// checked; one from a newer version than this server knows is refused
// rather than guessed at.

import type { RulesetRef } from '../../ruleset';
import type { Catalog } from '../catalog';
import { startingInventory } from './inventory';
import { CHARACTER_VERSION, type DndCharacter } from './model';
import { readCharacter, type CharacterRead } from './validate';

/** The most a saved character may be, in bytes. */
export const CHARACTER_MAX_BYTES = 64 * 1024;

type Raw = Record<string, unknown>;

export type Migration = (raw: Raw, catalog: Catalog) => Raw;

/**
 * Migrations, by the version they upgrade from: MIGRATIONS[n] turns a
 * version n character into version n + 1. A migration may read the
 * catalog the character is pinned to (it is checked after).
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
	// Version 2 carries weapons; a version 1 character carried none.
	1: (raw) => ({ ...raw, weapons: [] }),
	// Version 3 owns an inventory: the armor, Shield and weapons of version 2
	// become its entries, equipped as a new character's are (startingInventory:
	// weapons held while hands are free), with a bundle of each ammunition
	// they fire, as the character was made with; and nothing expended yet.
	2: (raw, catalog) => {
		const { armor, weapons, state, ...rest } = raw as Raw & {
			armor?: { worn?: unknown; shield?: unknown };
			weapons?: unknown;
			state?: Raw;
		};
		const worn = typeof armor?.worn === 'string' ? armor.worn : null;
		const list = Array.isArray(weapons) ? weapons.filter((w) => typeof w === 'string') : [];
		return {
			...rest,
			inventory: startingInventory(
				{ armor: worn, shield: armor?.shield === true, weapons: list },
				catalog
			),
			state: { ...state, expended: {} }
		};
	},
	// Version 4 chooses spells; a version 3 character has chosen none yet.
	3: (raw) => ({ ...raw, spells: { cantrips: [], prepared: [] } })
};

/** A character as JSON, the same character always the same text. */
export function serializeCharacter(character: DndCharacter): string {
	return JSON.stringify(character);
}

/** Brings a saved character up to this version, or says why it can't. */
export function migrateCharacter(
	raw: unknown,
	catalog: Catalog,
	migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
	current = CHARACTER_VERSION
): { ok: true; raw: unknown } | { ok: false; problems: string[] } {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
		return { ok: false, problems: ['a character must be an object'] };
	let at = raw as Raw;
	const version = at.version;
	if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
		return { ok: false, problems: ['a character must say its version'] };
	if (version > current)
		return {
			ok: false,
			problems: [`saved as version ${version}, newer than this server's ${current}`]
		};
	for (let v = version; v < current; v++) {
		const step = migrations[v];
		if (!step) return { ok: false, problems: [`no way to bring version ${v} forward`] };
		at = { ...step(structuredClone(at), catalog), version: v + 1 };
	}
	return { ok: true, raw: at };
}

/** Reads a saved character: size, JSON, migration, then every check. */
export function restoreCharacter(text: string, catalog: Catalog, rules: RulesetRef): CharacterRead {
	if (Buffer.byteLength(text, 'utf8') > CHARACTER_MAX_BYTES)
		return { ok: false, problems: [`a character is at most ${CHARACTER_MAX_BYTES} bytes`] };
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return { ok: false, problems: ['not JSON'] };
	}
	const migrated = migrateCharacter(raw, catalog);
	if (!migrated.ok) return migrated;
	return readCharacter(migrated.raw, catalog, rules);
}
