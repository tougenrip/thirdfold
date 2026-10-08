// D&D adventure authoring (milestone 57): an adventure file declares its
// rules, a party its rules build from choices, monsters from the rules'
// bestiary, saving throws, rests and gear, all as data; the server builds and
// checks it, and it plays from start to finish on the engine, through a save.

import { beforeEach, describe, expect, it } from 'vitest';
import { dndExampleAdventure, DND_EXAMPLE_TITLE } from '../../src/lib/adventure/dnd-example';
import { exampleAdventure } from '../../src/lib/adventure/example';
import { loadAdventureFile, type AdventureFile } from '../../src/lib/adventure/file';
import { DND_PREGENS } from '../../src/lib/rules/dnd55e/pregens';
import { DND_ABILITIES, DND_SKILLS } from '../../src/lib/rules/dnd55e/terms';
import type { DieRoller } from '../../src/lib/game/dice';
import { parseSceneFile } from '../../src/lib/game/scene-file';
import { RoomManager, type Player, type Room } from '../rooms';
import { DND_55E, dnd55e } from '../rules/dnd55e';
import { ABILITIES, SKILLS } from '../rules/dnd55e/core';
import { srdCatalog } from '../rules/dnd55e/catalog';
import { REST_PHRASES, SHORT_REST_RECHARGE } from '../rules/dnd55e/rests';
import { exportScene } from '../scene-io';
import { loadCustomAdventure } from './custom';
import {
	afterMove,
	beginAdventure,
	characterOf,
	claimCharacter,
	decide,
	direct,
	interact,
	ruleEffect,
	run,
	startAdventure
} from './engine';
import { effectsOn } from './effects';
import { readAdventure, saveAdventure } from './persist';
import { loadServerAdventure } from './rules-content';
import { adventureView } from './view';

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}

const dice =
	(...rolls: number[]): DieRoller =>
	() =>
		rolls.shift() ?? 10;

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('the shared pieces a creator builds with', () => {
	it('offers the rules’ own abilities and skills, and pregens the rules build as they are', () => {
		expect(DND_ABILITIES.map((a) => [a.id, a.name])).toEqual(ABILITIES.map((a) => [a.id, a.name]));
		expect(DND_SKILLS.map((s) => [s.id, s.name])).toEqual(SKILLS.map((s) => [s.id, s.name]));
		for (const p of DND_PREGENS) {
			const built = dnd55e.builder!.build(p.choices, p.id);
			expect(built, p.id).toMatchObject({ ok: true, def: { name: p.choices.name } });
		}
	});

	it('plays rests by the SRD’s own words', () => {
		const rules = srdCatalog().all('rule');
		for (const [id, phrases] of Object.entries(REST_PHRASES)) {
			const text = rules.find((r) => r.id === id)!.text.replace(/\s+/g, ' ');
			for (const phrase of phrases) expect(text, phrase).toContain(phrase);
		}
		const classes = srdCatalog().all('class');
		for (const [resource, r] of Object.entries(SHORT_REST_RECHARGE)) {
			const klass = classes.find((c) => c.name === r.class)!;
			const feature = (klass.data as { features: { name: string; text: string }[] }).features.find(
				(f) => f.name === r.feature
			);
			expect(feature?.text.replace(/\s+/g, ' '), resource).toContain(r.phrase);
		}
	});
});

