// The example homebrew pack (content/homebrew/cold-hill-armory.json): a
// blade, a coat, two spells and a barrow beast, made for The Barrow on Cold
// Hill. Tests and docs use it; a GM attaches it like any pack.

import { readFileSync } from 'node:fs';
import path from 'node:path';

export const EXAMPLE_PACK_FILE = path.join('content', 'homebrew', 'cold-hill-armory.json');

/** The example pack as a creator wrote it (plain JSON, unchecked). */
export function examplePack(): Record<string, unknown> {
	return JSON.parse(readFileSync(EXAMPLE_PACK_FILE, 'utf8'));
}
