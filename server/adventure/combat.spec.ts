import { beforeEach, describe, expect, it } from 'vitest';
import { CHARACTERS, type CharacterId } from '../../src/lib/adventure/characters';
import type { ChatMessage } from '../../src/lib/game/chat';
import type { DieRoller } from '../../src/lib/game/dice';
import type { GridPos } from '../../src/lib/game/grid';
import { parseSceneFile } from '../../src/lib/game/scene-file';
import { RoomManager, type Player, type Room } from '../rooms';
import { exportScene } from '../scene-io';
import {
	act,
	afterTokenDeleted,
	beginAdventure,
	characterOf,
	claimCharacter,
	endTurn,
	pendingEnemyTurn,
	runEnemyTurn,
	startAdventure,
	startEncounter
} from './engine';
import type { EnemyKind } from './enemies';
import { readAdventure, saveAdventure } from './persist';
import { adventureView } from './view';

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

/** The Warden (Ana) and the Saint (Ben) side by side in Bellweather's square. */
beforeEach(() => {
	const rooms = new RoomManager();
	const created = ok(rooms.create('Gia'));
	room = created.room;
	gm = created.player;
	ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
	ben = ok(rooms.join(room.id, 'Ben', 'player')).player;
	room.dice = max;
	ok(startAdventure(room, gm));
	ok(claimCharacter(room, ana, 'warden'));
	ok(claimCharacter(room, ben, 'saint'));
	ok(beginAdventure(room, gm, 1000));
	put(warden().token.id, { x: 13, y: 16 });
	put(saint().token.id, { x: 12, y: 16 });
});

const story = () => room.adventure!;
const warden = () => characterOf(room, ana.id)!;
const saint = () => characterOf(room, ben.id)!;
const put = (tokenId: string, pos: GridPos) => {
	room.tokens.get(tokenId)!.pos = { ...pos };
};
/** The fight's enemies of a kind, by token id. */
const foes = (kind: EnemyKind) =>
	[...story().encounter!.enemies].filter(([, e]) => e.kind === kind).map(([id]) => id);
/** Leaves only the given enemies in the fight (the rest are removed as if by the GM). */
const only = (...keep: string[]) => {
	for (const id of [...story().encounter!.enemies.keys()]) {
		if (keep.includes(id)) continue;
		room.tokens.delete(id);
		afterTokenDeleted(room, id);
	}
};
/** Makes it this enemy's turn and runs it. */
const enemyTurn = (tokenId: string, roller: DieRoller = max) => {
	const encounter = story().encounter!;
	encounter.current = encounter.order.findIndex((t) => t.kind === 'enemy' && t.tokenId === tokenId);
	return runEnemyTurn(room, encounter.turn, roller)!;
};
const turnTo = (id: CharacterId) => {
	const encounter = story().encounter!;
	encounter.current = encounter.order.findIndex((t) => t.kind === 'character' && t.id === id);
	encounter.speed = CHARACTERS[id].speed;
};
const texts = (log: ChatMessage[]) => log.flatMap((m) => ('text' in m ? [m.text] : []));