describe('an adventure file under the fifth edition rules', () => {
	it('reads its rules, party, monsters, saves, rests and gear, and the server builds them', () => {
		const shared = loadAdventureFile(dndExampleAdventure(), 'custom-x');
		expect(shared).toMatchObject({ ok: true, adventure: { rules: DND_55E, openParty: true } });
		const loaded = ok(loadServerAdventure(dndExampleAdventure(), 'custom-x'));
		expect(Object.keys(loaded.adventure.characters)).toEqual(['brakka', 'wren', 'ilse']);
		expect(loaded.adventure.characters.brakka).toMatchObject({
			name: 'Brakka',
			intro: 'A soldier who has carried a shield up too many hills to count.'
		});
		expect(loaded.adventure.enemies['srd-skeleton']).toMatchObject({ name: 'Skeleton' });
		expect(loaded.file.title).toBe(DND_EXAMPLE_TITLE);
	});

	it('names everything its rules can’t make of it, where it is', () => {
		const bad = copy(dndExampleAdventure()) as AdventureFile;
		(bad.party!.wren.choices as { class: { expertise: string[] } }).class.expertise = [
			'athletics',
			'stealth'
		];
		bad.monsters = ['srd-skeleton', 'srd-nothing-at-all'];
		bad.encounters.guardians.foes.push({ kind: 'srd-nothing-at-all' });
		bad.objects[0].verbs[0].check = { stat: 'wits', dc: 10 };
		const failed = loadServerAdventure(bad, 'custom-x');
		expect(failed.ok).toBe(false);
		if (failed.ok) return;
		expect(failed.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'character.invalid', path: 'party.wren' }),
				expect.objectContaining({ code: 'ref.missing', path: 'monsters[1]' })
			])
		);
		// Its check by another rules' stat: once the party and monsters read, the rules say so.
		const stat = copy(dndExampleAdventure()) as AdventureFile;
		stat.objects[0].verbs[0].check = { stat: 'wits', dc: 10 };
		const checked = loadServerAdventure(stat, 'custom-x');
		expect(checked).toMatchObject({
			ok: false,
			diagnostics: [{ code: 'rules.check', message: expect.stringContaining('"wits"') }]
		});
		// A party member's id is a character's: no underscores.
		const id = copy(dndExampleAdventure()) as AdventureFile;
		id.party = { brakka_2: id.party!.brakka };
		expect(loadServerAdventure(id, 'custom-x')).toMatchObject({
			ok: false,
			diagnostics: [{ code: 'schema.value', path: 'party.brakka_2' }]
		});
		// Gear the catalog doesn't have.
		const gear = copy(dndExampleAdventure()) as AdventureFile;
		JSON.stringify(gear); // the chest's gear, inside its verb
		(gear.objects[1].verbs[0].does![0].do[1] as { gear: { item: string } }).gear.item =
			'srd-5.2.1:weapon:laser';
		expect(loadServerAdventure(gear, 'custom-x')).toMatchObject({
			ok: false,
			diagnostics: [{ code: 'ref.missing', path: 'gear' }]
		});
	});

	it('keeps the classic rules to what they have: no saves, rests, gear, party or monsters', () => {
		const classic = copy(exampleAdventure()) as AdventureFile;
		classic.objects[0].verbs[0].check = { stat: 'dex', dc: 10, save: true };
		classic.events.asked.does = [{ rest: 'long' }];
		classic.monsters = ['srd-skeleton'];
		const loaded = loadAdventureFile(classic, 'custom-x');
		expect(loaded.ok).toBe(false);
		if (loaded.ok) return;
		expect(loaded.problems).toEqual(
			expect.arrayContaining([
				'object sack: search: the classic rules have no saving throws',
				'rest: the classic rules have no rests',
				'rules: pick rules with a character builder and a bestiary for a party or monsters'
			])
		);
		// And older files read exactly as before.
		expect(loadAdventureFile(exampleAdventure(), 'custom-x').ok).toBe(true);
	});
});

