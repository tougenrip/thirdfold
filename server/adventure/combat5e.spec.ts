// Fifth edition combat at the table (milestone 50): opportunity attacks as
// reactions, death saving throws, Dash, Disengage, Dodge and Help, cover,
// damage types, and all of it kept through a save. The Barrow on Cold Hill's
// fight, with the dice set for each case.

import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../src/lib/game/chat';
import type { DieRoller } from '../../src/lib/game/dice';
import type { GridPos } from '../../src/lib/game/grid';
import { BARROW_IDS, CARVINGS_AT } from '../adventures/barrow';
import { RoomManager, type Player, type Room } from '../rooms';
import { exportScene } from '../scene-io';
import { toggleDoor } from '../scene';
import {
	act,
	afterMove,
	beginAdventure,
	characterOf,
	checkMove,
	claimCharacter,
	editSheet,
	endTurn,
	interact,
	runEnemyTurn,
	share,
	startAdventure
} from './engine';
import { readAdventure } from './persist';
import { adventureView } from './view';

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}
/** d20s from `d20s` in turn; every other die rolls `other` (or its highest). */
const dice =
	(d20s: number[], other: number[] = []): DieRoller =>
	(sides) =>
		sides === 20 ? (d20s.shift() ?? 10) : Math.min(sides, other.shift() ?? sides);

let room: Room;
let gm: Player;
let ana: Player;
let ben: Player;
let cam: Player;
let dee: Player;

const ember = () => characterOf(room, ana.id)!;
const saint = () => characterOf(room, ben.id)!;
const veil = () => characterOf(room, cam.id)!;
const warden = () => characterOf(room, dee.id)!;
const place = (who: { token: { pos: GridPos } }, at: GridPos) => (who.token.pos = { ...at });
const view = (who: Player) => adventureView(room, who, new Set(room.tokens.keys()), null)!;
const status = (id: string) => view(gm).characters.find((c) => c.id === id)!;
const texts = (log: readonly ChatMessage[]) => log.map((m) => ('text' in m ? m.text : ''));
const attacks = (log: readonly ChatMessage[]) =>
	log.flatMap((m) => (m.kind === 'attack' ? [m] : []));

beforeEach(() => {
	const rooms = new RoomManager();
	const created = ok(rooms.create('Gia'));
	room = created.room;
	gm = created.player;
	ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
	ben = ok(rooms.join(room.id, 'Ben', 'player')).player;
	cam = ok(rooms.join(room.id, 'Cam', 'player')).player;
	dee = ok(rooms.join(room.id, 'Dee', 'player')).player;
	room.dice = () => 10;
	ok(startAdventure(room, gm, 'barrow'));
	ok(claimCharacter(room, ana, 'ember'));
	ok(claimCharacter(room, ben, 'saint'));
	ok(claimCharacter(room, cam, 'veil'));
	ok(claimCharacter(room, dee, 'warden'));
	ok(beginAdventure(room, gm, 1000));
});

/** Into the barrow: the guardians wake. The party stands aside, and the foes' tokens are returned. */
function fight() {
	place(veil(), { x: CARVINGS_AT.x, y: CARVINGS_AT.y + 1 });
	ok(interact(room, cam, 'carvings', 'examine', dice([10])));
	ok(share(room, cam, 'ward'));
	place(warden(), { x: 7, y: 8 });
	ok(interact(room, dee, 'barrow-door', 'force', dice([12])));
	ok(toggleDoor(room, dee, BARROW_IDS.door));
	place(veil(), { x: 7, y: 7 });
	place(warden(), { x: 9, y: 5 });
	afterMove(room, warden().token, null);
	const encounter = room.adventure!.encounter!;
	const foe = (kind: string) =>
		room.tokens.get([...encounter.enemies].find(([, e]) => e.kind === kind)![0])!;
	place(ember(), { x: 1, y: 11 });
	place(saint(), { x: 2, y: 11 });
	place(veil(), { x: 3, y: 11 });
	place(warden(), { x: 4, y: 11 });
	const shade = foe('shade');
	shade.pos = { x: 13, y: 1 };
	return { encounter, guard: foe('guard'), shade };
}

/** Makes it `id`'s turn, fresh. */
function turnTo(id: string) {
	const encounter = room.adventure!.encounter!;
	encounter.current = encounter.order.findIndex(
		(t) => (t.kind === 'character' ? t.id : t.tokenId) === id
	);
	encounter.acted.clear();
	encounter.moved.clear();
	encounter.speed = 6;
	encounter.turnSpeed = 6;
}

