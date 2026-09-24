import { beforeEach, describe, expect, it } from 'vitest';
import { CHARACTERS } from '../../src/lib/adventure/characters';
import type { DieRoller } from '../../src/lib/game/dice';
import type { GridPos } from '../../src/lib/game/grid';
import { isReachable } from '../../src/lib/game/objects';
import { isSolidCell } from '../../src/lib/game/props';
import { parseSceneFile } from '../../src/lib/game/scene-file';
import { cellIndex } from '../../src/lib/game/visibility';
import { RoomManager, type Player, type Room } from '../rooms';
import { obstacles } from '../scene';
import { bellweatherScene, EXIT, IDS, PATH_AREA, SPAWN } from './bellweather';
import {
	afterMove,
	afterTokenDeleted,
	act,
	beginAdventure,
	characterOf,
	checkMove,
	claimCharacter,
	control,
	doorLock,
	endTurn,
	interact,
	narrate,
	override,
	readCue,
	releaseCharacter,
	runEnemyTurn,
	startAdventure
} from './engine';
import { adventureView } from './view';

/** Every die shows its highest face: attacks always hit for maximum damage. */
const max: DieRoller = (sides) => sides;
/** Every die shows 1: attacks always miss. */
const min: DieRoller = () => 1;

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
	if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result as Extract<T, { ok: true }>;
}

let room: Room;
let gm: Player;
let ana: Player;
let ben: Player;
let watcher: Player;

function setup(): void {
	const rooms = new RoomManager();
	const created = ok(rooms.create('Gia'));
	room = created.room;
	gm = created.player;
	ana = ok(rooms.join(room.id, 'Ana', 'player')).player;
	ben = ok(rooms.join(room.id, 'Ben', 'player')).player;
	watcher = ok(rooms.join(room.id, 'Wes', 'spectator')).player;
}

const token = (id: string) => room.tokens.get(id)!;
const put = (tokenId: string, pos: GridPos) => (token(tokenId).pos = { ...pos });
const hound = () => [...room.adventure!.encounter!.enemies.keys()][0];

/** Starts the adventure with Ana as the Warden, begun and standing at `at`. */
function playing(at?: GridPos): string {
	ok(startAdventure(room, gm));
	ok(claimCharacter(room, ana, 'warden'));
	ok(beginAdventure(room, gm, 1000));
	const id = characterOf(room, ana.id)!.token.id;
	if (at) put(id, at);
	return id;
}

/** Ana's Warden has talked to Maren and examined the well: the Hound is out. */
function fighting(): string {
	const id = playing({ x: 7, y: 10 });
	ok(interact(room, ana, 'maren'));
	put(id, { x: 11, y: 12 });
	ok(interact(room, ana, 'well'));
	return id;
}

beforeEach(setup);

describe('Bellweather', () => {
	it('is a valid scene whose story pieces are all in place', () => {
		const scene = bellweatherScene();
		const parsed = parseSceneFile(scene);
		expect(parsed.ok).toBe(true);
		expect(scene.tokens.some((t) => t.id === IDS.maren)).toBe(true);
		expect(scene.objects.find((o) => o.id === IDS.gate)).toMatchObject({
			kind: 'door',
			open: false
		});
		for (const id of [IDS.well, IDS.noticeboard, IDS.chest]) {
			expect(scene.props.some((p) => p.id === id)).toBe(true);
		}
	});

	it('lets characters walk from the road to the mountain path only once the gate is open', () => {
		ok(startAdventure(room, gm));
		const blocked = () => obstacles(room);
		for (const c of SPAWN) expect(isSolidCell(blocked(), c)).toBe(false);
		expect(isReachable(room.grid, blocked(), SPAWN[0], EXIT[0])).toBe(false);
		const gate = room.objects.get(IDS.gate);
		if (gate?.kind === 'door') gate.open = true;
		expect(isReachable(room.grid, blocked(), SPAWN[0], EXIT[0])).toBe(true);
	});
});

