import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../src/lib/game/chat';
import type { DieRoller } from '../../src/lib/game/dice';
import type { GridPos } from '../../src/lib/game/grid';
import { parseSceneFile } from '../../src/lib/game/scene-file';
import { RoomManager, type Player, type Room } from '../rooms';
import { applyScene, exportScene } from '../scene-io';
import {
	afterTokenDeleted,
	askAgain,
	beginAdventure,
	characterOf,
	claimCharacter,
	control,
	decide,
	interact,
	sense,
	startAdventure
} from './engine';
import { HEART_IDS, HEART_SPAWN } from '../adventures/hollow-bell/heart';
import {
	BESIDE_PIT,
	BY_TOBIN,
	HOLLOW_IDS,
	HOLLOW_SPAWN,
	hollowScene
} from '../adventures/hollow-bell/hollow';
import { HOLLOW_BELL } from '../adventures/hollow-bell/index';
import { recordOrigins } from './world';
import { readAdventure } from './persist';
import { adventureView } from './view';

const max: DieRoller = (sides) => sides;

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}

let room: Room;
let gm: Player;
let ana: Player;

/** The Warden (Ana) in the Hollow, the Keeper beaten, beside Tobin. */
beforeEach(() => {
	const rooms = new RoomManager();
	const created = ok(rooms.create('Gia'));
	room = created.room;
	gm = created.player;
	ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
	ok(startAdventure(room, gm));
	ok(claimCharacter(room, ana, 'warden'));
	ok(beginAdventure(room, gm, 1000));
	room.dice = max;
	const party = [...room.tokens.values()].filter((t) => t.ownerId);
	applyScene(room, hollowScene());
	party.forEach((t, i) => {
		t.pos = { ...HOLLOW_SPAWN[i] };
		room.tokens.set(t.id, t);
	});
	story().location = 'hollow';
	story().chapter = 'the_hollow';
	story().events.push('won_hollow');
	story().encounters.set('hollow', 'won');
	story().origins = recordOrigins(HOLLOW_BELL, room);
	put(BY_TOBIN);
});

const story = () => room.adventure!;
const me = () => characterOf(room, ana.id)!;
const put = (pos: GridPos) => {
	me().token.pos = { ...pos };
};
const texts = (log: ChatMessage[]) => log.flatMap((m) => ('text' in m ? [m.text] : []));
const light = (id: string) => room.lights.get(id);
const clearEnemies = () => {
	let last = { log: [] as ChatMessage[] };
	for (const id of [...(story().encounter?.enemies.keys() ?? [])]) {
		room.tokens.delete(id);
		last = afterTokenDeleted(room, id);
	}
	return last;
};
/** The finale's first three phases, straight through, to the choice. */
const toTheChoice = () => {
	ok(interact(room, ana, 'tobin'));
	put(BESIDE_PIT);
	ok(interact(room, ana, 'pit'));
	clearEnemies();
	put(BY_TOBIN);
	while (story().encounter) {
		const battle = story().encounter!;
		battle.current = battle.order.findIndex((t) => t.kind === 'character');
		battle.acted.clear();
		ok(interact(room, ana, 'bell-rope', 'pull'));
	}
	expect(story().pending).toBe('bell');
};
const ending = () => adventureView(room, ana, new Set(room.tokens.keys()), null)!.ending!;
/** The session is over: the story complete, nothing left to do in it. */
const expectOver = (at: number) => {
	expect(story()).toMatchObject({ stage: 'complete', completedAt: at, encounter: null });
	expect(story().sentries.size).toBe(0);
	expect(room.fog.revealed.every((v) => v === 1)).toBe(true);
	expect(interact(room, ana, 'tobin')).toMatchObject({ ok: false, message: 'This story is over.' });
	expect(sense(room, ana, 'listen')).toMatchObject({ ok: false });
};

