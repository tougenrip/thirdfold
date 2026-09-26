// What each viewer of a fixture table is sent, for rendering tests (milestone
// 61): the GM, a fogged player and a spectator, per ambient band. Built with
// the real server rules (applyScene, viewFor, snapshotFor), so client tests
// render exactly what the server would send without importing server code;
// they read these as JSON. Only render input is kept: no room id, players,
// log or story.

import type { Ambient } from '../../src/lib/game/lights';
import type { SceneFile } from '../../src/lib/game/scene-file';
import { emptyMask } from '../../src/lib/game/visibility';
import { readAdventure } from '../adventure/persist';
import { newRoom, type Player, type Room } from '../rooms';
import { applyScene } from '../scene-io';
import { snapshotFor, viewFor } from '../views';
import type { FixtureSidecar } from './compositions';

export const BANDS: readonly Ambient[] = ['day', 'dusk', 'dark'];
/** The player's name: the frozen story tables give her character back to her by name. */
export const FIXTURE_PLAYER = 'Ana';

export type ViewerRole = 'gm' | 'player' | 'spectator';

function seat(room: Room, id: string, name: string, role: Player['role']): Player {
	const player: Player = {
		id,
		name,
		role,
		sessionToken: '0'.repeat(64),
		connected: true,
		explored: emptyMask(room.grid)
	};
	room.players.set(id, player);
	return player;
}

const byId = <T extends { id: string }>(list: T[]) =>
	[...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** The three viewers' render input for one fixture and band, in a stable order. */
export function fixtureViews(
	name: string,
	scene: SceneFile,
	sidecar: FixtureSidecar,
	band: Ambient
): Record<ViewerRole, unknown> {
	const room = newRoom('fixture');
	const gm = seat(room, 'gm', 'GM', 'gm');
	const p1 = seat(room, 'p1', FIXTURE_PLAYER, 'player');
	const s1 = seat(room, 's1', 'Watcher', 'spectator');
	const story = scene.adventure ? readAdventure(scene.adventure, scene) : null;
	if (story && !story.ok) throw new Error(`${name}: ${story.error}`);
	// Players' saved discoveries are not part of the fixture: exploring starts fresh.
	applyScene(room, { ...scene, discovery: {} });
	room.adventure = story ? story.adventure : null;
	room.gmOwner = undefined;
	// Fog is always on, with nothing revealed by the GM, so the views differ.
	room.fog = { enabled: true, revealed: emptyMask(room.grid), shared: false };
	room.ambient = band;
	const token = room.tokens.get(sidecar.player.tokenId);
	if (!token) throw new Error(`${name}: no token ${sidecar.player.tokenId}`);
	token.ownerId = p1.id;
	// Explore: the token looks around where it stands, then along its path.
	viewFor(room, p1);
	for (const cell of sidecar.explore ?? []) {
		token.pos = { ...cell };
		viewFor(room, p1);
	}
	const out = {} as Record<ViewerRole, unknown>;
	for (const [role, viewer] of [
		['player', p1],
		['spectator', s1],
		['gm', gm]
	] as const) {
		const s = snapshotFor(room, viewer, viewFor(room, viewer));
		out[role] = {
			viewer: role,
			band,
			fogMode: role === 'gm' ? 'gm' : 'player',
			grid: s.grid,
			environment: s.environment,
			ambient: s.ambient,
			fog: s.fog,
			terrain: s.terrain,
			darkness: s.darkness,
			floor: s.floor,
			tokens: byId(s.tokens),
			objects: byId(s.objects),
			props: byId(s.props),
			lights: byId(s.lights)
		};
	}
	return out;
}
