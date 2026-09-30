import { beforeEach, describe, expect, it } from 'vitest';
import type { DndSheetDetails } from '../../src/lib/rules/dnd55e/sheet';
import type { CreatorChoices } from '../../src/lib/rules/dnd55e/creator';
import { RoomManager, type Player, type Room } from '../rooms';
import { exportScene } from '../scene-io';
import {
	act,
	beginAdventure,
	buildCharacter,
	characterOf,
	claimCharacter,
	editSheet,
	sheetDetails,
	startAdventure
} from './engine';
import { readAdventure } from './persist';
import { adventureView } from './view';

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}

const srd = (kind: string, slug: string) => `srd-5.2.1:${kind}:${slug}`;
const monk = (): CreatorChoices => ({
	name: 'Sela',
	color: '#17a589',
	species: { id: srd('species', 'orc'), options: {}, feat: null },
	background: { id: srd('background', 'sage'), increases: { wis: 2, con: 1 } },
	class: {
		id: srd('class', 'monk'),
		skills: ['acrobatics', 'insight'],
		expertise: [],
		fightingStyle: null,
		weaponMasteries: []
	},
	abilities: {
		method: 'standard-array',
		base: { str: 10, dex: 15, con: 13, int: 8, wis: 14, cha: 12 }
	},
	armor: { worn: null, shield: false },
	weapons: [srd('weapon', 'quarterstaff')]
});

let room: Room;
let gm: Player;
let ana: Player;
let ben: Player;
let cai: Player;
let sam: Player;

const view = (who: Player) => adventureView(room, who, new Set(room.tokens.keys()), null)!;
const sheetOf = (who: Player, id: string) => view(who).characters.find((c) => c.id === id)!;

beforeEach(() => {
	const rooms = new RoomManager();
	const created = ok(rooms.create('Gia'));
	room = created.room;
	gm = created.player;
	ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
	ben = ok(rooms.join(room.id, 'Ben', 'player')).player;
	cai = ok(rooms.join(room.id, 'Cai', 'player')).player;
	sam = ok(rooms.join(room.id, 'Sam', 'spectator')).player;
	room.dice = () => 10;
	ok(startAdventure(room, gm, 'barrow'));
	ok(claimCharacter(room, ana, 'ember'));
	ok(claimCharacter(room, ben, 'warden'));
	ok(buildCharacter(room, cai, monk()));
	ok(beginAdventure(room, gm, 1000));
});

