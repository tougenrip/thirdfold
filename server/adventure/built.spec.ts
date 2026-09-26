import { beforeEach, describe, expect, it } from 'vitest';
import type { CreatorChoices } from '../../src/lib/rules/dnd55e/creator';
import { RoomManager, type Player, type Room } from '../rooms';
import { exportScene } from '../scene-io';
import {
	beginAdventure,
	buildCharacter,
	characterOf,
	claimCharacter,
	control,
	creatorOptions,
	previewCharacter,
	releaseCharacter,
	startAdventure
} from './engine';
import { readAdventure, saveAdventure } from './persist';
import { adventureView } from './view';

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}

const srd = (kind: string, slug: string) => `srd-5.2.1:${kind}:${slug}`;

/** A level 1 Dwarf Cleric, as a creation page sends it. */
const cleric = (): CreatorChoices => ({
	name: 'Brannoc',
	color: '#d68910',
	species: { id: srd('species', 'dwarf'), options: {}, feat: null },
	background: { id: srd('background', 'acolyte'), increases: { wis: 2, cha: 1 } },
	class: {
		id: srd('class', 'cleric'),
		skills: ['medicine', 'history'],
		expertise: [],
		fightingStyle: null,
		weaponMasteries: []
	},
	abilities: {
		method: 'standard-array',
		base: { str: 14, dex: 10, con: 13, int: 8, wis: 15, cha: 12 }
	},
	armor: { worn: srd('armor', 'chain-shirt'), shield: true },
	weapons: [srd('weapon', 'mace')]
});

let rooms: RoomManager;
let room: Room;
let gm: Player;
let ana: Player;
let cai: Player;
let sam: Player;

beforeEach(() => {
	rooms = new RoomManager();
	const created = ok(rooms.create('Gia'));
	room = created.room;
	gm = created.player;
	ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
	cai = ok(rooms.join(room.id, 'Cai', 'player')).player;
	sam = ok(rooms.join(room.id, 'Sam', 'spectator')).player;
	room.dice = () => 10;
	ok(startAdventure(room, gm, 'barrow'));
});

