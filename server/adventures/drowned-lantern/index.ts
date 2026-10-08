// The Drowned Lantern (milestone 60), as the server runs it: the Fate
// Condensed adventure file (src/lib/adventure/fate-example.ts), checked and
// compiled exactly as a creator's would be, its party built by the rules from
// choices. A mistake in it fails here, when the server starts.

import { fateExampleAdventure } from '../../../src/lib/adventure/fate-example';
import type { AdventureDef } from '../../adventure/define';
import { loadServerAdventure } from '../../adventure/rules-content';

export const DROWNED_LANTERN_ID = 'drowned-lantern';

function load(): AdventureDef {
	const loaded = loadServerAdventure(
		JSON.parse(JSON.stringify(fateExampleAdventure())),
		DROWNED_LANTERN_ID
	);
	if (!loaded.ok)
		throw new Error(
			`The Drowned Lantern: ${[loaded.error, ...loaded.diagnostics.map((d) => `${d.path}: ${d.message}`)].join('\n')}`
		);
	return loaded.adventure;
}

export const DROWNED_LANTERN: AdventureDef = load();