describe('starting and choosing characters', () => {
	it('lets only the GM set up the adventure, replacing the table', () => {
		expect(startAdventure(room, ana)).toMatchObject({ ok: false, code: 'forbidden' });
		const result = ok(startAdventure(room, gm));
		expect(result.reset).toBe(true);
		expect(room.sceneName).toBe('Bellweather');
		expect(room.adventure?.stage).toBe('choosing');
		expect(room.fog.enabled).toBe(true);
	});

	it('gives each player one character, placed on the road and owned by them', () => {
		ok(startAdventure(room, gm));
		ok(claimCharacter(room, ana, 'warden'));
		const mine = characterOf(room, ana.id)!;
		expect(mine.id).toBe('warden');
		expect(mine.token).toMatchObject({ name: 'The Warden', ownerId: ana.id, pos: SPAWN[0] });
		expect(mine.state.hp).toBe(CHARACTERS.warden.hp);

		expect(claimCharacter(room, ana, 'veil')).toMatchObject({ ok: false, code: 'forbidden' });
		expect(claimCharacter(room, ben, 'warden')).toMatchObject({
			ok: false,
			code: 'character_taken'
		});
		expect(claimCharacter(room, watcher, 'veil')).toMatchObject({ ok: false, code: 'forbidden' });
		expect(claimCharacter(room, gm, 'veil')).toMatchObject({ ok: false, code: 'forbidden' });
		ok(claimCharacter(room, ben, 'veil'));
		expect(characterOf(room, ben.id)?.token.pos).toEqual(SPAWN[1]);
	});

	it('lets a player put their character back before play begins, not after', () => {
		ok(startAdventure(room, gm));
		ok(claimCharacter(room, ana, 'warden'));
		const tokenId = characterOf(room, ana.id)!.token.id;
		ok(releaseCharacter(room, ana));
		expect(room.tokens.has(tokenId)).toBe(false);
		ok(claimCharacter(room, ben, 'warden'));
		ok(claimCharacter(room, ana, 'ember'));
		ok(beginAdventure(room, gm));
		expect(releaseCharacter(room, ana)).toMatchObject({ ok: false, code: 'forbidden' });
	});

	it('begins only when the GM says so and someone has a character', () => {
		ok(startAdventure(room, gm));
		expect(beginAdventure(room, gm)).toMatchObject({ ok: false, code: 'forbidden' });
		ok(claimCharacter(room, ana, 'saint'));
		expect(beginAdventure(room, ana)).toMatchObject({ ok: false, code: 'forbidden' });
		const begun = ok(beginAdventure(room, gm, 5000));
		expect(begun.log[0]).toMatchObject({ kind: 'narration' });
		expect(room.adventure).toMatchObject({ stage: 'arrival', begunAt: 5000 });
	});

	it('keeps characters in place until play begins', () => {
		ok(startAdventure(room, gm));
		ok(claimCharacter(room, ana, 'warden'));
		const tokenId = characterOf(room, ana.id)!.token.id;
		expect(checkMove(room, ana, tokenId, { x: 11, y: 17 })).toMatchObject({ ok: false });
		expect(checkMove(room, gm, tokenId, { x: 11, y: 17 })).toMatchObject({ ok: true });
	});
});

describe('investigating', () => {
	it('needs the character beside what it interacts with, not through a wall', () => {
		const id = playing();
		expect(interact(room, ana, 'maren')).toMatchObject({ ok: false, code: 'out_of_reach' });
		// Right outside the inn's west wall from Maren is still not beside her.
		put(id, { x: 1, y: 9 });
		expect(interact(room, ana, 'maren')).toMatchObject({ ok: false, code: 'out_of_reach' });
		put(id, { x: 7, y: 10 });
		ok(interact(room, ana, 'maren'));
		expect(interact(room, ben, 'maren')).toMatchObject({ ok: false, code: 'forbidden' });
		expect(interact(room, ana, 'nothing')).toMatchObject({ ok: false, code: 'object_not_found' });
	});

	it('moves the story on: Maren points to the well, the well gives up its clue', () => {
		const id = playing({ x: 11, y: 12 });
		// The well means nothing yet.
		const early = ok(interact(room, ana, 'well'));
		expect(early.log).toHaveLength(1);
		expect(room.adventure?.clues).toEqual([]);

		put(id, { x: 7, y: 10 });
		const talk = ok(interact(room, ana, 'maren'));
		expect(talk.log[0]).toMatchObject({ kind: 'narration', speaker: 'Maren' });
		expect(room.adventure?.stage).toBe('investigate');

		put(id, { x: 11, y: 12 });
		ok(interact(room, ana, 'well'));
		expect(room.adventure?.clues).toEqual(['scratches']);
		expect(room.adventure?.stage).toBe('encounter');
		const houndToken = token(hound());
		expect(houndToken).toMatchObject({ name: 'Hollow Hound', ownerId: null });
		// It climbs out beside the well.
		expect(Math.abs(houndToken.pos.y - 13.5)).toBeLessThanOrEqual(2);
	});

	it('records optional clues once, and refuses to chat mid-fight', () => {
		const id = playing({ x: 11, y: 9 });
		ok(interact(room, ana, 'noticeboard'));
		ok(interact(room, ana, 'noticeboard'));
		put(id, { x: 17, y: 9 });
		ok(interact(room, ana, 'chest'));
		expect(room.adventure?.clues).toEqual(['notice', 'rope']);

		fighting();
		expect(interact(room, ana, 'well')).toMatchObject({ ok: false, code: 'not_your_turn' });
	});
});

