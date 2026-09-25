import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../src/lib/game/chat';
import type { DieRoller } from '../../../src/lib/game/dice';
import type { GridPos } from '../../../src/lib/game/grid';
import { parseSceneFile } from '../../../src/lib/game/scene-file';
import {
	act,
	afterMove,
	beginAdventure,
	characterOf,
	claimCharacter,
	interact,
	runEnemyTurn,
	sense,
	share,
	startAdventure
} from '../../adventure/engine';
import { readAdventure, saveAdventure } from '../../adventure/persist';
import { validateAdventure } from '../../adventure/validate';
import { adventureView } from '../../adventure/view';
import { RoomManager, type Player, type Room } from '../../rooms';
import { rulesProblems } from '../../rules';
import { DND_55E, dnd55e } from '../../rules/dnd55e';
import { exportScene } from '../../scene-io';
import { toggleDoor } from '../../scene';
import { BARROW, BARROW_IDS, CARVINGS_AT, THRESHOLD } from '.';

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}

/** Rolls these, in order, then 10s. */
function dice(...rolls: number[]): DieRoller {
	return () => rolls.shift() ?? 10;
}

function only<K extends ChatMessage['kind']>(log: ChatMessage[], kind: K) {
	return log.filter((m): m is Extract<ChatMessage, { kind: K }> => m.kind === kind);
}

let room: Room;
let gm: Player;
let ana: Player;
let ben: Player;

const veil = () => characterOf(room, ana.id)!;
const warden = () => characterOf(room, ben.id)!;
const place = (who: ReturnType<typeof veil>, at: GridPos) => (who.token.pos = { ...at });

beforeEach(() => {
	const rooms = new RoomManager();
	const created = ok(rooms.create('Gia'));
	room = created.room;
	gm = created.player;
	ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
	ben = ok(rooms.join(room.id, 'Ben', 'player')).player;
	room.dice = () => 10;
	ok(startAdventure(room, gm, 'barrow'));
	ok(claimCharacter(room, ana, 'veil'));
	ok(claimCharacter(room, ben, 'warden'));
	ok(beginAdventure(room, gm, 1000));
});

/** The door studied (or not), forced and opened: the party is at the threshold. */
function open(read: boolean) {
	if (read) {
		place(veil(), { x: CARVINGS_AT.x, y: CARVINGS_AT.y + 1 });
		ok(interact(room, ana, 'carvings', 'examine', dice(10)));
		ok(share(room, ana, 'ward'));
	}
	place(warden(), { x: 7, y: 8 });
	ok(interact(room, ben, 'barrow-door', 'force', dice(12)));
	ok(toggleDoor(room, ben, BARROW_IDS.door));
}

/** Walks the Warden in to wake the guardians: the fight begins, and it is the Warden's turn. */
function fight() {
	open(true);
	place(veil(), { x: 7, y: 7 });
	place(warden(), { x: 9, y: 5 });
	afterMove(room, warden().token, null);
	const encounter = room.adventure!.encounter!;
	expect(encounter.id).toBe('guardians');
	return encounter;
}

function turnTo(id: string) {
	const encounter = room.adventure!.encounter!;
	encounter.current = encounter.order.findIndex(
		(t) => (t.kind === 'character' ? t.id : t.tokenId) === id
	);
	encounter.speed = 6;
}

function foe(kind: string) {
	const encounter = room.adventure!.encounter!;
	const id = [...encounter.enemies].find(([, e]) => e.kind === kind)![0];
	return room.tokens.get(id)!;
}

