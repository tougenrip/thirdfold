import { beforeEach, describe, expect, it } from 'vitest';
import { CHAPTER_IDS } from '../../src/lib/adventure/adventure';
import type { GridPos } from '../../src/lib/game/grid';
import { isReachable } from '../../src/lib/game/objects';
import { isSolidCell } from '../../src/lib/game/props';
import { parseSceneFile, type SavedStory } from '../../src/lib/game/scene-file';
import { RoomManager, type Player, type Room } from '../rooms';
import { obstacles } from '../scene';
import { applyScene, exportScene } from '../scene-io';
import { EXIT } from './bellweather';
import {
	act,
	afterMove,
	afterTokenDeleted,
	beginAdventure,
	characterOf,
	claimCharacter,
	decide,
	doorLock,
	interact,
	startAdventure
} from './engine';
import { HOLLOW_SPAWN, hollowScene } from './hollow';
import { LOCATIONS } from './locations';
import {
	CHAMBER,
	MONASTERY_IDS,
	MONASTERY_SPAWN,
	monasteryScene,
	NAVE,
	SECRET_EDGE,
	STAIR
} from './monastery';
import { readAdventure, saveAdventure } from './persist';
import { CHAPTERS, EVENT_IDS, objectivesFor, transition } from './story';
import { adventureView } from './view';

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}

let room: Room;
let gm: Player;
let ana: Player;
let watcher: Player;

beforeEach(() => {
	const rooms = new RoomManager();
	const created = ok(rooms.create('Gia'));
	room = created.room;
	gm = created.player;
	ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
	watcher = ok(rooms.join(room.id, 'Wes', 'spectator')).player;
});

const story = () => room.adventure!;
const me = () => characterOf(room, ana.id)!;
/** Puts Ana's character on a cell and tells the story it walked there. */
const walk = (pos: GridPos, now?: number) => {
	me().token.pos = { ...pos };
	return afterMove(room, me().token, null, now);
};
const hounds = () => [...(story().encounter?.enemies.keys() ?? [])];
/** The GM clears the enemies off the table: each removal is a defeat. */
const clearEnemies = () => {
	for (const id of hounds()) {
		room.tokens.delete(id);
		afterTokenDeleted(room, id);
	}
};

function begun(): void {
	ok(startAdventure(room, gm));
	ok(claimCharacter(room, ana, 'warden'));
	ok(beginAdventure(room, gm, 1000));
}

/** Plays Bellweather: Maren, the well, the Hound; the party stands at the gate. */
function throughVillage(): void {
	begun();
	walk({ x: 7, y: 10 });
	ok(interact(room, ana, 'maren'));
	walk({ x: 11, y: 12 });
	ok(interact(room, ana, 'well'));
	const hound = hounds()[0];
	room.tokens.get(hound)!.pos = { x: 12, y: 12 };
	story().encounter!.enemies.get(hound)!.hp = 1;
	ok(act(room, ana, 'blade', hound, (sides) => sides));
}

/** On to the monastery, where Oswin is answered and the ringers' door unlocked. */
function atMonastery(promise: 'boy' | 'silence' = 'boy'): void {
	throughVillage();
	walk(EXIT[0]);
	walk({ x: 4, y: 15 });
	ok(interact(room, ana, 'oswin'));
	ok(decide(room, ana, 'promise', promise));
}