describe('the fight at the well', () => {
	it('limits movement to the character’s speed each round', () => {
		const id = fighting();
		put(hound(), { x: 16, y: 16 });
		// Along the road south of the Hale house, from (11, 12).
		const far = { x: 17, y: 12 };
		expect(checkMove(room, ana, id, far)).toMatchObject({ ok: false, code: 'out_of_reach' });
		const near = checkMove(room, ana, id, { x: 14, y: 12 });
		expect(near).toEqual({ ok: true, cost: 3 });
		put(id, { x: 14, y: 12 });
		afterMove(room, token(id), 3);
		expect(checkMove(room, ana, id, far)).toMatchObject({
			ok: false,
			message: 'The Warden can move 2 more cells this round.'
		});
	});

	it('resolves attacks on the server and ends the round once everyone has acted', () => {
		const id = fighting();
		const houndId = hound();
		put(houndId, { x: 16, y: 16 });
		expect(act(room, ana, 'blade', houndId, max)).toMatchObject({
			ok: false,
			code: 'out_of_reach'
		});
		put(houndId, { x: 12, y: 12 });
		expect(act(room, ben, 'blade', houndId, max)).toMatchObject({ ok: false, code: 'forbidden' });

		const hp = room.adventure!.encounter!.enemies.get(houndId)!.hp;
		const hit = ok(act(room, ana, 'blade', houndId, min));
		expect(hit.log[0]).toMatchObject({ kind: 'attack', hit: false, damage: null });
		expect(room.adventure!.encounter!.enemies.get(houndId)!.hp).toBe(hp);
		expect(act(room, ana, 'blade', houndId, max)).toMatchObject({
			ok: false,
			code: 'not_your_turn'
		});
		// Ana was the only character, so the enemies are up.
		expect(hit.enemyTurn).toBe(2);
		expect(checkMove(room, ana, id, { x: 10, y: 12 })).toMatchObject({ code: 'not_your_turn' });
	});

	it('runs the Hound: it closes in, bites, and hands the next round back', () => {
		const id = fighting();
		const houndId = hound();
		put(houndId, { x: 16, y: 16 });
		const turn = ok(endTurn(room, ana)).enemyTurn!;
		expect(runEnemyTurn(room, turn - 1, max)).toBeNull();

		const out = runEnemyTurn(room, turn, max)!;
		const houndPos = token(houndId).pos;
		expect(Math.max(Math.abs(houndPos.x - 11), Math.abs(houndPos.y - 12))).toBe(1);
		expect(out.log[0]).toMatchObject({ kind: 'attack', authorId: houndId, hit: true });
		// 1d6+2 at its highest.
		expect(characterOf(room, ana.id)!.state.hp).toBe(CHARACTERS.warden.hp - 8);
		expect(room.adventure!.encounter).toMatchObject({ round: 2, phase: 'players' });
		expect(checkMove(room, ana, id, { x: 9, y: 12 })).toMatchObject({ ok: true });
		// A second run of the same turn does nothing.
		expect(runEnemyTurn(room, turn, max)).toBeNull();
	});

	it('wins the fight: the Hound falls, the gate opens, the path is revealed', () => {
		const id = fighting();
		const houndId = hound();
		put(houndId, { x: 12, y: 12 });
		const gate = room.objects.get(IDS.gate)!;
		expect(gate.kind === 'door' && doorLock(room, ana, gate)).toBe('The gate is chained shut.');
		room.adventure!.encounter!.enemies.get(houndId)!.hp = 1;

		const result = ok(act(room, ana, 'blade', houndId, max));
		expect(result.log[0]).toMatchObject({ kind: 'attack', outcome: 'The Hollow Hound falls.' });
		expect(room.tokens.has(houndId)).toBe(false);
		expect(room.adventure).toMatchObject({ stage: 'aftermath', encounter: null });
		expect(gate).toMatchObject({ open: true });
		expect(doorLock(room, ana, gate as never)).toBeNull();
		expect(room.fog.revealed[cellIndex(room.grid, PATH_AREA.from)]).toBe(1);

		// Walking up the path ends the section.
		put(id, EXIT[0]);
		const end = afterMove(room, token(id), null, 9000);
		expect(end.log[0]).toMatchObject({ kind: 'narration' });
		expect(room.adventure).toMatchObject({ stage: 'complete', completedAt: 9000 });
	});

	it('loses the fight when every character is down', () => {
		fighting();
		put(hound(), { x: 12, y: 12 });
		characterOf(room, ana.id)!.state.hp = 3;
		const turn = ok(endTurn(room, ana)).enemyTurn!;
		const out = runEnemyTurn(room, turn, max)!;
		expect(out.log[0]).toMatchObject({ outcome: 'The Warden falls!' });
		expect(room.adventure).toMatchObject({ stage: 'defeat', encounter: null });
		const downed = characterOf(room, ana.id)!;
		expect(checkMove(room, ana, downed.token.id, { x: 10, y: 11 })).toMatchObject({ ok: false });
	});

	it('lets the GM end the players’ turn, or remove the Hound to end the fight', () => {
		fighting();
		expect(control(room, ana, 'end_round')).toMatchObject({ ok: false, code: 'forbidden' });
		expect(ok(control(room, gm, 'end_round')).enemyTurn).toBe(2);

		const houndId = hound();
		room.tokens.delete(houndId);
		const out = afterTokenDeleted(room, houndId);
		expect(out.log.length).toBeGreaterThan(0);
		expect(room.adventure?.stage).toBe('aftermath');
	});
});

