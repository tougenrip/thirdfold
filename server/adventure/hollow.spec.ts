import { beforeEach, describe, expect, it } from 'vitest';
import type { GridPos } from '../../src/lib/game/grid';
import { canStep, isReachable } from '../../src/lib/game/objects';
import { isSolidCell } from '../../src/lib/game/props';
import { parseSceneFile } from '../../src/lib/game/scene-file';
import { cellIndex } from '../../src/lib/game/visibility';
import { RoomManager, type Player, type Room } from '../rooms';
import { lightFor, obstacles } from '../scene';
import { applyScene } from '../scene-io';
import {
	beginAdventure,
	characterOf,
	claimCharacter,
	happen,
	patrol,
	startAdventure
} from './engine';
import {
	BELL_AT,
	BY_TOBIN,
	CAUSEWAY,
	CLEFT_EDGE,
	CULTIST_ROUNDS,
	HOLLOW_GRID,
	HOLLOW_IDS,
	HOLLOW_SPAWN,
	hollowScene,
	ISLAND,
	KEEPER_POST,
	LEDGE,
	LEVELS,
	RUINS,
	STEPS,
	TERRACE,
	TOBIN_AT,
	WATCH
} from '../adventures/hollow-bell/hollow';
import { MONASTERY_GRID } from '../adventures/hollow-bell/monastery';
import { HOLLOW_BELL } from '../adventures/hollow-bell/index';
import { recordOrigins } from './world';
import { adventureView } from './view';

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
	ok(startAdventure(room, gm));
	ok(claimCharacter(room, ana, 'warden'));
	ok(beginAdventure(room, gm, 1000));
});

const story = () => room.adventure!;
const levelAt = (c: GridPos) => room.terrain![cellIndex(room.grid, c)];
const reachable = (from: GridPos, to: GridPos) => isReachable(room.grid, obstacles(room), from, to);

/** The cleft as it is with the torch out: rock. */
function sealCleft() {
	room.objects.delete(HOLLOW_IDS.cleft);
	room.objects.set('test-sealed', { id: 'test-sealed', kind: 'wall', ...CLEFT_EDGE });
}

/** The party at the foot of the stair, as the story brings it down. */
function arrive() {
	const party = [...room.tokens.values()].filter((t) => t.ownerId);
	applyScene(room, hollowScene());
	party.forEach((t, i) => {
		t.pos = { ...HOLLOW_SPAWN[i] };
		room.tokens.set(t.id, t);
	});
	story().location = 'hollow';
	story().chapter = 'descend';
	story().origins = recordOrigins(HOLLOW_BELL, room);
}