describe('the chapters', () => {
	it('run in the roadmap’s order, each waiting for one event that leads to the next', () => {
		const order = [...CHAPTER_IDS];
		for (const [i, id] of order.entries()) {
			const next = CHAPTERS[id].next;
			expect(transition(id, next.on)).toBe(order[i + 1] ?? null);
		}
		// Every chapter's event is a known one, and the story ends only at the final decision.
		expect(order.every((id) => EVENT_IDS.includes(CHAPTERS[id].next.on))).toBe(true);
		expect(transition('village', 'decided_bell')).toBeUndefined();
	});

	it('show the objectives of the chapters at this location, new ones once heard of', () => {
		expect(objectivesFor('choosing', 'village', [])).toEqual([
			{ id: 'choose', text: 'Choose your characters', done: false }
		]);
		expect(objectivesFor('playing', 'village', []).map((o) => o.id)).toEqual(['innkeeper']);
		expect(objectivesFor('playing', 'village', ['talked_maren'])).toMatchObject([
			{ id: 'innkeeper', done: true },
			{ id: 'well', done: false }
		]);
		// A new location starts a fresh list.
		expect(
			objectivesFor('playing', 'enter_monastery', ['talked_oswin', 'entered_nave']).map((o) => [
				o.id,
				o.done
			])
		).toEqual([
			['gatehouse', true],
			['way-in', true],
			['ringers', false]
		]);
	});
});

describe('the monastery and the Hollow', () => {
	it('are valid tables with room for the whole party to arrive', () => {
		for (const scene of [monasteryScene(), hollowScene()]) {
			const parsed = parseSceneFile(JSON.parse(JSON.stringify(scene)));
			expect(parsed.ok).toBe(true);
		}
		for (const location of Object.values(LOCATIONS)) {
			expect(location.spawn.length).toBeGreaterThanOrEqual(4);
		}
	});

	it('can be walked: the nave only through the ringers’ door, the chamber only once found', () => {
		applyScene(room, monasteryScene());
		const blocked = () => obstacles(room);
		const from = MONASTERY_SPAWN[0];
		const inNave = { x: 20, y: 6 };
		const inChamber = { x: 5, y: 5 };
		for (const c of MONASTERY_SPAWN) expect(isSolidCell(blocked(), c)).toBe(false);
		expect(isReachable(room.grid, blocked(), from, { x: 22, y: 6 })).toBe(true);
		expect(isReachable(room.grid, blocked(), from, inNave)).toBe(false);
		const side = room.objects.get(MONASTERY_IDS.sideDoor)!;
		if (side.kind === 'door') side.open = true;
		expect(isReachable(room.grid, blocked(), from, inNave)).toBe(true);
		expect(isReachable(room.grid, blocked(), from, inChamber)).toBe(false);
		expect(room.objects.has(MONASTERY_IDS.secretDoor)).toBe(false);
		expect(NAVE.from.x).toBe(SECRET_EDGE.a.x);
		expect(CHAMBER.to.x).toBe(SECRET_EDGE.a.x - 1);
	});
});