describe('ending A: Silence', () => {
	it('destroyed: the Bell lies broken, and every light the Hollow gave goes out', () => {
		toTheChoice();
		ok(decide(room, ana, 'bell', 'destroy', 5000));
		const won = clearEnemies();
		expect(story().ending).toBe('silence');
		expect(room.props.get(HOLLOW_IDS.bell)?.assetId).toBe('broken-bell');
		expect(light('ho-bell-glow')?.on).toBe(false);
		expect(light('ho-pit-glow')?.on).toBe(false);
		expect(light('ho-lake-glow-1')?.on).toBe(false);
		expect(won.log).toContainEqual(
			expect.objectContaining({ cue: 'toll', text: expect.stringContaining('The Bell lies split') })
		);
		expect(texts(won.log)).toContain('The Hollow Bell: Silence. The Bell Broken.');
		expect(ending()).toMatchObject({
			id: 'silence',
			title: 'Silence',
			subtitle: 'The Bell Broken'
		});
		expect(ending().result).toContainEqual({ label: 'The Bell', value: 'Broken' });
		expect(story().stage).toBe('complete');
	});

	it('silenced: the Bell dark in its frame, and the eye below red and open', () => {
		toTheChoice();
		const end = ok(decide(room, ana, 'bell', 'silence', 5000));
		expect(story().ending).toBe('silence');
		expect(room.props.get(HOLLOW_IDS.bell)?.assetId).toBe('great-bell');
		expect(light('ho-bell-glow')?.on).toBe(false);
		expect(light('ho-pit-glow')).toMatchObject({ on: true, color: '#c0392b' });
		expect(texts(end.log).join(' ')).toContain('It will wake.');
		expect(ending()).toMatchObject({ subtitle: 'The Bell Silenced' });
		expect(ending().result).toContainEqual({ label: 'The Hollow', value: 'Beginning to wake' });
		expectOver(5000);
	});
});

describe('ending B: Descent', () => {
	it('takes the party down into the Hollow’s heart to confront it, and ends when it is stilled', () => {
		toTheChoice();
		const down = ok(decide(room, ana, 'bell', 'descend', 5000));
		expect(down.reset).toBe(true);
		expect(texts(down.log)).toContain(
			'You leave Tobin holding the rope and climb down into the pit, down a stair of roots, toward a light like a heart beating.'
		);
		expect(story()).toMatchObject({ chapter: 'the_descent', location: 'heart', stage: 'playing' });
		expect(room.sceneName).toBe('The Heart of the Hollow');
		expect(me().token.pos).toEqual(HEART_SPAWN[0]);
		expect(room.props.has(HEART_IDS.heart)).toBe(true);
		const foes = [...story().encounter!.enemies.values()].map((e) => e.kind);
		expect(foes).toEqual(['heart', 'tendril', 'tendril']);
		expect(adventureView(room, ana, new Set(), null)!.objectives.map((o) => o.id)).toEqual([
			'heart'
		]);

		const won = clearEnemies();
		expect(texts(won.log)).toContain(
			'The Heart shudders, slows, and stops. Around you the walls fall still, and the only sound is your own breath.'
		);
		expect(story().ending).toBe('descent');
		expect(light(HEART_IDS.heartLight)?.on).toBe(false);
		expect(ending()).toMatchObject({ id: 'descent', title: 'Descent', subtitle: 'Into the Heart' });
		expect(ending().result).toContainEqual({ label: 'The Hollow', value: 'Dead' });
		expect(ending().scene).toContain('The Heart lies still and grey');
		expect(story().events).toContain('chose_descent');
		expect(story().stage).toBe('complete');
	});
});

describe('ending C: Communion', () => {
	it('lights the whole Hollow a calm blue, and the party speaks with it', () => {
		toTheChoice();
		const end = ok(decide(room, ana, 'bell', 'use', 5000));
		expect(story().ending).toBe('communion');
		expect(room.ambient).toBe('dusk');
		expect(light('ho-bell-glow')).toMatchObject({ on: true, radius: 12 });
		expect(end.log).toContainEqual(
			expect.objectContaining({ cue: 'flash', text: expect.stringContaining('calm blue') })
		);
		expect(ending()).toMatchObject({
			id: 'communion',
			title: 'Communion',
			subtitle: 'The Bell Spoken'
		});
		expect(ending().result).toContainEqual({
			label: 'The Hollow',
			value: 'At peace, and listening'
		});
		expectOver(5000);
	});
});