/** Puts `first` just before `then` in the turn order, and makes it `first`'s turn. */
function nextUp(first: string, then: string) {
	const encounter = room.adventure!.encounter!;
	const key = (t: (typeof encounter.order)[number]) => (t.kind === 'character' ? t.id : t.tokenId);
	const a = encounter.order.find((t) => key(t) === first)!;
	const b = encounter.order.find((t) => key(t) === then)!;
	encounter.order = [a, b, ...encounter.order.filter((t) => t !== a && t !== b)];
	encounter.current = 0;
	encounter.acted.clear();
	encounter.speed = 6;
}

/** A player walks their character to `to`, as the game server does it. */
function walk(who: Player, to: GridPos) {
	const me = characterOf(room, who.id)!;
	const allowed = ok(checkMove(room, who, me.token.id, to));
	me.token.pos = { ...to };
	return afterMove(room, me.token, allowed.cost, 2000, allowed.walk);
}

describe('opportunity attacks', () => {
	it('strike a character leaving a foe’s reach, once until the foe’s turn, and never one that disengages', () => {
		const { guard } = fight();
		turnTo('warden');
		place(warden(), { x: 5, y: 4 });
		guard.pos = { x: 6, y: 4 };
		expect(status('warden').reaction).toBe('ready');

		// Leaving: the Guard strikes as the Warden goes, from the cell it leaves.
		room.dice = dice([14], [3]);
		const { log } = walk(dee, { x: 3, y: 4 });
		expect(texts(log)).toContain(
			'The Barrow Guard strikes as The Warden moves away (Opportunity Attack).'
		);
		expect(attacks(log)).toMatchObject([{ authorName: 'Barrow Guard', attack: 'Rusted blade' }]);
		expect(warden().token.pos).toEqual({ x: 3, y: 4 });
		expect(room.adventure!.encounter!.reacted).toEqual(new Set([guard.id]));

		// Its reaction is spent: back in and out again draws nothing.
		const again = walk(dee, { x: 5, y: 5 });
		expect(attacks(again.log)).toEqual([]);
		const away = walk(dee, { x: 4, y: 3 });
		expect(attacks(away.log)).toEqual([]);

		// Its turn gives it back.
		turnTo(guard.id);
		runEnemyTurn(room, room.adventure!.encounter!.turn, dice([1]));
		expect(room.adventure!.encounter!.reacted?.has(guard.id)).toBe(false);

		// Disengaging, the Warden walks off freely.
		turnTo('warden');
		place(warden(), { x: 5, y: 4 });
		guard.pos = { x: 6, y: 4 };
		const { log: disengaged } = ok(act(room, dee, 'disengage', null, dice([])));
		expect(texts(disengaged)).toContain('The Warden disengages.');
		expect(attacks(walk(dee, { x: 3, y: 4 }).log)).toEqual([]);
	});

	it('let a character strike a foe that walks out of its reach, unless its player holds the reaction', () => {
		const { guard } = fight();
		const enemy = room.adventure!.encounter!.enemies.get(guard.id)!;
		place(warden(), { x: 5, y: 4 });
		guard.pos = { x: 6, y: 4 };
		place(veil(), { x: 10, y: 4 });
		// The Veil hurt it last: it goes for the Veil, past the Warden.
		enemy.lastHitBy = 'veil';
		turnTo(guard.id);
		const turn = runEnemyTurn(room, room.adventure!.encounter!.turn, dice([15, 2], [4]))!;
		expect(texts(turn.log)).toContain(
			'The Warden strikes as the Barrow Guard moves away (Opportunity Attack).'
		);
		expect(attacks(turn.log)[0]).toMatchObject({ authorName: 'The Warden', attack: 'Longsword' });
		expect(status('warden').reaction).toBe('used');

		// Held: the table leaves the Warden's reaction be.
		ok(editSheet(room, dee, 'warden', { kind: 'reaction', ready: false }));
		expect(status('warden').reaction).toBe('held');
		room.adventure!.encounter!.reacted!.clear();
		place(warden(), { x: 5, y: 4 });
		guard.pos = { x: 6, y: 4 };
		enemy.lastHitBy = 'veil';
		turnTo(guard.id);
		const held = runEnemyTurn(room, room.adventure!.encounter!.turn, dice([2], [4]))!;
		expect(texts(held.log).some((t) => t.includes('Opportunity Attack'))).toBe(false);
		// Only its player (or the GM) holds it.
		expect(editSheet(room, cam, 'warden', { kind: 'reaction', ready: true }).ok).toBe(false);
	});
});