describe('players building their own characters', () => {
	it('builds a legal character, bound to its player, beside the story’s own', () => {
		expect(adventureView(room, cai, new Set(room.tokens.keys()), null)!.build).toEqual({
			rules: 'dnd-5.5e'
		});
		ok(claimCharacter(room, ana, 'veil'));
		const { log } = ok(buildCharacter(room, cai, cleric()));
		expect(log.map((m) => (m.kind === 'system' || m.kind === 'narration' ? m.text : ''))).toEqual([
			'Cai is playing Brannoc, Dwarf Cleric 1 (Acolyte).',
			'Brannoc joins the party: a Dwarf Cleric, once an acolyte. A torch in hand, and mace ready.'
		]);
		const mine = characterOf(room, cai.id)!;
		expect(mine.id).toBe('pc-1');
		expect(mine.token).toMatchObject({
			ownerId: cai.id,
			model: 'saint',
			color: '#d68910',
			light: 2
		});
		// Dwarf Cleric 1: d8 + Constitution 1 + Dwarven Toughness 1; chain shirt 13 + Dexterity 0 + Shield 2.
		expect(mine.def).toMatchObject({ hp: 10, armor: 15, speed: 6 });
		expect(mine.state.hp).toBe(10);
		const view = adventureView(room, cai, new Set(room.tokens.keys()), null)!;
		const card = view.characters.find((c) => c.id === 'pc-1')!;
		expect(card).toMatchObject({ inPlay: true, playerId: cai.id });
		expect(card.card).toMatchObject({
			title: 'Dwarf Cleric 1 (Acolyte)',
			defense: { name: 'Armor Class', value: 15 }
		});
		// The story's own characters are still there to choose.
		expect(view.characters.map((c) => c.id)).toEqual(['warden', 'veil', 'ember', 'saint', 'pc-1']);
		ok(beginAdventure(room, gm, 1000));
		expect(room.adventure!.stage).toBe('playing');
	});

	it('answers a creation page: options and previews change nothing', () => {
		const options = ok(creatorOptions(room));
		expect(options.rules).toBe('dnd-5.5e');
		expect((options.options.classes as unknown[]).length).toBe(12);
		const preview = ok(previewCharacter(room, cleric())).preview;
		expect(preview).toMatchObject({
			ok: true,
			summary: { title: 'Dwarf Cleric 1 (Acolyte)', hp: 10 }
		});
		expect(
			ok(previewCharacter(room, { ...cleric(), weapons: [srd('weapon', 'longsword')] })).preview
		).toEqual({ ok: false, problems: ["Cleric isn't trained with Longsword"] });
		expect(room.adventure!.built).toBeUndefined();
		expect(room.tokens.size).toBe(0);
	});

	it('refuses who may not build, and what may not be built', () => {
		expect(buildCharacter(room, gm, cleric())).toMatchObject({
			ok: false,
			message: 'Only players can build a character.'
		});
		expect(buildCharacter(room, sam, cleric())).toMatchObject({ ok: false, code: 'forbidden' });
		expect(
			buildCharacter(room, cai, { ...cleric(), weapons: [srd('weapon', 'longsword')] })
		).toEqual({
			ok: false,
			code: 'invalid_message',
			message: "That character can't be made: Cleric isn't trained with Longsword."
		});
		ok(claimCharacter(room, cai, 'saint'));
		expect(buildCharacter(room, cai, cleric())).toMatchObject({
			ok: false,
			message: 'You are already playing The Saint.'
		});
		expect(room.adventure!.built).toBeUndefined();

		// A story with its own characters only: The Hollow Bell.
		const other = ok(rooms.create('Hal'));
		const pip = ok(rooms.join(other.room.id, 'Pip', 'player')).player;
		ok(startAdventure(other.room, other.player, 'hollow-bell'));
		expect(buildCharacter(other.room, pip, cleric())).toMatchObject({
			ok: false,
			message: 'This story has its own characters to choose from.'
		});
		expect(creatorOptions(other.room)).toMatchObject({ ok: false, code: 'forbidden' });
		expect(adventureView(other.room, pip, new Set(), null)!.build).toBeNull();
	});

	it('puts a built character back with its player before play, and keeps it through a restart', () => {
		ok(buildCharacter(room, cai, cleric()));
		ok(releaseCharacter(room, cai));
		expect(room.adventure!.built?.size).toBe(0);
		expect(characterOf(room, cai.id)).toBeNull();

		ok(buildCharacter(room, cai, cleric()));
		ok(beginAdventure(room, gm, 1000));
		ok(control(room, gm, 'restart', 2000));
		const mine = characterOf(room, cai.id)!;
		expect(mine).toMatchObject({ id: 'pc-1', def: { name: 'Brannoc' } });
		expect(mine.token.ownerId).toBe(cai.id);
	});

	it('saves a built character with the story and restores it through the rules', () => {
		ok(claimCharacter(room, ana, 'veil'));
		ok(buildCharacter(room, cai, cleric()));
		ok(beginAdventure(room, gm, 1000));
		room.adventure!.characters.get('pc-1')!.hp = 4;
		const scene = exportScene(room, 'The Barrow');
		const saved = scene.adventure!;
		expect(Object.keys(saved.state.built as object)).toEqual(['pc-1']);
		const back = ok(readAdventure(saved, scene)).adventure;
		expect(back.built!.get('pc-1')!.def).toEqual(room.adventure!.built!.get('pc-1')!.def);
		expect(back.characters.get('pc-1')!.hp).toBe(4);
		expect(saveAdventure(back)).toEqual(saved);

		// A built character changed in the file is refused, and the whole story with it.
		const tampered = structuredClone(saved);
		(tampered.state.built as Record<string, { character: { level: number } }>)[
			'pc-1'
		].character.level = 20;
		expect(readAdventure(tampered, scene)).toMatchObject({ ok: false });
		const renamed = structuredClone(saved);
		(renamed.state.built as Record<string, unknown>).warden = (
			renamed.state.built as Record<string, unknown>
		)['pc-1'];
		expect(readAdventure(renamed, scene)).toMatchObject({ ok: false });
	});
});