describe('initiative', () => {
	it('orders everyone by a server roll, characters first on a tie, and starts with the first', () => {
		const started = startEncounter(room, story(), 'hollow');
		const encounter = story().encounter!;
		// d20 at its highest: cultists 21, the Warden and the Saint 20, the Keeper 20.
		expect(encounter.order.map((t) => (t.kind === 'character' ? t.id : 'enemy'))).toEqual([
			'enemy',
			'enemy',
			'warden',
			'saint',
			'enemy'
		]);
		expect(encounter.order.map((t) => t.initiative)).toEqual([21, 21, 20, 20, 20]);
		expect(texts(started.log)).toContain(
			'Initiative: Bell Cultist 21, Bell Cultist 21, The Warden 20, The Saint 20, Bell Keeper 20. Round 1.'
		);
		expect(encounter.current).toBe(0);
		expect(started.enemyTurn).toBe(encounter.turn);
		expect(pendingEnemyTurn(story())).toBe(encounter.turn);

		// Everyone sees the same order; enemies they can't see keep their names but not their tokens.
		const all = new Set(room.tokens.keys());
		const seen = adventureView(room, ana, all, null)!.encounter!;
		expect(seen.order.map((t) => t.name)).toEqual([
			'Bell Cultist',
			'Bell Cultist',
			'The Warden',
			'The Saint',
			'Bell Keeper'
		]);
		expect(seen.current).toBe(0);
		const blind = adventureView(room, ana, new Set([warden().token.id]), null)!.encounter!;
		expect(blind.order[0]).toMatchObject({ name: 'Bell Cultist', tokenId: null });
		expect(blind.order[2]).toMatchObject({ tokenId: warden().token.id, out: false });
	});

	it('skips the fallen, and bleeds the downed at their turn', () => {
		startEncounter(room, story(), 'hollow');
		const [keeper] = foes('keeper');
		only(keeper);
		saint().state.hp = 0;
		// The Keeper is far off: its turn passes to the Warden; the Saint's is skipped as it bleeds.
		put(keeper, { x: 24, y: 22 });
		turnTo('warden');
		const passed = ok(endTurn(room, ana));
		expect(texts(passed.log)).toContain('The Saint is bleeding out: 2 more turns to save them.');
		expect(saint().state.downedFor).toBe(1);
		expect(passed.enemyTurn).toBe(story().encounter!.turn);
	});
});

describe('the Bell Cultist', () => {
	it('slings from where it stands when someone is in range and in sight', () => {
		startEncounter(room, story(), 'hollow');
		const [cultist] = foes('cultist');
		only(cultist);
		put(cultist, { x: 17, y: 16 });
		const out = enemyTurn(cultist);
		expect(room.tokens.get(cultist)!.pos).toEqual({ x: 17, y: 16 });
		expect(out.log[0]).toMatchObject({ kind: 'attack', attack: 'Sling', targetName: 'The Warden' });
		// 1d4+1 at its highest.
		expect(warden().state.hp).toBe(CHARACTERS.warden.hp - 5);
	});

	it('draws its knife on whoever stands beside it, the weakest first', () => {
		startEncounter(room, story(), 'hollow');
		const [cultist] = foes('cultist');
		only(cultist);
		put(cultist, { x: 13, y: 15 });
		saint().state.hp = 4;
		const out = enemyTurn(cultist);
		expect(out.log[0]).toMatchObject({ attack: 'Ritual knife', targetName: 'The Saint' });
	});

	it('closes in until it has a shot, then takes it', () => {
		startEncounter(room, story(), 'hollow');
		const [cultist] = foes('cultist');
		only(cultist);
		put(cultist, { x: 22, y: 16 });
		const out = enemyTurn(cultist);
		const pos = room.tokens.get(cultist)!.pos;
		// It walked no further than it had to: now five cells or less from its mark.
		expect(pos).not.toEqual({ x: 22, y: 16 });
		expect(Math.max(Math.abs(pos.x - 13), Math.abs(pos.y - 16))).toBeLessThanOrEqual(5);
		expect(out.log[0]).toMatchObject({ attack: 'Sling' });
	});
});

describe('the Bell Keeper', () => {
	it('tolls when the party crowds it, rests a turn, then hammers', () => {
		startEncounter(room, story(), 'hollow');
		const [keeper] = foes('keeper');
		only(keeper);
		put(keeper, { x: 13, y: 14 });
		const tolled = enemyTurn(keeper);
		expect(tolled.log[0]).toMatchObject({ kind: 'ability', ability: 'Toll', amount: -4 });
		expect(warden().state.hp).toBe(CHARACTERS.warden.hp - 4);
		expect(saint().state.hp).toBe(CHARACTERS.saint.hp - 4);
		expect(saint().state.statuses.get('slowed')).toBe(1);

		// The Warden is next: slowed, it has half its speed this turn, and then the slow is gone.
		const encounter = story().encounter!;
		expect(encounter.order[encounter.current]).toMatchObject({ id: 'warden' });
		expect(encounter.speed).toBe(Math.floor(CHARACTERS.warden.speed / 2));
		expect(warden().state.statuses.has('slowed')).toBe(false);

		// Its next turn it must rest: the hammer instead (1d10+2 at its highest).
		const hammered = enemyTurn(keeper);
		expect(hammered.log[0]).toMatchObject({ kind: 'attack', attack: 'Bell hammer' });
		// And the turn after, it tolls again.
		expect(enemyTurn(keeper, min).log[0]).toMatchObject({ ability: 'Toll' });
	});

	it('is hard to hit and survives a blow', () => {
		startEncounter(room, story(), 'hollow');
		const [keeper] = foes('keeper');
		only(keeper);
		put(keeper, { x: 14, y: 16 });
		turnTo('warden');
		const blow = ok(act(room, ana, 'blade', keeper, max));
		expect(blow.log[0]).toMatchObject({
			kind: 'attack',
			defense: 14,
			hit: true,
			damage: { total: 11 }
		});
		expect(story().encounter!.enemies.get(keeper)!.hp).toBe(40 - 11);
	});
});

