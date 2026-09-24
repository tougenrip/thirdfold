import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../src/lib/game/chat';
import type { DieRoller } from '../../src/lib/game/dice';
import type { GridPos } from '../../src/lib/game/grid';
import { parseSceneFile } from '../../src/lib/game/scene-file';
import { RoomManager, type Player, type Room } from '../rooms';
import { applyScene, exportScene } from '../scene-io';
import {
	addClue,
	afterTokenDeleted,
	beginAdventure,
	characterOf,
	claimCharacter,
	control,
	decide,
	interact,
	startAdventure
} from './engine';
import { BESIDE_PIT, BY_TOBIN, HOLLOW_SPAWN, hollowScene } from '../adventures/hollow-bell/hollow';
import { HOLLOW_BELL } from '../adventures/hollow-bell/index';
import { recordOrigins } from './world';
import { readAdventure, saveAdventure } from './persist';
import { adventureView } from './view';

const max: DieRoller = (sides) => sides;

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}

let room: Room;
let gm: Player;
let ana: Player;
let ben: Player;

/** The Warden (Ana) and the Saint (Ben) in the Hollow, the Keeper beaten, beside Tobin. */
beforeEach(() => {
	const rooms = new RoomManager();
	const created = ok(rooms.create('Gia'));
	room = created.room;
	gm = created.player;
	ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
	ben = ok(rooms.join(room.id, 'Ben', 'player')).player;
	ok(startAdventure(room, gm));
	ok(claimCharacter(room, ana, 'warden'));
	ok(claimCharacter(room, ben, 'saint'));
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
	put(ana, BY_TOBIN);
	put(ben, { x: BY_TOBIN.x - 1, y: BY_TOBIN.y });
});

const story = () => room.adventure!;
const me = (player: Player) => characterOf(room, player.id)!;
const put = (player: Player, pos: GridPos) => {
	me(player).token.pos = { ...pos };
};
const texts = (log: ChatMessage[]) => log.flatMap((m) => ('text' in m ? [m.text] : []));
const kinds = () => [...(story().encounter?.enemies.values() ?? [])].map((e) => e.kind);
const findTobin = () => ok(interact(room, ana, 'tobin'));
/** Phase 1: look into the pit. */
const lookIn = () => {
	put(ana, BESIDE_PIT);
	return ok(interact(room, ana, 'pit'));
};
/** Clears every enemy off the table, as the GM would. */
const clearEnemies = () => {
	let last = { log: [] as ChatMessage[] };
	for (const id of [...(story().encounter?.enemies.keys() ?? [])]) {
		room.tokens.delete(id);
		last = afterTokenDeleted(room, id);
	}
	return last;
};
/** Makes it this player's character's turn, with its action unspent. */
const turnOf = (player: Player) => {
	const battle = story().encounter!;
	battle.current = battle.order.findIndex((t) => t.kind === 'character' && t.id === me(player).id);
	battle.acted.clear();
};
/** The GM ends turns until a new round begins, and returns what was said on the way. */
const nextRound = () => {
	const round = story().encounter!.round;
	const log: ChatMessage[] = [];
	while (story().encounter && story().encounter!.round === round) {
		log.push(...ok(control(room, gm, 'end_turn')).log);
	}
	return log;
};
/** Phase 3 reached with nobody left standing against the party. */
const toTheRinging = () => {
	findTobin();
	lookIn();
	clearEnemies();
	expect(story().chapter).toBe('the_ringing');
};
const pull = (player: Player) => {
	turnOf(player);
	return ok(interact(room, player, 'bell-rope', 'pull'));
};
const holdTheBell = () => {
	put(ana, BY_TOBIN);
	while (story().encounter) pull(ana);
};

describe('phase 1: the party discovers the Hollow', () => {
	it('stirs when Tobin is found, and wakes when the party looks into the pit', () => {
		const found = findTobin();
		expect(story().chapter).toBe('the_pit');
		expect(texts(found.log).join(' ')).toContain('Something down there heard you say his name.');
		const view = adventureView(room, ana, new Set(room.tokens.keys()), null)!;
		expect(view.objectives.find((o) => o.id === 'pit')).toMatchObject({ done: false });

		const looked = lookIn();
		expect(texts(looked.log).join(' ')).toContain('The Hollow is awake enough to see you.');
		expect(story().events).toContain('saw_hollow');
		expect(story().chapter).toBe('the_waking');
	});

	it('knows the party who saw its eye before: no need to look again', () => {
		addClue(room, story(), 'sleeper', null);
		expect(story().events).toContain('saw_hollow');
		const found = findTobin();
		expect(texts(found.log)).toContain(
			'You have seen that eye before, from the pit’s edge. Now it opens wide, and it knows you.'
		);
		expect(story().chapter).toBe('the_waking');
	});
});