describe('each ending’s final state', () => {
	it('is saved with the table and read back, the ending and its final scene alike', () => {
		toTheChoice();
		ok(decide(room, ana, 'bell', 'silence', 5000));
		const file = parseSceneFile(JSON.parse(JSON.stringify(exportScene(room, 'The end'))));
		if (!file.ok) throw new Error(file.error);
		expect(file.scene.lights.find((l) => l.id === 'ho-pit-glow')).toMatchObject({
			color: '#c0392b'
		});
		const read = readAdventure(file.scene.adventure!, file.scene);
		if (!read.ok) throw new Error(read.error);
		expect(read.adventure).toMatchObject({
			stage: 'complete',
			ending: 'silence',
			completedAt: 5000
		});
	});

	it('are three different endings, with different results', () => {
		const results = new Set<string>();
		for (const answer of ['destroy', 'silence', 'use', 'descend']) {
			// A fresh table for each answer.
			const rooms = new RoomManager();
			const created = ok(rooms.create('Gia'));
			room = created.room;
			gm = created.player;
			ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
			ok(startAdventure(room, gm));
			ok(claimCharacter(room, ana, 'warden'));
			ok(beginAdventure(room, gm, 1000));
			room.dice = max;
			const party = [...room.tokens.values()].filter((t) => t.ownerId);
			applyScene(room, hollowScene());
			party.forEach((t, i) => {
				t.pos = { ...HOLLOW_SPAWN[i] };
				room.tokens.set(t.id, t);
			});
			Object.assign(story(), { location: 'hollow', chapter: 'the_hollow' });
			story().events.push('won_hollow');
			story().origins = recordOrigins(HOLLOW_BELL, room);
			put(BY_TOBIN);
			toTheChoice();
			ok(decide(room, ana, 'bell', answer));
			if (story().encounter) clearEnemies();
			results.add(JSON.stringify(ending().result));
		}
		expect(results.size).toBe(4);
	});
});

describe('the session’s end', () => {
	const view = () => adventureView(room, ana, new Set(room.tokens.keys()), null)!;

	it('opens with a headline for each ending, and tallies what the party did', () => {
		expect(view().summary).toBeNull();
		toTheChoice();
		ok(decide(room, ana, 'bell', 'silence', 5000));
		expect(ending().headline).toBe('The Bell is silent');
		expect(view()).toMatchObject({ begunAt: 1000, completedAt: 5000 });
		expect(view().summary).toEqual({
			fightsWon: [...story().encounters.values()].filter((s) => s === 'won').length,
			foesDefeated: story().defeated.length,
			evidence: story().evidence.size,
			chapters: 12,
			again: []
		});
		expect(view().summary!.fightsWon).toBeGreaterThanOrEqual(2);
	});

	it('lets players ask the GM to play again, once each, and the GM replay with the same party', () => {
		expect(askAgain(room, ana)).toMatchObject({ ok: false, code: 'forbidden' });
		toTheChoice();
		ok(decide(room, ana, 'bell', 'use', 5000));
		expect(askAgain(room, gm)).toMatchObject({ ok: false, code: 'forbidden' });
		expect(texts(ok(askAgain(room, ana)).log)).toEqual(['Ana would like to play again.']);
		expect(ok(askAgain(room, ana)).log).toEqual([]);
		expect(view().summary!.again).toEqual([ana.id]);

		const replay = ok(control(room, gm, 'restart', 9000));
		expect(replay.reset).toBe(true);
		expect(story()).toMatchObject({
			stage: 'playing',
			chapter: 'village',
			location: 'bellweather',
			begunAt: 9000,
			completedAt: null,
			ending: null
		});
		expect(view().summary).toBeNull();
		expect(me().id).toBe('warden');
		expect(me().token.ownerId).toBe(ana.id);
	});
});
