// The Last Train to Blackwater, as the server runs it: the adventure file
// (story.ts), checked and compiled exactly as a creator's would be. A mistake
// in it fails here, when the server starts, not in the middle of a session.

import { loadAdventureFile } from '../../../src/lib/adventure/file';
import type { AdventureDef } from '../../adventure/define';
import { blackwaterFile } from './story';

function load(): AdventureDef {
	const loaded = loadAdventureFile(JSON.parse(JSON.stringify(blackwaterFile())), 'blackwater');
	if (!loaded.ok) {
		throw new Error(
			`The Last Train to Blackwater: ${[loaded.error, ...(loaded.problems ?? [])].join('\n')}`
		);
	}
	return loaded.adventure;
}

export const BLACKWATER: AdventureDef = load();