describe('phase 2: the environment becomes dangerous', () => {
	it('sends up tendrils and cracks the floor under the party', () => {
		findTobin();
		const woke = lookIn();
		expect(texts(woke.log)).toContain(
			'The Hollow stirs. The island shudders, cracks run across the stone, and pale tendrils come up out of the pit, feeling for the warm things standing on it.'
		);
		expect(story().encounter).toMatchObject({ id: 'waking', finale: 'waking' });
		expect(kinds()).toEqual(['tendril', 'tendril', 'tendril']);
		const cracks = story().encounter!.cracks!;
		expect(cracks).toContainEqual(BESIDE_PIT);
		expect(cracks).toContainEqual(me(ben).token.pos);
		expect(room.props.get(`ho-crack-${BESIDE_PIT.x}-${BESIDE_PIT.y}`)).toMatchObject({
			assetId: 'crack'
		});
	});

	it('remembers a hand that touched the Bell: one more tendril', () => {
		story().objects.set('bell', 'used');
		findTobin();
		const woke = lookIn();
		expect(kinds()).toHaveLength(4);
		expect(texts(woke.log)).toContain(
			'It remembers the hand that touched the Bell. More of it comes up to find you.'
		);
	});

	it('hurts whoever is still on a crack when the floor heaves, not whoever stepped off', () => {
		findTobin();
		lookIn();
		// Ben steps off his crack; Ana stays on hers.
		put(ben, { x: 20, y: 16 });
		const hpAna = me(ana).state.hp;
		const hpBen = me(ben).state.hp;
		const log = texts(nextRound());
		expect(log).toContain('The floor heaves.');
		expect(log).toContain('The Warden is caught as the stone gives way: 6 damage.');
		expect(me(ana).state.hp).toBe(hpAna - 6);
		expect(me(ben).state.hp).toBe(hpBen);
		// New cracks open where the party stands now.
		expect(story().encounter!.cracks).toContainEqual({ x: 20, y: 16 });
	});
});

describe('phase 3: the Bell becomes part of the fight', () => {
	it('starts ringing itself once the tendrils are down, or by the third round', () => {
		findTobin();
		lookIn();
		clearEnemies();
		expect(story()).toMatchObject({ chapter: 'the_ringing' });
		expect(story().encounter).toMatchObject({ finale: 'ringing', pulls: 0 });
		expect(story().objects.get('bell-rope')).toBe('interactable');
	});

	it('comes by the third round even with tendrils still standing', () => {
		findTobin();
		lookIn();
		put(ana, { x: 20, y: 16 });
		put(ben, { x: 21, y: 16 });
		nextRound();
		expect(story().chapter).toBe('the_waking');
		nextRound();
		expect(story().chapter).toBe('the_ringing');
		expect(kinds()).toContain('tendril');
	});

	it('rings itself each round nobody pulled the rope: it hurts, flashes, and calls up more', () => {
		toTheRinging();
		put(ana, BY_TOBIN);
		put(ben, { x: 20, y: 16 });
		const log = nextRound();
		expect(log).toContainEqual(
			expect.objectContaining({ text: 'The Bell rings itself.', cue: 'flash' })
		);
		expect(texts(log)).toContain('The note goes through The Warden: 6 damage.');
		expect(texts(log).some((t) => t.includes('through The Saint'))).toBe(false);
		expect(kinds()).toEqual(['tendril']);
		// A round the rope was pulled, it strains and is still.
		pull(ana);
		expect(texts(nextRound())).toContain('The Bell strains against the rope, and is still.');
	});

	it('is held by three pulls, each a character’s action on its turn', () => {
		toTheRinging();
		put(ana, BY_TOBIN);
		put(ben, { x: BY_TOBIN.x + 2, y: BY_TOBIN.y });
		// Not Ben's turn: he can't pull.
		turnOf(ana);
		expect(interact(room, ben, 'bell-rope', 'pull')).toMatchObject({ code: 'not_your_turn' });
		const first = ok(interact(room, ana, 'bell-rope', 'pull'));
		expect(texts(first.log)).toContain(`The Bell’s swing shortens. (1 of 3)`);
		expect(interact(room, ana, 'bell-rope', 'pull')).toMatchObject({ code: 'not_your_turn' });
		expect(adventureView(room, ana, new Set(room.tokens.keys()), null)!.encounter?.counter).toEqual(
			{
				label: 'Bell held',
				count: 1,
				of: 3
			}
		);
		pull(ben);
		const held = pull(ana);
		expect(texts(held.log)).toContain(
			'The Bell hangs still, humming, held, and every tendril in the cavern goes slack and sinks back into the pit. Below, the great eye watches you, and waits.'
		);
		expect(story().encounter).toBeNull();
		expect(story().encounters.get('waking')).toBe('won');
		expect([...room.props.keys()].some((id) => id.startsWith('ho-crack-'))).toBe(false);
		expect(story()).toMatchObject({ chapter: 'final_decision', pending: 'bell' });
	});

	it('gets Tobin’s help if the party freed him with Pell’s name', () => {
		addClue(room, story(), 'promise', null);
		findTobin();
		ok(interact(room, ana, 'tobin'));
		expect(story().said.has('tobin:pell')).toBe(true);
		lookIn();
		const rang = clearEnemies();
		expect(texts(rang.log).join(' ')).toContain('Tobin says, in his own voice');
		expect(story().encounter).toMatchObject({ pulls: 1 });
	});

	it('answers the hand bell from anywhere, as good as a pull', () => {
		story().carried.set('handbell', me(ben).id);
		story().objects.set('handbell', 'carried');
		toTheRinging();
		put(ben, { x: 20, y: 16 });
		turnOf(ben);
		const rung = ok(interact(room, ben, 'handbell', 'ring'));
		expect(texts(rung.log)).toContain(
			`You ring the little hand bell, and the great Bell answers it, and checks, as if listening. (1 of 3)`
		);
	});

	it('also knows the ringers’ rule, if the party read it', () => {
		addClue(room, story(), 'rule', null);
		expect(story().events).toContain('learned_rule');
		toTheRinging();
		const view = adventureView(room, ana, new Set(room.tokens.keys()), null)!;
		expect(view.objectives.map((o) => o.id)).toEqual(expect.arrayContaining(['hold', 'rule']));
	});
});