describe('dying', () => {
	it('rolls a death save at the start of each turn at 0 HP: three failures and it dies', () => {
		fight();
		const w = warden();
		w.state.hp = 0;
		w.state.downedFor = 0;
		expect(status('warden').deathSaves).toEqual({ successes: 0, failures: 0, stable: false });

		room.dice = dice([15]);
		nextUp('veil', 'warden');
		const first = ok(endTurn(room, cam)).log;
		const save = first.find((m) => m.kind === 'check')!;
		expect(save).toMatchObject({
			authorName: 'The Warden',
			stat: 'Death saving throw',
			dc: 10,
			success: true,
			explain: 'Death save: 15: success (1 success, 0 failures)'
		});
		expect(status('warden').deathSaves).toEqual({ successes: 1, failures: 0, stable: false });

		// A natural 1 is two failures; one more, and it dies.
		room.dice = dice([1]);
		nextUp('veil', 'warden');
		ok(endTurn(room, cam));
		expect(status('warden').deathSaves).toMatchObject({ failures: 2 });
		room.dice = dice([4]);
		nextUp('veil', 'warden');
		const last = ok(endTurn(room, cam)).log;
		expect(last.find((m) => m.kind === 'check')).toMatchObject({
			success: false,
			explain: 'Death save: 4: failure, the third failure'
		});
		expect(status('warden')).toMatchObject({ dead: true, deathSaves: null });
	});

	it('comes to on a 20, and a steadied character stops rolling', () => {
		fight();
		warden().state.hp = 0;
		room.dice = dice([20]);
		nextUp('veil', 'warden');
		const { log } = ok(endTurn(room, cam));
		expect(texts(log)).toContain('The Warden comes to with 1 HP!');
		expect(texts(log)).toContain("The Warden's turn.");
		expect(warden().state.hp).toBe(1);

		// First aid: the Veil, beside the fallen Saint, steadies it with a Medicine check.
		saint().state.hp = 0;
		turnTo('veil');
		place(veil(), { x: 5, y: 8 });
		place(saint(), { x: 6, y: 8 });
		const aid = ok(act(room, cam, 'first-aid', saint().token.id, dice([12]))).log;
		expect(aid.find((m) => m.kind === 'check')).toMatchObject({
			stat: 'Wisdom (Medicine)',
			dc: 10,
			success: true
		});
		expect(texts(aid)).toContain('The Saint is stable.');
		expect(status('saint').deathSaves).toEqual({ successes: 0, failures: 0, stable: true });
		// Stable, it rolls no more saves on its turns.
		nextUp('veil', 'saint');
		const next = ok(endTurn(room, cam)).log;
		expect(next.some((m) => m.kind === 'check')).toBe(false);
		// And first aid is only for the dying.
		turnTo('veil');
		expect(act(room, cam, 'first-aid', warden().token.id, dice([12]))).toMatchObject({
			ok: false
		});
	});

	it('dies outright of massive damage, and a hit at 0 HP is a failed death save', () => {
		const { guard } = fight();
		const w = warden();
		place(w, { x: 5, y: 4 });
		guard.pos = { x: 6, y: 4 };
		// 1 HP left, and a critical Rusted blade: 2d8 + 2 = 18, 17 past 0, beyond its 13 maximum.
		w.state.hp = 1;
		turnTo(guard.id);
		const turn = runEnemyTurn(room, room.adventure!.encounter!.turn, dice([20]))!;
		const hit = attacks(turn.log)[0];
		expect(hit).toMatchObject({ critical: true, damage: { total: 18 } });
		expect(hit.outcome).toMatch(
			/Massive damage: 17 left over, at least its Hit Point maximum of 1[0-9]/
		);
		expect(status('warden').dead).toBe(true);
	});
});

describe('actions every character has', () => {
	it('dashes for the turn’s movement again, and dodges attacks it sees', () => {
		const { guard } = fight();
		turnTo('warden');
		place(warden(), { x: 3, y: 4 });
		const dash = ok(act(room, dee, 'dash', null, dice([]))).log;
		expect(texts(dash)).toEqual(['The Warden dashes.', 'The Warden can move 6 more cells.']);
		expect(room.adventure!.encounter!.speed).toBe(12);
		// One action a turn: it can't dodge as well.
		expect(act(room, dee, 'dodge', null, dice([]))).toMatchObject({ ok: false });

		turnTo('warden');
		place(warden(), { x: 5, y: 4 });
		guard.pos = { x: 6, y: 4 };
		ok(act(room, dee, 'dodge', null, dice([])));
		expect(status('warden').effects).toContain(
			'Dodge: attacks against it have Disadvantage, and it makes Dexterity saves with Advantage'
		);
		turnTo(guard.id);
		const turn = runEnemyTurn(room, room.adventure!.encounter!.turn, dice([18, 3]))!;
		expect(attacks(turn.log)[0]).toMatchObject({ mode: 'disadvantage', hit: false });
		expect(attacks(turn.log)[0].explain).toContain('the target is dodging');
		// It lasts until the start of the Warden's next turn.
		nextUp('veil', 'warden');
		ok(endTurn(room, cam));
		expect(status('warden').effects).toEqual([]);
	});

	it('helps an ally’s next attack against a foe beside it', () => {
		const { guard } = fight();
		turnTo('warden');
		place(warden(), { x: 5, y: 4 });
		guard.pos = { x: 6, y: 4 };
		const help = ok(act(room, dee, 'help', guard.id, dice([]))).log;
		expect(texts(help)).toContain('The Warden distracts the Barrow Guard.');
		turnTo('veil');
		place(veil(), { x: 7, y: 4 });
		const { log } = ok(act(room, cam, 'shortsword', guard.id, dice([3, 16])));
		expect(attacks(log)[0]).toMatchObject({ mode: 'advantage' });
		expect(attacks(log)[0].explain).toContain('the target is exposed');
	});
});

