import { beforeEach, describe, expect, it } from 'vitest';
import type { DieRoller } from '../../src/lib/game/dice';
import type { GridPos } from '../../src/lib/game/grid';
import { parseSceneFile } from '../../src/lib/game/scene-file';
import { cellIndex, decodeMask } from '../../src/lib/game/visibility';
import { RoomManager, type Player, type Room } from '../rooms';
import { canStep } from '../../src/lib/game/objects';
import { lightFor, obstacles } from '../scene';
import { applyScene, exportScene } from '../scene-io';
import { viewFor } from '../views';
import {
	beginAdventure,
	characterOf,
	claimCharacter,
	FLASH_MS,
	interact,
	postSentries,
	startAdventure,
	startEncounter
} from './engine';
import {
	CLEFT_EDGE,
	HOLLOW_IDS,
	HOLLOW_SPAWN,
	hollowScene,
	TORCH_AT as HOLLOW_TORCH
} from './hollow';
import {
	CARVINGS_AT,
	CHAMBER,
	MONASTERY_IDS,
	MONASTERY_SPAWN,
	monasteryScene,
	TORCH_AT
} from './monastery';
import { recordOrigins } from './objects';

const max: DieRoller = (sides) => sides;

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}

let room: Room;
let gm: Player;
let ana: Player;
let ben: Player;

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
});

const story = () => room.adventure!;
const token = (player: Player) => characterOf(room, player.id)!.token;
const put = (player: Player, pos: GridPos) => {
	token(player).pos = { ...pos };
};
const sees = (viewer: Player, pos: GridPos) =>
	decodeMask(viewFor(room, viewer).fog.visible, room.grid.width * room.grid.height)[
		cellIndex(room.grid, pos)
	] === 1;
const tokenNames = (viewer: Player) => viewFor(room, viewer).tokens.map((t) => t.name);
const propIds = (viewer: Player) => viewFor(room, viewer).props.map((p) => p.id);

/** The party moved to a table (the story's chapter doesn't matter here). */
function at(
	scene: typeof monasteryScene,
	spawn: readonly GridPos[],
	where: 'monastery' | 'hollow'
) {
	const party = [...room.tokens.values()].filter((t) => t.ownerId);
	applyScene(room, scene());
	party.forEach((t, i) => {
		t.pos = { ...spawn[i] };
		room.tokens.set(t.id, t);
	});
	story().location = where;
	story().chapter = where === 'monastery' ? 'enter_monastery' : 'the_hollow';
	story().origins = recordOrigins(room);
}

/** A GM-only figure standing somewhere, like a lurking enemy. */
function lurker(pos: GridPos): string {
	const id = 'lurker';
	room.tokens.set(id, {
		id,
		name: 'Lurker',
		color: '#6c3483',
		pos: { ...pos },
		ownerId: null,
		vision: 6,
		light: 0
	});
	return id;
}

