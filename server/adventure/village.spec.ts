import { beforeEach, describe, expect, it } from 'vitest';
import { CHARACTERS } from '../../src/lib/adventure/characters';
import { gridDistance, type GridPos } from '../../src/lib/game/grid';
import { isReachable } from '../../src/lib/game/objects';
import { isSolidCell } from '../../src/lib/game/props';
import { parseSceneFile } from '../../src/lib/game/scene-file';
import { RoomManager, type Player, type Room } from '../rooms';
import { obstacles } from '../scene';
import { exportScene } from '../scene-io';
import { bellweatherScene, SPAWN, WELL_RING } from './bellweather';
import {
	afterTokenDeleted,
	beginAdventure,
	characterOf,
	claimCharacter,
	interact,
	objectCells,
	startAdventure
} from './engine';
import { NPC_IDS, NPCS, REACTIONS, type NpcId } from './npcs';
import { OBJECTS } from './objects';
import { readAdventure } from './persist';

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
});

const story = () => room.adventure!;
const found = () => [...story().evidence.keys()];
const me = () => characterOf(room, ana.id)!;
const villagers = NPC_IDS.filter((id) => NPCS[id].location === 'bellweather');
const tokenOf = (id: NpcId) => room.tokens.get(NPCS[id].token)!;
/** Stands Ana's character beside someone (or a cell) and does something there. */
function beside(target: GridPos): void {
	const blocked = obstacles(room);
	for (const [dx, dy] of [
		[0, 1],
		[1, 0],
		[-1, 0],
		[0, -1],
		[1, 1],
		[-1, 1],
		[1, -1],
		[-1, -1]
	]) {
		const cell = { x: target.x + dx, y: target.y + dy };
		const taken = [...room.tokens.values()].some(
			(t) => t.id !== me().token.id && t.pos.x === cell.x && t.pos.y === cell.y
		);
		if (!taken && !isSolidCell(blocked, cell)) {
			me().token.pos = cell;
			return;
		}
	}
	throw new Error(`nowhere to stand beside ${JSON.stringify(target)}`);
}
const talkTo = (id: NpcId) => {
	beside(tokenOf(id).pos);
	return ok(interact(room, ana, id));
};
const spoken = (log: { kind: string }[]) =>
	log.flatMap((m) => ('speaker' in m && m.speaker ? [m.speaker] : []));

describe('the village', () => {
	it('is a valid table, with every building, the churchyard and the path in place', () => {
		const scene = bellweatherScene();
		expect(parseSceneFile(JSON.parse(JSON.stringify(scene))).ok).toBe(true);
		expect(scene.grid).toMatchObject({ width: 36, height: 28 });
		for (const id of [
			'hb-inn-door',
			'hb-hale-door',
			'hb-chapel-door',
			'hb-crane-door',
			'hb-gate'
		]) {
			expect(scene.objects.some((o) => o.id === id && o.kind === 'door')).toBe(true);
		}
		for (const id of ['hb-well', 'hb-anvil', 'hb-ringers', 'hb-waystone', 'hb-stall']) {
			expect(scene.props.some((p) => p.id === id)).toBe(true);
		}
		expect(scene.lights.length).toBeGreaterThanOrEqual(10);
	});

	it('has about ten people, each somewhere the party can walk up to', () => {
		expect(villagers.length).toBeGreaterThanOrEqual(10);
		for (const d of room.objects.values()) if (d.kind === 'door') d.open = true;
		const blocked = obstacles(room);
		for (const id of villagers) {
			const npc = NPCS[id];
			expect(tokenOf(id).pos).toEqual(npc.places.calm);
			const reachable = [npc.places.calm, npc.places.hiding, npc.places.after].every(
				(p) =>
					!p ||
					[-1, 0, 1].some((dx) =>
						[-1, 0, 1].some((dy) =>
							isReachable(room.grid, blocked, SPAWN[0], { x: p.x + dx, y: p.y + dy })
						)
					)
			);
			expect(reachable, `${npc.name} can be reached`).toBe(true);
			// Nobody stands where the Hound climbs out.
			expect(WELL_RING.some((c) => c.x === npc.places.calm.x && c.y === npc.places.calm.y)).toBe(
				false
			);
		}
	});

	it('gives every person lines, a fallback line, and states their lines use', () => {
		for (const id of NPC_IDS) {
			const npc = NPCS[id];
			expect(npc.lines.at(-1)?.if, `${npc.name}'s last line always applies`).toBeUndefined();
			for (const line of npc.lines) {
				if (line.becomes) expect(npc.states).toContain(line.becomes);
				for (const s of line.if?.state ?? []) expect(npc.states).toContain(s);
			}
		}
		for (const r of REACTIONS) expect(NPC_IDS).toContain(r.npc);
		// Every world object in the village is on the table.
		for (const def of OBJECTS.filter((o) => o.location === 'bellweather' && o.id !== 'remains')) {
			expect(objectCells(room, def), def.id).not.toBeNull();
		}
	});
});