describe('the Hollow', () => {
	beforeEach(arrive);

	it('is a table far larger than the monastery above it', () => {
		const parsed = parseSceneFile(JSON.parse(JSON.stringify(hollowScene())));
		expect(parsed.ok).toBe(true);
		expect(HOLLOW_GRID.width * HOLLOW_GRID.height).toBeGreaterThan(
			2.5 * MONASTERY_GRID.width * MONASTERY_GRID.height
		);
		expect(room.ambient).toBe('dark');
		// The Bell in its frame, gears, ruins, and the lake's black water.
		expect(room.props.get(HOLLOW_IDS.bell)).toMatchObject({ assetId: 'great-bell', pos: BELL_AT });
		const assets = [...room.props.values()].map((p) => p.assetId);
		expect(assets.filter((a) => a === 'gear').length).toBeGreaterThanOrEqual(3);
		expect(assets.filter((a) => a === 'water').length).toBeGreaterThan(20);
		expect(assets).toContain('statue');
		expect(assets).toContain('rubble');
	});

	it('stands on levels: a lake below the shore, an island, and terraces climbing to the Watch', () => {
		expect(levelAt(HOLLOW_SPAWN[0])).toBe(LEVELS.shore);
		expect(levelAt(RUINS.from)).toBe(LEVELS.shore);
		expect(levelAt(TERRACE.from)).toBe(LEVELS.shore);
		expect(levelAt(STEPS.from)).toBe(LEVELS.steps);
		expect(levelAt(WATCH.from)).toBe(LEVELS.watch);
		expect(levelAt(ISLAND.from)).toBe(LEVELS.island);
		expect(levelAt({ x: 20, y: 24 })).toBe(LEVELS.lake);
		// North of the island, only the void.
		expect(levelAt({ x: 24, y: 1 })).toBe(LEVELS.lake);
		for (const c of HOLLOW_SPAWN) expect(isSolidCell(obstacles(room), c)).toBe(false);
	});

	it('can be crossed only by its bridges: nobody climbs out of the lake, or steps off into it', () => {
		const blocked = obstacles(room);
		// From the causeway down into the water: a drop nobody takes.
		expect(canStep(blocked, { x: 23, y: 25 }, { x: 22, y: 25 })).toBe(false);
		expect(reachable(HOLLOW_SPAWN[0], { x: 20, y: 24 })).toBe(false);
		// Along the causeway, through the gate, to the boy under the Bell.
		expect(reachable(HOLLOW_SPAWN[0], CAUSEWAY.from)).toBe(true);
		expect(reachable(HOLLOW_SPAWN[0], BY_TOBIN)).toBe(true);
		expect(room.tokens.get('ho-tobin')?.pos).toEqual(TOBIN_AT);
	});

	it('climbs the terraces to the Watch, and brings you down the high bridge onto the island', () => {
		// With the causeway gate walled up, the island can still be reached from the Watch.
		room.objects.set('test-gate', {
			id: 'test-gate',
			kind: 'wall',
			a: { x: 23, y: 19 },
			b: { x: 25, y: 19 }
		});
		expect(reachable(HOLLOW_SPAWN[0], STEPS.from)).toBe(true);
		expect(reachable(HOLLOW_SPAWN[0], WATCH.from)).toBe(true);
		expect(reachable(HOLLOW_SPAWN[0], BY_TOBIN)).toBe(true);
		// Without the stair up the cavern wall (and the cleft sealed), there is no way round.
		sealCleft();
		room.terrain![cellIndex(room.grid, { x: 40, y: 23 })] = 0;
		room.terrain![cellIndex(room.grid, { x: 41, y: 23 })] = 0;
		expect(reachable(HOLLOW_SPAWN[0], WATCH.from)).toBe(false);
		expect(reachable(HOLLOW_SPAWN[0], BY_TOBIN)).toBe(false);
	});

	it('lets you along the ruins’ bridge to the ledge, and into the island only by the cleft', () => {
		room.objects.set('test-gate', {
			id: 'test-gate',
			kind: 'wall',
			a: { x: 23, y: 19 },
			b: { x: 25, y: 19 }
		});
		room.objects.set('test-arch', {
			id: 'test-arch',
			kind: 'wall',
			a: { x: 32, y: 9 },
			b: { x: 32, y: 10 }
		});
		expect(reachable(HOLLOW_SPAWN[0], LEDGE.from)).toBe(true);
		expect(reachable(HOLLOW_SPAWN[0], BY_TOBIN)).toBe(true);
		sealCleft();
		expect(reachable(HOLLOW_SPAWN[0], BY_TOBIN)).toBe(false);
	});

	it('keeps the causeway gate in the dark, out of the Keeper’s light', () => {
		const lit = lightFor(room, obstacles(room))!;
		expect(lit[cellIndex(room.grid, { x: 23, y: 18 })]).toBe(0);
		expect(lit[cellIndex(room.grid, BY_TOBIN)]).toBe(1);
		expect(lit[cellIndex(room.grid, KEEPER_POST)]).toBe(1);
	});

	it('has the watch walk rounds it can walk, on the shore, never into the lake', () => {
		for (const round of CULTIST_ROUNDS) {
			for (const c of round) expect(levelAt(c)).toBe(LEVELS.shore);
			for (let i = 0; i < round.length; i++) {
				expect(reachable(round[i], round[(i + 1) % round.length])).toBe(true);
			}
		}
	});
});

describe('arriving in the Hollow', () => {
	it('shows the party the whole Hollow in a flash as the Bell sounds, and they remember its shape', () => {
		// On the stair down, the story takes the party below.
		story().chapter = 'descend';
		story().events.push('opened_grate');
		const arrived = happen(room, story(), 'reached_stair');
		expect(arrived.reset).toBe(true);
		expect(story()).toMatchObject({ chapter: 'the_hollow', location: 'hollow' });
		expect(arrived.log).toContainEqual(expect.objectContaining({ cue: 'flash' }));
		expect(room.flashUntil).toBeGreaterThan(Date.now());
		// Every player remembers the whole cavern's shape; the watch still stands in the dark.
		expect(ana.explored.every((v) => v === 1)).toBe(true);
		expect(characterOf(room, ana.id)!.token.pos).toEqual(HOLLOW_SPAWN[0]);
		expect(story().sentries.size).toBe(3);
		expect(patrol(room)).toMatchObject({ log: [] });
		// A player joining now is welcomed to where the party is.
		expect(adventureView(room, ana, new Set(), null)!.welcome).toMatchObject({
			title: 'Welcome to The Hollow',
			text: expect.stringContaining('The stair ends on a landing of wet stone')
		});
	});
});
