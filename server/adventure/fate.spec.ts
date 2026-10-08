// The second rules system (milestone 60): The Drowned Lantern, an adventure
// file under Fate Condensed, plays on the same engine as the fifth edition
// and classic stories: an overcome on the ladder, a conflict where the
// defender rolls, elective turns (whoever acts picks who goes next), stress
// and consequences, through a save; and its characters and saves stay bound
// to their rules.

import { beforeEach, describe, expect, it } from 'vitest';
import { fateExampleAdventure, FATE_EXAMPLE_TITLE } from '../../src/lib/adventure/fate-example';
import { exampleAdventure } from '../../src/lib/adventure/example';
import type { DieRoller } from '../../src/lib/game/dice';
import { parseSceneFile } from '../../src/lib/game/scene-file';
import { FATE_PREGENS, FATE_RULES } from '../../src/lib/rules/fate/core';
import { DND_PREGENS } from '../../src/lib/rules/dnd55e/pregens';
import { RoomManager, type Player, type Room } from '../rooms';
import { DND_55E, dnd55e } from '../rules/dnd55e';
import { fateCondensed } from '../rules/fate';
import { exportScene } from '../scene-io';
import { DROWNED_LANTERN_ID } from '../adventures/drowned-lantern';
import {
	act,
	afterMove,
	beginAdventure,
	characterOf,
	claimCharacter,
	decide,
	direct,
	endTurn,
	handOff,
	interact,
	runEnemyTurn,
	startAdventure
} from './engine';
import { readAdventure, saveAdventure } from './persist';
import { loadServerAdventure } from './rules-content';
import { adventureView } from './view';

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}

/** Fate dice by face, then blanks: 3 is +, 2 is 0, 1 is −. */
const faces =
	(...f: number[]): DieRoller =>
	() =>
		f.shift() ?? 2;

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('an adventure file under Fate Condensed', () => {
	it('reads its rules and builds its party from choices, without a classic stat', () => {
		const loaded = ok(loadServerAdventure(fateExampleAdventure(), 'custom-x'));
		expect(loaded.adventure.rules).toEqual(FATE_RULES);
		expect(loaded.file.title).toBe(FATE_EXAMPLE_TITLE);
		const ida = loaded.adventure.characters.ida;
		expect(ida).toMatchObject({ name: 'Ida Brann', hp: 5, armor: 3 });
		expect(ida.stats).toBeUndefined();
	});

	it('names what its rules can’t make of it', () => {
		const save = copy(fateExampleAdventure());
		save.objects[0].verbs[0].check = { stat: 'investigate', dc: 2, save: true };
		expect(loadServerAdventure(save, 'custom-x')).toMatchObject({
			ok: false,
			diagnostics: [{ code: 'rules.check', message: expect.stringMatching(/no saving throws/) }]
		});
		const stat = copy(fateExampleAdventure());
		stat.objects[0].verbs[0].check = { stat: 'religion', dc: 10 };
		expect(loadServerAdventure(stat, 'custom-x')).toMatchObject({
			ok: false,
			diagnostics: [{ message: expect.stringContaining('no skill "religion"') }]
		});
		const pyramid = copy(fateExampleAdventure());
		(pyramid.party!.ida.choices as { skills: Record<string, number> }).skills.lore = 4;
		expect(loadServerAdventure(pyramid, 'custom-x')).toMatchObject({
			ok: false,
			diagnostics: expect.arrayContaining([
				expect.objectContaining({ code: 'character.invalid', path: 'party.ida' })
			])
		});
		const rest = copy(fateExampleAdventure());
		rest.events.decided.does = [{ rest: 'short' }];
		expect(loadServerAdventure(rest, 'custom-x')).toMatchObject({
			ok: false,
			diagnostics: [{ code: 'rules.check', path: 'rest' }]
		});
		// The classic rules' files read as before.
		expect(loadServerAdventure(exampleAdventure(), 'custom-x').ok).toBe(true);
	});
});

describe('characters stay bound to their rules', () => {
	it('restores a character only by the rules that made it', () => {
		const fate = fateCondensed.builder!.build(FATE_PREGENS[0].choices, 'pc-1');
		const dnd = dnd55e.builder!.build(DND_PREGENS[0].choices, 'pc-2');
		if (!fate.ok || !dnd.ok) throw new Error('pregens build');
		expect(fateCondensed.builder!.restore(copy(fate.saved), 'pc-1').ok).toBe(true);
		expect(dnd55e.builder!.restore(copy(fate.saved), 'pc-1').ok).toBe(false);
		expect(fateCondensed.builder!.restore(copy(dnd.saved), 'pc-2').ok).toBe(false);
	});
});