describe('the ringing chamber in the dark', () => {
	beforeEach(() => at(monasteryScene, MONASTERY_SPAWN, 'monastery'));

	it('is dark at dusk: only light shows anything there, while the nave is plain to see', () => {
		expect(room.ambient).toBe('dusk');
		const lit = lightFor(room, obstacles(room))!;
		expect(lit[cellIndex(room.grid, { x: 3, y: 7 })]).toBe(0);
		// The candle stub lights the cell it stands on and little else.
		expect(lit[cellIndex(room.grid, { x: 5, y: 3 })]).toBe(1);
		expect(lit[cellIndex(room.grid, { x: 3, y: 5 })]).toBe(0);
		// Outside the chamber, dusk is enough to see by.
		expect(lit[cellIndex(room.grid, { x: 15, y: 12 })]).toBe(1);
		expect(lit[cellIndex(room.grid, CHAMBER.to)]).toBe(0);
	});

	it('hides what stands in the dark, and a lit torch shows it', () => {
		put(ana, { x: 6, y: 6 });
		lurker({ x: 3, y: 6 });
		expect(sees(ana, { x: 3, y: 6 })).toBe(false);
		expect(tokenNames(ana)).not.toContain('Lurker');

		ok(interact(room, ana, 'chamber-torch', 'light'));
		expect(room.lights.get(MONASTERY_IDS.torchLight)?.on).toBe(true);
		expect(tokenNames(ana)).toContain('Lurker');

		// Put out again, the dark takes it back.
		ok(interact(room, ana, 'chamber-torch', 'extinguish'));
		expect(tokenNames(ana)).not.toContain('Lurker');
	});

	it('shows the ringers’ carvings only by torchlight', () => {
		put(ana, TORCH_AT);
		put(ana, { x: 6, y: 6 });
		expect(propIds(ana)).not.toContain(MONASTERY_IDS.carvings);
		expect(propIds(gm)).toContain(MONASTERY_IDS.carvings);
		put(ben, { x: CARVINGS_AT.x, y: CARVINGS_AT.y + 1 });
		expect(interact(room, ben, 'carvings', 'read')).toMatchObject({
			ok: false,
			code: 'object_not_found'
		});

		const lit = ok(interact(room, ana, 'chamber-torch', 'light'));
		expect(lit.log.map((e) => ('text' in e ? e.text : ''))).toContain(
			'The torch catches. The dark draws back to the walls, and on the north wall, above the rope, carvings you could not see by the candle stand out in the flame.'
		);
		expect(propIds(ana)).toContain(MONASTERY_IDS.carvings);
		ok(interact(room, ben, 'carvings', 'read'));
		expect(story().evidence.get('rule')).toMatchObject({ shared: false });

		ok(interact(room, ana, 'chamber-torch', 'extinguish'));
		expect(propIds(ana)).not.toContain(MONASTERY_IDS.carvings);
		expect(interact(room, ben, 'carvings', 'read')).toMatchObject({ ok: false });
	});

	it('lets a character light the torch in a fight, as its action, on its own turn', () => {
		put(ana, { x: 6, y: 6 });
		put(ben, { x: 5, y: 6 });
		startEncounter(room, story(), 'chamber');
		const battle = story().encounter!;
		// Make it a character's turn, whoever won initiative.
		battle.current = battle.order.findIndex((e) => e.kind === 'character');
		const entry = battle.order[battle.current];
		const [first, other] =
			entry.kind === 'character' && entry.id === 'warden' ? [ana, ben] : [ben, ana];
		put(first, { x: 6, y: 6 });
		put(other, { x: 7, y: 6 });
		// Nothing else can be used mid-fight.
		expect(interact(room, first, 'chamber-crate', 'push')).toMatchObject({ ok: false });
		expect(interact(room, other, 'chamber-torch', 'light')).toMatchObject({
			ok: false,
			code: 'not_your_turn'
		});
		ok(interact(room, first, 'chamber-torch', 'light'));
		expect(battle.acted.has(characterOf(room, first.id)!.id)).toBe(true);
		expect(interact(room, first, 'chamber-torch', 'extinguish')).toMatchObject({ ok: false });
	});

	it('saves the dark with the table', () => {
		const file = parseSceneFile(JSON.parse(JSON.stringify(exportScene(room, 'Monastery'))));
		if (!file.ok) throw new Error(file.error);
		expect(file.scene.darkness).not.toBeNull();
		room.darkness = null;
		applyScene(room, file.scene);
		expect(room.darkness?.[cellIndex(room.grid, { x: 3, y: 7 })]).toBe(1);
		expect(room.darkness?.[cellIndex(room.grid, { x: 15, y: 12 })]).toBe(0);
	});
});