describe('the fifth edition character sheet', () => {
	it('carries the whole sheet: choices, what the rules work out, features with their text', () => {
		const ember = sheetOf(ben, 'ember');
		// The live view only says there is a full sheet; a page asks for it when it opens it.
		expect(ember.card.details).toBe('dnd-5.5e');
		const full = ok(sheetDetails(room, 'ember'));
		expect(full.rules).toBe('dnd-5.5e');
		const d = full.details as unknown as DndSheetDetails;
		expect(d.choices).toMatchObject({
			species: 'Elf',
			speciesOptions: [
				{ label: 'Lineage', value: 'High Elf' },
				{ label: 'Spellcasting ability', value: 'Intelligence' },
				{ label: 'Keen Senses', value: 'Perception' }
			],
			background: 'Sage',
			class: 'Wizard',
			scores: 'Standard array',
			skills: ['Investigation', 'Religion'],
			kept: [{ name: 'Magic Initiate (Wizard)', value: 'Light, Mage Hand; Sleep' }]
		});
		expect(d.choices.base.find((b) => b.id === 'int')).toEqual({
			id: 'int',
			name: 'Intelligence',
			score: 15,
			increase: 2
		});
		expect(d.derived).toEqual({
			initiative: 2,
			speed: 30,
			passivePerception: 13,
			hitDie: 6,
			hitDice: 1
		});
		expect(d.spellcasting).toMatchObject({
			ability: 'Intelligence',
			saveDc: 13,
			attackBonus: 5,
			cantrips: 3,
			prepared: 4
		});
		// Each spell it knows, with its action at the table or why it has none.
		expect(d.spellcasting!.spells.map((s) => [s.name, s.action, s.why !== null])).toEqual([
			['Fire Bolt', 'fire-bolt', false],
			['Ray of Frost', 'ray-of-frost', false],
			['Shocking Grasp', 'shocking-grasp', false],
			['Magic Missile', 'magic-missile', false],
			['Burning Hands', 'burning-hands', false],
			['Thunderwave', 'thunderwave', false],
			['Sleep', 'sleep', false]
		]);
		const trance = d.features.find((f) => f.name === 'Trance')!;
		expect(trance.from).toBe('Species');
		expect(trance.text).toContain('Long Rest');
		expect(d.features.find((f) => f.name === 'Arcane Recovery')).toMatchObject({
			from: 'Class',
			level: 1
		});
		expect(d.equipment.weapons.map((w) => [w.name, w.held])).toEqual([
			['Light Crossbow', true],
			['Dagger', false]
		]);
		expect(ember.card.resources).toEqual([
			{ id: 'spell-slots-1', name: 'Level 1 spell slots', max: 2, trackedBy: null }
		]);
		// A resource an action spends is counted by the table.
		expect(sheetOf(ben, 'warden').card.resources).toEqual([
			{ id: 'second-wind', name: 'Second Wind', max: 2, trackedBy: 'second-wind' }
		]);
		// The same values for the GM, the other players and a spectator.
		for (const who of [gm, ana, cai, sam]) expect(sheetOf(who, 'ember').card).toEqual(ember.card);
	});

	it('lets a player mark a resource spent, and counts the ones an action spends by itself', () => {
		const { log } = ok(
			editSheet(room, ana, 'ember', { kind: 'resource', resource: 'spell-slots-1', spent: 1 })
		);
		expect(log.map((m) => (m.kind === 'system' ? m.text : ''))).toEqual([
			'The Ember: Level 1 spell slots, 1 of 2 left.'
		]);
		for (const who of [gm, ana, ben])
			expect(sheetOf(who, 'ember').resourcesSpent).toEqual({ 'spell-slots-1': 1 });
		expect(
			editSheet(room, ana, 'ember', { kind: 'resource', resource: 'spell-slots-1', spent: 3 })
		).toMatchObject({
			ok: false,
			message: 'Level 1 spell slots has 2 uses.'
		});
		expect(
			editSheet(room, ben, 'ember', { kind: 'resource', resource: 'spell-slots-1', spent: 0 })
		).toMatchObject({
			ok: false,
			code: 'forbidden'
		});
		// The GM may set it back.
		ok(editSheet(room, gm, 'ember', { kind: 'resource', resource: 'spell-slots-1', spent: 0 }));
		expect(sheetOf(ana, 'ember').resourcesSpent).toEqual({ 'spell-slots-1': 0 });

		expect(
			editSheet(room, ben, 'warden', { kind: 'resource', resource: 'second-wind', spent: 1 })
		).toMatchObject({
			ok: false,
			message: 'The table counts Second Wind as it is used.'
		});
		const warden = characterOf(room, ben.id)!;
		warden.state.hp = 5;
		ok(act(room, ben, 'second-wind', warden.token.id, () => 4));
		expect(sheetOf(gm, 'warden').resourcesSpent).toEqual({ 'second-wind': 1 });
	});

	it('keeps a player’s notes for them and the GM alone', () => {
		ok(editSheet(room, ana, 'ember', { kind: 'notes', text: 'Owes the Veil a lantern.' }));
		expect(sheetOf(ana, 'ember').notes).toBe('Owes the Veil a lantern.');
		expect(sheetOf(gm, 'ember').notes).toBe('Owes the Veil a lantern.');
		expect(sheetOf(ben, 'ember').notes).toBeNull();
		expect(sheetOf(sam, 'ember').notes).toBeNull();
		expect(sheetOf(ana, 'ember')).toMatchObject({ editable: true, renamable: false });
		expect(sheetOf(ben, 'ember')).toMatchObject({ editable: false, renamable: false });
		expect(editSheet(room, ben, 'ember', { kind: 'notes', text: 'x' })).toMatchObject({
			code: 'forbidden'
		});
		expect(editSheet(room, ana, 'ember', { kind: 'notes', text: 'x'.repeat(2001) })).toMatchObject({
			ok: false
		});
	});

	it('renames a character its player built, and only that', () => {
		expect(sheetOf(cai, 'pc-1')).toMatchObject({ editable: true, renamable: true });
		const { log } = ok(editSheet(room, cai, 'pc-1', { kind: 'name', name: '  Sela Brightwater ' }));
		expect(log[0]).toMatchObject({ text: 'Sela is now called Sela Brightwater.' });
		const mine = characterOf(room, cai.id)!;
		expect(mine.def.name).toBe('Sela Brightwater');
		expect(mine.token.name).toBe('Sela Brightwater');
		expect(sheetOf(gm, 'pc-1').def.name).toBe('Sela Brightwater');
		expect(ok(sheetDetails(room, 'pc-1')).details).toMatchObject({ choices: { class: 'Monk' } });
		expect(editSheet(room, cai, 'pc-1', { kind: 'name', name: '' })).toMatchObject({ ok: false });
		expect(editSheet(room, ana, 'ember', { kind: 'name', name: 'Blaze' })).toMatchObject({
			ok: false,
			message: "The Ember's name is the story's."
		});
		expect(editSheet(room, ana, 'pc-1', { kind: 'name', name: 'Stolen' })).toMatchObject({
			code: 'forbidden'
		});
	});

	it('keeps notes, marked resources and a new name through a save, and refuses them out of bounds', () => {
		ok(editSheet(room, ana, 'ember', { kind: 'notes', text: 'Read the ward first.' }));
		ok(editSheet(room, ana, 'ember', { kind: 'resource', resource: 'spell-slots-1', spent: 2 }));
		ok(editSheet(room, cai, 'pc-1', { kind: 'name', name: 'Sela Brightwater' }));
		const scene = exportScene(room, 'The Barrow');
		const back = ok(readAdventure(scene.adventure!, scene)).adventure;
		expect(back.notes?.get('ember')).toBe('Read the ward first.');
		expect(back.characters.get('ember')!.resources?.get('spell-slots-1')).toBe(2);
		expect(back.built?.get('pc-1')!.def.name).toBe('Sela Brightwater');

		const over = structuredClone(scene.adventure!);
		(
			over.state.characters as Record<string, { resources: Record<string, number> }>
		).ember.resources['spell-slots-1'] = 3;
		expect(readAdventure(over, scene).ok).toBe(false);
		const unknown = structuredClone(scene.adventure!);
		(
			unknown.state.characters as Record<string, { resources: Record<string, number> }>
		).ember.resources = {
			rages: 1
		};
		expect(readAdventure(unknown, scene).ok).toBe(false);
	});
});
