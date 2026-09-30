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
	claimCharacter,
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
const texts = (log: ChatMessage[]) => log.map((m) => ('text' in m ? m.text : ''));

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
const put = (token: { pos: GridPos }, at: GridPos) => (token.pos = { ...at });
const view = (who: Player) => adventureView(room, who, new Set(room.tokens.keys()), null)!;
const status = (who: Player, id: string) => view(who).characters.find((c) => c.id === id)!;
const cast = (slot: number | null, targets: string[] = [], at: GridPos | null = null) => ({
	slot,
	targets,
	at
});

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

/** Into the barrow: the guardians wake and the fight is on. Returns the foes' tokens. */
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
	// Everyone else out of the way, lit by a lantern each so nobody fights blind.
	place(veil(), { x: 1, y: 11 });
	place(warden(), { x: 2, y: 11 });
	return { encounter, guard: foe('guard'), shade: foe('shade') };
}

function turnTo(id: string) {
	const encounter = room.adventure!.encounter!;
	encounter.current = encounter.order.findIndex(
		(t) => (t.kind === 'character' ? t.id : t.tokenId) === id
	);
	encounter.acted.clear();
	encounter.speed = 6;
}

describe('fifth edition spells in play', () => {
	it('gives each caster its spells as actions, and the sheet what isn’t cast here', () => {
		const actions = status(ana, 'ember').def.actions.filter((a) => a.cast);
		expect(actions.map((a) => [a.name, a.kind, a.cast!.level, a.cast!.resolves])).toEqual([
			['Fire Bolt', 'attack', 0, '+5 to hit, 1d10 fire'],
			['Ray of Frost', 'attack', 0, '+5 to hit, 1d8 cold'],
			['Shocking Grasp', 'attack', 0, '+5 to hit, 1d8 lightning'],
			['Magic Missile', 'attack', 1, '3 darts of 1d4+1 force, never missing'],
			['Burning Hands', 'attack', 1, 'DC 13 Dexterity save, 3d6 fire, half on a success'],
			[
				'Thunderwave',
				'attack',
				1,
				'DC 13 Constitution save, 2d8 thunder, half on a success, pushed 10 feet'
			],
			['Sleep', 'attack', 1, 'DC 13 Wisdom save, or Incapacitated, then Unconscious']
		]);
		expect(actions.find((a) => a.name === 'Burning Hands')!.cast!.area).toEqual({
			shape: 'cone',
			size: 3
		});
		const saintly = status(ben, 'saint').def.actions.filter((a) => a.cast);
		expect(saintly.map((a) => [a.name, a.kind, a.target, a.cast!.concentration])).toEqual([
			['Bless', 'boon', 'ally', true],
			['Cure Wounds', 'heal', 'ally', false]
		]);
		// Slots are the card's resources, counted by the table.
		expect(status(ana, 'ember').card.resources).toContainEqual({
			id: 'spell-slots-1',
			name: 'Level 1 spell slots',
			max: 2,
			trackedBy: null
		});
	});

	it('casts an attack cantrip: a spell attack roll, no slot spent', () => {
		const { guard } = fight();
		turnTo('ember');
		place(ember(), { x: 5, y: 4 });
		put(guard, { x: 9, y: 4 });
		const { log } = ok(act(room, ana, 'fire-bolt', guard.id, dice([15], [7])));
		const attack = log.find((m) => m.kind === 'attack')!;
		expect(attack).toMatchObject({ attack: 'Fire Bolt', hit: true, defense: 15 });
		expect(attack.kind === 'attack' && attack.toHit.total).toBe(20);
		expect(attack.kind === 'attack' && attack.damage!.total).toBe(7);
		expect(room.adventure!.encounter!.enemies.get(guard.id)!.hp).toBe(25 - 7);
		expect(status(ana, 'ember').resourcesSpent['spell-slots-1']).toBe(0);
	});

	it('spends a slot on a levelled spell, one slot a turn, and none when they are gone', () => {
		const { shade, guard } = fight();
		turnTo('ember');
		place(ember(), { x: 5, y: 4 });
		put(shade, { x: 9, y: 4 });
		// Three darts at the shade: 3d4 + 3, never missing.
		const { log } = ok(act(room, ana, 'magic-missile', shade.id, dice([], [2, 3, 1])));
		expect(texts(log)).toContain('The Cold Shade takes 9 force damage.');
		expect(status(ana, 'ember').resourcesSpent['spell-slots-1']).toBe(1);
		// A second slot the same turn is refused, whatever part of the turn is left.
		room.adventure!.encounter!.acted.delete('ember');
		expect(act(room, ana, 'magic-missile', guard.id, dice([]))).toMatchObject({
			ok: false,
			message: 'The Ember has already spent a spell slot this turn.'
		});
		turnTo('ember');
		ok(act(room, ana, 'magic-missile', guard.id, dice([])));
		expect(status(ana, 'ember').resourcesSpent['spell-slots-1']).toBe(2);
		turnTo('ember');
		expect(act(room, ana, 'magic-missile', guard.id, dice([]))).toMatchObject({
			ok: false,
			message: 'The Ember has no spell slots left for Magic Missile.'
		});
		// A slot above the spell's level it doesn't have.
		expect(act(room, ana, 'magic-missile', guard.id, dice([]), cast(2))).toMatchObject({
			ok: false,
			message: 'The Ember has no level 2 spell slots left.'
		});
	});

	it('burns everyone in a cone: one damage roll, a save each, half on a success', () => {
		const { guard, shade } = fight();
		turnTo('ember');
		place(ember(), { x: 5, y: 4 });
		put(guard, { x: 6, y: 4 });
		put(shade, { x: 8, y: 5 });
		const { log } = ok(
			act(
				room,
				ana,
				'burning-hands',
				null,
				dice([2, 20], [4, 4, 4]),
				cast(null, [], { x: 8, y: 4 })
			)
		);
		const saves = log.filter((m) => m.kind === 'check');
		expect(saves.map((m) => m.kind === 'check' && [m.authorName, m.success, m.dc])).toEqual([
			['Barrow Guard', false, 13],
			['Cold Shade', true, 13]
		]);
		expect(texts(log)).toContain('The Barrow Guard takes 12 fire damage.');
		expect(texts(log)).toContain('The Cold Shade takes 6 fire damage (half, on a save).');
		expect(room.adventure!.encounter!.enemies.get(guard.id)!.hp).toBe(25 - 12);
		expect(room.adventure!.encounter!.enemies.get(shade.id)!.hp).toBe(12 - 6);
	});

	it('pushes those who fail against Thunderwave, not through a wall or someone else', () => {
		const { guard } = fight();
		turnTo('ember');
		place(ember(), { x: 5, y: 4 });
		put(guard, { x: 6, y: 4 });
		const { log } = ok(
			act(room, ana, 'thunderwave', null, dice([1], [3, 3]), cast(null, [], { x: 6, y: 4 }))
		);
		expect(texts(log)).toContain('The Barrow Guard takes 6 thunder damage.');
		expect(texts(log)).toContain('The Barrow Guard is pushed back 10 feet.');
		expect(guard.pos).toEqual({ x: 8, y: 4 });
	});

	it('blesses allies while its caster concentrates, adding a d4 to their attacks', () => {
		const { guard } = fight();
		turnTo('saint');
		place(saint(), { x: 5, y: 4 });
		place(ember(), { x: 5, y: 5 });
		const { log } = ok(
			act(room, ben, 'bless', null, dice([]), cast(null, [saint().token.id, ember().token.id]))
		);
		expect(texts(log)).toContain(
			'Bless on The Saint, The Ember, while The Saint keeps concentrating.'
		);
		expect(status(gm, 'ember').effects).toEqual(['Bless: +1d4 to attack rolls and saves']);
		expect(status(gm, 'saint').concentrating).toBe('Bless');
		expect(status(ben, 'saint').resourcesSpent['spell-slots-1']).toBe(1);

		turnTo('ember');
		put(guard, { x: 9, y: 5 });
		const attack = ok(act(room, ana, 'fire-bolt', guard.id, dice([8], [3, 5]))).log.find(
			(m) => m.kind === 'attack'
		)!;
		// d20 8 + the blessing's 3 + 5 = 16 against Armor Class 15.
		expect(attack.kind === 'attack' && [attack.toHit.total, attack.hit]).toEqual([16, true]);
		expect(attack.kind === 'attack' && attack.explain).toContain('+3 (1d4)');
	});

	it('loses concentration to a failed Constitution save after taking damage', () => {
		const { guard } = fight();
		turnTo('saint');
		place(saint(), { x: 5, y: 4 });
		ok(act(room, ben, 'bless', null, dice([]), cast(null, [saint().token.id])));
		put(guard, { x: 6, y: 4 });
		const encounter = room.adventure!.encounter!;
		turnTo(guard.id);
		const outcome = runEnemyTurn(room, encounter.turn, dice([19, 1], [8, 1]))!;
		expect(texts(outcome.log)).toContain('The Saint loses concentration: Bless ends.');
		expect(status(gm, 'saint').concentrating).toBeNull();
		expect(status(gm, 'saint').effects).toEqual([]);
	});

	it('leaves a Ray of Frost’s chill until the start of its caster’s next turn', () => {
		const { guard } = fight();
		turnTo('ember');
		place(ember(), { x: 5, y: 4 });
		put(guard, { x: 9, y: 4 });
		ok(act(room, ana, 'ray-of-frost', guard.id, dice([15], [4])));
		const enemy = () => view(gm).encounter!.enemies.find((e) => e.tokenId === guard.id)!;
		expect(enemy().effects).toEqual(['Ray of Frost: 10 feet slower']);
		// The Veil goes just before the Ember; when the Veil's turn ends, the Ember's starts.
		const encounter = room.adventure!.encounter!;
		const order = encounter.order.filter(
			(t) => !(t.kind === 'character' && (t.id === 'veil' || t.id === 'ember'))
		);
		const at = (id: string) => encounter.order.find((t) => t.kind === 'character' && t.id === id)!;
		encounter.order = [at('veil'), at('ember'), ...order];
		turnTo('veil');
		expect(enemy().effects).toHaveLength(1);
		ok(endTurn(room, cam));
		expect(view(gm).encounter!.current).toBe(1);
		expect(enemy().effects).toEqual([]);
	});

	it('heals with Cure Wounds outside a fight, and keeps slots spent through a save', () => {
		place(saint(), { x: 7, y: 10 });
		place(warden(), { x: 8, y: 10 });
		warden().state.hp = 1;
		const { log } = ok(act(room, ben, 'cure-wounds', warden().token.id, dice([], [5, 6])));
		// 2d8 + the Saint's Charisma modifier (+3), up to its hit point maximum.
		const healing = log.find((m) => m.kind === 'ability')!;
		expect(healing.kind === 'ability' && healing.roll!.total).toBe(14);
		expect(warden().state.hp).toBe(Math.min(warden().def.hp, 15));
		// Bless needs a fight.
		expect(act(room, ben, 'bless', saint().token.id, dice([]))).toMatchObject({ ok: false });

		const scene = exportScene(room, 'Cold Hill');
		const back = ok(readAdventure(scene.adventure!, scene)).adventure;
		expect(back.characters.get('saint')!.resources!.get('spell-slots-1')).toBe(1);
	});

	it('keeps a fight’s lasting effects through a save, and refuses forged ones', () => {
		const { guard } = fight();
		turnTo('ember');
		place(ember(), { x: 5, y: 4 });
		put(guard, { x: 9, y: 4 });
		ok(act(room, ana, 'ray-of-frost', guard.id, dice([15], [4])));
		const scene = exportScene(room, 'Cold Hill');
		const back = ok(readAdventure(scene.adventure!, scene)).adventure;
		expect(back.effects).toEqual(room.adventure!.effects);

		const forged = structuredClone(scene.adventure!) as unknown as {
			state: { effects: { mods: object; target: string }[] };
		};
		forged.state.effects[0].mods = { defense: 99 };
		expect(readAdventure(forged as never, scene).ok).toBe(false);
		const elsewhere = structuredClone(scene.adventure!) as unknown as typeof forged;
		elsewhere.state.effects[0].target = 'nobody';
		expect(readAdventure(elsewhere as never, scene).ok).toBe(false);
	});
});
