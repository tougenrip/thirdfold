import { beforeEach, describe, expect, it } from 'vitest';
import type { DieRoller } from '../../../src/lib/game/dice';
import type { GridPos } from '../../../src/lib/game/grid';
import { isSolidCell } from '../../../src/lib/game/props';
import { parseSceneFile } from '../../../src/lib/game/scene-file';
import { RoomManager, type Player, type Room } from '../../rooms';
import { obstacles } from '../../scene';
import { applyScene, exportScene } from '../../scene-io';
import * as engine from '../../adventure/engine';
import { readAdventure } from '../../adventure/persist';
import { findAdventure } from '../../adventure/registry';
import { adventureView } from '../../adventure/view';
import { BLACKWATER } from '.';
import { FRONT, TRAIN_IDS } from './tables';

const max: DieRoller = (sides) => sides;

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
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
	room.dice = max;
	ok(engine.startAdventure(room, gm, 'blackwater'));
	ok(engine.claimCharacter(room, ana, 'warden'));
	ok(engine.beginAdventure(room, gm, 1000));
});

const story = () => room.adventure!;
const me = () => engine.characterOf(room, ana.id)!;
const view = () => adventureView(room, ana, new Set(room.tokens.keys()), null)!;

/** Stands Ana's character on a free cell beside `target`. */
function beside(target: GridPos): void {
	const blocked = obstacles(room);
	for (const [dx, dy] of [
		[0, 1],
		[0, -1],
		[1, 0],
		[-1, 0],
		[1, 1],
		[-1, 1],
		[1, -1],
		[-1, -1]
	]) {
		const cell = { x: target.x + dx, y: target.y + dy };
		const taken = [...room.tokens.values()].some(
			(t) => t.id !== me().token.id && t.pos.x === cell.x && t.pos.y === cell.y
		);
		if (!taken && !isSolidCell(blocked, cell)) {
			me().token.pos = cell;
			return;
		}
	}
	throw new Error(`nowhere to stand beside ${JSON.stringify(target)}`);
}

const npcAt = (id: string) => room.tokens.get(BLACKWATER.npcs[id].token)!.pos;
const talk = (id: string) => {
	beside(npcAt(id));
	return ok(engine.interact(room, ana, id, null, max));
};
const use = (id: string, verb: string | null, at: GridPos) => {
	me().token.pos = { ...at };
	return ok(engine.interact(room, ana, id, verb, max));
};
const gmDo = (direction: Parameters<typeof engine.direct>[2]) =>
	ok(engine.direct(room, gm, direction));

