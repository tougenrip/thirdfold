// Campaigns in the engine (milestone 58): a story started for a campaign
// brings its active characters, keeps each for its player, and is returned
// to the campaign once: history, a full rest, a level, the gear carried and
// the characters met on the way. Two adventures in a row, one party.

import { beforeEach, describe, expect, it } from 'vitest';
import { dndExampleAdventure } from '../../src/lib/adventure/dnd-example';
import type { DieRoller } from '../../src/lib/game/dice';
import { parseSceneFile } from '../../src/lib/game/scene-file';
import { pregenChoices } from '../../src/lib/rules/dnd55e/pregens';
import { changeRoster, closeStory, newCampaign, type CampaignRecord } from '../campaigns';
import { RoomManager, type Player, type Room } from '../rooms';
import { dnd55e } from '../rules/dnd55e';
import { exportScene } from '../scene-io';
import { loadCustomAdventure } from './custom';
import {
	afterMove,
	beginAdventure,
	buildCharacter,
	campaignReturned,
	campaignStory,
	characterOf,
	claimCharacter,
	decide,
	direct,
	interact,
	releaseCharacter,
	startAdventure
} from './engine';
import { readAdventure, saveAdventure } from './persist';
import { adventureView } from './view';

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}

const dice =
	(...rolls: number[]): DieRoller =>
	() =>
		rolls.shift() ?? 10;

const DND = { id: 'dnd-5.5e', version: 1 };
const progression = dnd55e.progression!;

