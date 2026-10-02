// SRD monsters at the table (milestone 51): the GM finds them, places them
// for a fight of their own, reads how hard it looks, starts it, and the
// monsters take their turns by the fifth edition rules; all of it kept in a
// save. The Barrow on Cold Hill's hill, outside the barrow.

import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../src/lib/game/chat';
import type { DieRoller } from '../../src/lib/game/dice';
import type { GridPos } from '../../src/lib/game/grid';
import { RoomManager, type Player, type Room } from '../rooms';
import { exportScene } from '../scene-io';
import {
	beginAdventure,
	characterOf,
	claimCharacter,
	direct,
	directorOptions,
	runEnemyTurn,
	searchMonsters,
	startAdventure
} from './engine';
import { readAdventure } from './persist';

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
let dee: Player;

const warden = () => characterOf(room, dee.id)!;
const ember = () => characterOf(room, ana.id)!;
const place = (who: { token: { pos: GridPos } }, at: GridPos) => (who.token.pos = { ...at });
const attacks = (log: readonly ChatMessage[]) =>
	log.flatMap((m) => (m.kind === 'attack' ? [m] : []));
const texts = (log: readonly ChatMessage[]) => log.map((m) => ('text' in m ? m.text : ''));
const tokenNamed = (name: string) => [...room.tokens.values()].filter((t) => t.name === name);
const spawn = (kind: string, pos: GridPos, waiting = true) =>
	direct(room, gm, { op: 'spawn', kind, pos, waiting });

function barrow() {
	const rooms = new RoomManager();
	const created = ok(rooms.create('Gia'));
	room = created.room;
	gm = created.player;
	ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
	dee = ok(rooms.join(room.id, 'Dee', 'player')).player;
	room.dice = () => 10;
	ok(startAdventure(room, gm, 'barrow'));
	ok(claimCharacter(room, ana, 'ember'));
	ok(claimCharacter(room, dee, 'warden'));
	ok(beginAdventure(room, gm, 1000));
	place(warden(), { x: 2, y: 10 });
	place(ember(), { x: 1, y: 11 });
}

beforeEach(barrow);