describe('talking to people', () => {
	it('hands out clues once, then moves on to other lines', () => {
		const first = talkTo('bertram');
		expect(first.log[0]).toMatchObject({ kind: 'narration', speaker: 'Bertram' });
		expect(found()).toEqual(['legend']);
		const again = talkTo('bertram');
		expect(again.log).toHaveLength(1);
		expect(found()).toEqual(['legend']);
		expect(story().said.has('bertram:legend')).toBe(true);
	});

	it('collects a clue from each of the village’s witnesses', () => {
		for (const id of ['edda', 'aldric', 'wynn', 'nell', 'gregor', 'crane'] as NpcId[]) talkTo(id);
		expect(found()).toEqual(['bread', 'tracks', 'saint', 'empty-graves', 'shears', 'lights']);
		expect(story().npcs.get('edda')).toBe('hopeful');
		expect(story().npcs.get('crane')).toBe('frightened');
	});

	it('reacts to what the party has found and done', () => {
		// Pell keeps his promise until the party has Tobin's drawing.
		expect(talkTo('pell').log[0]).toMatchObject({ speaker: 'Pell' });
		expect(found()).not.toContain('promise');
		story().evidence.set('drawing', { by: [me().id], shared: false });
		talkTo('pell');
		expect(found()).toContain('promise');
		expect(story().npcs.get('pell')).toBe('talking');

		// Gregor has words about his crate.
		beside({ x: 10, y: 11 });
		const smashed = ok(interact(room, ana, 'crate'));
		expect(spoken(smashed.log)).toContain('Rosa');
		const told = talkTo('gregor');
		expect(told.log[0]).toMatchObject({ speaker: 'Gregor' });
		expect(story().npcs.get('gregor')).toBe('angry');
		expect(found()).not.toContain('shears');
		talkTo('gregor');
		expect(found()).toContain('shears');
	});

	it('only calls out reactions within earshot, once', () => {
		// Reading the parish register at the inn, with Bertram at the next table.
		beside({ x: 5, y: 7 });
		const read = ok(interact(room, ana, 'register'));
		expect(spoken(read.log)).toEqual(['Bertram']);
		expect(spoken(ok(interact(room, ana, 'register')).log)).toEqual([]);
		// The ringers' graves are far from the inn; Nell is right there.
		beside({ x: 31, y: 19 });
		expect(gridDistance(me().token.pos, tokenOf('nell').pos)).toBeLessThanOrEqual(8);
		expect(spoken(ok(interact(room, ana, 'ringers')).log)).toEqual(['Nell']);
		expect(found()).toContain('empty-graves');
	});
});

describe('people react to the Hound', () => {
	function houndOut() {
		talkTo('maren');
		beside({ x: 11, y: 13 });
		return ok(interact(room, ana, 'well'));
	}

	it('take cover when it climbs out and come back once it is dead', () => {
		const out = houndOut();
		expect(spoken(out.log)).toEqual(expect.arrayContaining(['Rosa', 'Pell']));
		expect(tokenOf('pell').pos).toEqual(NPCS.pell.places.hiding);
		expect(tokenOf('rosa').pos).toEqual(NPCS.rosa.places.hiding);
		expect(tokenOf('maren').pos).toEqual(NPCS.maren.places.calm);

		const hound = [...story().encounter!.enemies.keys()][0];
		room.tokens.delete(hound);
		const won = afterTokenDeleted(room, hound);
		expect(spoken(won.log)).toContain('Aldric');
		expect(tokenOf('pell').pos).toEqual(NPCS.pell.places.after);
		expect(tokenOf('rosa').pos).toEqual(NPCS.rosa.places.calm);
		expect(tokenOf('aldric').pos).toEqual(NPCS.aldric.places.after);
	});

	it('lets Rosa tend the party once the Hound is dead', () => {
		houndOut();
		const hound = [...story().encounter!.enemies.keys()][0];
		room.tokens.delete(hound);
		afterTokenDeleted(room, hound);
		me().state.hp = 10;
		talkTo('rosa');
		expect(me().state.hp).toBe(18);
		talkTo('rosa');
		expect(me().state.hp).toBe(18);
		expect(me().state.hp).toBeLessThanOrEqual(CHARACTERS.warden.hp);
		expect(story().npcs.get('rosa')).toBe('grateful');
	});
});

describe('saving what was said', () => {
	it('keeps lines said and reactions heard through a save, and refuses made-up ones', () => {
		talkTo('bertram');
		beside({ x: 5, y: 7 });
		ok(interact(room, ana, 'register'));
		const file = parseSceneFile(JSON.parse(JSON.stringify(exportScene(room, 'Village'))));
		if (!file.ok) throw new Error(file.error);
		const read = readAdventure(file.scene.adventure!, file.scene);
		if (!read.ok) throw new Error(read.error);
		expect([...read.adventure.said]).toEqual(['bertram:legend', 'reaction:bertram-register']);

		const state = file.scene.adventure!.state;
		state.said = ['bertram:nonsense'];
		expect(readAdventure(file.scene.adventure!, file.scene)).toMatchObject({ ok: false });
		delete state.said;
		const older = readAdventure(file.scene.adventure!, file.scene);
		expect(older.ok && older.adventure.said.size).toBe(0);
	});
});