describe('playing it', () => {
	let room: Room;
	let gm: Player;
	let ana: Player;
	let ben: Player;
	const wren = () => characterOf(room, ana.id)!;
	const brakka = () => characterOf(room, ben.id)!;

	beforeEach(() => {
		const rooms = new RoomManager();
		const created = ok(rooms.create('Gia'));
		room = created.room;
		gm = created.player;
		ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
		ben = ok(rooms.join(room.id, 'Ben', 'player')).player;
		room.dice = () => 10;
		const custom = ok(loadCustomAdventure(dndExampleAdventure()));
		ok(startAdventure(room, gm, custom.adventure.id));
		ok(claimCharacter(room, ana, 'wren'));
		ok(claimCharacter(room, ben, 'brakka'));
		ok(beginAdventure(room, gm, 1000));
	});

	it('plays from the shrine’s door to its ending, by the fifth edition rules, through a save', () => {
		const adventure = room.adventure!;
		expect(adventure.rules).toEqual(DND_55E);
		// The view: the party the rules built, and the check worded by them.
		const view = adventureView(room, ana, new Set(room.tokens.keys()), null)!;
		expect(view.characters.map((c) => c.id)).toEqual(['brakka', 'wren', 'ilse']);
		expect(view.build).toEqual({ rules: 'dnd-5.5e' });

		// A Religion check reads the inscription: Wren is no scholar of it, but a 15 will do.
		wren().token.pos = { x: 4, y: 8 };
		const read = ok(interact(room, ana, 'inscription', 'examine', dice(15)));
		expect(read.log.find((m) => m.kind === 'check')).toMatchObject({
			stat: 'Intelligence (Religion)',
			dc: 10,
			success: true
		});
		expect(adventure.chapter).toBe('the_guardians');

		// The chest: a Dexterity save against its needle (failed: 1d6 taken), and a dagger inside.
		brakka().token.pos = { x: 9, y: 3 };
		const before = brakka().state.hp;
		const opened = ok(interact(room, ben, 'chest', 'open', dice(2)));
		expect(opened.log.find((m) => m.kind === 'check')).toMatchObject({
			save: true,
			success: false
		});
		expect(brakka().state.hp).toBeLessThan(before);
		expect(opened.log.some((m) => m.kind === 'system' && /takes .*Dagger/i.test(m.text))).toBe(
			true
		);
		const card = dnd55e.card(brakka().def, new Map());
		expect(card.inventory?.some((i) => /Dagger/.test(i.name))).toBe(true);

		// Inside, the guardians rise: two SRD Skeletons.
		brakka().token.pos = { x: 6, y: 6 };
		afterMove(room, brakka().token, null);
		const encounter = adventure.encounter!;
		expect(encounter.id).toBe('guardians');
		expect([...encounter.enemies.values()].map((e) => e.kind)).toEqual([
			'srd-skeleton',
			'srd-skeleton'
		]);

		// Saved and read back mid-fight: the file, its party and the hurt come back.
		const scene = parseSceneFile(JSON.parse(JSON.stringify(exportScene(room, 'Shrine'))));
		if (!scene.ok) throw new Error(scene.error);
		const back = ok(readAdventure(saveAdventure(adventure), scene.scene));
		expect(back.adventure.characters.get('brakka')!.hp).toBe(brakka().state.hp);
		expect(back.adventure.encounter!.id).toBe('guardians');

		// The GM ends the fight as won: a Short Rest, then the choice.
		const hurt = brakka().state.hp;
		const won = ok(direct(room, gm, { op: 'encounter_end', result: 'won' }));
		expect(adventure.chapter).toBe('the_choice');
		expect(
			won.log.some((m) => m.kind === 'system' && m.text === 'The party takes a Short Rest.')
		).toBe(true);
		expect(brakka().state.hp).toBeGreaterThan(hurt);
		expect(brakka().state.hitDiceSpent).toBe(1);
		const rested = parseSceneFile(JSON.parse(JSON.stringify(exportScene(room, 'Shrine'))));
		if (!rested.ok) throw new Error(rested.error);
		expect(
			ok(readAdventure(saveAdventure(adventure), rested.scene)).adventure.characters.get('brakka')!
				.hitDiceSpent
		).toBe(1);
		expect(adventure.pending).toBe('shrine');

		ok(decide(room, ana, 'shrine', 'restore'));
		expect(adventure.stage).toBe('complete');
		expect(adventureView(room, ana, new Set(room.tokens.keys()), null)!.ending).toMatchObject({
			title: 'The Shrine Restored'
		});
	});

	it('rests by the rules: a Long Rest gives back every Hit Point, Hit Point Die and slot, and eases Exhaustion', () => {
		const adventure = room.adventure!;
		const b = brakka();
		b.state.hp = 2;
		b.state.hitDiceSpent = 1;
		b.state.resources = new Map([['second-wind', 1]]);
		ok(
			direct(room, gm, {
				op: 'event',
				event: 'read_rite'
			})
		);
		// Exhausted twice over: a Long Rest takes one level away.
		const exhaust = {
			kind: 'apply',
			target: b.state.tokenId,
			condition: 'exhaustion',
			rounds: null
		} as const;
		ok(ruleEffect(room, gm, exhaust));
		ok(ruleEffect(room, gm, exhaust));
		expect(effectsOn(adventure, b.state.tokenId)[0].level).toBe(2);
		run(room, adventure, [{ rest: 'long' }]);
		expect(effectsOn(adventure, b.state.tokenId)[0].level).toBe(1);
		run(room, adventure, [{ rest: 'long' }]);
		expect(b.state.hp).toBe(b.def.hp);
		expect(b.state.hitDiceSpent).toBeUndefined();
		expect(b.state.resources).toBeUndefined();
		expect(effectsOn(adventure, b.state.tokenId)).toEqual([]);

		// A downed character can't rest; nobody rests in a fight.
		b.state.hp = 0;
		const log = run(room, adventure, [{ rest: 'short' }]).log;
		expect(log.some((m) => m.kind === 'system' && /too badly hurt/.test(m.text))).toBe(true);
		expect(b.state.hp).toBe(0);
	});
});