describe('the fight’s turns', () => {
	it('passes the turn on when the enemy whose turn it is is removed', () => {
		startEncounter(room, story(), 'hollow');
		const [first] = story().encounter!.order;
		const turn = story().encounter!.turn;
		if (first.kind !== 'enemy') throw new Error('an enemy should lead');
		room.tokens.delete(first.tokenId);
		const out = afterTokenDeleted(room, first.tokenId);
		expect(runEnemyTurn(room, turn, max)).toBeNull();
		// The other cultist is up next.
		expect(out.enemyTurn).toBe(story().encounter!.turn);
		expect(story().encounter!.order).toHaveLength(4);
	});

	it('lets burning finish an enemy on its own turn, and moves on', () => {
		startEncounter(room, story(), 'hollow');
		const [cultist] = foes('cultist');
		const enemy = story().encounter!.enemies.get(cultist)!;
		enemy.hp = 2;
		enemy.statuses.set('burning', 1);
		const out = enemyTurn(cultist);
		expect(out.log[0]).toMatchObject({
			ability: 'Burning',
			text: 'The Bell Cultist burns away to ash.'
		});
		expect(story().encounter!.enemies.has(cultist)).toBe(false);
		expect(story().encounter!.order.some((t) => t.kind === 'enemy' && t.tokenId === cultist)).toBe(
			false
		);
	});

	it('saves the turn order mid-fight and reads it back, and reads saves from before initiative', () => {
		startEncounter(room, story(), 'hollow');
		const [keeper] = foes('keeper');
		story().encounter!.enemies.get(keeper)!.rest = 1;
		const file = parseSceneFile(JSON.parse(JSON.stringify(exportScene(room, 'Mid-fight'))));
		if (!file.ok) throw new Error(file.error);
		const read = readAdventure(file.scene.adventure!, file.scene);
		if (!read.ok) throw new Error(read.error);
		expect(saveAdventure(read.adventure)).toEqual(saveAdventure(story()));
		expect(pendingEnemyTurn(read.adventure)).toBe(story().encounter!.turn);

		// An older save: a players' phase, no order.
		const saved = file.scene.adventure!;
		const fight = saved.state.encounter as Record<string, unknown>;
		const old = {
			...saved,
			state: {
				...saved.state,
				encounter: {
					id: fight.id,
					round: 2,
					phase: 'players',
					acted: [],
					moved: {},
					enemies: fight.enemies,
					turn: 7
				}
			}
		};
		const migrated = readAdventure(old, file.scene);
		if (!migrated.ok) throw new Error(migrated.error);
		expect(migrated.adventure.encounter).toMatchObject({ round: 2, current: 0, speed: 5 });
		expect(migrated.adventure.encounter!.order.slice(0, 2)).toEqual([
			{ kind: 'character', id: 'warden', initiative: 0 },
			{ kind: 'character', id: 'saint', initiative: 0 }
		]);

		// A turn order naming someone who isn't in the fight is refused.
		const tampered = {
			...saved,
			state: {
				...saved.state,
				encounter: { ...fight, order: [{ enemy: 'nobody', initiative: 3 }] }
			}
		};
		expect(readAdventure(tampered, file.scene)).toMatchObject({ ok: false });
	});
});
