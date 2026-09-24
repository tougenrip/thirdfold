import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../src/lib/game/chat';
import type { DieRoller } from '../../src/lib/game/dice';
import type { GridPos } from '../../src/lib/game/grid';
import type { Direction } from '../../src/lib/game/protocol';
import { RoomManager, type Player, type Room } from '../rooms';
import {
	afterTokenDeleted,
	beginAdventure,
	characterOf,
	claimCharacter,
	decide,
	direct,
	patrol,
	startAdventure
} from './engine';
import { DECISIONS } from '../adventures/hollow-bell/story';
import { adventureView } from './view';

const max: DieRoller = (sides) => sides;

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}

let room: Room;
let gm: Player;
let ana: Player;

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
});

const story = () => room.adventure!;
const me = () => characterOf(room, ana.id)!;
const gmDo = (direction: Direction) => direct(room, gm, direction);
const texts = (log: ChatMessage[]) => log.flatMap((m) => ('text' in m ? [m.text] : []));
const director = () => adventureView(room, gm, new Set(room.tokens.keys()), null)!.director!;
/** A free cell `n` steps east of the character (the valley road runs east-west). */
const beside = (n = 1): GridPos => ({ x: me().token.pos.x + n, y: me().token.pos.y });
const enemies = () => [...(story().encounter?.enemies.values() ?? [])].map((e) => e.kind);

describe('directing the story', () => {
	it('is the GM’s alone, and only once the story has begun', () => {
		expect(direct(room, ana, { op: 'skip' })).toMatchObject({ ok: false, code: 'forbidden' });
		ok(startAdventure(room, gm));
		expect(gmDo({ op: 'skip' })).toMatchObject({ ok: false, message: 'Begin the story first.' });
		expect(adventureView(room, ana, new Set(), null)!.director).toBeNull();
	});

	it('makes a story event happen, as if the party had done it', () => {
		expect(director().events.map((e) => e.id)).toContain('talked_maren');
		const done = ok(gmDo({ op: 'event', event: 'talked_maren' }));
		expect(done.log[0]).toMatchObject({ kind: 'system', audience: 'gm' });
		expect(story().events).toContain('talked_maren');
		expect(director().events.map((e) => e.id)).not.toContain('talked_maren');
		expect(gmDo({ op: 'event', event: 'talked_maren' })).toMatchObject({
			ok: false,
			message: 'That has already happened.'
		});
		expect(gmDo({ op: 'event', event: 'nonsense' })).toMatchObject({
			ok: false,
			code: 'invalid_message'
		});
	});

	it('counts a fight as won when the GM raises what winning it would', () => {
		ok(gmDo({ op: 'event', event: 'well_clue' }));
		expect(story().encounter?.id).toBe('well');
		const [hound] = story().encounter!.enemies.keys();
		ok(gmDo({ op: 'event', event: 'won_well' }));
		expect(story().encounter).toBeNull();
		expect(story().encounters.get('well')).toBe('won');
		expect(room.tokens.has(hound)).toBe(false);
		expect(story().objects.get('gate')).toBe('opened');
	});
});

describe('skipping a scene', () => {
	it('moves the story on a chapter, winning the fight at hand first', () => {
		expect(director().skip).toBe('What the bell woke');
		ok(gmDo({ op: 'skip' }));
		expect(story().chapter).toBe('discover_bell');
		expect(story().encounter?.id).toBe('well');
		expect(director().skip).toBe('Win the fight (The Hound at the well)');

		const won = ok(gmDo({ op: 'skip' }));
		expect(texts(won.log)).toContain('The fight is won in 1 round.');
		expect(story()).toMatchObject({ chapter: 'discover_bell', encounter: null });
		expect(story().events).toContain('won_well');

		const left = ok(gmDo({ op: 'skip' }));
		expect(left.reset).toBe(true);
		expect(story()).toMatchObject({ chapter: 'investigate_monastery', location: 'monastery' });
	});

	it('waits for a choice put to the party', () => {
		ok(gmDo({ op: 'event', event: 'talked_oswin' }));
		expect(story().pending).toBe('promise');
		expect(director().skip).toBeNull();
		expect(gmDo({ op: 'skip' })).toMatchObject({ ok: false, code: 'forbidden' });
	});

	it('runs The Hollow Bell from start to finish with nothing but the GM’s controls', () => {
		const chapters = [story().chapter as string];
		for (let i = 0; i < 40 && story().stage === 'playing'; i++) {
			const pending = story().pending;
			if (pending) {
				const option =
					pending === 'bell' ? 'use' : DECISIONS[pending as keyof typeof DECISIONS].options[0].id;
				ok(decide(room, gm, pending, option));
			} else ok(gmDo({ op: 'skip' }));
			if (chapters.at(-1) !== story().chapter) chapters.push(story().chapter);
		}
		expect(story()).toMatchObject({ stage: 'complete', ending: 'communion' });
		expect(chapters).toEqual([
			'village',
			'discover_bell',
			'investigate_monastery',
			'enter_monastery',
			'discover_hidden_chamber',
			'bell_rings',
			'descend',
			'the_hollow',
			'the_pit',
			'the_waking',
			'the_ringing',
			'final_decision'
		]);
		expect(me().state.dead).toBe(false);
		expect(gmDo({ op: 'skip' })).toMatchObject({ ok: false, message: 'This story is over.' });
	});
});

