import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../src/lib/game/chat';
import type { DieRoller } from '../../src/lib/game/dice';
import type { GridPos } from '../../src/lib/game/grid';
import { parseSceneFile } from '../../src/lib/game/scene-file';
import { RoomManager, type Player, type Room } from '../rooms';
import { exportScene } from '../scene-io';
import { canSeeLogEntry } from '../views';
import {
	afterMove,
	beginAdventure,
	characterOf,
	claimCharacter,
	interact,
	knows,
	sense,
	share,
	startAdventure
} from './engine';
import { readAdventure } from './persist';
import type { AdventureStage } from '../../src/lib/adventure/adventure';
import { HOLLOW_BELL } from '../adventures/hollow-bell/index';
import type { AdventureState } from './state';
import { objectivesFor } from './view';
import { adventureView } from './view';

/** The objectives shown at a point in the story. */
const objectivesAt = (stage: AdventureStage, chapter: string, events: string[]) =>
	objectivesFor(HOLLOW_BELL, { stage, chapter, events } as unknown as AdventureState);

const max: DieRoller = (sides) => sides;
const min: DieRoller = () => 1;

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}

let room: Room;
let gm: Player;
let ana: Player;
let ben: Player;
let wes: Player;

beforeEach(() => {
	const rooms = new RoomManager();
	const created = ok(rooms.create('Gia'));
	room = created.room;
	gm = created.player;
	ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
	ben = ok(rooms.join(room.id, 'Ben', 'player')).player;
	wes = ok(rooms.join(room.id, 'Wes', 'spectator')).player;
	ok(startAdventure(room, gm));
	ok(claimCharacter(room, ana, 'veil'));
	ok(claimCharacter(room, ben, 'warden'));
	ok(beginAdventure(room, gm, 1000));
});

const story = () => room.adventure!;
const put = (player: Player, pos: GridPos) => {
	characterOf(room, player.id)!.token.pos = { ...pos };
};
const view = (viewer: Player) => adventureView(room, viewer, new Set(room.tokens.keys()), null)!;
const clueIds = (viewer: Player) => view(viewer).clues.map((c) => c.id);
const seenBy = (viewer: Player, log: ChatMessage[]) => log.filter((m) => canSeeLogEntry(viewer, m));
const texts = (log: ChatMessage[]) => log.flatMap((m) => ('text' in m ? [m.text] : []));

/** Ana's Veil opens the Hale chest and searches it. */
function searchChest(roller: DieRoller) {
	put(ana, { x: 17, y: 9 });
	ok(interact(room, ana, 'chest', 'open'));
	return ok(interact(room, ana, 'chest', 'search', roller));
}

describe('investigation actions', () => {
	it('labels what each thing offers: examine, inspect, search, interact, with any check', () => {
		put(ana, { x: 11, y: 9 });
		const nearWell = view(ana).interactables;
		const verb = (id: string, v: string) =>
			nearWell.find((i) => i.id === id)?.verbs.find((x) => x.id === v);
		expect(verb('well', 'examine')).toMatchObject({ action: 'examine', check: null });
		expect(verb('noticeboard', 'read')).toMatchObject({ action: 'inspect' });
		expect(verb('crate', 'break')).toMatchObject({ action: 'interact' });
		expect(verb('maren', 'talk')).toMatchObject({ action: 'interact' });
		put(ana, { x: 17, y: 9 });
		ok(interact(room, ana, 'chest', 'open'));
		const chest = view(ana).interactables.find((i) => i.id === 'chest')!;
		expect(chest.verbs[0]).toMatchObject({
			id: 'search',
			action: 'search',
			check: { stat: 'wits', dc: 8 },
			tried: false
		});
	});

	it('rolls a search’s check on the server; a failure lets someone else try, not the same one', () => {
		const failed = searchChest(min);
		expect(failed.log[0]).toMatchObject({ kind: 'check', success: false, dc: 8, stat: 'Wits' });
		expect(story().evidence.has('rope')).toBe(false);
		expect(interact(room, ana, 'chest', 'search', max)).toMatchObject({ ok: false });
		expect(view(ana).interactables.find((i) => i.id === 'chest')?.verbs[0].tried).toBe(true);
		put(ben, { x: 18, y: 9 });
		const found = ok(interact(room, ben, 'chest', 'search', max));
		expect(found.log[0]).toMatchObject({ kind: 'check', success: true });
		expect(story().evidence.get('rope')).toEqual({ by: ['warden'], shared: false });
	});
});

