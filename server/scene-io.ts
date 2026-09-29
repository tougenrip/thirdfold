// Turning a live room into a scene file and back. The story being played at
// the table (if any) is saved with it; see adventure/persist.ts.

import { serializeScene, type SceneFile } from '../src/lib/game/scene-file';
import { saveAdventure } from './adventure/persist';
import type { Token } from '../src/lib/game/token';
import { decodeFloor } from '../src/lib/game/floor';
import { decodeLevels } from '../src/lib/game/terrain';
import { decodeMask, emptyMask } from '../src/lib/game/visibility';
import type { Player, Room } from './rooms';
import { lookWorld } from './scene';

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
			world: room.world,
			interior: room.interior,
			fog: room.fog,
			playerName: (id) => room.players.get(id)?.name,
			// What each player has discovered, by name, so it comes back with the table.
			discovery: [...room.players.values()]
				.filter((p) => p.role === 'player')
				.map((p) => [p.name, { explored: p.explored, lights: p.seenLights?.values() }]),
			adventure: room.adventure && saveAdventure(room.adventure),
			terrain: room.terrain,
			darkness: room.darkness,
			floor: room.floor,
			environment: room.environment
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
/**
 * A player joining a table loaded from a save: under the name a saved owner
 * had, they get that owner's tokens (their character) and what they had
 * explored back. Returns the tokens handed back.
 */
export function reclaim(room: Room, player: Player): string[] {
	if (player.role !== 'player') return [];
	const name = player.name.toLowerCase();
	const back: string[] = [];
	for (const [tokenId, owner] of room.awaiting ?? []) {
		const token = room.tokens.get(tokenId);
		if (owner !== name || !token || token.ownerId) continue;
		token.ownerId = player.id;
		room.awaiting!.delete(tokenId);
		back.push(tokenId);
	}
	const found = room.discovery?.get(name);
	if (found && back.length) {
		const saved = decodeMask(found.explored, room.grid.width * room.grid.height);
		for (let i = 0; i < saved.length; i++) if (saved[i]) player.explored[i] = 1;
		// And the lights as they remembered them, on the cells they had explored.
		if (found.lights) {
			const seen = (player.seenLights ??= new Map());
			for (const l of found.lights) if (!seen.has(l.id)) seen.set(l.id, structuredClone(l));
			const learned = (player.lightsLearned ??= emptyMask(room.grid));
			for (let i = 0; i < saved.length; i++) if (saved[i]) learned[i] = 1;
		}
	}
	return back;
}

/**
 * A player catching up on what another has explored (joining a story under
 * way) also takes on the lights that one remembers, as remembered: the
 * first record of each light wins, and cells the other had learned the lights
 * of count as learned.
 */
export function catchUpLights(player: Player, other: Player): void {
	if (!other.seenLights || !other.lightsLearned) return;
	const seen = (player.seenLights ??= new Map());
	for (const [id, l] of other.seenLights) if (!seen.has(id)) seen.set(id, structuredClone(l));
	const learned = (player.lightsLearned ??= new Uint8Array(other.lightsLearned.length));
	for (let i = 0; i < learned.length; i++) if (other.lightsLearned[i]) learned[i] = 1;
}

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
	room.awaiting = new Map();
	room.tokens = new Map(
		scene.tokens.map(({ owner, ...t }): [string, Token] => {
			const ownerId = ownerFor(owner);
			if (owner && !ownerId && owner.name) room.awaiting!.set(t.id, owner.name.toLowerCase());
			return [t.id, { ...structuredClone(t), ownerId }];
		})
	);
	room.objects = new Map(scene.objects.map((o) => [o.id, structuredClone(o)]));
	room.props = new Map(scene.props.map((p) => [p.id, structuredClone(p)]));
	room.lights = new Map(scene.lights.map((l) => [l.id, structuredClone(l)]));
	lookWorld(room, structuredClone(scene.world), scene.ambient);
	room.terrain = scene.terrain
		? decodeLevels(scene.terrain, scene.grid.width * scene.grid.height)
		: null;
	const size = room.grid.width * room.grid.height;
	room.darkness = scene.darkness ? decodeMask(scene.darkness, size) : null;
	room.interior = scene.interior ? decodeMask(scene.interior, size) : null;
	room.floor = scene.floor ? decodeFloor(scene.floor, size) : null;
	room.environment = scene.environment;
	room.flashUntil = undefined;
	room.fog = {
		enabled: scene.fog.enabled,
		revealed: decodeMask(scene.fog.revealed, size),
		shared: scene.fog.shared
	};
	const discovered = new Map(
		Object.entries(scene.discovery).map(([name, d]) => [name.toLowerCase(), structuredClone(d)])
	);
	room.discovery = discovered;
	for (const p of room.players.values()) {
		const d = discovered.get(p.name.toLowerCase());
		p.explored = d ? decodeMask(d.explored, size) : emptyMask(room.grid);
		p.seenLights = d?.lights && new Map(d.lights.map((l) => [l.id, structuredClone(l)]));
		// Remembered lights were taken in on every explored cell; a save without them learns afresh.
		p.lightsLearned = p.seenLights && p.explored.slice();
	}
}
