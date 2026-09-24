import { beforeEach, describe, expect, it } from 'vitest';
import type { DieRoller } from '../../src/lib/game/dice';
import type { GridPos } from '../../src/lib/game/grid';
import { parseSceneFile } from '../../src/lib/game/scene-file';
import { RoomManager, type Player, type Room } from '../rooms';
import { applyScene, exportScene } from '../scene-io';
import {
	afterTokenDeleted,
	beginAdventure,
	characterOf,
	claimCharacter,
	interact,
	pendingMechanisms,
	runMechanism,
	setObject,
	startAdventure
} from './engine';
import { MONASTERY_IDS, MONASTERY_SPAWN, monasteryScene } from './monastery';
import { recordOrigins } from './objects';
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

/** The party in the monastery, the nave open (the story's place doesn't matter here). */
function atMonastery(): void {
	const party = [...room.tokens.values()].filter((t) => t.ownerId);
	applyScene(room, monasteryScene());
	party.forEach((t, i) => {
		t.pos = { ...MONASTERY_SPAWN[i] };
		room.tokens.set(t.id, t);
	});
	story().location = 'monastery';
	story().chapter = 'enter_monastery';
	story().origins = recordOrigins(room);
}

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
	atMonastery();
});

const story = () => room.adventure!;
const token = (player: Player) => characterOf(room, player.id)!.token;
const put = (player: Player, pos: GridPos) => {
	token(player).pos = { ...pos };
};
const propAt = (id: string) => room.props.get(id)?.pos;
const view = (viewer: Player) => adventureView(room, viewer, new Set(room.tokens.keys()), null)!;

describe('pushing and pulling', () => {
	it('pushes a crate a cell away, not through a wall, and only from square on', () => {
		put(ana, { x: 5, y: 2 });
		const pushed = ok(interact(room, ana, 'chamber-crate', 'push'));
		expect(propAt(MONASTERY_IDS.crate)).toEqual({ x: 7, y: 2 });
		expect(pushed.motions).toEqual([{ propId: MONASTERY_IDS.crate, kind: null, sound: 'scrape' }]);
		// Against the chamber's east wall it goes no further.
		put(ana, { x: 6, y: 2 });
		expect(interact(room, ana, 'chamber-crate', 'push')).toMatchObject({ ok: false });
		expect(propAt(MONASTERY_IDS.crate)).toEqual({ x: 7, y: 2 });
		// From a corner there is nothing to push against.
		put(ana, { x: 6, y: 3 });
		expect(interact(room, ana, 'chamber-crate', 'push')).toMatchObject({
			ok: false,
			message: 'Stand square to the heavy crate to push it.'
		});
	});

	it('pulls a crate toward the character, who steps back to make room', () => {
		put(ana, { x: 6, y: 3 });
		ok(interact(room, ana, 'chamber-crate', 'pull'));
		expect(propAt(MONASTERY_IDS.crate)).toEqual({ x: 6, y: 3 });
		expect(token(ana).pos).toEqual({ x: 6, y: 4 });
		// With someone behind, there's no room to pull.
		put(ben, { x: 6, y: 5 });
		expect(interact(room, ana, 'chamber-crate', 'pull')).toMatchObject({ ok: false });
		expect(propAt(MONASTERY_IDS.crate)).toEqual({ x: 6, y: 3 });
	});

	it('finds what the crate hid the first time it moves, for the one who moved it', () => {
		put(ana, { x: 5, y: 2 });
		ok(interact(room, ana, 'chamber-crate', 'push'));
		expect(story().evidence.get('tally')).toEqual({ by: ['warden'], shared: false });
		expect(view(ana).clues.map((c) => c.id)).toContain('tally');
		expect(view(ben).clues.map((c) => c.id)).not.toContain('tally');
	});

	it('keeps where a pushed thing stands in a save', () => {
		put(ana, { x: 5, y: 2 });
		ok(interact(room, ana, 'chamber-crate', 'push'));
		const file = parseSceneFile(JSON.parse(JSON.stringify(exportScene(room, 'Monastery'))));
		if (!file.ok) throw new Error(file.error);
		const read = readAdventure(file.scene.adventure!, file.scene);
		if (!read.ok) throw new Error(read.error);
		expect(read.adventure.origins.get('chamber-crate')?.pos).toEqual({ x: 7, y: 2 });
	});
});

