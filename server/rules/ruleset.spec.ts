import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../../src/lib/adventure/characters';
import type { DieRoller } from '../../src/lib/game/dice';
import { parseSceneFile } from '../../src/lib/game/scene-file';
import { HOLLOW_BELL } from '../adventures/hollow-bell/index';
import {
	beginAdventure,
	characterOf,
	claimCharacter,
	interact,
	startAdventure
} from '../adventure/engine';
import { readAdventure, saveAdventure } from '../adventure/persist';
import { addAdventure } from '../adventure/registry';
import type { CharacterState } from '../adventure/state';
import { RoomManager, type Player, type Room } from '../rooms';
import { exportScene } from '../scene-io';
import { classic, CLASSIC } from './classic';
import { findRuleset, registerRuleset, type Ruleset } from './ruleset';

// A second ruleset, as a test would write one: no bonuses, one stat called Luck.
const FLAT = { id: 'test-flat', version: 1 };
const flat: Ruleset = {
	...classic,
	...FLAT,
	name: 'Flat',
	bonus: () => 0,
	label: () => 'Luck'
};
registerRuleset(flat);
addAdventure({ ...HOLLOW_BELL, id: 'hollow-bell-flat', rules: FLAT });

const min: DieRoller = () => 1;
const open = {
	ranged: false,
	hostileBeside: false,
	targetUnseen: false,
	attackerUnseen: false,
	targetStatuses: new Map()
};

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}

let room: Room;
let gm: Player;
let ana: Player;

function play(adventureId?: string) {
	const rooms = new RoomManager();
	const created = ok(rooms.create('Gia'));
	room = created.room;
	gm = created.player;
	ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
	ok(startAdventure(room, gm, adventureId));
	ok(claimCharacter(room, ana, 'veil'));
	ok(beginAdventure(room, gm, 1000));
}

/** Ana's Veil searches the Hale chest: a check. */
function searchChest() {
	characterOf(room, ana.id)!.token.pos = { x: 17, y: 9 };
	ok(interact(room, ana, 'chest', 'open'));
	const { log } = ok(interact(room, ana, 'chest', 'search', min));
	const check = log.find((m) => m.kind === 'check');
	if (check?.kind !== 'check') throw new Error('no check');
	return check;
}

function roundTrip() {
	const file = parseSceneFile(JSON.parse(JSON.stringify(exportScene(room, 'Mid-story'))));
	if (!file.ok) throw new Error(file.error);
	return file.scene;
}

describe('the classic rules', () => {
	const state = (downedFor: number): CharacterState => ({
		tokenId: 't',
		hp: 0,
		statuses: new Map(),
		uses: new Map(),
		downedFor,
		dead: false
	});

	it('answers as the adventures always played', () => {
		const veil = CHARACTERS.veil;
		expect(classic.bonus(veil, 'agility', 'check')).toBe(4);
		expect(classic.label('wits', 'check')).toBe('Wits');
		expect(classic.actionType(veil, veil.actions[1])).toBe('action');
		expect(classic.initiativeBonus(veil)).toBe(4);
		expect(classic.attackBonus(veil, veil.actions[0])).toBe(6);
		expect(classic.defense(1, new Map())).toBe(11);
		expect(classic.defense(1, new Map([['guarded', 1]]))).toBe(13);
		expect(classic.speed(5, new Map([['slowed', 1]]))).toBe(2);
		expect(classic.turnDamage(new Map([['burning', 2]]))).toEqual({
			dice: '1d4',
			cause: 'Burning'
		});
		const statuses = new Map([
			['slowed' as const, 1],
			['burning' as const, 2]
		]);
		classic.tick(statuses);
		expect([...statuses]).toEqual([['burning', 1]]);
		expect(classic.downedTurn(state(0))).toEqual({ dead: false, turnsLeft: 2 });
		expect(classic.downedTurn(state(2))).toEqual({ dead: true });
	});

	it('hits on a natural 20 and misses on a natural 1, whatever the numbers', () => {
		expect(classic.strike(0, '1d4', 99, open, () => 20).hit).toBe(true);
		expect(classic.strike(99, '1d4', 2, open, () => 1)).toMatchObject({
			hit: false,
			damage: null
		});
	});

	it('pay no mind to the table: the dark, or a foe beside an archer', () => {
		const dark = { ...open, ranged: true, hostileBeside: true, targetUnseen: true };
		const ten: DieRoller = () => 10;
		expect(classic.strike(2, '1d4', 12, dark, ten)).toEqual(
			classic.strike(2, '1d4', 12, open, ten)
		);
		const veil = CHARACTERS.veil;
		const lit = classic.test(veil, 'wits', 'check', 12, { dark: false, sight: true }, ten);
		const unlit = classic.test(veil, 'wits', 'check', 12, { dark: true, sight: true }, ten);
		expect(unlit).toEqual(lit);
		expect(lit).toMatchObject({ success: true, label: 'Wits', roll: { expression: '1d20+2' } });
	});

	it('find nothing wrong with the built-in adventures', () => {
		expect(classic.validate(HOLLOW_BELL)).toEqual([]);
		expect(
			classic.validate({
				...HOLLOW_BELL,
				signs: [{ ...HOLLOW_BELL.signs[0], check: { stat: 'luck', dc: 10 } }]
			})
		).toEqual([expect.stringContaining('no stat "luck"')]);
	});
});