describe('The Last Train to Blackwater', () => {
	it('is a built-in adventure made from an adventure file, with its own intros', () => {
		expect(findAdventure('blackwater')?.title).toBe('The Last Train to Blackwater');
		expect(Object.keys(BLACKWATER.chapters)).toHaveLength(7);
		expect(BLACKWATER.characters.warden.intro).toMatch(/shotgun/);
		expect(story()).toMatchObject({ id: 'blackwater', chapter: 'all_aboard', location: 'train' });
		expect(room.grid).toMatchObject({ width: 68, height: 7 });
		expect(room.environment).toBe('railcar');
	});

	it('shows a newcomer a first find in the aisle, a few rows back', () => {
		expect(view().firstFind).toMatchObject({ objectId: 'ticket', clueId: 'ticket' });
		use('ticket', null, { x: 59, y: 3 });
		expect(view().clues.find((c) => c.id === 'ticket')).toMatchObject({ mine: true });
		expect(view().firstFind).toBeNull();
	});

	it('plays to Laid to Rest: the conductor confesses and faces the dead', () => {
		talk('pike');
		expect(story().chapter).toBe('the_vanishing');

		// The berth: frost, found by Ana, shared with the party.
		use('berth', 'search', { x: 22, y: 3 });
		ok(engine.share(room, ana, 'frost'));
		expect(story().events).toContain('searched_berth');
		// Tommy saw the lady in black walk through the baggage car door.
		talk('tommy');
		expect(story().chapter).toBe('the_baggage_car');

		// The key, the door, the strongbox, the coffin.
		expect(engine.interact(room, ana, 'baggage-door', 'unlock', max)).toMatchObject({ ok: false });
		use('brass-key', 'take', { x: 63, y: 3 });
		expect(story().carried.get('brass-key')).toBe(me().id);
		use('baggage-door', 'unlock', { x: 14, y: 3 });
		expect(story().events).toContain('opened_baggage');
		use('strongbox', 'search', { x: 11, y: 2 });
		ok(engine.share(room, ana, 'manifest'));
		expect(story().rewards).toEqual(['The 1861 manifest']);
		use('coffin', 'open', { x: 7, y: 3 });
		expect(story().encounter?.id).toBe('coffins');
		expect(room.props.get(TRAIN_IDS.coffin)?.assetId).toBe('coffin-open');
		gmDo({ op: 'encounter_end', result: 'won' });
		expect(story()).toMatchObject({ chapter: 'midnight', location: 'train' });
		expect(story().rewards).toContain('Mr. Grant, alive');
		expect(room.ambient).toBe('dark');
		expect(story().sentries).toHaveLength(3);

		// Midnight: Pike confesses to what Ana knows, then the front of the train.
		talk('pike');
		expect(story().events).toContain('pike_confessed');
		me().token.pos = { ...FRONT };
		const forward = engine.afterMove(room, me().token, null);
		expect(forward.reset).toBe(true);
		expect(story()).toMatchObject({ chapter: 'the_engine', location: 'engine' });
		expect(story().encounter?.id).toBe('engineer');

		gmDo({ op: 'encounter_end', result: 'won' });
		expect(story()).toMatchObject({ chapter: 'the_bridge', pending: 'reckoning' });
		expect(view().decision?.options.find((o) => o.id === 'confess')?.label).toMatch(/finish/);
		ok(engine.decide(room, ana, 'reckoning', 'confess'));
		expect(story()).toMatchObject({ stage: 'complete', ending: 'rest' });
		expect(view().ending).toMatchObject({ title: 'Laid to Rest' });
		expect(story().rewards).toEqual([
			'The 1861 manifest',
			'Mr. Grant, alive',
			'Wade Dollar’s scorched cap'
		]);
	});

	it('does not take the party forward while the dead are fighting it', () => {
		for (let i = 0; i < 3; i++) gmDo({ op: 'skip' });
		expect(story().chapter).toBe('midnight');
		gmDo({ op: 'encounter_start', encounter: 'the_dead' });
		expect(story().encounter?.id).toBe('the_dead');
		me().token.pos = { ...FRONT };
		engine.afterMove(room, me().token, null);
		expect(story()).toMatchObject({ chapter: 'midnight', location: 'train' });
		gmDo({ op: 'encounter_end', result: 'won' });
		expect(story().events).toContain('dead_dispersed');
		engine.afterMove(room, me().token, null);
		expect(story()).toMatchObject({ chapter: 'the_engine', location: 'engine' });
	});

	it('plays to Stopped Short when the GM directs it and the party throws the brake', () => {
		for (let i = 0; i < 5; i++) gmDo({ op: 'skip' });
		expect(story()).toMatchObject({ chapter: 'the_bridge', pending: 'reckoning' });
		ok(engine.decide(room, ana, 'reckoning', 'brake'));
		expect(story()).toMatchObject({ stage: 'complete', ending: 'stopped' });
		expect(view().ending).toMatchObject({ title: 'Stopped Short' });
	});

	it('saves at the bridge, loads, and rides on to Blackwater for End of the Line', () => {
		for (let i = 0; i < 5; i++) gmDo({ op: 'skip' });
		const saved = exportScene(room, 'Bridge');
		expect(saved.adventure).toMatchObject({ id: 'blackwater' });
		expect(saved.adventure!.content).toBeUndefined();
		const parsed = parseSceneFile(JSON.parse(JSON.stringify(saved)));
		if (!parsed.ok) throw new Error(parsed.error);
		room.adventure = null;
		applyScene(room, parsed.scene);
		room.adventure = ok(readAdventure(parsed.scene.adventure!, parsed.scene)).adventure;
		expect(story()).toMatchObject({ chapter: 'the_bridge', pending: 'reckoning' });

		ok(engine.decide(room, ana, 'reckoning', 'ride'));
		expect(story()).toMatchObject({ chapter: 'to_blackwater', location: 'blackwater' });
		expect(room.environment).toBe('ghost-town');
		expect(story().encounter?.id).toBe('wreck');
		gmDo({ op: 'encounter_end', result: 'won' });
		expect(story()).toMatchObject({ stage: 'complete', ending: 'line' });
		expect(view().ending).toMatchObject({ title: 'End of the Line' });
	});
});