describe('SRD monsters brought to the table', () => {
	it('lets only the GM search the rules’ bestiary', () => {
		const found = ok(searchMonsters(room, gm, 'goblin')).monsters;
		expect(found.map((m) => m.name)).toContain('Goblin Warrior');
		expect(found[0].source).toMatch(/^SRD 5\.2\.1, Monsters A–Z/);
		expect(searchMonsters(room, ana, 'goblin')).toMatchObject({ ok: false, code: 'forbidden' });
	});

	it('places monsters for the GM’s own fight, held until the GM starts it, with the SRD’s summary', () => {
		ok(spawn('srd-goblin-warrior', { x: 4, y: 10 }));
		ok(spawn('srd-goblin-warrior', { x: 4, y: 11 }));
		ok(spawn('srd-wolf', { x: 5, y: 10 }));
		// In plain sight of the party, and still nobody is spotted.
		expect(room.adventure!.encounter).toBeNull();
		expect(room.adventure!.bestiary).toEqual(['srd-goblin-warrior', 'srd-wolf']);
		expect(tokenNamed('Goblin Warrior')).toHaveLength(2);

		const options = directorOptions(room, room.adventure!);
		expect(options.enemies.map((e) => e.kind)).toEqual(
			expect.arrayContaining(['guard', 'shade', 'srd-goblin-warrior', 'srd-wolf'])
		);
		expect(options.bestiary!.monsters.map((m) => m.name)).toEqual(['Goblin Warrior', 'Wolf']);
		// Two level 1 characters: Low 100, Moderate 150, High 200; three monsters of 50 XP.
		expect(options.bestiary!.summary).toMatchObject({
			xp: 150,
			party: { characters: 2, levels: [1, 1] },
			budgets: [
				{ name: 'Low', xp: 100 },
				{ name: 'Moderate', xp: 150 },
				{ name: 'High', xp: 200 }
			],
			band: 'Moderate',
			monsters: [
				{ name: 'Goblin Warrior', count: 2, xp: 50 },
				{ name: 'Wolf', count: 1, xp: 50 }
			]
		});

		// The GM starts it: initiative for all, the monsters by their SRD bonuses.
		const started = ok(direct(room, gm, { op: 'encounter_start', encounter: 'ambush' }));
		const encounter = room.adventure!.encounter!;
		expect(encounter.id).toBe('ambush');
		expect(encounter.order).toHaveLength(5);
		expect([...encounter.enemies.values()].map((e) => [e.kind, e.hp])).toEqual(
			expect.arrayContaining([
				['srd-goblin-warrior', 10],
				['srd-wolf', 11]
			])
		);
		expect(started.log.length).toBeGreaterThan(0);
		expect(directorOptions(room, room.adventure!).bestiary!.summary!.xp).toBe(150);
	});

	it('brings a monster straight into the fight at hand, and runs its turn by the rules', () => {
		ok(spawn('srd-wolf', { x: 6, y: 10 }));
		ok(direct(room, gm, { op: 'encounter_start', encounter: 'ambush' }));
		const encounter = room.adventure!.encounter!;
		const wolf = tokenNamed('Wolf')[0];
		// The wolf closes in and bites: a hit knocks its target Prone.
		encounter.current = encounter.order.findIndex(
			(t) => t.kind === 'enemy' && t.tokenId === wolf.id
		);
		const turn = runEnemyTurn(room, encounter.turn, dice([15], [3]))!;
		const bite = attacks(turn.log)[0];
		expect(bite).toMatchObject({ authorName: 'Wolf', attack: 'Bite', hit: true });
		expect(bite.damage).toMatchObject({ total: 5 });
		const bitten = [warden(), ember()].find((c) => c.token.id === bite.targetId)!;
		expect(texts(turn.log)).toContain(`${bitten.def.name} is Prone (Bite).`);

		// A Bandit Captain joins mid-fight, and its Multiattack swings twice.
		ok(direct(room, gm, { op: 'spawn', kind: 'srd-bandit-captain', pos: { x: 3, y: 10 } }));
		const captain = tokenNamed('Bandit Captain')[0];
		expect(encounter.order.some((t) => t.kind === 'enemy' && t.tokenId === captain.id)).toBe(true);
		place(warden(), { x: 2, y: 10 });
		warden().state.hp = 30;
		encounter.current = encounter.order.findIndex(
			(t) => t.kind === 'enemy' && t.tokenId === captain.id
		);
		const swings = runEnemyTurn(room, encounter.turn, dice([14, 14], [2, 2]))!;
		expect(attacks(swings.log).map((a) => a.attack)).toEqual(['Scimitar', 'Scimitar']);
	});

	it('plays an SRD monster by its stat block: hit points and attacks as printed', () => {
		ok(spawn('srd-skeleton', { x: 3, y: 10 }));
		ok(direct(room, gm, { op: 'encounter_start', encounter: 'ambush' }));
		const skeleton = tokenNamed('Skeleton')[0];
		const state = room.adventure!.encounter!.enemies.get(skeleton.id)!;
		expect(state.maxHp).toBe(13);
		const content = directorOptions(room, room.adventure!);
		expect(content.bestiary!.monsters[0].attacks).toEqual([
			'Shortsword: +5, reach 5 ft., 1d6+3 piercing',
			'Shortbow: +5, range 80 ft., 1d6+3 piercing'
		]);
	});

	it('keeps the monsters brought in, and the ones held for the GM’s fight, in a save', () => {
		ok(spawn('srd-goblin-warrior', { x: 4, y: 10 }));
		ok(spawn('srd-wolf', { x: 5, y: 10 }));
		const scene = exportScene(room, 'Cold Hill');
		const back = ok(readAdventure(scene.adventure!, scene)).adventure;
		expect(back.bestiary).toEqual(['srd-goblin-warrior', 'srd-wolf']);
		expect([...back.sentries.values()].map((s) => [s.kind, s.waiting])).toEqual([
			['srd-goblin-warrior', true],
			['srd-wolf', true]
		]);

		// And in the fight: its foes' kinds come back with the story's bestiary.
		ok(direct(room, gm, { op: 'encounter_start', encounter: 'ambush' }));
		const mid = exportScene(room, 'Cold Hill');
		const fought = ok(readAdventure(mid.adventure!, mid)).adventure;
		expect([...fought.encounter!.enemies.values()].map((e) => e.kind).sort()).toEqual([
			'srd-goblin-warrior',
			'srd-wolf'
		]);

		// A kind the rules don't play, or one twice, is refused.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const forged = structuredClone(scene.adventure!) as any;
		forged.state.bestiary = ['srd-goblin-warrior', 'srd-archmage'];
		expect(readAdventure(forged, scene).ok).toBe(false);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const twice = structuredClone(scene.adventure!) as any;
		twice.state.bestiary = ['srd-wolf', 'srd-wolf'];
		expect(readAdventure(twice, scene).ok).toBe(false);
	});

	it('leaves stories under the classic rules as they were: no bestiary', () => {
		const rooms = new RoomManager();
		const created = ok(rooms.create('Gia'));
		room = created.room;
		gm = created.player;
		const pip = ok(rooms.join(room.id, 'Pip', 'player')).player;
		ok(startAdventure(room, gm, 'hollow-bell'));
		ok(claimCharacter(room, pip, 'warden'));
		ok(beginAdventure(room, gm, 1000));
		expect(searchMonsters(room, gm, 'wolf')).toMatchObject({ ok: false, code: 'forbidden' });
		expect(directorOptions(room, room.adventure!).bestiary).toBeNull();
		expect(
			direct(room, gm, { op: 'spawn', kind: 'srd-wolf', pos: { x: 10, y: 20 } })
		).toMatchObject({ ok: false, message: 'There is no such enemy in this story.' });
	});
});
