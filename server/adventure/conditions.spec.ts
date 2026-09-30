import { beforeEach, describe, expect, it } from 'vitest';
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
	buildCharacter,
	checkMove,
	endTurn,
	interact,
	ruleEffect,
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

const srd = (kind: string, slug: string) => `srd-5.2.1:${kind}:${slug}`;
/** A level 1 Dwarf Wizard a player built, with the enchantments and the sickness of this milestone. */
const wizard = () => ({
	name: 'Wren',
	color: '#17a589',
	species: { id: srd('species', 'dwarf'), options: {}, feat: null },
	background: { id: srd('background', 'sage'), increases: { int: 2, con: 1 } },
	class: {
		id: srd('class', 'wizard'),
		skills: ['insight', 'investigation'],
		expertise: [],
		fightingStyle: null,
		weaponMasteries: []
	},
	abilities: {
		method: 'standard-array',
		base: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }
	},
	armor: { worn: null, shield: false },
	weapons: [srd('weapon', 'dagger')],
	spells: {
		cantrips: [
			srd('spell', 'fire-bolt'),
			srd('spell', 'ray-of-frost'),
			srd('spell', 'chill-touch')
		],
		prepared: [
			srd('spell', 'ray-of-sickness'),
			srd('spell', 'hideous-laughter'),
			srd('spell', 'sleep'),
			srd('spell', 'magic-missile')
		]
	}
});

let room: Room;
let gm: Player;
let ana: Player;
let ben: Player;
let cam: Player;
let dee: Player;
let eve: Player;

const ember = () => characterOf(room, ana.id)!;
const saint = () => characterOf(room, ben.id)!;
const veil = () => characterOf(room, cam.id)!;
const warden = () => characterOf(room, dee.id)!;
const wren = () => characterOf(room, eve.id)!;
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
	eve = ok(rooms.join(room.id, 'Eve', 'player')).player;
	ok(buildCharacter(room, eve, wizard()));
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

const enemyView = (tokenId: string) =>
	view(gm).encounter!.enemies.find((e) => e.tokenId === tokenId)!;
const conditionIds = (marks: { id: string }[]) => marks.map((m) => m.id);
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