describe('phase 4: the party decides what becomes of the Bell', () => {
	const choose = (option: string) => {
		toTheRinging();
		holdTheBell();
		return ok(decide(room, ana, 'bell', option, 9000));
	};

	it('silence: the Hollow begins to awaken', () => {
		story().decisions.set('promise', { option: 'silence', by: 'The Warden' });
		toTheRinging();
		holdTheBell();
		const labels = adventureView(room, ana, new Set(), null)!.decision!.options.map((o) => o.label);
		expect(labels).toContain('Silence the Bell, as you promised Oswin');
		const end = ok(decide(room, ana, 'bell', 'silence', 9000));
		expect(story()).toMatchObject({ stage: 'complete', ending: 'silence' });
		expect(texts(end.log).join(' ')).toContain('It will wake.');
		expect(texts(end.log)).toContain(
			'You kept your promise to Oswin: the Bell is silent. He will spend what is left of his life listening for what it held down.'
		);
	});

	it('use: the party speaks with the Hollow, and what it makes of them depends on what they know', () => {
		const end = choose('use');
		expect(story()).toMatchObject({ stage: 'complete', ending: 'communion' });
		expect(texts(end.log)).toContain(
			'It does not understand you, not all of it. But it lets you go.'
		);
	});

	it('use, knowing the rule and the eye: the Hollow understands', () => {
		addClue(room, story(), 'rule', null);
		addClue(room, story(), 'sleeper', null);
		// Having seen the eye, they go straight from Tobin into its waking.
		findTobin();
		expect(story().chapter).toBe('the_waking');
		clearEnemies();
		holdTheBell();
		const labels = adventureView(room, ana, new Set(), null)!.decision!.options.map((o) => o.label);
		expect(labels).toContain(
			'Use the Bell: ring it as the ringers did, and speak to what is below'
		);
		const end = ok(decide(room, ana, 'bell', 'use', 9000));
		const said = texts(end.log).join(' ');
		expect(said).toContain('the Hollow knows the voice of its old keepers');
		expect(said).toContain('for the first time in forty years it closes');
	});

	it('destroy: the Hollow attacks, and only surviving it ends the story', () => {
		const chosen = choose('destroy');
		expect(texts(chosen.log)).toContain(
			'You set your weapons to the Bell. The eye below widens, and the whole Hollow rises to stop you.'
		);
		expect(story()).toMatchObject({ stage: 'playing', ending: null });
		expect(story().encounter?.id).toBe('wrath');
		expect(kinds()).toEqual(['hand', 'tendril', 'tendril']);
		const won = clearEnemies();
		expect(texts(won.log)).toContain(
			'The Hand falls back into the pit, and you bring the Bell down. It cracks with a sound like the end of the world.'
		);
		expect(story()).toMatchObject({ stage: 'complete', ending: 'silence' });
	});
});

describe('saving the finale', () => {
	it('keeps the phase, the cracks and the pulls through a save', () => {
		toTheRinging();
		put(ana, BY_TOBIN);
		pull(ana);
		const file = parseSceneFile(JSON.parse(JSON.stringify(exportScene(room, 'The ringing'))));
		if (!file.ok) throw new Error(file.error);
		const read = readAdventure(file.scene.adventure!, file.scene);
		if (!read.ok) throw new Error(read.error);
		expect(read.adventure.encounter).toMatchObject({ finale: 'ringing', pulls: 1, pulled: true });
		expect(saveAdventure(read.adventure)).toEqual(saveAdventure(story()));
	});

	it('reads saves from before the finale had phases: their Bell choices and endings', () => {
		toTheRinging();
		holdTheBell();
		ok(decide(room, ana, 'bell', 'use'));
		const file = parseSceneFile(JSON.parse(JSON.stringify(exportScene(room, 'Done'))));
		if (!file.ok) throw new Error(file.error);
		const state = file.scene.adventure!.state as Record<string, unknown>;
		(state.decisions as Record<string, { option: string }>).bell.option = 'ring';
		state.ending = 'kept';
		const read = readAdventure(file.scene.adventure!, file.scene);
		if (!read.ok) throw new Error(read.error);
		expect(read.adventure.decisions.get('bell')?.option).toBe('use');
		expect(read.adventure.ending).toBe('communion');
	});
});