describe('playing the story through', () => {
	it('goes from the village to an ending through play alone', () => {
		begun();
		expect(story()).toMatchObject({ chapter: 'village', location: 'bellweather' });

		// The village: Maren, the well, the Hound.
		walk({ x: 7, y: 10 });
		ok(interact(room, ana, 'maren'));
		walk({ x: 11, y: 12 });
		ok(interact(room, ana, 'well'));
		expect(story()).toMatchObject({ chapter: 'discover_bell' });
		expect(hounds()).toHaveLength(1);
		clearEnemies();
		expect(story().encounters.get('well')).toBe('won');

		// Up the mountain path: a new table, the same character.
		const tokenId = me().token.id;
		expect(walk(EXIT[0]).reset).toBe(true);
		expect(story()).toMatchObject({ chapter: 'investigate_monastery', location: 'monastery' });
		expect(me().token).toMatchObject({ id: tokenId, ownerId: ana.id });

		// The ringers' door is locked until Oswin is answered.
		const side = room.objects.get(MONASTERY_IDS.sideDoor)!;
		expect(side.kind === 'door' && doorLock(room, ana, side)).toMatch(/locked/);
		walk({ x: 4, y: 15 });
		ok(interact(room, ana, 'oswin'));
		expect(story().pending).toBe('promise');
		expect(decide(room, watcher, 'promise', 'boy')).toMatchObject({ ok: false });
		expect(decide(room, ana, 'bell', 'ring')).toMatchObject({ ok: false });
		expect(decide(room, ana, 'promise', 'forever')).toMatchObject({ ok: false });
		ok(decide(room, ana, 'promise', 'boy'));
		expect(story().decisions.get('promise')).toEqual({ option: 'boy', by: 'The Warden' });
		expect(story().npcs.get('oswin')).toBe('trusting');
		expect(side.kind === 'door' && doorLock(room, ana, side)).toBeNull();
		expect(decide(room, ana, 'promise', 'silence')).toMatchObject({ ok: false });

		// Into the nave, and Saint Agna shows the way.
		walk({ x: 21, y: 6 });
		expect(story().chapter).toBe('enter_monastery');
		walk({ x: 9, y: 4 });
		ok(interact(room, ana, 'agna'));
		expect(story().chapter).toBe('discover_hidden_chamber');
		expect(room.objects.get(MONASTERY_IDS.secretDoor)).toMatchObject({ kind: 'door' });
		expect(room.objects.has(`${MONASTERY_IDS.secretDoor}-sealed`)).toBe(false);

		// The chamber: the bell rings, the grate bursts, two hounds come up.
		walk({ x: 7, y: 5 });
		expect(story().chapter).toBe('bell_rings');
		expect(hounds()).toHaveLength(2);
		expect(room.props.get(MONASTERY_IDS.grate)?.assetId).toBe('stairs');
		clearEnemies();
		expect(story()).toMatchObject({ chapter: 'descend', encounter: null });
		expect(story().defeated).toHaveLength(3);

		// Down the stair to the Hollow.
		expect(walk(STAIR.from).reset).toBe(true);
		expect(story()).toMatchObject({ chapter: 'the_hollow', location: 'hollow' });
		expect(me().token.pos).toEqual(HOLLOW_SPAWN[0]);
		expect(story().npcs.get('tobin')).toBe('entranced');

		// Tobin, and the final decision.
		walk({ x: 9, y: 5 });
		ok(interact(room, ana, 'tobin'));
		expect(story()).toMatchObject({ chapter: 'final_decision', pending: 'bell' });
		const end = ok(decide(room, ana, 'bell', 'ring', 5000));
		expect(story()).toMatchObject({
			stage: 'complete',
			ending: 'kept',
			completedAt: 5000,
			pending: null
		});
		expect(end.log.map((m) => ('text' in m ? m.text : ''))).toContain(
			'Oswin weeps at the gate when he sees the boy alive.'
		);
		expect(story().events).toEqual(EVENT_IDS);
	});

	it('never skips ahead: walking into a place does nothing before its chapter', () => {
		atMonastery();
		// The chamber and the stair only matter in their own chapters.
		walk({ x: 3, y: 8 });
		expect(story().chapter).toBe('investigate_monastery');
		expect(story().events).not.toContain('reached_stair');
	});

	it('picks the ending from the final choice', () => {
		atMonastery('silence');
		walk({ x: 21, y: 6 });
		walk({ x: 9, y: 4 });
		ok(interact(room, ana, 'agna'));
		walk({ x: 7, y: 5 });
		clearEnemies();
		walk(STAIR.from);
		walk({ x: 9, y: 5 });
		ok(interact(room, ana, 'tobin'));
		ok(decide(room, gm, 'bell', 'break'));
		expect(story()).toMatchObject({ ending: 'broken', stage: 'complete' });
		expect(story().decisions.get('bell')).toEqual({ option: 'break', by: 'Gia' });
	});
});