describe('The Barrow on Cold Hill (fifth edition rules)', () => {
	it('is valid content under its rules, and plays by them', () => {
		expect(validateAdventure(BARROW)).toEqual([]);
		expect(rulesProblems(BARROW)).toEqual([]);
		expect(room.adventure!.rules).toEqual(DND_55E);
	});

	it('shows each player the numbers the rules work out, with the SRD credited', () => {
		place(veil(), { x: CARVINGS_AT.x, y: CARVINGS_AT.y + 1 });
		const view = adventureView(room, ana, new Set(room.tokens.keys()), null)!;
		expect(view.rules).toMatchObject({
			id: 'dnd-5.5e',
			version: 1,
			name: 'Fifth Edition (SRD 5.2.1)'
		});
		expect(view.rules.attribution).toContain('SRD 5.2.1');
		const card = view.characters.find((c) => c.id === 'warden')!.card;
		expect(card).toMatchObject({
			defense: { name: 'Armor Class', value: 18 },
			level: 1,
			proficiency: 2
		});
		expect(card.actions.map((a) => a.partName)).toEqual(['Action', 'Bonus action']);
		const carvings = view.interactables.find((i) => i.id === 'carvings')!;
		// The Veil: Intelligence 12 (+1) and proficient in Investigation (+2).
		expect(carvings.verbs[0].check).toEqual({
			stat: 'investigation',
			dc: 12,
			label: 'Intelligence (Investigation)',
			bonus: 3
		});
	});

	it('resolves an ability check with the skill, and the ward it reads saves the party from the darts', () => {
		place(veil(), { x: CARVINGS_AT.x, y: CARVINGS_AT.y + 1 });
		const { log } = ok(interact(room, ana, 'carvings', 'examine', dice(9)));
		const [check] = only(log, 'check');
		expect(check).toMatchObject({
			stat: 'Intelligence (Investigation)',
			roll: { expression: '1d20+3', total: 12 },
			dc: 12,
			success: true,
			explain: 'd20 9 +3 = 12 vs DC 12: success'
		});
		// Found alone, the ward is the Veil's to share; shared, the party knows it.
		expect(room.adventure!.events).not.toContain('read_ward');
		ok(share(room, ana, 'ward'));
		expect(room.adventure!.events).toContain('read_ward');

		place(warden(), { x: 7, y: 8 });
		const forced = ok(interact(room, ben, 'barrow-door', 'force', dice(8)));
		expect(only(forced.log, 'check')[0]).toMatchObject({
			stat: 'Strength (Athletics)',
			success: true
		});
		expect(room.adventure!.chapter).toBe('inside');
		ok(toggleDoor(room, ben, BARROW_IDS.door));
		place(warden(), THRESHOLD);
		const stepped = afterMove(room, warden().token, null);
		expect(only(stepped.log, 'check')).toEqual([]);
		expect(warden().state.hp).toBe(12);
	});

	it('makes whoever crosses the threshold unwarned roll a Dexterity save, half damage on a success', () => {
		open(false);
		place(veil(), { x: 8, y: 9 });
		place(warden(), THRESHOLD);
		// For each in the party's order, the darts (2d6: 4 and 4), then the save. The Warden
		// rolls a 2 (+1 = 3: failed); the Veil, beside the door outside, an 11 (+5 = 16: made it).
		room.dice = dice(4, 4, 2, 4, 4, 11);
		const { log } = afterMove(room, warden().token, null);
		const [failed, made] = only(log, 'check');
		expect(failed).toMatchObject({
			authorName: 'The Warden',
			stat: 'Dexterity saving throw',
			save: true,
			dc: 12,
			success: false,
			roll: { total: 3 }
		});
		expect(made).toMatchObject({ authorName: 'The Veil', success: true, roll: { total: 16 } });
		expect(warden().state.hp).toBe(12 - 8);
		expect(veil().state.hp).toBe(10 - 4);
	});

	it('fails a check that needs sight in the dark, where a lantern would have let it pass', () => {
		place(veil(), { x: CARVINGS_AT.x, y: CARVINGS_AT.y + 1 });
		room.ambient = 'dark';
		const { log } = ok(interact(room, ana, 'carvings', 'examine', dice(20)));
		const [check] = only(log, 'check');
		expect(check).toMatchObject({ success: false, roll: { total: 23 } });
		expect(check.explain).toContain('in darkness, a check that needs sight fails');
		// Listening needs no light: the Veil hears what breathes behind the door.
		place(veil(), { x: 7, y: 8 });
		const heard = ok(sense(room, ana, 'listen', dice(15)));
		expect(only(heard.log, 'check')[0]).toMatchObject({
			stat: 'Wisdom (Perception)',
			success: true
		});
	});

	it('attacks against Armor Class with the ability and proficiency, and crits on a 20', () => {
		fight();
		turnTo('warden');
		const guard = foe('guard');
		place(warden(), { x: guard.pos.x - 1, y: guard.pos.y });
		const { log } = ok(act(room, ben, 'longsword', guard.id, dice(20, 3, 4)));
		const [attack] = only(log, 'attack');
		expect(attack).toMatchObject({
			attack: 'Longsword',
			defense: 15,
			hit: true,
			critical: true,
			toHit: { expression: '1d20+5', total: 25 },
			damage: { expression: '2d8+3', total: 10 }
		});
		expect(attack.explain).toContain('critical hit');
	});

	it('takes an action and a bonus action a turn, and no second action', () => {
		fight();
		turnTo('warden');
		const guard = foe('guard');
		place(warden(), { x: guard.pos.x - 1, y: guard.pos.y });
		warden().state.hp = 4;
		ok(act(room, ben, 'longsword', guard.id, dice(2)));
		expect(act(room, ben, 'longsword', guard.id, dice(2))).toMatchObject({
			ok: false,
			message: 'The Warden has already acted this turn.'
		});
		const healed = ok(act(room, ben, 'second-wind', null, dice(6)));
		expect(only(healed.log, 'ability')[0]).toMatchObject({ ability: 'Second Wind', amount: 7 });
		expect(warden().state.hp).toBe(11);
		expect(act(room, ben, 'second-wind', null, dice(6))).toMatchObject({
			ok: false,
			message: 'The Warden has already used this turn’s bonus action.'.replace('’', "'")
		});
		const view = adventureView(room, ben, new Set(room.tokens.keys()), null)!;
		expect(view.characters.find((c) => c.id === 'warden')!.spent).toEqual(['action', 'bonus']);
	});

	it('gives an archer with a foe beside it disadvantage', () => {
		fight();
		turnTo('veil');
		const guard = foe('guard');
		const shade = foe('shade');
		guard.pos = { x: 7, y: 3 };
		place(veil(), { x: 7, y: 4 });
		place(warden(), { x: 3, y: 6 });
		shade.pos = { x: 10, y: 4 };
		room.lights.set('lamp', {
			id: 'lamp',
			pos: { x: 8, y: 4 },
			radius: 6,
			color: '#fff',
			on: true
		});
		const { log } = ok(act(room, ana, 'shortbow', shade.id, dice(18, 5)));
		const [attack] = only(log, 'attack');
		expect(attack).toMatchObject({
			mode: 'disadvantage',
			toHit: { expression: '2d20kl1+5', total: 10 }
		});
		expect(attack.explain).toContain('ranged, with a foe beside');
	});

	it('has the Cold Shade’s chill call for a Constitution save', () => {
		fight();
		const shade = foe('shade');
		const guard = foe('guard');
		guard.pos = { x: 12, y: 2 };
		place(warden(), { x: 3, y: 5 });
		place(veil(), { x: 6, y: 5 });
		shade.pos = { x: 9, y: 5 };
		room.lights.set('lamp', {
			id: 'lamp',
			pos: { x: 7, y: 5 },
			radius: 6,
			color: '#fff',
			on: true
		});
		turnTo(shade.id);
		const encounter = room.adventure!.encounter!;
		// The Veil's save (d20 3 +2 = 5: failed), then the chill's damage (2d6: 5 and 5).
		const outcome = runEnemyTurn(room, encounter.turn, dice(3, 5, 5))!;
		const [save] = only(outcome.log, 'check');
		expect(save).toMatchObject({
			authorName: 'The Veil',
			action: 'Cold Shade: Grave chill',
			stat: 'Constitution saving throw',
			save: true,
			success: false
		});
		expect(only(outcome.log, 'ability')[0]).toMatchObject({ ability: 'Grave chill', amount: -10 });
		expect(veil().state.hp).toBe(0);
	});

	it('saves mid-fight with a bonus action spent, and reads it back', () => {
		fight();
		turnTo('warden');
		warden().state.hp = 4;
		ok(act(room, ben, 'second-wind', null, dice(6)));
		const parsed = parseSceneFile(JSON.parse(JSON.stringify(exportScene(room, 'Barrow'))));
		if (!parsed.ok) throw new Error(parsed.error);
		const read = readAdventure(parsed.scene.adventure!, parsed.scene);
		if (!read.ok) throw new Error(read.error);
		expect(read.adventure.rules).toEqual(DND_55E);
		expect([...read.adventure.encounter!.acted]).toEqual(['warden:bonus']);
		expect(saveAdventure(read.adventure)).toEqual(saveAdventure(room.adventure!));
	});

	it('carries the SRD’s credit in every save and exported table, as the licence requires', () => {
		const exported = exportScene(room, 'Barrow');
		expect(exported.adventure!.state.credits).toEqual([dnd55e.attribution]);
		// A story under rules that need no credit carries none.
		const rooms = new RoomManager();
		const created = ok(rooms.create('Gia'));
		ok(startAdventure(created.room, created.player));
		expect(exportScene(created.room, 'Bellweather').adventure!.state).not.toHaveProperty('credits');
	});
});