describe('the GM', () => {
	it('narrates and reads prepared passages; players cannot', () => {
		playing();
		expect(ok(narrate(room, gm, '  The wind  rises. ')).log[0]).toMatchObject({
			kind: 'narration',
			text: 'The wind rises.'
		});
		expect(narrate(room, ana, 'Hi')).toMatchObject({ ok: false, code: 'forbidden' });
		expect(narrate(room, gm, ' ')).toMatchObject({ ok: false, code: 'invalid_chat' });
		ok(readCue(room, gm, 'bell'));
		expect(readCue(room, gm, 'nope')).toMatchObject({ ok: false });
		expect(readCue(room, ana, 'bell')).toMatchObject({ ok: false, code: 'forbidden' });
		expect(room.adventure?.cuesRead.has('bell')).toBe(true);
	});

	it('restarts the section with everyone keeping their character, or ends the adventure', () => {
		fighting();
		ok(claimCharacter(room, ben, 'ember'));
		const out = ok(control(room, gm, 'restart', 7000));
		expect(out.reset).toBe(true);
		expect(room.adventure).toMatchObject({ stage: 'arrival', clues: [], begunAt: 7000 });
		expect(characterOf(room, ana.id)).toMatchObject({ id: 'warden', state: { hp: 30 } });
		expect(characterOf(room, ben.id)?.id).toBe('ember');
		expect([...room.tokens.values()].some((t) => t.name === 'Hollow Hound')).toBe(false);

		ok(control(room, gm, 'end'));
		expect(room.adventure).toBeNull();
	});

	it('frees a character whose token the GM removed', () => {
		const id = playing();
		room.tokens.delete(id);
		afterTokenDeleted(room, id);
		expect(characterOf(room, ana.id)).toBeNull();
		ok(claimCharacter(room, ben, 'warden'));
	});
});