describe('cover and damage types', () => {
	it('gives a target behind another creature Half Cover: +2 to its Armor Class', () => {
		const { guard } = fight();
		turnTo('ember');
		place(ember(), { x: 2, y: 4 });
		place(veil(), { x: 4, y: 4 });
		guard.pos = { x: 6, y: 4 };
		const { log } = ok(act(room, ana, 'fire-bolt', guard.id, dice([15])));
		expect(attacks(log)[0]).toMatchObject({ defense: 17 });
		expect(attacks(log)[0].explain).toContain('vs AC 17 (+2, Half Cover)');
		// With a clear line, none.
		turnTo('ember');
		place(veil(), { x: 3, y: 9 });
		const clear = ok(act(room, ana, 'fire-bolt', guard.id, dice([15])));
		expect(attacks(clear.log)[0]).toMatchObject({ defense: 15 });
	});

	it('doubles damage a foe is vulnerable to, and halves what it resists', () => {
		const { guard, shade } = fight();
		turnTo('saint');
		place(saint(), { x: 5, y: 4 });
		guard.pos = { x: 6, y: 4 };
		const hp = room.adventure!.encounter!.enemies.get(guard.id)!.hp;
		const { log } = ok(act(room, ben, 'mace', guard.id, dice([15], [4])));
		const hit = attacks(log)[0];
		expect(hit.damage?.total).toBe(4 + 2);
		expect(hit).toMatchObject({ taken: 12 });
		expect(hit.explain).toContain('vulnerable to bludgeoning: doubled');
		expect(room.adventure!.encounter!.enemies.get(guard.id)!.hp).toBe(hp - 12);

		// The Ember's Fire Bolt on the Cold Shade: Resistance halves it.
		turnTo('ember');
		place(ember(), { x: 10, y: 1 });
		const shadeHp = room.adventure!.encounter!.enemies.get(shade.id)!.hp;
		const bolt = ok(act(room, ana, 'fire-bolt', shade.id, dice([15], [7])));
		expect(attacks(bolt.log)[0]).toMatchObject({ damage: { total: 7 }, taken: 3 });
		expect(room.adventure!.encounter!.enemies.get(shade.id)!.hp).toBe(shadeHp - 3);
	});

	it('gives characters their species’ resistances: the Dwarf Saint halves poison', () => {
		fight();
		expect(status('saint').card.resistances).toEqual(['poison']);
		expect(status('warden').card.resistances).toBeUndefined();
	});
});

describe('the fight kept in a save', () => {
	it('keeps death saves, reactions spent and held, and the turn’s movement', () => {
		const { guard } = fight();
		turnTo('warden');
		ok(act(room, dee, 'dash', null, dice([])));
		ok(editSheet(room, cam, 'veil', { kind: 'reaction', ready: false }));
		room.adventure!.encounter!.reacted = new Set([guard.id, 'saint']);
		ember().state.hp = 0;
		ember().state.deathSaves = { successes: 2, failures: 1 };
		const scene = exportScene(room, 'Cold Hill');
		const back = ok(readAdventure(scene.adventure!, scene)).adventure;
		expect(back.characters.get('ember')).toMatchObject({
			hp: 0,
			deathSaves: { successes: 2, failures: 1 }
		});
		expect(back.characters.get('veil')?.holdReaction).toBe(true);
		expect(back.encounter).toMatchObject({ speed: 12, turnSpeed: 6 });
		expect(back.encounter?.reacted).toEqual(new Set([guard.id, 'saint']));

		// A forged tally is refused.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const forged = structuredClone(scene.adventure!) as any;
		forged.state.characters.ember.deathSaves = { successes: 3, failures: 0 };
		expect(readAdventure(forged, scene).ok).toBe(false);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const stranger = structuredClone(scene.adventure!) as any;
		stranger.state.encounter.reacted = ['nobody'];
		expect(readAdventure(stranger, scene).ok).toBe(false);
	});
});
