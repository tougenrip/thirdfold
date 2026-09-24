// Scenes are content too, but they stay on the server (a table holds the
// story's secrets: hidden doors, what is in the dark). The pipeline checks
// The Hollow Bell's tables against the manifest instead: every prop has a
// model, every figure the story puts on a table (people, characters,
// enemies) has one of its kind, and every table's environment exists. A
// future adventure's tables go through the same check.

import type { Manifest, ModelKind } from '../../src/lib/assets/manifest';
import { CHARACTER_IDS } from '../../src/lib/adventure/characters';
import { parseSceneFile } from '../../src/lib/game/scene-file';
import { ENEMIES } from '../adventure/enemies';
import { LOCATIONS } from '../adventure/locations';
import { NPC_IDS, NPCS } from '../adventure/npcs';

/** What the story's tables and figures refer to that the manifest lacks; empty when all is there. */
export function checkScenes(manifest: Manifest): string[] {
	const problems: string[] = [];
	const model = (id: string | undefined, kind: ModelKind, what: string) => {
		if (!id) problems.push(`${what} has no model`);
		else if (manifest.models[id]?.kind !== kind) problems.push(`${what}: no ${kind} model "${id}"`);
	};
	for (const [location, def] of Object.entries(LOCATIONS)) {
		const parsed = parseSceneFile(JSON.parse(JSON.stringify(def.scene())));
		if (!parsed.ok) {
			problems.push(`${location}: ${parsed.error}`);
			continue;
		}
		const scene = parsed.scene;
		if (!scene.environment || !(scene.environment in manifest.environments)) {
			problems.push(`${location}: no environment "${scene.environment}"`);
		}
		for (const p of scene.props) model(p.assetId, 'prop', `${location}: prop ${p.id}`);
		for (const t of scene.tokens) model(t.model, 'npc', `${location}: ${t.name}`);
	}
	for (const id of NPC_IDS) model(NPCS[id].model, 'npc', NPCS[id].name);
	for (const id of CHARACTER_IDS) model(id, 'character', id);
	for (const def of Object.values(ENEMIES)) model(def.model, 'enemy', def.name);
	return problems;
}