describe('what each viewer is told', () => {
	it('shows enemies only to viewers who can see them, and cues only to the GM', () => {
		fighting();
		const houndId = hound();
		const gmView = adventureView(room, gm, new Set([houndId]), null)!;
		expect(gmView.encounter?.enemies.map((e) => e.tokenId)).toEqual([houndId]);
		expect(gmView.cues?.length).toBeGreaterThan(0);

		const benView = adventureView(room, ben, new Set(), ben.explored)!;
		expect(benView.encounter?.enemies).toEqual([]);
		expect(benView.cues).toBeNull();
		expect(benView.characters.find((c) => c.id === 'warden')).toMatchObject({
			inPlay: true,
			playerId: ana.id,
			tokenId: null
		});
	});

	it('lists only things to interact with that the viewer has seen', () => {
		playing();
		const unseen = adventureView(room, ben, new Set(), ben.explored)!;
		expect(unseen.interactables).toEqual([]);
		const well = room.props.get(IDS.well)!;
		ben.explored[cellIndex(room.grid, well.pos)] = 1;
		const seen = adventureView(room, ben, new Set(), ben.explored)!;
		expect(seen.interactables.map((i) => i.id)).toEqual(['well']);
	});
});

describe('character gameplay', () => {
	/** The Warden (Ana) and the Saint (Ben) side by side at the well, with the Hound out. */
	function party() {
		ok(startAdventure(room, gm));
		ok(claimCharacter(room, ana, 'warden'));
		ok(claimCharacter(room, ben, 'saint'));
		ok(beginAdventure(room, gm, 1000));
		const warden = characterOf(room, ana.id)!;
		const saint = characterOf(room, ben.id)!;
		put(warden.token.id, { x: 7, y: 10 });
		ok(interact(room, ana, 'maren'));
		put(warden.token.id, { x: 11, y: 12 });
		put(saint.token.id, { x: 10, y: 12 });
		ok(interact(room, ana, 'well'));
		return { warden, saint, houndId: hound() };
	}

	it('introduces a character when a player takes it', () => {
		ok(startAdventure(room, gm));
		const claimed = ok(claimCharacter(room, ana, 'veil'));
		expect(claimed.log.at(-1)).toMatchObject({ kind: 'narration', text: CHARACTERS.veil.intro });
	});

	it('guards the Warden and allies beside with a shield wall until the enemies have acted', () => {
		const { warden, saint, houndId } = party();
		put(houndId, { x: 12, y: 11 });
		const wall = ok(act(room, ana, 'shield-wall', null, max));
		expect(wall.log[0]).toMatchObject({ kind: 'ability', ability: 'Shield wall' });
		expect([...warden.state.statuses.keys()]).toEqual(['guarded']);
		expect([...saint.state.statuses.keys()]).toEqual(['guarded']);

		const turn = ok(endTurn(room, ben)).enemyTurn!;
		const out = runEnemyTurn(room, turn, max)!;
		// 1d20+4 at its highest (24) against 10 + 3 armor + 2 guard: still a hit, but defense was 15.
		expect(out.log.find((m) => m.kind === 'attack')).toMatchObject({ defense: 15 });
		expect(warden.state.statuses.size).toBe(0);
	});

	it('slows the Hound with a hamstring, twice per fight at most', () => {
		ok(startAdventure(room, gm));
		ok(claimCharacter(room, ana, 'veil'));
		ok(beginAdventure(room, gm));
		const veil = characterOf(room, ana.id)!;
		put(veil.token.id, { x: 7, y: 10 });
		ok(interact(room, ana, 'maren'));
		put(veil.token.id, { x: 11, y: 12 });
		ok(interact(room, ana, 'well'));
		const houndId = hound();
		room.adventure!.encounter!.enemies.get(houndId)!.hp = 50;

		const cut = ok(act(room, ana, 'hamstring', houndId, max));
		expect(cut.log[0]).toMatchObject({ kind: 'attack', hit: true, effect: 'Slowed' });
		expect(room.adventure!.encounter!.enemies.get(houndId)!.statuses.get('slowed')).toBe(1);
		// Far away and slowed, it only gets 3 steps closer.
		put(houndId, { x: 19, y: 16 });
		runEnemyTurn(room, cut.enemyTurn!, max);
		expect(token(houndId).pos.x).toBe(16);
		expect(room.adventure!.encounter!.enemies.get(houndId)!.statuses.size).toBe(0);

		put(houndId, { x: 12, y: 12 });
		ok(act(room, ana, 'hamstring', houndId, max));
		room.adventure!.encounter!.acted.clear();
		room.adventure!.encounter!.phase = 'players';
		expect(act(room, ana, 'hamstring', houndId, max)).toMatchObject({
			ok: false,
			message: 'Hamstring is spent until the next fight.'
		});
	});

	it('sets the Hound burning: fire eats at it at the start of its next two turns', () => {
		ok(startAdventure(room, gm));
		ok(claimCharacter(room, ana, 'ember'));
		ok(beginAdventure(room, gm));
		const ember = characterOf(room, ana.id)!;
		put(ember.token.id, { x: 7, y: 10 });
		ok(interact(room, ana, 'maren'));
		put(ember.token.id, { x: 11, y: 12 });
		ok(interact(room, ana, 'well'));
		const houndId = hound();
		const enemy = room.adventure!.encounter!.enemies.get(houndId)!;
		enemy.hp = 40;
		put(houndId, { x: 14, y: 12 });

		const burst = ok(act(room, ana, 'flame-burst', houndId, max));
		expect(enemy.hp).toBe(40 - 14);
		const out = runEnemyTurn(room, burst.enemyTurn!, max)!;
		expect(out.log[0]).toMatchObject({ kind: 'ability', ability: 'Burning', amount: -4 });
		expect(enemy.hp).toBe(40 - 14 - 4);
		expect(enemy.statuses.get('burning')).toBe(1);
	});

	it('mends an ally in reach, lifts the fallen, and heals outside a fight too', () => {
		const { warden, saint, houndId } = party();
		put(houndId, { x: 16, y: 16 });
		warden.state.hp = 0;
		expect(act(room, ana, 'blade', houndId, max)).toMatchObject({
			ok: false,
			message: 'The Warden is down.'
		});

		put(saint.token.id, { x: 5, y: 15 });
		expect(act(room, ben, 'mend', warden.token.id, max)).toMatchObject({ code: 'out_of_reach' });
		put(saint.token.id, { x: 10, y: 12 });
		const mended = ok(act(room, ben, 'mend', warden.token.id, max));
		expect(mended.log[0]).toMatchObject({ kind: 'ability', amount: 11 });
		expect(warden.state.hp).toBe(11);

		ok(control(room, gm, 'end'));
		ok(startAdventure(room, gm));
		ok(claimCharacter(room, ben, 'saint'));
		ok(beginAdventure(room, gm));
		const me = characterOf(room, ben.id)!;
		me.state.hp = 5;
		ok(act(room, ben, 'mend', me.token.id, max));
		expect(me.state.hp).toBe(16);
		expect(act(room, ben, 'mace', me.token.id, max)).toMatchObject({
			ok: false,
			message: 'There is nothing to fight.'
		});
	});

	it('lets a downed character bleed out after three rounds, beyond healing but not beyond the GM', () => {
		const { warden, saint, houndId } = party();
		put(houndId, { x: 20, y: 18 });
		room.adventure!.encounter!.enemies.get(houndId)!.hp = 99;
		warden.state.hp = 0;
		for (let i = 0; i < 3; i++) {
			const turn = ok(endTurn(room, ben)).enemyTurn!;
			// Keep the Hound away from the Saint so only the bleeding matters.
			put(houndId, { x: 20, y: 18 });
			runEnemyTurn(room, turn, min);
			put(houndId, { x: 20, y: 18 });
		}
		expect(warden.state).toMatchObject({ dead: true, downedFor: 3 });
		expect(act(room, ben, 'mend', warden.token.id, max)).toMatchObject({
			ok: false,
			message: 'The Warden is beyond help.'
		});
		const view = adventureView(room, ana, new Set([warden.token.id]), null)!;
		expect(view.characters.find((c) => c.id === 'warden')).toMatchObject({
			dead: true,
			downed: false
		});

		expect(override(room, ana, 'warden', { revive: true })).toMatchObject({ ok: false });
		ok(override(room, gm, 'warden', { revive: true, hp: 12, statuses: ['guarded'] }));
		expect(warden.state).toMatchObject({ dead: false, hp: 12, downedFor: 0 });
		expect([...warden.state.statuses.keys()]).toEqual(['guarded']);
		void saint;
	});

	it('tells each player how many uses their abilities have left', () => {
		const { saint } = party();
		saint.state.hp = 10;
		ok(act(room, ben, 'mend', saint.token.id, max));
		const view = adventureView(room, ben, new Set([saint.token.id]), null)!;
		expect(view.characters.find((c) => c.id === 'saint')?.usesLeft).toEqual({
			mace: null,
			mend: 1
		});
	});
});
