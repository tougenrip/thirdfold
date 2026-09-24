import { beforeEach, describe, expect, it } from 'vitest';
import { canStep, isReachable } from '../../src/lib/game/objects';
import { isSolidCell } from '../../src/lib/game/props';
import { parseSceneFile } from '../../src/lib/game/scene-file';
import { decodeLevels, levelAt } from '../../src/lib/game/terrain';
import { hasLineOfSight } from '../../src/lib/game/visibility';
import { RoomManager, type Player, type Room } from '../rooms';
import { obstacles } from '../scene';
import { applyScene } from '../scene-io';
import { viewFor } from '../views';
import {
	BELFRY,
	BELL_AT,
	GALLERY,
	LEDGE,
	LEVELS,
	MONASTERY_IDS,
	MONASTERY_SPAWN,
	monasteryScene
} from '../adventures/hollow-bell/monastery';

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}

let room: Room;
let gm: Player;
let ana: Player;

beforeEach(() => {
	const rooms = new RoomManager();
	const created = ok(rooms.create('Gia'));
	room = created.room;
	gm = created.player;
	ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
	applyScene(room, monasteryScene());
});

const at = (x: number, y: number) => ({ x, y });
const level = (x: number, y: number) => levelAt(room.terrain, room.grid, at(x, y));
const door = (id: string) => {
	const d = room.objects.get(id);
	if (d?.kind === 'door') d.open = true;
};

describe('the monastery’s heights', () => {
	it('is a valid table with a gallery, a ledge and a belfry above the floor', () => {
		const scene = monasteryScene();
		expect(parseSceneFile(JSON.parse(JSON.stringify(scene))).ok).toBe(true);
		expect(scene.terrain).not.toBeNull();
		expect(level(GALLERY.from.x, GALLERY.from.y)).toBe(LEVELS.gallery);
		expect(level(LEDGE.to.x, LEDGE.to.y)).toBe(LEVELS.ledge);
		expect(level(BELFRY.to.x, BELFRY.to.y)).toBe(LEVELS.belfry);
		expect(level(12, 6)).toBe(0);
		for (const c of MONASTERY_SPAWN) expect(level(c.x, c.y)).toBe(0);
		// The bell hangs over the belfry, which the stair reaches one level at a time.
		expect(level(BELL_AT.x, BELL_AT.y)).toBe(LEVELS.belfry);
		expect([24, 25, 26, 27, 28].map((x) => level(x, 2))).toEqual([6, 7, 8, 9, 10]);
	});

	it('is climbed by its stairs: the outside stair to the ledge, the tower stair to the belfry', () => {
		const from = MONASTERY_SPAWN[0];
		expect(isReachable(room.grid, obstacles(room), from, at(23, 6))).toBe(true);
		expect(isReachable(room.grid, obstacles(room), from, at(26, 5))).toBe(true);
		// The gallery only through the ringers' door; the nave floor from the gallery by its stair.
		expect(isReachable(room.grid, obstacles(room), from, at(20, 6))).toBe(false);
		door(MONASTERY_IDS.sideDoor);
		expect(isReachable(room.grid, obstacles(room), from, at(20, 6))).toBe(true);
		expect(isReachable(room.grid, obstacles(room), at(20, 6), at(12, 6))).toBe(true);
		// Nobody steps off the ledge: it is five levels above the ground beside it.
		expect(canStep(obstacles(room), at(23, 7), at(24, 7))).toBe(false);
		expect(isSolidCell(obstacles(room), at(24, 7))).toBe(false);
	});

	it('lets the belfry and the courtyard far below see each other through the arches', () => {
		const blocked = obstacles(room);
		expect(hasLineOfSight(blocked, at(27, 5), at(26, 10))).toBe(true);
		expect(hasLineOfSight(blocked, at(26, 10), at(27, 5))).toBe(true);
		// The gallery looks down over its railing into the nave.
		expect(hasLineOfSight(blocked, at(20, 5), at(11, 6))).toBe(true);
		// The courtyard sees into the nave only through its windows.
		expect(hasLineOfSight(blocked, at(9, 12), at(9, 8))).toBe(true);
		expect(hasLineOfSight(blocked, at(7, 12), at(7, 8))).toBe(false);
	});
});

describe('the ground each viewer knows', () => {
	it('sends a player only the heights of cells they have explored; the GM all of them', () => {
		room.fog.enabled = true;
		const full = decodeLevels(viewFor(room, gm).terrain!, room.grid.width * room.grid.height)!;
		expect(full[BELFRY.from.y * room.grid.width + BELFRY.from.x]).toBe(LEVELS.belfry);
		const seen = decodeLevels(viewFor(room, ana).terrain!, room.grid.width * room.grid.height)!;
		// Ana has no token here and hasn't explored the tower.
		expect(seen[BELFRY.from.y * room.grid.width + BELFRY.from.x]).toBe(0);
		room.fog.enabled = false;
		expect(viewFor(room, ana).terrain).toBe(viewFor(room, gm).terrain);
	});
});