describe('the Hollow', () => {
	beforeEach(() => at(hollowScene, HOLLOW_SPAWN, 'hollow'));

	/** Beside the Bell, west of Tobin. */
	const atBell = { x: 22, y: 11 };
	/** From the cultists' ledge into the island, through the cleft. */
	const ledge = { x: 16, y: 13 };
	const inside = { x: 17, y: 13 };

	it('has a cleft in the island wall that is there only while the cultists’ torch burns', () => {
		expect(room.objects.get(HOLLOW_IDS.cleft)).toMatchObject({ kind: 'door', open: true });
		expect(canStep(obstacles(room), ledge, inside)).toBe(true);
		put(ana, { x: HOLLOW_TORCH.x, y: HOLLOW_TORCH.y + 1 });
		const out = ok(interact(room, ana, 'hollow-torch', 'extinguish'));
		expect(out.log.at(-1)).toMatchObject({ kind: 'narration' });
		expect(room.lights.get(HOLLOW_IDS.torchLight)?.on).toBe(false);
		expect(room.objects.has(HOLLOW_IDS.cleft)).toBe(false);
		expect(room.objects.get(`${HOLLOW_IDS.cleft}-sealed`)).toMatchObject({
			kind: 'wall',
			a: CLEFT_EDGE.a,
			b: CLEFT_EDGE.b
		});
		expect(canStep(obstacles(room), ledge, inside)).toBe(false);

		ok(interact(room, ana, 'hollow-torch', 'light'));
		expect(room.objects.get(HOLLOW_IDS.cleft)).toMatchObject({ kind: 'door' });
		expect(canStep(obstacles(room), ledge, inside)).toBe(true);
	});

	it('lights the whole cavern for a moment when the Bell is touched, and the watch sees who is there', () => {
		// Ana at the Bell; someone in the dark by the island's west wall, within her sight but not the Bell's glow.
		put(ana, atBell);
		const far = { x: 18, y: 14 };
		expect(lightFor(room, obstacles(room))?.[cellIndex(room.grid, far)]).toBe(0);
		const lurkerId = lurker(far);
		expect(tokenNames(ana)).not.toContain('Lurker');

		const touched = ok(interact(room, ana, 'bell', 'examine'));
		expect(touched.log).toContainEqual(expect.objectContaining({ cue: 'flash' }));
		expect(room.flashUntil).toBeGreaterThan(Date.now());
		expect(lightFor(room, obstacles(room))).toBeNull();
		expect(tokenNames(ana)).toContain('Lurker');
		// Once it fades, the dark is back.
		expect(lightFor(room, obstacles(room), Date.now() + FLASH_MS + 1)).not.toBeNull();
		room.flashUntil = Date.now() - 1;
		expect(tokenNames(ana)).not.toContain('Lurker');
		expect(room.tokens.has(lurkerId)).toBe(true);
		// Only the first touch rings it.
		expect(ok(interact(room, ana, 'bell', 'examine')).log).not.toContainEqual(
			expect.objectContaining({ cue: 'flash' })
		);
	});

	it('starts the fight when the flash shows the party to the watch', () => {
		postSentries(room, story(), 'hollow');
		// Only the cultist on the terrace keeps watch; the rest of the watch is gone.
		const [, watcher] = [...story().sentries.keys()].filter(
			(id) => story().sentries.get(id)!.kind === 'cultist'
		);
		for (const id of [...story().sentries.keys()]) {
			if (id === watcher) continue;
			story().sentries.delete(id);
			room.tokens.delete(id);
		}
		room.tokens.get(watcher)!.pos = { x: 38, y: 28 };
		// Ben in the dark, out of its lantern's reach but well within its sight; Ana at the Bell, far off.
		put(ben, { x: 38, y: 31 });
		put(ana, atBell);
		expect(lightFor(room, obstacles(room))?.[cellIndex(room.grid, { x: 38, y: 31 })]).toBe(0);
		expect(story().encounter).toBeNull();

		const out = ok(interact(room, ana, 'bell', 'examine'));
		expect(story().encounter?.id).toBe('hollow');
		expect(out.log.some((e) => 'text' in e && /spots The Saint/.test(e.text))).toBe(true);
	});
});
