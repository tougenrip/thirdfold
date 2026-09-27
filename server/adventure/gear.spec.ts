import { beforeEach, describe, expect, it } from 'vitest';
import type { CharacterStatus } from '../../src/lib/adventure/adventure';
import type { ChatMessage } from '../../src/lib/game/chat';
import type { DieRoller } from '../../src/lib/game/dice';
import type { GridPos } from '../../src/lib/game/grid';
import { BARROW_IDS, CARVINGS_AT } from '../adventures/barrow';
import { RoomManager, type Player, type Room } from '../rooms';
import { dnd55e } from '../rules/dnd55e';
import { exportScene } from '../scene-io';
import { toggleDoor } from '../scene';
import {
	act,
	afterMove,
	beginAdventure,
	changeGear,
	characterOf,
	claimCharacter,
	direct,
	interact,
	share,
	startAdventure
} from './engine';
import { readAdventure } from './persist';
import { adventureView } from './view';

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}
const dice =
	(...rolls: number[]): DieRoller =>
	() =>
		rolls.shift() ?? 10;
const texts = (log: ChatMessage[]) => log.map((m) => ('text' in m ? m.text : ''));

let room: Room;
let gm: Player;
let ana: Player;
let ben: Player;
let sam: Player;

const veil = () => characterOf(room, ana.id)!;
const warden = () => characterOf(room, ben.id)!;
const place = (who: ReturnType<typeof veil>, at: GridPos) => (who.token.pos = { ...at });
const view = (who: Player) => adventureView(room, who, new Set(room.tokens.keys()), null)!;
const status = (who: Player, id: string): CharacterStatus =>
	view(who).characters.find((c) => c.id === id)!;
const item = (who: Player, id: string, name: string) =>
	status(who, id).card.inventory!.find((i) => i.name === name)!;

beforeEach(() => {
	const rooms = new RoomManager();
	const created = ok(rooms.create('Gia'));
	room = created.room;
	gm = created.player;
	ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
	ben = ok(rooms.join(room.id, 'Ben', 'player')).player;
	sam = ok(rooms.join(room.id, 'Sam', 'spectator')).player;
	room.dice = () => 10;
	ok(startAdventure(room, gm, 'barrow'));
	ok(claimCharacter(room, ana, 'veil'));
	ok(claimCharacter(room, ben, 'warden'));
	ok(beginAdventure(room, gm, 1000));
});

/** Into the barrow: the guardians wake and the fight is on. */
function fight() {
	place(veil(), { x: CARVINGS_AT.x, y: CARVINGS_AT.y + 1 });
	ok(interact(room, ana, 'carvings', 'examine', dice(10)));
	ok(share(room, ana, 'ward'));
	place(warden(), { x: 7, y: 8 });
	ok(interact(room, ben, 'barrow-door', 'force', dice(12)));
	ok(toggleDoor(room, ben, BARROW_IDS.door));
	place(veil(), { x: 7, y: 7 });
	place(warden(), { x: 9, y: 5 });
	afterMove(room, warden().token, null);
	return room.adventure!.encounter!;
}

function turnTo(id: string) {
	const encounter = room.adventure!.encounter!;
	encounter.current = encounter.order.findIndex(
		(t) => (t.kind === 'character' ? t.id : t.tokenId) === id
	);
	encounter.acted.clear();
	encounter.speed = 6;
}

