import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage, Shot } from '../../src/lib/game/chat';
import type { DieRoller } from '../../src/lib/game/dice';
import { RoomManager, type Player, type Room } from '../rooms';
import { MOUNTAIN_PATH } from '../adventures/hollow-bell/bellweather';
import {
	beginAdventure,
	characterOf,
	claimCharacter,
	decide,
	direct,
	interact,
	startAdventure
} from './engine';
import { PIT_AT } from '../adventures/hollow-bell/hollow';
import {
	BELL_AT as TOWER_BELL,
	MONASTERY_SPAWN,
	monasteryScene,
	SECRET_EDGE
} from '../adventures/hollow-bell/monastery';
import { applyScene } from '../scene-io';
import { HOLLOW_BELL } from '../adventures/hollow-bell/index';
import { recordOrigins } from './world';
import { DECISIONS } from '../adventures/hollow-bell/story';
import { SHOTS } from '../adventures/hollow-bell/shots';

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
});

const shots = (log: readonly ChatMessage[]): Shot[] =>
	log.flatMap((m) => (m.kind === 'narration' && m.shot ? [m.shot] : []));

describe('cinematic moments', () => {
	it('First Bell: as the party arrives, the camera looks up the mountain path to the monastery', () => {
		const begun = ok(beginAdventure(room, gm, 1000));
		expect(shots(begun.log)).toEqual([{ focus: MOUNTAIN_PATH, frame: 'wide' }]);
		// So there is something to see: the players take in the path north (its shape, not who is on it).
		const at = (x: number, y: number) => ana.explored[y * room.grid.width + x];
		expect(at(MOUNTAIN_PATH.x, MOUNTAIN_PATH.y)).toBe(1);
		// The village itself is still theirs to find.
		expect(at(11, 13)).toBe(0);
		expect(at(30, 9)).toBe(0);
	});

	it('Discovery: when Saint Agna turns, the camera finds the door that was a wall', () => {
		ok(beginAdventure(room, gm, 1000));
		room.dice = max;
		const party = [...room.tokens.values()].filter((t) => t.ownerId);
		applyScene(room, monasteryScene());
		party.forEach((t, i) => {
			t.pos = { ...MONASTERY_SPAWN[i] };
			room.tokens.set(t.id, t);
		});
		Object.assign(room.adventure!, { location: 'monastery', chapter: 'enter_monastery' });
		room.adventure!.origins = recordOrigins(HOLLOW_BELL, room);
		const agna = [...room.props.values()].find((p) => p.assetId === 'statue')!;
		characterOf(room, ana.id)!.token.pos = { x: agna.pos.x + 1, y: agna.pos.y };
		const turned = ok(interact(room, ana, 'agna', 'turn'));
		expect(shots(turned.log)).toEqual([{ focus: SECRET_EDGE.a, frame: 'close' }]);
	});

	it('are few, and come at the story’s great moments: the bell, the Hollow, the pit, its waking', () => {
		ok(beginAdventure(room, gm, 1000));
		room.dice = max;
		const seen: Shot[] = [];
		for (let i = 0; i < 40 && room.adventure!.stage === 'playing'; i++) {
			const pending = room.adventure!.pending;
			const out = pending
				? ok(
						decide(
							room,
							gm,
							pending,
							pending === 'bell'
								? 'use'
								: DECISIONS[pending as keyof typeof DECISIONS].options[0].id
						)
					)
				: ok(direct(room, gm, { op: 'skip' }));
			seen.push(...shots(out.log));
		}
		expect(room.adventure!.stage).toBe('complete');
		expect(seen).toEqual([SHOTS.bellRing, SHOTS.hollow, SHOTS.pit, SHOTS.waking]);
		expect(SHOTS.bellRing.focus).toEqual(TOWER_BELL);
		expect(SHOTS.hollow).toEqual({ focus: null, frame: 'table' });
		expect(SHOTS.waking).toEqual({ focus: PIT_AT, frame: 'wide' });
	});
});
