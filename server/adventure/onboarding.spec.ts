import { beforeEach, describe, expect, it } from 'vitest';
import type { DieRoller } from '../../src/lib/game/dice';
import { gridDistance, type GridPos } from '../../src/lib/game/grid';
import { isReachable } from '../../src/lib/game/objects';
import { RoomManager, type Player, type Room } from '../rooms';
import { lightFor, obstacles } from '../scene';
import { CHARM_AT, IDS, SPAWN } from '../adventures/hollow-bell/bellweather';
import {
	beginAdventure,
	characterOf,
	claimCharacter,
	interact,
	sense,
	setObject,
	startAdventure
} from './engine';
import { adventureView } from './view';
import { cellIndex } from '../../src/lib/game/visibility';

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
	ok(claimCharacter(room, ben, 'veil'));
	ok(beginAdventure(room, gm, 1000));
	room.dice = max;
});

const story = () => room.adventure!;
const put = (player: Player, pos: GridPos) => {
	characterOf(room, player.id)!.token.pos = { ...pos };
};
const view = (viewer: Player) => adventureView(room, viewer, new Set(room.tokens.keys()), null)!;
const beside = { x: CHARM_AT.x, y: CHARM_AT.y + 1 };

describe('a newcomer’s first find', () => {
	it('glows in the road a few steps from where the party arrives, and every player is shown it', () => {
		expect(room.props.get(IDS.charm)?.pos).toEqual(CHARM_AT);
		expect(room.lights.get(IDS.charmGlow)).toMatchObject({ pos: CHARM_AT, on: true });
		expect(lightFor(room, obstacles(room))?.[cellIndex(room.grid, CHARM_AT)] ?? 1).toBe(1);
		const nearest = Math.min(...SPAWN.map((s) => gridDistance(s, CHARM_AT)));
		// Close enough to notice, far enough that walking there is a choice.
		expect(nearest).toBeGreaterThanOrEqual(5);
		expect(nearest).toBeLessThanOrEqual(7);
		expect(isReachable(room.grid, obstacles(room), SPAWN[0], beside)).toBe(true);
		expect(view(ana).firstFind).toEqual({
			objectId: 'charm',
			cells: [CHARM_AT],
			clueId: 'tinbell'
		});
	});

	it('catches the eye of whoever looks around nearby, until they have found it', () => {
		put(ana, SPAWN[1]);
		const looked = ok(sense(room, ana, 'observe'));
		expect(looked.log).toEqual([
			expect.objectContaining({
				kind: 'narration',
				text: expect.stringContaining('a faint, cold glint of blue'),
				audience: { players: [ana.id] }
			})
		]);
		put(ana, beside);
		ok(interact(room, ana, 'charm', 'examine'));
		expect(ok(sense(room, ana, 'observe')).log[0]).not.toMatchObject({
			text: expect.stringContaining('glint')
		});
		// Listening doesn't notice it.
		put(ben, SPAWN[1]);
		expect(ok(sense(room, ben, 'listen')).log[0]).not.toMatchObject({
			text: expect.stringContaining('glint')
		});
	});

	it('is inspected by walking up to it, and what it holds is the finder’s alone', () => {
		put(ana, SPAWN[0]);
		expect(interact(room, ana, 'charm')).toMatchObject({ ok: false, code: 'out_of_reach' });
		put(ana, beside);
		const found = ok(interact(room, ana, 'charm', 'examine'));
		expect(found.log).toContainEqual(
			expect.objectContaining({ kind: 'narration', audience: { players: [ana.id] } })
		);
		expect(view(ana).clues).toEqual([
			expect.objectContaining({ id: 'tinbell', title: 'A child’s tin bell', mine: true })
		]);
		expect(view(ben).clues).toEqual([]);
	});

	it('can be found by each newcomer in turn', () => {
		put(ana, beside);
		ok(interact(room, ana, 'charm', 'examine'));
		put(ana, SPAWN[0]);
		put(ben, beside);
		ok(interact(room, ben, 'charm', 'examine'));
		expect(story().evidence.get('tinbell')).toMatchObject({
			by: ['warden', 'veil'],
			shared: false
		});
		expect(view(ben).clues[0]).toMatchObject({ id: 'tinbell', mine: true });
		// Still there for whoever comes next.
		expect(view(ben).firstFind).not.toBeNull();
	});

	it('is not pointed at once the GM hides it, or away from the village', () => {
		ok(setObject(room, gm, 'charm', 'hidden'));
		expect(view(ana).firstFind).toBeNull();
		ok(setObject(room, gm, 'charm', 'interactable'));
		story().location = 'monastery';
		expect(view(ana).firstFind).toBeNull();
	});
});