describe('what each viewer is told', () => {
	it('gives everyone the chapter, place and choice, and only the GM the ledger', () => {
		throughVillage();
		walk(EXIT[0]);
		walk({ x: 4, y: 15 });
		ok(interact(room, ana, 'oswin'));
		const all = new Set(room.tokens.keys());
		const mine = adventureView(room, ana, all, null)!;
		expect(mine).toMatchObject({
			stage: 'playing',
			chapter: { id: 'investigate_monastery', number: 3, of: 9 },
			location: { id: 'monastery', name: 'The Monastery' },
			decision: { id: 'promise' },
			ending: null,
			ledger: null
		});
		expect(mine.objectives.map((o) => o.id)).toEqual(['gatehouse', 'way-in']);
		// Bellweather's objects are behind the party now.
		expect(mine.interactables.every((i) => !['well', 'maren'].includes(i.id))).toBe(true);
		const gms = adventureView(room, gm, all, null)!;
		expect(gms.ledger).toMatchObject({
			events: ['talked_maren', 'well_clue', 'won_well', 'left_village', 'talked_oswin'],
			defeated: ['Hollow Hound'],
			encounters: [{ id: 'well', state: 'won' }]
		});
		expect(gms.ledger?.npcs).toContainEqual(
			expect.objectContaining({ id: 'maren', home: 'The Tolling Rest', state: 'hopeful' })
		);
		expect(gms.objects?.every((o) => o.id !== 'well')).toBe(true);
	});
});

describe('saving the story with the table', () => {
	const roundTrip = () => {
		const file = parseSceneFile(JSON.parse(JSON.stringify(exportScene(room, 'Mid-story'))));
		if (!file.ok) throw new Error(file.error);
		return file.scene;
	};

	it('saves every part of the story and reads it back the same', () => {
		atMonastery();
		walk({ x: 21, y: 6 });
		walk({ x: 9, y: 4 });
		ok(interact(room, ana, 'agna'));
		walk({ x: 7, y: 5 });
		const scene = roundTrip();
		expect(scene.adventure).toMatchObject({ id: 'hollow-bell', version: 1 });
		const read = readAdventure(scene.adventure!, scene);
		if (!read.ok) throw new Error(read.error);
		expect(saveAdventure(read.adventure)).toEqual(saveAdventure(story()));
		expect(read.adventure.encounter?.enemies.size).toBe(2);
		// The found door is saved as a door, not the wall it was.
		expect(scene.objects.find((o) => o.id === MONASTERY_IDS.secretDoor)?.kind).toBe('door');
	});

	type Tamper = (state: Record<string, unknown>) => void;
	const warden = (s: Record<string, unknown>) =>
		(s.characters as Record<string, Record<string, unknown>>).warden;
	it.each<[string, Tamper]>([
		['an unknown chapter', (s) => (s.chapter = 'epilogue')],
		['a chapter at the wrong place', (s) => (s.location = 'hollow')],
		['too many hit points', (s) => (warden(s).hp = 99)],
		['a character without a token', (s) => (warden(s).tokenId = 'x')],
		['an unknown event', (s) => (s.events = ['talked_maren', 'dragon_slain'])],
		['a repeated clue', (s) => (s.clues = ['scratches', 'scratches'])],
		['an unknown choice', (s) => (s.decisions = { promise: { option: 'gold', by: 'Ana' } })],
		['a state an object cannot be in', (s) => (s.objects = { well: 'lit' })],
		['a person in a made-up mood', (s) => (s.npcs = { oswin: 'furious' })],
		['an ending before the end', (s) => (s.ending = 'kept')],
		[
			'an enemy that is a character',
			(s) => {
				const token = warden(s).tokenId as string;
				s.encounter = {
					id: 'well',
					round: 1,
					phase: 'players',
					acted: [],
					moved: {},
					enemies: { [token]: { kind: 'hound', hp: 1, maxHp: 1, statuses: {} } },
					turn: 1
				};
				s.encounters = { well: 'active' };
			}
		]
	])('rejects %s', (_label, tamper) => {
		atMonastery();
		const scene = roundTrip();
		const saved = scene.adventure as SavedStory;
		tamper(saved.state);
		const read = readAdventure(saved, scene);
		expect(!read.ok && read.error).toMatch(/saved story is invalid/);
	});

	it('refuses a story from another adventure or a newer version', () => {
		begun();
		const scene = roundTrip();
		const saved = scene.adventure!;
		expect(readAdventure({ ...saved, id: 'other' }, scene)).toMatchObject({ ok: false });
		expect(readAdventure({ ...saved, version: 2 }, scene)).toMatchObject({ ok: false });
	});
});
