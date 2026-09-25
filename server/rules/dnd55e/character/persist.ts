// Saving and restoring fifth edition characters: plain JSON of the stored
// character (choices and state, no owner, no derived number), and reading
// it back through every check validate.ts makes. A character saved in an
// older shape is migrated forward one version at a time before it is
// checked; one from a newer version than this server knows is refused
// rather than guessed at.

import type { RulesetRef } from '../../ruleset';
import type { Catalog } from '../catalog';
import { CHARACTER_VERSION, type DndCharacter } from './model';
import { readCharacter, type CharacterRead } from './validate';

/** The most a saved character may be, in bytes. */
export const CHARACTER_MAX_BYTES = 64 * 1024;

type Raw = Record<string, unknown>;

/**
 * Migrations, by the version they upgrade from: MIGRATIONS[n] turns a
 * version n character into version n + 1. Version 1 is the first shape, so
 * there are none yet; the next change to the shape adds MIGRATIONS[1].
 */
export const MIGRATIONS: Readonly<Record<number, (raw: Raw) => Raw>> = {};

/** A character as JSON, the same character always the same text. */
export function serializeCharacter(character: DndCharacter): string {
	return JSON.stringify(character);
}

/** Brings a saved character up to this version, or says why it can't. */
export function migrateCharacter(
	raw: unknown,
	migrations: Readonly<Record<number, (raw: Raw) => Raw>> = MIGRATIONS,
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
		at = { ...step(structuredClone(at)), version: v + 1 };
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
	const migrated = migrateCharacter(raw);
	if (!migrated.ok) return migrated;
	return readCharacter(migrated.raw, catalog, rules);
}