describe('fights', () => {
	it('starts one of the story’s fights where it is fought, and calls it off again', () => {
		expect(director().encounters.map((e) => e.id)).toEqual(['well', 'ambush']);
		expect(gmDo({ op: 'encounter_start', encounter: 'chamber' })).toMatchObject({
			ok: false,
			message: 'That fight is fought at The Monastery.'
		});
		expect(gmDo({ op: 'encounter_start', encounter: 'ambush' })).toMatchObject({ ok: false });

		ok(gmDo({ op: 'encounter_start', encounter: 'well' }));
		expect(enemies()).toEqual(['hound']);
		expect(gmDo({ op: 'encounter_start', encounter: 'well' })).toMatchObject({ ok: false });
		const [hound] = story().encounter!.enemies.keys();

		me().state.hp = 0;
		ok(gmDo({ op: 'encounter_end', result: 'called_off' }));
		expect(story().encounter).toBeNull();
		expect(story().encounters.has('well')).toBe(false);
		expect(room.tokens.has(hound)).toBe(false);
		expect(me().state.hp).toBe(1);
		expect(story().events).not.toContain('won_well');
		// It can be fought again.
		ok(gmDo({ op: 'encounter_start', encounter: 'well' }));
		expect(story().encounter?.id).toBe('well');
	});

	it('ends a fight as won, and the story hears of it', () => {
		ok(gmDo({ op: 'encounter_start', encounter: 'well' }));
		ok(gmDo({ op: 'encounter_end', result: 'won' }));
		expect(story().encounters.get('well')).toBe('won');
		expect(story().events).toContain('won_well');
		expect(story().defeated).toContain('Hollow Hound');
		expect(gmDo({ op: 'encounter_end', result: 'won' })).toMatchObject({ ok: false });
	});
});

describe('bringing on enemies', () => {
	it('stands them on guard (paused, nobody is spotted), and the GM’s own fight starts with them', () => {
		room.paused = true;
		ok(gmDo({ op: 'spawn', kind: 'cultist', pos: beside(3) }));
		expect(story().encounter).toBeNull();
		expect(director().foes).toEqual([expect.objectContaining({ name: 'Bell Cultist', hp: null })]);
		expect(patrol(room)).toBeNull();

		ok(gmDo({ op: 'encounter_start', encounter: 'ambush' }));
		expect(enemies()).toEqual(['cultist']);
		const won = ok(gmDo({ op: 'encounter_end', result: 'won' }));
		expect(texts(won.log)).toContain('The fight is won in 1 round.');
		expect(story().chapter).toBe('village');
	});

	it('starts the fight at once when one of them spots the party', () => {
		ok(gmDo({ op: 'spawn', kind: 'hound', pos: beside(2) }));
		expect(story().encounter?.id).toBe('ambush');
	});

	it('adds one to the fight at hand, in the turn order', () => {
		ok(gmDo({ op: 'encounter_start', encounter: 'well' }));
		const before = story().encounter!.order.length;
		ok(gmDo({ op: 'spawn', kind: 'tendril', pos: beside(2) }));
		expect(enemies()).toEqual(['hound', 'tendril']);
		expect(story().encounter!.order).toHaveLength(before + 1);
		expect(director().foes.map((f) => f.name)).toEqual(['Hollow Hound', 'Hollow Tendril']);
	});

	it('refuses a cell that is taken or off the table, or a kind the story has not got', () => {
		expect(gmDo({ op: 'spawn', kind: 'hound', pos: me().token.pos })).toMatchObject({
			code: 'cell_occupied'
		});
		expect(gmDo({ op: 'spawn', kind: 'hound', pos: { x: -1, y: 0 } })).toMatchObject({
			code: 'invalid_position'
		});
		expect(gmDo({ op: 'spawn', kind: 'dragon', pos: beside(2) })).toMatchObject({
			code: 'invalid_message'
		});
	});

	it('takes back an enemy the GM brought on without clearing any of the story’s fights', () => {
		room.paused = true;
		ok(gmDo({ op: 'spawn', kind: 'cultist', pos: beside(3) }));
		const [id] = story().sentries.keys();
		room.tokens.delete(id);
		expect(afterTokenDeleted(room, id).log).toEqual([]);
		expect(director().foes).toEqual([]);
	});
});

describe('the GM’s view of the table', () => {
	it('lists the people here, to pick and move', () => {
		expect(director().people.map((p) => p.name)).toContain('Maren');
	});
});
