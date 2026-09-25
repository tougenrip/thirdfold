// The built-in adventures' tables, frozen as fixtures (milestone 61): the
// village, monastery and Hollow played to with the engine (server/perf/
// scenes.ts), the Heart, the night train and Blackwater. They are written
// once and only rewritten with `build.ts --refreeze`, so story changes never
// move the golden images drawn from them.

import type { GridPos } from '../../src/lib/game/grid';
import type { SceneFile } from '../../src/lib/game/scene-file';
import {
	BLACKWATER_SPAWN,
	blackwaterScene,
	TRAIN_SPAWN,
	trainScene
} from '../adventures/blackwater/tables';
import { HEART_SPAWN, heartScene } from '../adventures/hollow-bell/heart';
import { perfScenes } from '../perf/scenes';
import { adventureSidecar, FIXTURE_DATE, mini, type Fixture } from './compositions';
import { FIXTURE_PLAYER } from './views';

const OWNER = { id: 'fixture-p1', name: FIXTURE_PLAYER };

/** A story table: the token Ana plays is the fogged player's. */
function played(scene: SceneFile): Fixture {
	const hero = scene.tokens.find((t) => t.owner?.name === FIXTURE_PLAYER);
	if (!hero) throw new Error(`${scene.name}: nobody plays as ${FIXTURE_PLAYER}`);
	return {
		scene: { ...scene, savedAt: FIXTURE_DATE.toISOString() },
		sidecar: adventureSidecar(scene.grid, scene.ambient, hero.id, hero.pos)
	};
}

/** A table without its party: two minis at the spawn, the first Ana's. */
function party(scene: SceneFile, prefix: string, spawn: readonly GridPos[]): Fixture {
	const heroes = [
		{ ...mini(`${prefix}-mini-hero`, 'Warden', spawn[0].x, spawn[0].y, 'warden', 1), owner: OWNER },
		mini(`${prefix}-mini-b`, 'Saint', spawn[1].x, spawn[1].y, 'saint', 2)
	];
	return {
		scene: { ...scene, savedAt: FIXTURE_DATE.toISOString(), tokens: [...scene.tokens, ...heroes] },
		sidecar: adventureSidecar(scene.grid, scene.ambient, heroes[0].id, spawn[0])
	};
}

export function frozenFixtures(): Record<string, Fixture> {
	const { village, monastery, hollow } = perfScenes();
	return {
		village: played(village),
		monastery: played(monastery),
		hollow: played(hollow),
		heart: party(heartScene(FIXTURE_DATE), 'heart', HEART_SPAWN),
		railcar: party(trainScene(), 'railcar', TRAIN_SPAWN),
		'ghost-town': party(blackwaterScene(), 'ghost-town', BLACKWATER_SPAWN)
	};
}
