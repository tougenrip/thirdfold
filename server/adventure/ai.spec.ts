import { describe, expect, it } from 'vitest';
import type { CharacterId } from '../../src/lib/adventure/characters';
import type { GridPos, SquareGrid } from '../../src/lib/game/grid';
import type { SceneObject } from '../../src/lib/game/objects';
import { obstaclesFor } from '../../src/lib/game/props';
import { emptyMask, type CellMask } from '../../src/lib/game/visibility';
import { LEASH, patrolStep, plan, seenBy, type Foe, type Self, type Situation } from './ai';
import { ENEMIES } from './enemies';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 20, height: 12 };
const at = (x: number, y: number): GridPos => ({ x, y });
const foe = (id: CharacterId, pos: GridPos, hp = 20): Foe => ({ id, pos, hp });

function situation(
	foes: Foe[],
	options: { walls?: SceneObject[]; lit?: CellMask | null; bell?: Situation['bell'] } = {}
): Situation {
	const occupied = new Set(foes.map((f) => `${f.pos.x},${f.pos.y}`));
	return {
		grid,
		blocked: obstaclesFor(grid, options.walls ?? [], []),
		lit: options.lit ?? null,
		foes,
		free: (c) => !occupied.has(`${c.x},${c.y}`),
		bell: options.bell ?? null
	};
}

function self(kind: Self['kind'], pos: GridPos, more: Partial<Self> = {}): Self {
	const def = ENEMIES[kind];
	return { kind, pos, hp: 20, maxHp: 20, speed: def.speed, rest: 0, ...more };
}

const end = (p: { path: GridPos[] }, from: GridPos) => p.path.at(-1) ?? from;

describe('seeing', () => {
	it('sees within its vision, not through walls, and in the dark only what light reaches', () => {
		const warden = foe('warden', at(8, 5));
		expect(seenBy(situation([warden]), { kind: 'hound', pos: at(2, 5) })).toHaveLength(1);
		// Beyond its vision of 8.
		expect(seenBy(situation([warden]), { kind: 'hound', pos: at(17, 11) })).toHaveLength(0);
		// A wall between.
		const wall: SceneObject = { id: 'w', kind: 'wall', a: at(5, 0), b: at(5, 12) };
		expect(
			seenBy(situation([warden], { walls: [wall] }), { kind: 'hound', pos: at(2, 5) })
		).toHaveLength(0);
		// In the dark: unseen unless light reaches the character (or it is right beside).
		const dark = emptyMask(grid);
		expect(
			seenBy(situation([warden], { lit: dark }), { kind: 'hound', pos: at(2, 5) })
		).toHaveLength(0);
		const lit = emptyMask(grid);
		lit[5 * grid.width + 8] = 1;
		expect(seenBy(situation([warden], { lit }), { kind: 'hound', pos: at(2, 5) })).toHaveLength(1);
		expect(
			seenBy(situation([warden], { lit: dark }), { kind: 'hound', pos: at(7, 5) })
		).toHaveLength(1);
	});
});

describe('the Hollow Hound', () => {
	it('chases the nearest it can see and bites when it gets there', () => {
		const p = plan(
			situation([foe('warden', at(6, 5)), foe('veil', at(14, 5))]),
			self('hound', at(2, 5))
		);
		expect(p.target).toBe('warden');
		const to = end(p, at(2, 5));
		expect(Math.max(Math.abs(to.x - 6), Math.abs(to.y - 5))).toBe(1);
		expect(p.deed).toMatchObject({ kind: 'attack', target: 'warden' });
	});

	it('keeps after its prey, turns on whoever hurt it, or on someone much closer', () => {
		const foes = [foe('warden', at(8, 5)), foe('veil', at(6, 5))];
		// Still after the Warden: the Veil is only a little closer.
		expect(plan(situation(foes), self('hound', at(3, 5), { target: 'warden' })).target).toBe(
			'warden'
		);
		// The Veil hurt it: it turns on the Veil.
		const avenged = plan(
			situation(foes),
			self('hound', at(3, 5), { target: 'warden', lastHitBy: 'veil' })
		);
		expect(avenged).toMatchObject({ target: 'veil', note: 'turns on' });
		// Someone much closer than its prey: it switches.
		const near = [foe('warden', at(12, 5)), foe('veil', at(4, 5))];
		expect(plan(situation(near), self('hound', at(3, 5), { target: 'warden' }))).toMatchObject({
			target: 'veil',
			note: 'turns on'
		});
	});

	it('with nobody in sight, runs to where it last saw someone, then forgets', () => {
		const wall: SceneObject = { id: 'w', kind: 'wall', a: at(10, 0), b: at(10, 12) };
		const hidden = situation([foe('warden', at(14, 5))], { walls: [wall] });
		const going = plan(hidden, self('hound', at(2, 5), { lastSeen: at(6, 5) }));
		expect(end(going, at(2, 5))).toEqual(at(6, 5));
		expect(going.deed).toBeNull();
		expect(going.lastSeen).toBeUndefined();
		expect(plan(hidden, self('hound', at(2, 5))).path).toEqual([]);
	});
});