describe('playing The Drowned Lantern', () => {
	let room: Room;
	let gm: Player;
	let ana: Player;
	let ben: Player;
	const ida = () => characterOf(room, ana.id)!;
	const wren = () => characterOf(room, ben.id)!;

	beforeEach(() => {
		const rooms = new RoomManager();
		const created = ok(rooms.create('Gia'));
		room = created.room;
		gm = created.player;
		ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
		ben = ok(rooms.join(room.id, 'Ben', 'player')).player;
		room.dice = () => 2;
		ok(startAdventure(room, gm, DROWNED_LANTERN_ID));
		ok(claimCharacter(room, ana, 'ida'));
		ok(claimCharacter(room, ben, 'wren'));
		ok(beginAdventure(room, gm, 1000));
	});

	it('plays from the dark lantern to its ending by Fate Condensed, through a save', () => {
		const adventure = room.adventure!;
		expect(adventure.rules).toEqual(FATE_RULES);
		const view = adventureView(room, ana, new Set(room.tokens.keys()), null)!;
		expect(view.rules).toMatchObject({ id: 'fate-condensed', name: 'Fate Condensed' });
		expect(view.rules?.attribution).toMatch(/Evil Hat Productions/);
		const card = view.characters.find((c) => c.id === 'ida')!;
		expect(card.card.traits?.[0]).toEqual({
			kind: 'High concept',
			name: 'Lantern-Bearing Marshal of the Fens'
		});
		expect(card.health).toEqual({ name: 'Stress boxes clear', value: 4, max: 4 });

		// An overcome: Wren's Fair (+2) Investigate against Fair (+2), all blanks: a tie, success at a minor cost.
		wren().token.pos = { x: 7, y: 8 };
		const looked = ok(interact(room, ben, 'lantern', 'examine', faces()));
		expect(looked.log.find((m) => m.kind === 'check')).toMatchObject({
			stat: 'Investigate',
			dc: 2,
			success: true,
			explain: expect.stringContaining('tie (success at a minor cost)')
		});
		expect(adventure.chapter).toBe('the_chapel');

		// Into the chapel: the wights rise in it, and nobody rolls initiative.
		ida().token.pos = { x: 11, y: 6 };
		const started = afterMove(room, ida().token, null);
		const encounter = adventure.encounter!;
		expect(encounter.id).toBe('wights');
		expect(
			started.log.some(
				(m) => m.kind === 'system' && /goes first; whoever acts picks who goes next/.test(m.text)
			)
		).toBe(true);
		expect(encounter.order[encounter.current]).toMatchObject({ kind: 'character', id: 'ida' });
		const [w1, w2] = [...encounter.enemies.keys()];
		expect([w1, w2].map((id) => room.tokens.get(id)!.pos)).toEqual([
			{ x: 10, y: 5 },
			{ x: 14, y: 5 }
		]);

		// Ida attacks: Great (+4) Fight against the wight's Average (+1), all blanks: a 3-shift hit with style.
		ida().token.pos = { ...room.tokens.get(w1)!.pos, y: room.tokens.get(w1)!.pos.y + 1 };
		const hit = ok(act(room, ana, 'fight', w1, faces()));
		const attack = hit.log.find((m) => m.kind === 'attack');
		expect(attack).toMatchObject({ hit: true, defense: 1, damage: { total: 3 } });
		expect(attack?.kind === 'attack' && attack.explain).toMatch(/a 3-shift hit, with style/);
		expect(encounter.enemies.has(w1)).toBe(false);

		// Her turn ends: her player picks who goes next. Nobody else acts meanwhile.
		const ended = ok(endTurn(room, ana));
		expect(
			ended.log.some((m) => m.kind === 'system' && m.text === 'Ida Brann picks who goes next.')
		).toBe(true);
		expect(encounter.handoff).toBe(true);
		const picking = adventureView(room, ben, new Set(room.tokens.keys()), null)!.encounter!;
		expect(picking.elective).toBe(true);
		expect(picking.handoff).toMatchObject({ by: 'ida', fresh: false, mine: false });
		expect(
			adventureView(room, ana, new Set(room.tokens.keys()), null)!.encounter!.handoff!.mine
		).toBe(true);
		expect(act(room, ben, 'fight', w2, faces())).toMatchObject({
			ok: false,
			code: 'not_your_turn'
		});
		const w2At = encounter.order.findIndex((t) => t.kind === 'enemy' && t.tokenId === w2);
		expect(handOff(room, ben, w2At)).toMatchObject({ ok: false, code: 'not_your_turn' });

		// Saved and read back while she picks: the pick is still hers.
		const scene = parseSceneFile(copy(exportScene(room, 'Fen')));
		if (!scene.ok) throw new Error(scene.error);
		const back = ok(readAdventure(saveAdventure(adventure), scene.scene));
		expect(back.adventure.rules).toEqual(FATE_RULES);
		expect(back.adventure.encounter).toMatchObject({ handoff: true, current: encounter.current });

		// She hands over to the wight; it lunges at Wren (Fair (+2) Fight, + + + + against Wren's Fair (+2) Athletics, blank).
		wren().token.pos = { ...room.tokens.get(w2)!.pos, y: room.tokens.get(w2)!.pos.y + 1 };
		ida().token.pos = { x: 2, y: 10 };
		const handed = ok(handOff(room, ana, w2At));
		expect(handed.log.some((m) => m.kind === 'system' && /hands over to/.test(m.text))).toBe(true);
		expect(handed.enemyTurn).toBe(encounter.turn);
		const lunge = runEnemyTurn(room, encounter.turn, faces(3, 3, 3, 3))!;
		expect(lunge.log.find((m) => m.kind === 'attack')).toMatchObject({
			hit: true,
			damage: { total: 4 }
		});
		// Four shifts: Wren's four stress boxes take them all.
		expect(wren().state.hp).toBe(1);
		// The wight's side picks for itself: only Wren is left this exchange.
		expect(encounter.order[encounter.current]).toMatchObject({ kind: 'character', id: 'wren' });

		// Wren ends his turn last in the exchange: he picks who starts the next.
		ok(endTurn(room, ben));
		const fresh = adventureView(room, ben, new Set(room.tokens.keys()), null)!.encounter!.handoff!;
		expect(fresh).toMatchObject({ by: 'wren', fresh: true, mine: true });
		ok(handOff(room, ben, w2At === 0 ? 0 : encounter.order.findIndex((t) => t.kind === 'enemy')));
		expect(encounter.round).toBe(2);
		// Another lunge, + + + 0: three shifts with no stress left, so a moderate consequence soaks it.
		const again = runEnemyTurn(room, encounter.turn, faces(3, 3, 3, 2))!;
		expect(again.log.find((m) => m.kind === 'attack')).toMatchObject({
			outcome: 'Wren Holloway takes a moderate consequence.'
		});
		expect(wren().state.hp).toBe(1);
		expect(wren().state.resources?.get('moderate')).toBe(1);

		// The GM ends the fight as won: stress clears, the consequence stays.
		const won = ok(direct(room, gm, { op: 'encounter_end', result: 'won' }));
		expect(
			won.log.some((m) => m.kind === 'system' && m.text === 'Wren Holloway: stress clears.')
		).toBe(true);
		expect(wren().state.hp).toBe(wren().def.hp);
		expect(wren().state.resources?.get('moderate')).toBe(1);
		expect(adventure.chapter).toBe('the_lantern');

		ok(decide(room, ana, 'lantern', 'relight'));
		expect(adventure.stage).toBe('complete');
		expect(adventureView(room, ana, new Set(room.tokens.keys()), null)!.ending).toMatchObject({
			title: 'The Lantern Lit'
		});
		// The credit travels with the save.
		expect(saveAdventure(adventure).state.credits).toEqual([fateCondensed.attribution]);
	});

	it('takes a character out without killing it, and stands it up when the fight is won', () => {
		const adventure = room.adventure!;
		ok(direct(room, gm, { op: 'event', event: 'found_trail' }));
		ida().token.pos = { x: 11, y: 6 };
		afterMove(room, ida().token, null);
		const encounter = adventure.encounter!;
		for (const id of ['mild', 'moderate', 'severe'])
			(ida().state.resources ??= new Map()).set(id, 1);
		ida().state.hp = 1;
		const [w1] = [...encounter.enemies.keys()];
		ok(endTurn(room, ana));
		const at = encounter.order.findIndex((t) => t.kind === 'enemy' && t.tokenId === w1);
		ida().token.pos = { ...room.tokens.get(w1)!.pos, y: room.tokens.get(w1)!.pos.y + 1 };
		wren().token.pos = { x: 2, y: 10 };
		ok(handOff(room, ana, at));
		const out = runEnemyTurn(room, encounter.turn, faces(3, 3, 3, 3))!;
		expect(out.log.find((m) => m.kind === 'attack')).toMatchObject({
			outcome: expect.stringMatching(
				/Ida Brann can't soak a 3-shift hit and is taken out\. Ida Brann falls!/
			)
		});
		expect(ida().state).toMatchObject({ hp: 0, dead: false });
		ok(direct(room, gm, { op: 'encounter_end', result: 'won' }));
		expect(ida().state.hp).toBe(ida().def.hp);
	});

	it('refuses a save that names other rules than its story', () => {
		const scene = parseSceneFile(copy(exportScene(room, 'Fen')));
		if (!scene.ok) throw new Error(scene.error);
		const saved = copy(saveAdventure(room.adventure!));
		(saved.state as { rules: unknown }).rules = { ...DND_55E };
		expect(readAdventure(saved, scene.scene).ok).toBe(false);
	});
});
