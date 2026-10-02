// Homebrew in a story (milestone 52): the GM brings a pack to The Barrow on
// Cold Hill, a player builds a character from it, the GM gives out its
// armor and brings on its monster, and a save carries all of it; nothing of
// a pack the story doesn't have can be chosen, given or brought on.

import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../src/lib/game/chat';
import { RoomManager, type Player, type Room } from '../rooms';
import { examplePack } from '../rules/dnd55e/homebrew/example';
import { exportScene } from '../scene-io';
import {
	attachPack,
	beginAdventure,
	buildCharacter,
	changeGear,
	characterOf,
	claimCharacter,
	control,
	creatorOptions,
	detachPack,
	direct,
	searchMonsters,
	startAdventure
} from './engine';
import { readAdventure } from './persist';
import { packsOf } from './packs';
import { adventureView } from './view';

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}
const srd = (kind: string, slug: string) => `srd-5.2.1:${kind}:${slug}`;
const texts = (log: readonly ChatMessage[]) => log.map((m) => ('text' in m ? m.text : ''));

/** A level 1 Orc Fighter with the pack's blade and coat. */
const fighter = (pack: string) => ({
	name: 'Brann',
	color: '#c0392b',
	species: { id: srd('species', 'orc'), options: {}, feat: null },
	background: { id: srd('background', 'soldier'), increases: { str: 2, con: 1 } },
	class: {
		id: srd('class', 'fighter'),
		skills: ['perception', 'survival'],
		expertise: [],
		fightingStyle: srd('feat', 'defense'),
		weaponMasteries: [
			`${pack}:weapon:barrow-blade`,
			srd('weapon', 'longsword'),
			srd('weapon', 'javelin')
		]
	},
	abilities: {
		method: 'standard-array',
		base: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 }
	},
	armor: { worn: `${pack}:armor:ringed-hide`, shield: false },
	weapons: [`${pack}:weapon:barrow-blade`, srd('weapon', 'javelin')]
});

let room: Room;
let gm: Player;
let ana: Player;
let dee: Player;
/** The example pack's id, once attached. */
let pack: string;

beforeEach(() => {
	const rooms = new RoomManager();
	const created = ok(rooms.create('Gia'));
	room = created.room;
	gm = created.player;
	room.gmOwner = 'a'.repeat(64);
	ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
	dee = ok(rooms.join(room.id, 'Dee', 'player')).player;
	room.dice = () => 10;
	ok(startAdventure(room, gm, 'barrow'));
	ok(claimCharacter(room, dee, 'warden'));
});

const attach = () => {
	const done = ok(attachPack(room, gm, examplePack()));
	pack = packsOf(room.adventure!)[0];
	return done;
};