describe('evidence only the right viewers see', () => {
	it('keeps what a character finds to their player and the GM until it is shared', () => {
		const found = searchChest(max);
		expect(clueIds(ana)).toEqual(['rope']);
		expect(clueIds(ben)).toEqual([]);
		expect(clueIds(wes)).toEqual([]);
		expect(view(gm).clues).toMatchObject([
			{ id: 'rope', kind: 'object', foundBy: ['The Veil'], shared: false, mine: false }
		]);
		expect(view(ana).clues[0]).toMatchObject({ mine: true, shared: false });

		// The log tells everyone something was found, but only Ana (and the GM) what.
		const ropeText = texts(found.log).find((t) => t.includes('bell rope'))!;
		expect(texts(seenBy(ana, found.log))).toContain(ropeText);
		expect(texts(seenBy(gm, found.log))).toContain(ropeText);
		expect(texts(seenBy(ben, found.log))).not.toContain(ropeText);
		expect(texts(seenBy(ben, found.log)).join(' ')).toMatch(/The Veil found something/);
		expect(texts(seenBy(wes, found.log)).join(' ')).not.toMatch(/bell rope/);
	});

	it('lets only the finder hear what people say about a private find', () => {
		put(ben, { x: 18, y: 9 });
		const found = searchChest(max);
		const edda = found.log.filter((m) => m.kind === 'narration' && m.speaker === 'Edda');
		expect(edda).toHaveLength(1);
		expect(seenBy(ana, edda)).toHaveLength(1);
		expect(seenBy(ben, edda)).toHaveLength(0);
		// Smashing a crate is plain to see, and so is what Rosa shouts about it.
		put(ben, { x: 11, y: 11 });
		const smashed = ok(interact(room, ben, 'crate', 'break'));
		const rosa = smashed.log.filter((m) => m.kind === 'narration' && m.speaker === 'Rosa');
		expect(seenBy(ana, rosa)).toHaveLength(1);
	});

	it('lets only the finder (or the GM) share it, and then the whole party knows', () => {
		searchChest(max);
		expect(share(room, ben, 'rope')).toMatchObject({ ok: false });
		expect(share(room, ana, 'nothing')).toMatchObject({ ok: false });
		const shared = ok(share(room, ana, 'rope'));
		expect(texts(seenBy(ben, shared.log)).join(' ')).toMatch(/bell rope/);
		expect(clueIds(ben)).toEqual(['rope']);
		expect(clueIds(wes)).toEqual(['rope']);
		expect(share(room, ana, 'rope')).toMatchObject({ ok: false });
	});

	it('shares what people say aloud with everyone at once', () => {
		put(ben, { x: 4, y: 10 });
		ok(interact(room, ben, 'bertram'));
		expect(clueIds(ana)).toEqual(['legend']);
		expect(view(ana).clues[0]).toMatchObject({ kind: 'testimony', foundBy: [], shared: true });
	});

	it('makes people react to what the one talking to them knows', () => {
		story().evidence.set('drawing', { by: ['veil'], shared: false });
		put(ben, { x: 9, y: 14 });
		ok(interact(room, ben, 'pell'));
		expect(knows(story(), 'warden', 'promise')).toBe(false);
		put(ana, { x: 10, y: 14 });
		ok(interact(room, ana, 'pell'));
		expect(knows(story(), 'warden', 'promise')).toBe(true);
	});
});