describe('rulesets', () => {
	it('are found by exact id and version, and each registers once', () => {
		expect(findRuleset(CLASSIC)).toBe(classic);
		expect(findRuleset({ id: 'thirdfold-classic', version: 2 })).toBeUndefined();
		expect(() => registerRuleset(flat)).toThrow();
	});

	it('pins both built-in adventures to the classic rules', () => {
		play();
		expect(room.adventure!.rules).toEqual(CLASSIC);
		play('blackwater');
		expect(room.adventure!.rules).toEqual(CLASSIC);
	});

	it('resolves a story by the rules it is pinned to', () => {
		play();
		expect(searchChest()).toMatchObject({ stat: 'Wits', roll: { total: 3 } });
		play('hollow-bell-flat');
		expect(room.adventure!.rules).toEqual(FLAT);
		expect(searchChest()).toMatchObject({ stat: 'Luck', roll: { total: 1 } });
	});

	it('are saved with the story, and read back', () => {
		play('hollow-bell-flat');
		const scene = roundTrip();
		expect(scene.adventure!.state.rules).toEqual(FLAT);
		const read = readAdventure(scene.adventure!, scene);
		if (!read.ok) throw new Error(read.error);
		expect(read.adventure.rules).toEqual(FLAT);
		expect(saveAdventure(read.adventure)).toEqual(saveAdventure(room.adventure!));
	});

	it('default a save from before rulesets to the classic rules', () => {
		play();
		const scene = roundTrip();
		delete scene.adventure!.state.rules;
		const read = readAdventure(scene.adventure!, scene);
		expect(read.ok && read.adventure.rules).toEqual(CLASSIC);
	});

	it('refuse a save pinned to rules this server does not have', () => {
		play();
		const scene = roundTrip();
		scene.adventure!.state.rules = { id: 'thirdfold-classic', version: 9 };
		expect(readAdventure(scene.adventure!, scene)).toMatchObject({ ok: false });
		scene.adventure!.state.rules = 'classic';
		expect(readAdventure(scene.adventure!, scene)).toMatchObject({ ok: false });
	});

	it('refuse to start an adventure that needs rules this server does not have', () => {
		addAdventure({ ...HOLLOW_BELL, id: 'hollow-bell-unknown', rules: { id: 'nope', version: 1 } });
		const rooms = new RoomManager();
		const created = ok(rooms.create('Gia'));
		expect(startAdventure(created.room, created.player, 'hollow-bell-unknown')).toMatchObject({
			ok: false
		});
	});
});