describe('homebrew brought to a story', () => {
	it('is the GM’s to bring, checked in full, and listed for the whole table', () => {
		expect(attachPack(room, ana, examplePack())).toMatchObject({ ok: false, code: 'forbidden' });
		const broken = { ...examplePack(), records: [{ kind: 'weapon', slug: 'x' }] };
		const refused = attachPack(room, gm, broken);
		expect(refused).toMatchObject({ ok: false, code: 'invalid_message' });
		expect(!refused.ok && refused.message).toMatch(/^That homebrew can't be used: records\[0\]/);

		const done = attach();
		expect(texts(done.log)).toEqual([
			'The GM brings homebrew to the story: The Cold Hill Armory 1.0 (5 things).'
		]);
		const view = adventureView(room, ana, new Set(), null)!;
		expect(view.packs).toEqual([
			expect.objectContaining({
				id: pack,
				name: 'The Cold Hill Armory',
				version: '1.0',
				creator: 'thirdfold',
				license: 'CC0-1.0',
				access: { owner: expect.stringMatching(/^[0-9a-f]{16}$/), visibility: 'table' }
			})
		]);
		expect(view.packs![0].access.owner).not.toContain('a'.repeat(16));
		expect(view.packs![0].records.map((r) => r.name)).toEqual([
			'Barrow Blade',
			'Ringed Hide',
			'Grave Spark',
			'Barrow Chill',
			'Mound Crawler'
		]);
		expect(attachPack(room, gm, examplePack())).toMatchObject({
			ok: false,
			message: 'The story already has that homebrew.'
		});
	});

	it('is offered to the creator, and a player builds from it, only once the story has it', () => {
		const before = buildCharacter(room, ana, fighter('hb-70b000b23af0a6e1'));
		expect(before).toMatchObject({ ok: false, code: 'invalid_message' });
		attach();
		const options = ok(creatorOptions(room)).options as { weapons: { name: string }[] };
		expect(options.weapons.map((w) => w.name)).toContain('Barrow Blade');
		ok(buildCharacter(room, ana, fighter(pack)));
		const brann = characterOf(room, ana.id)!;
		expect(brann.def.armor).toBe(16);
		expect(brann.def.actions[0].name).toBe('Barrow Blade');
	});

	it('lets the GM give its gear and bring on its monsters, and nothing of a pack the story hasn’t', () => {
		attach();
		ok(beginAdventure(room, gm, 1000));
		const hide = `${pack}:armor:ringed-hide`;
		const given = ok(changeGear(room, gm, 'warden', { kind: 'grant', item: hide, quantity: 1 }));
		expect(texts(given.log)).toEqual(['The GM gives The Warden Ringed Hide.']);
		const otherId = 'hb-' + '0'.repeat(16);
		expect(
			changeGear(room, gm, 'warden', {
				kind: 'grant',
				item: `${otherId}:armor:ringed-hide`,
				quantity: 1
			})
		).toMatchObject({ ok: false, message: 'That comes from homebrew this story doesn’t have.' });

		expect(ok(searchMonsters(room, gm, 'crawler')).monsters).toEqual([
			expect.objectContaining({
				name: 'Mound Crawler',
				source: 'Homebrew: The Cold Hill Armory 1.0'
			})
		]);
		const kind = `${pack}-mound-crawler`;
		ok(direct(room, gm, { op: 'spawn', kind, pos: { x: 5, y: 10 }, waiting: true }));
		expect(room.adventure!.bestiary).toEqual([kind]);
		ok(direct(room, gm, { op: 'encounter_start', encounter: 'ambush' }));
		const crawler = [...room.adventure!.encounter!.enemies.values()][0];
		expect(crawler).toMatchObject({ kind, hp: 16 });
	});

	it('travels in a save and comes back checked; a save whose homebrew was changed is refused', () => {
		attach();
		ok(buildCharacter(room, ana, fighter(pack)));
		ok(beginAdventure(room, gm, 1000));
		ok(
			direct(room, gm, {
				op: 'spawn',
				kind: `${pack}-mound-crawler`,
				pos: { x: 5, y: 10 },
				waiting: true
			})
		);
		const scene = exportScene(room, 'Cold Hill');
		const state = scene.adventure!.state as { packs: { owner: string; pack: { name: string } }[] };
		expect(state.packs).toEqual([
			{
				owner: expect.stringMatching(/^[0-9a-f]{16}$/),
				pack: expect.objectContaining({ name: 'The Cold Hill Armory' })
			}
		]);
		const back = ok(readAdventure(scene.adventure!, scene)).adventure;
		expect(back.packs).toEqual(room.adventure!.packs);
		expect(back.built!.get('pc-1')!.def.actions[0].name).toBe('Barrow Blade');

		// The pack changed in the file: a new pack, whose ids the character doesn't carry.
		const changed = structuredClone(scene.adventure!) as typeof scene.adventure & {
			state: { packs: { pack: { records: { cost?: number }[] } }[] };
		};
		changed.state.packs[0].pack.records[0].cost = 1;
		expect(readAdventure(changed, scene).ok).toBe(false);
		// Or left out: the character and the monster name homebrew the story doesn't have.
		const without = structuredClone(scene.adventure!) as { state: Record<string, unknown> };
		delete without.state.packs;
		expect(readAdventure(without as typeof scene.adventure & object, scene).ok).toBe(false);
		// Or with code in it.
		const scripted = structuredClone(scene.adventure!) as typeof changed;
		(scripted.state.packs[0].pack as Record<string, unknown>).about = '<script>x</script>';
		expect(readAdventure(scripted, scene).ok).toBe(false);
	});

	it('stays while anything uses it, and goes when nothing does', () => {
		attach();
		ok(buildCharacter(room, ana, fighter(pack)));
		expect(detachPack(room, gm, pack)).toMatchObject({
			ok: false,
			message: 'That homebrew is in use: Brann carries or knows something from it.'
		});
		expect(detachPack(room, ana, pack)).toMatchObject({ ok: false, code: 'forbidden' });
		// Starting over keeps it with the story.
		ok(control(room, gm, 'restart'));
		expect(packsOf(room.adventure!)).toEqual([pack]);

		const rooms = new RoomManager();
		const fresh = ok(rooms.create('Gia'));
		room = fresh.room;
		gm = fresh.player;
		ok(startAdventure(room, gm, 'barrow'));
		attach();
		const gone = ok(detachPack(room, gm, pack));
		expect(texts(gone.log)).toEqual(['The GM puts away homebrew: The Cold Hill Armory.']);
		expect(room.adventure!.packs).toBeUndefined();
	});

	it('isn’t taken by rules that have none', () => {
		const rooms = new RoomManager();
		const created = ok(rooms.create('Gia'));
		room = created.room;
		gm = created.player;
		ok(startAdventure(room, gm, 'hollow-bell'));
		expect(attachPack(room, gm, examplePack())).toMatchObject({
			ok: false,
			message: 'These rules take no homebrew.'
		});
		expect(adventureView(room, gm, new Set(), null)!.packs).toBeNull();
	});
});