describe('conditions and lasting effects', () => {
	it('poisons with Ray of Sickness until the end of its caster’s next turn, hindering the foe’s attacks', () => {
		const { guard } = fight();
		turnTo('pc-1');
		place(wren(), { x: 5, y: 4 });
		put(guard, { x: 6, y: 4 });
		ok(act(room, eve, 'ray-of-sickness', guard.id, dice([15], [5, 5])));
		expect(conditionIds(enemyView(guard.id).conditions)).toEqual(['poisoned']);
		expect(enemyView(guard.id).conditions[0]).toMatchObject({
			name: 'Poisoned',
			from: 'Ray of Sickness, from Wren',
			until: "until the end of Wren's next turn"
		});
		expect(enemyView(guard.id).conditions[0].text).toContain('Disadvantage on attack rolls');

		// Its blade comes at Wren with Disadvantage.
		turnTo(guard.id);
		const turn = runEnemyTurn(room, room.adventure!.encounter!.turn, dice([18, 3], [4]))!;
		const attack = turn.log.find((m) => m.kind === 'attack')!;
		expect(attack.kind === 'attack' && attack.explain).toContain('poisoned attacker');
		expect(attack.kind === 'attack' && attack.mode).toBe('disadvantage');

		// Wren's next turn starts, then ends: the poison is gone.
		nextUp('veil', 'pc-1');
		ok(endTurn(room, cam));
		expect(conditionIds(enemyView(guard.id).conditions)).toEqual(['poisoned']);
		ok(endTurn(room, eve));
		expect(enemyView(guard.id).conditions).toEqual([]);
	});

	it('lays a foe out laughing: Prone and Incapacitated, a save at the end of its turns and when hurt', () => {
		const { guard } = fight();
		turnTo('pc-1');
		place(wren(), { x: 5, y: 4 });
		put(guard, { x: 7, y: 4 });
		// Wisdom +0: 5 fails DC 13.
		const { log } = ok(act(room, eve, 'hideous-laughter', guard.id, dice([5])));
		expect(log.map((m) => ('text' in m ? m.text : ''))).toContain(
			'The Barrow Guard is Prone and Incapacitated (Hideous Laughter).'
		);
		expect(status(gm, 'pc-1').concentrating).toBe('Hideous Laughter');

		// Its turn: it can't act; at the end, it saves again (the room's dice: 10, a failure).
		turnTo(guard.id);
		const turn = runEnemyTurn(room, room.adventure!.encounter!.turn, dice([]))!;
		const texts = turn.log.map((m) => ('text' in m ? m.text : ''));
		expect(texts).toContain('The Barrow Guard is Incapacitated and loses its turn.');
		expect(turn.log.some((m) => m.kind === 'check' && m.action === 'Hideous Laughter')).toBe(true);
		expect(conditionIds(enemyView(guard.id).conditions)).toEqual(['prone', 'incapacitated']);

		// The Warden beside it strikes with Advantage (Prone, within 5 feet); hurt, it saves with Advantage.
		turnTo('warden');
		place(warden(), { x: 6, y: 5 });
		const hit = ok(act(room, dee, 'longsword', guard.id, dice([15, 14, 20, 3], [4])));
		const attack = hit.log.find((m) => m.kind === 'attack')!;
		expect(attack.kind === 'attack' && [attack.mode, attack.hit]).toEqual(['advantage', true]);
		const save = hit.log.find((m) => m.kind === 'check')!;
		expect(save.kind === 'check' && [save.mode, save.success]).toEqual(['advantage', true]);
		expect(enemyView(guard.id).conditions).toEqual([]);
	});

	it('puts foes to sleep: Incapacitated, then Unconscious; a hit from beside is critical and wakes it, Prone', () => {
		const { guard, shade } = fight();
		turnTo('ember');
		place(ember(), { x: 3, y: 4 });
		put(guard, { x: 7, y: 4 });
		put(shade, { x: 7, y: 5 });
		place(warden(), { x: 8, y: 4 });
		// Only foes are caught, and the Shade, which doesn't sleep, shrugs it off.
		const { log } = ok(act(room, ana, 'sleep', null, dice([2]), cast(null, [], { x: 7, y: 4 })));
		const texts = log.map((m) => ('text' in m ? m.text : ''));
		expect(texts).toContain('The Cold Shade doesn’t sleep.');
		expect(texts).toContain('The Barrow Guard is Incapacitated (Sleep).');
		expect(status(gm, 'warden').conditions).toEqual([]);

		// A failed save at the end of its turn: Unconscious for the spell's duration.
		turnTo(guard.id);
		const turn = runEnemyTurn(room, room.adventure!.encounter!.turn, dice([]))!;
		expect(turn.log.map((m) => ('text' in m ? m.text : ''))).toContain(
			'The Barrow Guard is Unconscious (Sleep).'
		);
		expect(conditionIds(enemyView(guard.id).conditions)).toEqual(['unconscious']);

		// The Warden's blade from beside it: a critical hit, and the Guard wakes, still Prone.
		turnTo('warden');
		const hit = ok(act(room, dee, 'longsword', guard.id, dice([12, 11], [3, 3])));
		const attack = hit.log.find((m) => m.kind === 'attack')!;
		expect(attack.kind === 'attack' && [attack.hit, attack.critical]).toEqual([true, true]);
		expect(hit.log.map((m) => ('text' in m ? m.text : ''))).toContain(
			'The Barrow Guard is jolted out of Sleep.'
		);
		expect(conditionIds(enemyView(guard.id).conditions)).toEqual(['prone']);
		// On its turn it gets up, spending half its movement.
		turnTo(guard.id);
		const up = runEnemyTurn(room, room.adventure!.encounter!.turn, dice([1]))!;
		expect(up.log.map((m) => ('text' in m ? m.text : ''))).toContain(
			'The Barrow Guard gets up, spending half its movement.'
		);
	});

	it('frightens with the Cold Shade’s chill: no step closer, attacks hindered while it is in sight', () => {
		const { guard, shade } = fight();
		put(guard, { x: 12, y: 10 });
		place(warden(), { x: 5, y: 4 });
		put(shade, { x: 9, y: 4 });
		place(ember(), { x: 1, y: 10 });
		turnTo(shade.id);
		// A failed Constitution save (d20 1): the chill's damage, and Frightened of the Shade.
		const turn = runEnemyTurn(room, room.adventure!.encounter!.turn, dice([1], [3, 3]))!;
		expect(turn.log.map((m) => ('text' in m ? m.text : ''))).toContain(
			'The Warden is Frightened (Grave chill).'
		);
		expect(status(gm, 'warden').conditions[0]).toMatchObject({
			name: 'Frightened',
			from: 'Grave chill, from the Cold Shade'
		});
		turnTo('warden');
		expect(checkMove(room, dee, warden().token.id, { x: 6, y: 4 })).toMatchObject({
			ok: false,
			message: 'The Warden is too frightened to move closer to the Cold Shade.'
		});
		expect(checkMove(room, dee, warden().token.id, { x: 4, y: 4 }).ok).toBe(true);
		// The Warden's crossbow-less arm: its longsword can't reach, so check the rules directly by moving the Shade beside.
		put(shade, { x: 6, y: 4 });
		const hit = ok(act(room, dee, 'longsword', shade.id, dice([15, 4], [4])));
		const attack = hit.log.find((m) => m.kind === 'attack')!;
		expect(attack.kind === 'attack' && attack.explain).toContain('frightened attacker');
	});

	it('lets the GM rule: a condition for some rounds or until removed, refreshed, stacked, refused where immune', () => {
		const { guard, shade } = fight();
		turnTo('saint');
		place(saint(), { x: 5, y: 4 });
		ok(act(room, ben, 'bless', null, dice([]), cast(null, [saint().token.id])));
		// Stunned: Incapacitated, so the Saint's concentration breaks and it can't act.
		const stun = ok(
			ruleEffect(room, gm, {
				kind: 'apply',
				target: saint().token.id,
				condition: 'stunned',
				rounds: 1
			})
		);
		expect(stun.log.map((m) => ('text' in m ? m.text : ''))).toEqual([
			'The Saint is Stunned.',
			'The Saint loses concentration: Bless ends.'
		]);
		expect(act(room, ben, 'mace', guard.id, dice([]))).toMatchObject({
			ok: false,
			message: 'The Saint is Stunned.'
		});
		expect(status(gm, 'saint').conditions[0].until).toBe(
			"until the start of The Saint's next turn"
		);
		// Only the GM rules.
		expect(
			ruleEffect(room, ana, { kind: 'apply', target: guard.id, condition: 'prone', rounds: null })
		).toMatchObject({ ok: false, code: 'forbidden' });
		// The Shade can't be poisoned; the same ruling twice is one effect; Exhaustion counts levels.
		expect(
			ok(
				ruleEffect(room, gm, {
					kind: 'apply',
					target: shade.id,
					condition: 'poisoned',
					rounds: null
				})
			).log.map((m) => ('text' in m ? m.text : ''))
		).toEqual(['The Cold Shade is immune to Poisoned.']);
		ok(
			ruleEffect(room, gm, { kind: 'apply', target: guard.id, condition: 'poisoned', rounds: null })
		);
		ok(
			ruleEffect(room, gm, { kind: 'apply', target: guard.id, condition: 'poisoned', rounds: null })
		);
		expect(conditionIds(enemyView(guard.id).conditions)).toEqual(['poisoned']);
		ok(
			ruleEffect(room, gm, {
				kind: 'apply',
				target: warden().token.id,
				condition: 'exhaustion',
				rounds: null
			})
		);
		ok(
			ruleEffect(room, gm, {
				kind: 'apply',
				target: warden().token.id,
				condition: 'exhaustion',
				rounds: null
			})
		);
		expect(status(gm, 'warden').conditions).toMatchObject([{ id: 'exhaustion', level: 2 }]);
		// Removed by its id.
		const fx = enemyView(guard.id).conditions[0].effect;
		ok(ruleEffect(room, gm, { kind: 'remove', effect: fx }));
		expect(enemyView(guard.id).conditions).toEqual([]);
		// A GM's condition outlasts the fight; a spell's doesn't.
	});

	it('keeps every lasting effect through a save and a restart, the M48 ones too, and refuses a forged one', () => {
		const { guard } = fight();
		turnTo('pc-1');
		place(wren(), { x: 5, y: 4 });
		put(guard, { x: 7, y: 4 });
		ok(act(room, eve, 'hideous-laughter', guard.id, dice([5])));
		ok(
			ruleEffect(room, gm, {
				kind: 'apply',
				target: warden().token.id,
				condition: 'blinded',
				rounds: 3
			})
		);
		const scene = exportScene(room, 'Cold Hill');
		const back = ok(readAdventure(scene.adventure!, scene)).adventure;
		expect(back.effects).toEqual(room.adventure!.effects);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		type Raw = { state: Record<string, any> };
		const raw = () => structuredClone(scene.adventure!) as unknown as Raw;
		const forged = raw();
		forged.state.effects[0].mods.conditions = ['petrified-forever'];
		expect(readAdventure(forged as never, scene).ok).toBe(false);
		const nobody = raw();
		nobody.state.effects[1].source = { kind: 'enemy', id: 'nobody', name: 'x' };
		expect(readAdventure(nobody as never, scene).ok).toBe(false);
		// Milestone 48 kept a spell's effects on the fight, with the caster's id as its source.
		const old = raw();
		old.state.encounter.effects = [
			{
				...old.state.effects[0],
				source: 'ember',
				repeat: undefined,
				sourceToken: undefined,
				mods: { slow: 2 },
				name: 'Ray of Frost',
				ends: { at: 'start', turns: 1 },
				concentration: false
			}
		].map((e) => JSON.parse(JSON.stringify(e)));
		delete old.state.effects;
		const read = ok(readAdventure(old as never, scene)).adventure;
		expect(read.effects).toMatchObject([
			{
				name: 'Ray of Frost',
				source: { kind: 'character', id: 'ember', name: 'The Ember' },
				mods: { slow: 2 }
			}
		]);
	});
});