describe('listening and looking around', () => {
	it('picks up signs nearby, privately, behind a check', () => {
		put(ana, { x: 12, y: 12 });
		const heard = ok(sense(room, ana, 'listen', max));
		expect(heard.log[0]).toMatchObject({ kind: 'check', action: 'Listen', success: true });
		expect(clueIds(ana)).toEqual(['hum']);
		expect(clueIds(ben)).toEqual([]);
		// Nothing more to hear there.
		const again = ok(sense(room, ana, 'listen', max));
		expect(again.log).toHaveLength(1);
		expect(seenBy(ben, again.log)).toHaveLength(0);
	});

	it('lets each character try a sign once', () => {
		put(ana, { x: 11, y: 7 });
		const missed = ok(sense(room, ana, 'observe', min));
		expect(missed.log[0]).toMatchObject({ kind: 'check', success: false });
		expect(ok(sense(room, ana, 'observe', max)).log).toHaveLength(1);
		expect(story().evidence.has('footprints')).toBe(false);
		put(ben, { x: 12, y: 7 });
		ok(sense(room, ben, 'observe', max));
		expect(knows(story(), 'warden', 'footprints')).toBe(true);
	});

	it('is refused mid-fight and to people without a character', () => {
		expect(sense(room, wes, 'listen', max)).toMatchObject({ ok: false });
		put(ana, { x: 7, y: 10 });
		ok(interact(room, ana, 'maren'));
		put(ana, { x: 11, y: 12 });
		ok(interact(room, ana, 'well'));
		expect(sense(room, ana, 'listen', max)).toMatchObject({ ok: false, code: 'not_your_turn' });
	});
});

describe('evidence moves the story', () => {
	it('unlocks an objective once the party knows, not while one character keeps it', () => {
		put(ana, { x: 11, y: 7 });
		ok(sense(room, ana, 'observe', max));
		const tobin = () => view(ana).objectives.find((o) => o.id === 'tobin');
		expect(tobin()).toMatchObject({ done: false, optional: true });
		expect(story().events).not.toContain('learned_tobin');
		ok(share(room, ana, 'footprints'));
		expect(story().events).toContain('learned_tobin');
		expect(tobin()?.done).toBe(true);
	});

	it('opens a monastery objective from what Father Wynn says in the village', () => {
		expect(objectivesAt('playing', 'investigate_monastery', []).map((o) => o.id)).toEqual([
			'gatehouse',
			'way-in'
		]);
		put(ana, { x: 27, y: 8 });
		ok(interact(room, ana, 'wynn'));
		expect(story().events).toContain('learned_agna');
		expect(
			objectivesAt('playing', 'investigate_monastery', story().events).map((o) => o.id)
		).toEqual(['gatehouse', 'way-in', 'agna']);
	});

	it('never lets evidence found in one chapter skip ahead', () => {
		put(ben, { x: 12, y: 7 });
		ok(sense(room, ben, 'observe', max));
		ok(share(room, ben, 'footprints'));
		afterMove(room, characterOf(room, ben.id)!.token, null);
		expect(story().chapter).toBe('village');
	});
});

describe('saving evidence', () => {
	it('keeps who found what, what was shared and failed checks through a save', () => {
		searchChest(max);
		put(ben, { x: 12, y: 12 });
		ok(sense(room, ben, 'listen', min));
		const file = parseSceneFile(JSON.parse(JSON.stringify(exportScene(room, 'Clues'))));
		if (!file.ok) throw new Error(file.error);
		const read = readAdventure(file.scene.adventure!, file.scene);
		if (!read.ok) throw new Error(read.error);
		expect([...read.adventure.evidence]).toEqual([['rope', { by: ['veil'], shared: false }]]);
		expect([...read.adventure.tried]).toEqual(['warden:sign:well-hum']);
	});

	it('reads older saves’ clue lists as evidence the whole party shares', () => {
		searchChest(max);
		const file = parseSceneFile(JSON.parse(JSON.stringify(exportScene(room, 'Old'))));
		if (!file.ok) throw new Error(file.error);
		const state = file.scene.adventure!.state;
		delete state.evidence;
		delete state.tried;
		state.clues = ['notice', 'rope'];
		const read = readAdventure(file.scene.adventure!, file.scene);
		if (!read.ok) throw new Error(read.error);
		expect([...read.adventure.evidence.values()].every((f) => f.shared)).toBe(true);
		expect(read.adventure.tried.size).toBe(0);
	});
});