describe('picking up, carrying and putting down', () => {
	it('takes the hand bell off the table into one character’s hands', () => {
		put(ana, { x: 5, y: 14 });
		ok(interact(room, ana, 'handbell', 'take'));
		expect(room.props.has(MONASTERY_IDS.handbell)).toBe(false);
		expect(story().carried.get('handbell')).toBe('warden');
		expect(story().objects.get('handbell')).toBe('carried');
		const mine = view(ana);
		expect(mine.characters.find((c) => c.id === 'warden')?.carrying).toEqual([
			{ id: 'handbell', name: 'Hand bell' }
		]);
		expect(mine.interactables.find((i) => i.id === 'handbell')).toMatchObject({
			carried: true,
			cells: [],
			verbs: [
				{ id: 'ring', physical: 'activate' },
				{ id: 'drop', physical: 'drop' }
			]
		});
		// Nobody else can use it or even see it offered.
		expect(view(ben).interactables.some((i) => i.id === 'handbell')).toBe(false);
		expect(interact(room, ben, 'handbell', 'ring')).toMatchObject({ ok: false });
		// The GM can't set its state out of someone's hands.
		expect(setObject(room, gm, 'handbell', 'interactable')).toMatchObject({ ok: false });
	});

	it('rings it anywhere: the note steadies the party once', () => {
		put(ana, { x: 5, y: 14 });
		ok(interact(room, ana, 'handbell', 'take'));
		story().characters.get('saint')!.hp = 5;
		put(ana, { x: 12, y: 16 });
		const rung = ok(interact(room, ana, 'handbell', 'ring'));
		// Carried, it has no prop on the table: the sound alone.
		expect(rung.motions).toEqual([{ propId: MONASTERY_IDS.handbell, kind: null, sound: 'chime' }]);
		expect(story().characters.get('saint')!.hp).toBe(7);
		ok(interact(room, ana, 'handbell', 'ring'));
		expect(story().characters.get('saint')!.hp).toBe(7);
	});

	it('puts it down where the character stands, and it lands there', () => {
		put(ana, { x: 5, y: 14 });
		ok(interact(room, ana, 'handbell', 'take'));
		put(ana, { x: 12, y: 16 });
		const dropped = ok(interact(room, ana, 'handbell', 'drop'));
		expect(room.props.get(MONASTERY_IDS.handbell)).toMatchObject({
			assetId: 'handbell',
			pos: { x: 12, y: 16 }
		});
		expect(story().carried.has('handbell')).toBe(false);
		expect(dropped.motions).toEqual([
			{ propId: MONASTERY_IDS.handbell, kind: 'land', sound: 'thud' }
		]);
		// Someone else can pick it up from there.
		put(ben, { x: 13, y: 16 });
		ok(interact(room, ben, 'handbell', 'take'));
		expect(story().carried.get('handbell')).toBe('saint');
	});

	it('drops what a removed character carried where it stood', () => {
		put(ana, { x: 5, y: 14 });
		ok(interact(room, ana, 'handbell', 'take'));
		const t = token(ana);
		room.tokens.delete(t.id);
		afterTokenDeleted(room, t.id, { x: 9, y: 15 });
		expect(room.props.get(MONASTERY_IDS.handbell)?.pos).toEqual({ x: 9, y: 15 });
		expect(story().objects.get('handbell')).toBe('interactable');
	});

	it('saves what each character carries, and refuses a save that disagrees', () => {
		put(ana, { x: 5, y: 14 });
		ok(interact(room, ana, 'handbell', 'take'));
		const file = parseSceneFile(JSON.parse(JSON.stringify(exportScene(room, 'Monastery'))));
		if (!file.ok) throw new Error(file.error);
		const read = readAdventure(file.scene.adventure!, file.scene);
		if (!read.ok) throw new Error(read.error);
		expect(read.adventure.carried.get('handbell')).toBe('warden');
		const saved = saveAdventure(story());
		const tampered = { ...saved, state: { ...saved.state, carried: {} } };
		expect(readAdventure(tampered, file.scene)).toMatchObject({ ok: false });
	});
});

describe('turning and breaking', () => {
	it('turns Saint Agna a quarter on her plinth', () => {
		put(ana, { x: 9, y: 4 });
		const turned = ok(interact(room, ana, 'agna'));
		expect(room.props.get(MONASTERY_IDS.agna)?.rotation).toBe(1);
		expect(turned.motions?.[0]).toEqual({ propId: MONASTERY_IDS.agna, kind: null, sound: 'grind' });
	});

	it('breaks the chains on the great doors with a Might check, and the doors open from inside', () => {
		put(ana, { x: 13, y: 8 });
		const broke = ok(interact(room, ana, 'door-chains', 'break', max));
		expect(broke.log.some((m) => m.kind === 'check' && m.success)).toBe(true);
		expect(room.props.get(MONASTERY_IDS.doorChains)?.assetId).toBe('rubble');
		expect(story().objects.get('great-door')).toBe('closed');
		expect(broke.motions).toEqual([
			{ propId: MONASTERY_IDS.doorChains, kind: 'shake', sound: 'crack' }
		]);
	});
});

describe('mechanisms', () => {
	it('runs the lever’s chain one step at a time, and ignores a stale or repeated step', () => {
		story().chapter = 'descend';
		ok(setObject(room, gm, 'grate', 'disabled'));
		put(ana, { x: 6, y: 7 });
		const pulled = ok(interact(room, ana, 'lever'));
		expect(pulled.mechanisms).toEqual([{ id: 'grate', step: 1, delay: 900 }]);
		expect(story().objects.get('grate')).toBe('disabled');
		expect(runMechanism(room, 'grate', 2)).toBeNull();
		const chain = runMechanism(room, 'grate', 1)!;
		expect(chain.motions).toEqual([
			{ propId: MONASTERY_IDS.chamberChains, kind: 'shake', sound: 'rattle' }
		]);
		expect(chain.mechanisms).toEqual([{ id: 'grate', step: 2, delay: 1100 }]);
		expect(runMechanism(room, 'grate', 1)).toBeNull();
		const lifted = runMechanism(room, 'grate', 2)!;
		expect(lifted.mechanisms).toBeUndefined();
		expect(story().objects.get('grate')).toBe('opened');
		expect(story().events).toContain('opened_grate');
		expect(story().running.size).toBe(0);
		// The lever stays down.
		expect(interact(room, ana, 'lever')).toMatchObject({ ok: false });
	});

	it('saves a chain half run, and picks it up after loading', () => {
		story().chapter = 'descend';
		put(ana, { x: 6, y: 7 });
		ok(interact(room, ana, 'lever'));
		const file = parseSceneFile(JSON.parse(JSON.stringify(exportScene(room, 'Monastery'))));
		if (!file.ok) throw new Error(file.error);
		const read = readAdventure(file.scene.adventure!, file.scene);
		if (!read.ok) throw new Error(read.error);
		expect(pendingMechanisms(read.adventure)).toEqual([{ id: 'grate', step: 1, delay: 900 }]);
	});
});