describe('a campaign carried through two adventures', () => {
	let room: Room;
	let gm: Player;
	let ana: Player;
	let ben: Player;
	let record: CampaignRecord;

	beforeEach(() => {
		const rooms = new RoomManager();
		const created = ok(rooms.create('Gia'));
		room = created.room;
		gm = created.player;
		ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
		ben = ok(rooms.join(room.id, 'Ben', 'player')).player;
		room.dice = () => 10;
		record = ok(newCampaign('a'.repeat(64), 'The Long Road', DND)).record;
	});

	/** The Hillside Shrine, from its door to its ending, with Ana as Brakka and Ben's own wizard. */
	function playShrine() {
		const custom = ok(loadCustomAdventure(dndExampleAdventure()));
		ok(startAdventure(room, gm, custom.adventure.id, record));
		expect(room.adventure!.campaign).toMatchObject({ id: record.id, members: [], closed: false });
		ok(claimCharacter(room, ana, 'brakka'));
		const ilse = { ...pregenChoices('wizard')!, name: 'Odile' };
		ok(buildCharacter(room, ben, ilse));
		expect(characterOf(room, ben.id)!.id).toBe('pc-1');
		ok(beginAdventure(room, gm, 1000));
		const brakka = () => characterOf(room, ana.id)!;
		brakka().token.pos = { x: 4, y: 8 };
		ok(interact(room, ana, 'inscription', 'examine', dice(15)));
		brakka().token.pos = { x: 9, y: 3 };
		ok(interact(room, ana, 'chest', 'open', dice(18)));
		brakka().token.pos = { x: 6, y: 6 };
		afterMove(room, brakka().token, null);
		expect(campaignStory(room, gm)).toMatchObject({
			ok: false,
			message: 'Finish the fight first.'
		});
		ok(direct(room, gm, { op: 'encounter_end', result: 'won' }));
		ok(decide(room, ana, 'shrine', 'restore'));
		expect(room.adventure!.stage).toBe('complete');
	}

	function returnStory(advance = true) {
		const { story, campaign } = ok(campaignStory(room, gm));
		expect(campaign).toBe(record.id);
		const closed = closeStory(record, story, advance);
		if (!closed.ok) throw new Error(closed.message);
		record = closed.returned.record;
		return { story, lines: ok(campaignReturned(room, closed.returned.lines)).log };
	}

	it('finishes one adventure, returns to the campaign, and begins the next with the same party', () => {
		playShrine();
		expect(campaignStory(room, ana)).toMatchObject({ ok: false, code: 'forbidden' });
		const { story, lines } = returnStory();
		expect(story).toMatchObject({
			title: 'The Hillside Shrine',
			outcome: 'complete',
			ending: 'The Shrine Restored',
			members: []
		});
		expect(lines.map((m) => m.kind === 'system' && m.text)).toEqual(
			expect.arrayContaining([
				'The Hillside Shrine is written into The Long Road.',
				'Brakka reaches level 2: Orc Fighter 2 (Soldier).',
				'Odile reaches level 2: Elf Wizard 2 (Sage).'
			])
		);
		// Once, and only once.
		expect(campaignStory(room, gm)).toMatchObject({ ok: false, code: 'forbidden' });
		expect(adventureView(room, ana, new Set(room.tokens.keys()), null)!.campaign).toEqual({
			id: record.id,
			name: 'The Long Road',
			members: [],
			closed: true
		});

		// Both wait on the roster for the GM: Odile under her own id, Brakka under the next free one.
		expect(record.roster.map((e) => [e.id, e.status, e.player])).toEqual([
			['pc-2', 'pending', 'Ana'],
			['pc-1', 'pending', 'Ben']
		]);
		expect(record.history[0].characters).toEqual([
			{ id: 'pc-2', name: 'Brakka', fate: 'alive', level: 1, advancedTo: 2 },
			{ id: 'pc-1', name: 'Odile', fate: 'alive', level: 1, advancedTo: 2 }
		]);
		// Not approved yet: nobody comes along.
		ok(startAdventure(room, gm, 'barrow', record));
		expect(room.adventure!.built).toBeUndefined();
		record = ok(changeRoster(record, { op: 'approve', character: 'pc-1' })).record;
		record = ok(changeRoster(record, { op: 'approve', character: 'pc-2' })).record;

		// The Barrow on Cold Hill, for the campaign: its own four, and the campaign's two.
		const started = ok(startAdventure(room, gm, 'barrow', record));
		expect(
			started.log.some((m) => m.kind === 'system' && /Brakka, Odile come along/.test(m.text))
		).toBe(true);
		const adventure = room.adventure!;
		expect([...adventure.built!.keys()]).toEqual(['pc-2', 'pc-1']);
		const brakka = adventure.built!.get('pc-2')!;
		expect(progression.describe(brakka.saved)).toMatchObject({ name: 'Brakka', level: 2 });
		// Level 2 in full health, with the dagger found in the shrine.
		const card = dnd55e.card(brakka.def, new Map());
		expect(card.level).toBe(2);
		expect(brakka.def.hp).toBe(20);
		expect(card.inventory?.some((i) => /Dagger/.test(i.name))).toBe(true);

		// Each is kept for its player.
		expect(claimCharacter(room, ben, 'pc-2')).toMatchObject({
			ok: false,
			message: 'Brakka is Ana’s in The Long Road.'.replace('’', "'")
		});
		ok(claimCharacter(room, ana, 'pc-2'));
		ok(claimCharacter(room, ben, 'pc-1'));
		// Putting one back leaves it with the story.
		ok(releaseCharacter(room, ben));
		expect(adventure.built!.has('pc-1')).toBe(true);
		ok(claimCharacter(room, ben, 'pc-1'));

		// Saved and read back: the campaign, its members and their state come back checked.
		const scene = parseSceneFile(JSON.parse(JSON.stringify(exportScene(room, 'Barrow'))));
		if (!scene.ok) throw new Error(scene.error);
		const back = ok(readAdventure(saveAdventure(adventure), scene.scene)).adventure;
		expect(back.campaign).toEqual(adventure.campaign);
		expect(back.built!.get('pc-2')!.def.hp).toBe(20);
		const tampered = saveAdventure(adventure) as unknown as {
			state: { campaign: { members: { id: string }[] } };
		};
		tampered.state.campaign.members[0].id = 'pc-7';
		expect(readAdventure(tampered as never, scene.scene).ok).toBe(false);
	});

	it('refuses an adventure under other rules, and a second start before the story is returned', () => {
		expect(startAdventure(room, gm, 'hollow-bell', record)).toMatchObject({
			ok: false,
			message: expect.stringContaining('The Long Road plays by')
		});
		playShrine();
		expect(startAdventure(room, gm, 'barrow', record)).toMatchObject({
			ok: false,
			message: 'Return The Hillside Shrine to The Long Road before the next adventure.'
		});
		// An abandoned story goes back too, with nobody advanced.
		ok(startAdventure(room, gm, 'barrow'));
	});

	it('remembers the fallen and advances nobody when the party is defeated', () => {
		playShrine();
		room.adventure!.characters.get('pc-1')!.dead = true;
		room.adventure!.stage = 'defeat';
		const { story } = returnStory();
		expect(story.outcome).toBe('defeat');
		expect(record.roster.map((e) => [e.id, progression.describe(e.saved)!.level])).toEqual([
			['pc-2', 1]
		]);
	});
});