describe('the Bell Cultist', () => {
	it('knifes whoever is beside it, slings anyone else in range', () => {
		const knife = plan(situation([foe('warden', at(5, 6))]), self('cultist', at(5, 5)));
		expect(knife.deed).toMatchObject({ kind: 'attack', attack: { name: 'Ritual knife' } });
		const sling = plan(situation([foe('warden', at(9, 5))]), self('cultist', at(5, 5)));
		expect(sling).toMatchObject({
			path: [],
			deed: { attack: { name: 'Sling' }, target: 'warden' }
		});
	});

	it('falls back when badly hurt and cornered, and slings from there', () => {
		const p = plan(situation([foe('warden', at(5, 6))]), self('cultist', at(5, 5), { hp: 4 }));
		expect(p.note).toBe('falls back');
		const to = end(p, at(5, 5));
		expect(Math.max(Math.abs(to.x - 5), Math.abs(to.y - 6))).toBeGreaterThan(1);
		expect(p.deed).toMatchObject({ attack: { name: 'Sling' } });
	});
});

describe('the Bell Keeper', () => {
	const post = at(10, 3);
	const bell = { cells: [at(10, 1), at(11, 1)], touched: false };

	it('tolls when crowded and ready; otherwise hammers', () => {
		const crowd = [foe('warden', at(10, 4)), foe('saint', at(11, 5))];
		expect(plan(situation(crowd, { bell }), self('keeper', post, { post })).deed).toEqual({
			kind: 'toll',
			targets: ['warden', 'saint']
		});
		expect(
			plan(situation(crowd, { bell }), self('keeper', post, { post, rest: 1 })).deed
		).toMatchObject({ kind: 'attack', attack: { name: 'Bell hammer' } });
	});

	it('tolls every turn once someone has laid hands on the Bell', () => {
		const crowd = [foe('warden', at(10, 4))];
		const angry = situation(crowd, { bell: { ...bell, touched: true } });
		expect(plan(angry, self('keeper', post, { post, rest: 2 })).deed).toMatchObject({
			kind: 'toll'
		});
	});

	it('goes first for whoever is near the Bell, even if someone else is closer to it', () => {
		const foes = [foe('warden', at(7, 4)), foe('veil', at(12, 1))];
		expect(
			plan(situation(foes, { bell }), self('keeper', at(10, 4), { post, rest: 1 })).target
		).toBe('veil');
	});

	it('never strays beyond its leash, and goes back to its post with nobody to guard against', () => {
		const lure = plan(
			situation([foe('warden', at(10, 9))], { bell }),
			self('keeper', post, { post, rest: 1 })
		);
		for (const c of lure.path) {
			expect(Math.max(Math.abs(c.x - post.x), Math.abs(c.y - post.y))).toBeLessThanOrEqual(LEASH);
		}
		// Far beyond its ground: it walks home.
		const home = plan(
			situation([foe('warden', at(19, 11))], { bell }),
			self('keeper', at(10, 6), { post })
		);
		expect(end(home, at(10, 6))).toEqual(post);
		expect(home.deed).toBeNull();
	});
});

describe('patrols', () => {
	it('walks its round a step at a time, looping through the waypoints', () => {
		const s = situation([]);
		const route = [at(2, 2), at(2, 4), at(4, 4)];
		let pos = at(2, 2);
		let leg = 0;
		const visited: GridPos[] = [];
		for (let i = 0; i < 8; i++) {
			({ pos, leg } = patrolStep(s, pos, route, leg));
			visited.push(pos);
		}
		// One step each time, through the waypoints in order and round again.
		const key = (c: GridPos) => `${c.x},${c.y}`;
		const order = visited.map(key);
		expect(order.indexOf('2,4')).toBeLessThan(order.indexOf('4,4'));
		expect(order.indexOf('4,4')).toBeLessThan(order.indexOf('2,2'));
		// A post is not a round: the guard stays put.
		expect(patrolStep(s, at(5, 5), [at(5, 5)], 0).pos).toEqual(at(5, 5));
	});
});
