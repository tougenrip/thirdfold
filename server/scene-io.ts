// Turning a live room into a scene file and back. The story being played at
// the table (if any) is saved with it; see adventure/persist.ts.

import { serializeScene, type SceneFile } from '../src/lib/game/scene-file';
import { saveAdventure } from './adventure/persist';
import type { Token } from '../src/lib/game/token';
import { decodeLevels } from '../src/lib/game/terrain';
import { decodeMask, emptyMask } from '../src/lib/game/visibility';
import type { Room } from './rooms';

export function exportScene(room: Room, name: string, now = new Date()): SceneFile {
	return serializeScene(
		name,
		{
			grid: room.grid,
			tokens: room.tokens.values(),
			objects: room.objects.values(),
			props: room.props.values(),
			lights: room.lights.values(),
			ambient: room.ambient,
			fog: room.fog,
			playerName: (id) => room.players.get(id)?.name,
			// What each player has discovered, by name, so it comes back with the table.
			discovery: [...room.players.values()]
				.filter((p) => p.role === 'player')
				.map((p): [string, Uint8Array] => [p.name, p.explored]),
			adventure: room.adventure && saveAdventure(room.adventure),
			terrain: room.terrain
		},
		now
	);
}

/**
 * Replaces the room's table with a (validated) scene. Players and the log are
 * untouched. A saved owner is matched to a player in this room by id (same
 * session) or else by name (a new session with the same group); otherwise the
 * token becomes GM-only. Each player's explored map comes from what a player
 * of the same name had discovered when it was saved; everyone else starts
 * with nothing explored.
 */
export function applyScene(room: Room, scene: SceneFile): void {
	const players = [...room.players.values()].filter((p) => p.role === 'player');
	const ownerFor = (owner: SceneFile['tokens'][number]['owner']): string | null => {
		if (!owner) return null;
		const byId = players.find((p) => p.id === owner.id);
		if (byId) return byId.id;
		const name = owner.name.toLowerCase();
		return (name && players.find((p) => p.name.toLowerCase() === name)?.id) || null;
	};

	room.sceneName = scene.name;
	room.grid = { ...scene.grid };
	room.tokens = new Map(
		scene.tokens.map(({ owner, ...t }): [string, Token] => [
			t.id,
			{ ...structuredClone(t), ownerId: ownerFor(owner) }
		])
	);
	room.objects = new Map(scene.objects.map((o) => [o.id, structuredClone(o)]));
	room.props = new Map(scene.props.map((p) => [p.id, structuredClone(p)]));
	room.lights = new Map(scene.lights.map((l) => [l.id, structuredClone(l)]));
	room.ambient = scene.ambient;
	room.terrain = scene.terrain
		? decodeLevels(scene.terrain, scene.grid.width * scene.grid.height)
		: null;
	const size = room.grid.width * room.grid.height;
	room.fog = {
		enabled: scene.fog.enabled,
		revealed: decodeMask(scene.fog.revealed, size),
		shared: scene.fog.shared
	};
	const discovered = new Map(
		Object.entries(scene.discovery).map(([name, mask]) => [name.toLowerCase(), mask])
	);
	for (const p of room.players.values()) {
		const mask = discovered.get(p.name.toLowerCase());
		p.explored = mask ? decodeMask(mask, size) : emptyMask(room.grid);
	}
}
