// Adventures creators built (adventure files, see src/lib/adventure/file.ts),
// run by the same engine as the built-in ones. A custom adventure's id comes
// from its content, so the same file is the same adventure wherever it goes,
// and a save carries the file it was played from: loading the save brings
// the adventure back, checked again, before the story is read.

import { createHash } from 'node:crypto';
import {
	ADVENTURE_FILE_MAX_BYTES,
	loadAdventureFile,
	parseAdventureFile,
	type AdventureFile
} from '../../src/lib/adventure/file';
import type { AdventureDef } from './define';
import { addCustom, customFile } from './registry';

/** Custom adventures' ids: `custom-` and a hash of the checked file. */
export const CUSTOM_ID = /^custom-[0-9a-f]{32}$/;

export function customId(file: AdventureFile): string {
	return `custom-${createHash('sha256').update(JSON.stringify(file)).digest('hex').slice(0, 32)}`;
}

export type CustomLoad = { ok: true; adventure: AdventureDef } | { ok: false; error: string };

/**
 * Checks an adventure file (its shape, its references, its size) and makes
 * it playable here. `expectId`, from a save, must be the id its content
 * gives, or the save was tampered with.
 */
export function loadCustomAdventure(raw: unknown, expectId?: string): CustomLoad {
	if (JSON.stringify(raw).length > ADVENTURE_FILE_MAX_BYTES) {
		return { ok: false, error: 'That adventure is too large.' };
	}
	const parsed = parseAdventureFile(raw);
	if (!parsed.ok) return { ok: false, error: `That is not a valid adventure: ${parsed.error}.` };
	const id = customId(parsed.file);
	if (expectId !== undefined && id !== expectId) {
		return { ok: false, error: 'The saved adventure does not match its content.' };
	}
	const loaded = loadAdventureFile(parsed.file, id);
	if (!loaded.ok) return { ok: false, error: loaded.error };
	addCustom(loaded.adventure, loaded.file);
	return { ok: true, adventure: loaded.adventure };
}

/** The file a custom adventure was made from, to save with a story; undefined for a built-in one. */
export function fileOf(id: string): AdventureFile | undefined {
	return customFile(id);
}