describe('fifth edition equipment in play', () => {
	it('shows everyone what a character owns, where it came from and what it weighs', () => {
		const card = status(ana, 'veil').card;
		expect(card.inventory).toEqual([
			{
				id: 'item-1',
				name: 'Leather Armor',
				quantity: 1,
				equipped: 'Worn',
				kind: 'Light armor',
				weight: 10,
				source: 'Starting equipment',
				equippable: true
			},
			expect.objectContaining({ id: 'item-2', name: 'Shortsword', equipped: 'In hand' }),
			expect.objectContaining({ id: 'item-3', name: 'Shortbow', equipped: null }),
			expect.objectContaining({ id: 'item-4', name: 'Arrows', quantity: 20, equippable: false })
		]);
		expect(card.carrying).toEqual({ weight: 15, capacity: 150 });
		for (const who of [gm, ben, sam]) expect(status(who, 'veil').card).toEqual(card);
		// The rules' own data about a character stays on the server.
		expect(status(ana, 'veil').def.sheet).toBeUndefined();
	});

	it('changes Armor Class and attacks with what is equipped', () => {
		expect(warden().def.armor).toBe(19);
		const { log } = ok(changeGear(room, ben, 'warden', { kind: 'unequip', item: 'item-2' }));
		expect(texts(log)).toEqual(['The Warden takes off the Shield.']);
		// Chain Mail 16 + Defense 1, without the Shield's 2.
		expect(warden().def.armor).toBe(17);
		expect(status(gm, 'warden').card.defense).toEqual({ name: 'Armor Class', value: 17 });
		// The Longsword alone in both hands deals its Versatile damage.
		expect(warden().def.actions.find((a) => a.id === 'longsword')!.dice).toBe('1d10+3');
		ok(changeGear(room, ben, 'warden', { kind: 'equip', item: 'item-2' }));
		expect(warden().def.armor).toBe(19);
		expect(warden().def.actions.find((a) => a.id === 'longsword')!.dice).toBe('1d8+3');

		// With nothing in hand, an Unarmed Strike: Strength +3 and proficiency to hit, 1 + 3 damage.
		ok(changeGear(room, ben, 'warden', { kind: 'unequip', item: 'item-3' }));
		const unarmed = warden().def.actions.find((a) => a.id === 'unarmed-strike')!;
		expect(unarmed).toMatchObject({ kind: 'attack', dice: '4' });
		expect(dnd55e.attackBonus(warden().def, unarmed)).toBe(5);
	});

	it('refuses what the rules refuse, and what isn’t the player’s to change', () => {
		// Only its player or the GM.
		expect(changeGear(room, ana, 'warden', { kind: 'unequip', item: 'item-2' })).toMatchObject({
			ok: false,
			code: 'forbidden'
		});
		// Hands: a Two-Handed bow while holding a shortsword.
		expect(changeGear(room, ana, 'veil', { kind: 'equip', item: 'item-3' })).toMatchObject({
			ok: false,
			message: "The Veil's hands are full: Shortbow takes both hands."
		});
		// Training: a Rogue can't wear Chain Mail (the GM hands one over to try).
		ok(
			changeGear(room, gm, 'veil', {
				kind: 'grant',
				item: 'srd-5.2.1:armor:chain-mail',
				quantity: 1
			})
		);
		const mail = item(ana, 'veil', 'Chain Mail');
		expect(mail).toMatchObject({ equipped: null, source: 'From the GM' });
		expect(changeGear(room, ana, 'veil', { kind: 'equip', item: mail.id })).toMatchObject({
			ok: false,
			message: "The Veil isn't trained in Chain Mail."
		});
		// Carrying Capacity: Strength 10 carries 150 lb.; the Veil has 70.
		expect(
			changeGear(room, gm, 'veil', {
				kind: 'grant',
				item: 'srd-5.2.1:armor:plate-armor',
				quantity: 2
			})
		).toMatchObject({ ok: false, message: expect.stringContaining('capacity of 150 lb.') });
		// Only the GM grants, and only what the catalog has.
		expect(
			changeGear(room, ana, 'veil', { kind: 'grant', item: 'srd-5.2.1:weapon:dagger', quantity: 1 })
		).toMatchObject({ ok: false, code: 'forbidden' });
		expect(
			changeGear(room, gm, 'veil', { kind: 'grant', item: 'srd-5.2.1:weapon:vorpal', quantity: 1 })
		).toMatchObject({ ok: false });
	});

	it('takes no Proficiency Bonus with a weapon the class isn’t trained with', () => {
		ok(
			changeGear(room, gm, 'veil', {
				kind: 'grant',
				item: 'srd-5.2.1:weapon:greataxe',
				quantity: 1
			})
		);
		ok(changeGear(room, ana, 'veil', { kind: 'unequip', item: 'item-2' }));
		ok(changeGear(room, ana, 'veil', { kind: 'equip', item: item(ana, 'veil', 'Greataxe').id }));
		const axe = veil().def.actions.find((a) => a.id === 'greataxe')!;
		// Strength 10 (+0), and no +2: a Rogue isn't trained with the Greataxe.
		expect(dnd55e.attackBonus(veil().def, axe)).toBe(0);
		expect(status(ana, 'veil').card.actions.find((a) => a.id === 'greataxe')!.summary).toContain(
			'+0'
		);
	});

	it('puts things down on the table as a pile others can pick up, apart from the story’s objects', () => {
		place(veil(), { x: 8, y: 10 });
		place(warden(), { x: 9, y: 10 });
		const { log } = ok(
			changeGear(room, ana, 'veil', { kind: 'drop', item: 'item-4', quantity: 5 })
		);
		expect(texts(log)).toEqual(['The Veil puts down 5 Arrows.']);
		expect(item(ana, 'veil', 'Arrows').quantity).toBe(15);
		const prop = room.props.get('pile-1')!;
		expect(prop).toMatchObject({ assetId: 'gear-pile', pos: { x: 8, y: 10 } });
		// A pile is not a world object of the story.
		expect(view(ben).interactables.some((i) => i.id === 'pile-1')).toBe(false);
		expect(view(ben).piles).toEqual([
			{ id: 'pile-1', cell: { x: 8, y: 10 }, items: [{ index: 0, name: '5 Arrows' }] }
		]);
		// More on the same cell joins the pile.
		ok(changeGear(room, ana, 'veil', { kind: 'drop', item: 'item-2', quantity: 1 }));
		expect(view(ben).piles[0].items.map((i) => i.name)).toEqual(['5 Arrows', 'Shortsword']);
		expect(veil().def.actions.map((a) => a.id)).toEqual(['unarmed-strike']);

		// The Warden, beside it, picks up the arrows: found on Cold Hill.
		const taken = ok(changeGear(room, ben, 'warden', { kind: 'take', pile: 'pile-1', index: 0 }));
		expect(texts(taken.log)).toEqual(['The Warden picks up 5 Arrows.']);
		expect(item(ben, 'warden', 'Arrows')).toMatchObject({
			quantity: 5,
			source: 'Found: Cold Hill'
		});
		ok(changeGear(room, ben, 'warden', { kind: 'take', pile: 'pile-1', index: 0 }));
		// Empty, the pile goes, prop and all.
		expect(room.props.has('pile-1')).toBe(false);
		expect(view(ben).piles).toEqual([]);

		// Too far away to pick up or hand over.
		place(warden(), { x: 3, y: 10 });
		ok(
			changeGear(room, ben, 'warden', {
				kind: 'drop',
				item: item(ben, 'warden', 'Arrows').id,
				quantity: 5
			})
		);
		expect(changeGear(room, ana, 'veil', { kind: 'take', pile: 'pile-1', index: 0 })).toMatchObject(
			{
				ok: false,
				code: 'out_of_reach'
			}
		);
		expect(
			changeGear(room, ana, 'veil', { kind: 'give', item: 'item-1', quantity: 1, to: 'warden' })
		).toMatchObject({ ok: false, code: 'out_of_reach' });
	});

	it('hands things to a character beside it', () => {
		place(veil(), { x: 8, y: 10 });
		place(warden(), { x: 9, y: 10 });
		const { log } = ok(
			changeGear(room, ana, 'veil', { kind: 'give', item: 'item-4', quantity: 10, to: 'warden' })
		);
		expect(texts(log)).toEqual(['The Veil gives 10 Arrows to The Warden.']);
		expect(item(gm, 'warden', 'Arrows')).toMatchObject({
			quantity: 10,
			source: 'Given by The Veil'
		});
		expect(item(gm, 'veil', 'Arrows').quantity).toBe(10);
	});

	it('in a fight: on its own turn, weapons only, twice; each shot spends an arrow and half come back', () => {
		fight();
		turnTo('warden');
		expect(changeGear(room, ana, 'veil', { kind: 'unequip', item: 'item-2' })).toMatchObject({
			ok: false,
			code: 'not_your_turn'
		});
		turnTo('veil');
		expect(changeGear(room, ana, 'veil', { kind: 'unequip', item: 'item-1' })).toMatchObject({
			ok: false,
			message: 'There is no time to change armor in the middle of a fight.'
		});
		ok(changeGear(room, ana, 'veil', { kind: 'unequip', item: 'item-2' }));
		ok(changeGear(room, ana, 'veil', { kind: 'equip', item: 'item-3' }));
		expect(changeGear(room, ana, 'veil', { kind: 'unequip', item: 'item-3' })).toMatchObject({
			ok: false,
			message: 'The Veil has no time for more of that this turn.'
		});

		// Each shot spends an arrow, hit or miss.
		const encounter = room.adventure!.encounter!;
		const [shade] = [...encounter.enemies].find(([, e]) => e.kind === 'shade')!;
		room.tokens.get(shade)!.pos = { x: 7, y: 3 };
		room.lights.set('lamp', {
			id: 'lamp',
			pos: { x: 7, y: 5 },
			radius: 6,
			color: '#fff',
			on: true
		});
		ok(act(room, ana, 'shortbow', shade, dice(2)));
		expect(item(ana, 'veil', 'Arrows').quantity).toBe(19);
		expect(veil().def.actions.find((a) => a.id === 'shortbow')!.about).toContain(
			'Arrows: 19 left.'
		);

		// With no arrows left, the bow can't be fired.
		const state = room.adventure!;
		turnTo('veil');
		ok(changeGear(room, gm, 'veil', { kind: 'drop', item: 'item-4', quantity: 19 }));
		expect(act(room, ana, 'shortbow', shade, dice(15))).toMatchObject({
			ok: false,
			message: 'The Veil has no Arrows for the Shortbow.'
		});
		expect(state.encounter!.acted.has('veil')).toBe(false);

		// Three more shots, then the fight is won: of the four arrows shot, half (two) come back.
		ok(
			changeGear(room, gm, 'veil', {
				kind: 'grant',
				item: 'srd-5.2.1:ammunition:arrows',
				quantity: 3
			})
		);
		for (let i = 0; i < 3; i++) {
			turnTo('veil');
			ok(act(room, ana, 'shortbow', shade, dice(2)));
		}
		const found = item(ana, 'veil', 'Arrows');
		expect(found.quantity).toBe(0);
		const won = ok(direct(room, gm, { op: 'encounter_end', result: 'won' }));
		expect(texts(won.log)).toContain('The Veil recovers 2 Arrows.');
		expect(state.encounter).toBeNull();
		expect(item(ana, 'veil', 'Arrows').quantity).toBe(2);
	});

	it('keeps what each character carries, and what lies on the table, through a save', () => {
		place(veil(), { x: 8, y: 10 });
		ok(changeGear(room, ana, 'veil', { kind: 'drop', item: 'item-4', quantity: 5 }));
		ok(changeGear(room, ben, 'warden', { kind: 'unequip', item: 'item-2' }));
		const scene = exportScene(room, 'Cold Hill');
		const back = ok(readAdventure(scene.adventure!, scene)).adventure;
		expect(back.kept?.get('warden')!.def.armor).toBe(17);
		expect(back.kept?.get('veil')!.def.sheet).toMatchObject({
			inventory: expect.arrayContaining([expect.objectContaining({ name: 'Arrows', quantity: 15 })])
		});
		expect(back.piles?.get('pile-1')).toEqual({
			location: 'hill',
			pos: { x: 8, y: 10 },
			items: [{ item: { item: 'srd-5.2.1:ammunition:arrows', quantity: 5 }, name: '5 Arrows' }]
		});
		// A pile of something the rules don't know, or a forged inventory, refuses the story.
		const forged = structuredClone(scene.adventure!);
		(forged.state.piles as Record<string, { items: unknown[] }>)['pile-1'].items = [
			{ item: 'srd-5.2.1:weapon:vorpal', quantity: 1 }
		];
		expect(readAdventure(forged, scene).ok).toBe(false);
		const cheat = structuredClone(scene.adventure!);
		const saved = (
			cheat.state.kept as Record<string, { character: { inventory: { quantity: number }[] } }>
		).veil;
		saved.character.inventory[0].quantity = 5;
		expect(readAdventure(cheat, scene).ok).toBe(false);
	});
});
