// How The Hollow Bell's enemies decide what to do. Pure and deterministic:
// given what an enemy knows (where it is, what it can see, how hurt it is,
// who it was after), each function returns a plan (where to walk, and what
// to do at the end of it). engine.ts builds the situation from the table and
// carries the plan out, so the rules (rolls, damage, statuses) stay there.
//
// Seeing is the same rule players live by: within the enemy's vision, a
// clear line, and in the dark only cells that light reaches (or right
// beside it). What an enemy can't see it can't target; it goes where it last
// saw someone instead.

import type { CharacterId, Attack } from '../../src/lib/adventure/characters';
import { gridDistance, type GridPos, type SquareGrid } from '../../src/lib/game/grid';
import { findPath, type Obstacles } from '../../src/lib/game/objects';
import { sees, type CellMask } from '../../src/lib/game/visibility';
import { inAttackRange } from '../../src/lib/adventure/adventure';
import { ENEMIES, type EnemyKind } from './enemies';

/** How far the Bell Keeper will stray from its post by the Bell. */
export const LEASH = 4;
/** The Keeper goes first for anyone this close to the Bell. */
export const BELL_GUARD = 2;
/** A cultist this hurt (a third of its hit points or less) falls back when cornered. */
export const RETREAT_AT = 1 / 3;
/** A hound leaves its prey for another this many steps closer. */
export const SWITCH_BY = 3;

/** A standing character as an enemy sees the table. */
export interface Foe {
	id: CharacterId;
	pos: GridPos;
	hp: number;
}

export interface Situation {
	grid: SquareGrid;
	blocked: Obstacles;
	/** Cells light reaches, in the dark; null when it isn't dark. */
	lit: CellMask | null;
	/** The standing characters. */
	foes: readonly Foe[];
	/** Whether this enemy may walk into a cell (no one else standing there). */
	free: (c: GridPos) => boolean;
	/** The Bell, where there is one: its cells, and whether someone has laid hands on it. */
	bell: { cells: readonly GridPos[]; touched: boolean } | null;
}

/** What an enemy knows about itself. */
export interface Self {
	kind: EnemyKind;
	pos: GridPos;
	hp: number;
	maxHp: number;
	/** Cells it may move this turn. */
	speed: number;
	/** Turns before its special is ready again. */
	rest: number;
	/** Who it was after. */
	target?: CharacterId;
	/** Who hurt it last. */
	lastHitBy?: CharacterId;
	/** Where it last saw a character. */
	lastSeen?: GridPos;
	/** Where it stands guard (the Keeper). */
	post?: GridPos;
}

export type Deed =
	| { kind: 'attack'; attack: Attack; target: CharacterId }
	| { kind: 'toll'; targets: CharacterId[] };

export interface Plan {
	/** Cells to walk, in order (at most its speed). */
	path: GridPos[];
	/** What it does when it gets there. */
	deed: Deed | null;
	/** Who it is after now (kept for its next turn). */
	target?: CharacterId;
	/** Where it last saw someone, after this turn. */
	lastSeen?: GridPos;
	/** Said to the table, e.g. a hound turning on someone new. */
	note?: string;
}

/** The characters this enemy can see (and anyone right beside it: it hears and feels them). */
export function seenBy(situation: Situation, self: Pick<Self, 'kind' | 'pos'>): Foe[] {
	const vision = ENEMIES[self.kind].vision;
	return situation.foes.filter(
		(f) =>
			gridDistance(self.pos, f.pos) <= 1 ||
			sees(situation.grid, situation.blocked, situation.lit, self.pos, vision, f.pos)
	);
}

const same = (a: GridPos, b: GridPos) => a.x === b.x && a.y === b.y;

/** The shortest walk to a cell beside `to` (from where an attack of `range` reaches it). */
function pathToward(situation: Situation, from: GridPos, to: GridPos, range = 1): GridPos[] | null {
	const { grid, blocked, free } = situation;
	const reaches = (c: GridPos) => inAttackRange(blocked, c, to, range);
	if (reaches(from)) return [];
	return findPath(grid, blocked, from, reaches, free);
}

/** The walk to a cell, or as close as the way allows. */
function pathTo(situation: Situation, from: GridPos, to: GridPos): GridPos[] {
	if (same(from, to)) return [];
	return (
		findPath(situation.grid, situation.blocked, from, (c) => same(c, to), situation.free) ??
		pathToward(situation, from, to) ??
		[]
	);
}

/** What an enemy does on its turn in a fight. */
export function plan(situation: Situation, self: Self): Plan {
	switch (ENEMIES[self.kind].behavior) {
		case 'rush':
			return hound(situation, self);
		case 'skirmish':
			return cultist(situation, self);
		case 'guardian':
			return keeper(situation, self);
	}
}

/**
 * Nobody in sight: go to where someone was last seen, and forget them once
 * there. `home` is where to go when there is nowhere to look.
 */
function search(situation: Situation, self: Self, home?: GridPos): Plan {
	const goal = self.lastSeen ?? home;
	if (!goal) return { path: [], deed: null };
	const path = pathTo(situation, self.pos, goal).slice(0, self.speed);
	const end = path.at(-1) ?? self.pos;
	return {
		path,
		deed: null,
		lastSeen: self.lastSeen && !same(end, goal) ? self.lastSeen : undefined
	};
}

/**
 * The Hollow Hound: chases what it can see and bites. It keeps after its
 * prey, but turns on whoever hurt it last, or on someone much closer.
 */
function hound(situation: Situation, self: Self): Plan {
	const seen = seenBy(situation, self);
	if (seen.length === 0) return search(situation, self);
	const melee = ENEMIES.hound.attacks[0];
	const routes = new Map(
		seen.flatMap((f) => {
			const path = pathToward(situation, self.pos, f.pos);
			return path ? [[f.id, { foe: f, path }] as const] : [];
		})
	);
	if (routes.size === 0) return { path: [], deed: null, lastSeen: seen[0].pos };
	// The nearest, then the weakest.
	const nearest = [...routes.values()].reduce((a, b) =>
		b.path.length < a.path.length || (b.path.length === a.path.length && b.foe.hp < a.foe.hp)
			? b
			: a
	);
	let chosen = nearest;
	let note: string | undefined;
	const current = self.target ? routes.get(self.target) : undefined;
	const avenger = self.lastHitBy ? routes.get(self.lastHitBy) : undefined;
	if (avenger && avenger.foe.id !== self.target) {
		chosen = avenger;
		note = 'turns on';
	} else if (current && current.path.length - nearest.path.length < SWITCH_BY) {
		chosen = current;
	} else if (self.target && chosen.foe.id !== self.target) {
		note = 'turns on';
	}
	const path = chosen.path.slice(0, self.speed);
	const end = path.at(-1) ?? self.pos;
	const bites = inAttackRange(situation.blocked, end, chosen.foe.pos, melee.range);
	return {
		path,
		deed: bites ? { kind: 'attack', attack: melee, target: chosen.foe.id } : null,
		target: chosen.foe.id,
		lastSeen: chosen.foe.pos,
		...(note ? { note } : {})
	};
}

/**
 * The Bell Cultist: slings from range and knifes whoever gets beside it.
 * Badly hurt and cornered, it falls back first and slings from there.
 */
function cultist(situation: Situation, self: Self): Plan {
	const [knife, sling] = ENEMIES.cultist.attacks;
	const seen = seenBy(situation, self);
	if (seen.length === 0) return search(situation, self);
	const { blocked } = situation;
	const shotsFrom = (c: GridPos) =>
		seen.filter((f) => inAttackRange(blocked, c, f.pos, sling.range));
	const beside = seen.filter((f) => gridDistance(self.pos, f.pos) <= 1);
	const nearestFrom = (c: GridPos, list: Foe[]) =>
		list.reduce((a, b) => (gridDistance(c, b.pos) < gridDistance(c, a.pos) ? b : a));
	const weakest = (list: Foe[]) => list.reduce((a, b) => (b.hp < a.hp ? b : a));
	const lastSeen = nearestFrom(self.pos, seen).pos;

	if (beside.length && self.hp <= self.maxHp * RETREAT_AT) {
		// Fall back: the reachable cell farthest from everyone, preferring one with a shot.
		const away = fallBack(situation, self, seen, sling.range);
		if (away) {
			const end = away.at(-1)!;
			const shots = shotsFrom(end).filter((f) => gridDistance(end, f.pos) > 1);
			return {
				path: away,
				deed: shots.length
					? { kind: 'attack', attack: sling, target: nearestFrom(end, shots).id }
					: null,
				lastSeen,
				note: 'falls back'
			};
		}
	}
	if (beside.length) {
		return {
			path: [],
			deed: { kind: 'attack', attack: knife, target: weakest(beside).id },
			lastSeen
		};
	}
	let path: GridPos[] = [];
	let shots = shotsFrom(self.pos);
	if (shots.length === 0) {
		path =
			findPath(
				situation.grid,
				blocked,
				self.pos,
				(c) => shotsFrom(c).length > 0,
				situation.free
			)?.slice(0, self.speed) ?? [];
		shots = shotsFrom(path.at(-1) ?? self.pos);
	}
	const end = path.at(-1) ?? self.pos;
	return {
		path,
		deed: shots.length
			? { kind: 'attack', attack: sling, target: nearestFrom(end, shots).id }
			: null,
		lastSeen
	};
}

/**
 * The walk (within speed) to fall back along: further from everyone than it
 * is now, best a cell it can still sling from, and among those the farthest.
 * Null if it can't get further away.
 */
function fallBack(
	situation: Situation,
	self: Self,
	foes: readonly Foe[],
	range: number
): GridPos[] | null {
	const { grid, blocked, free } = situation;
	const distance = (c: GridPos) => Math.min(...foes.map((f) => gridDistance(c, f.pos)));
	const shot = (c: GridPos) =>
		foes.some((f) => gridDistance(c, f.pos) > 1 && inAttackRange(blocked, c, f.pos, range));
	const here = distance(self.pos);
	let best: { path: GridPos[]; score: number } | null = null;
	for (let dy = -self.speed; dy <= self.speed; dy++) {
		for (let dx = -self.speed; dx <= self.speed; dx++) {
			const c = { x: self.pos.x + dx, y: self.pos.y + dy };
			if (c.x < 0 || c.y < 0 || c.x >= grid.width || c.y >= grid.height || !free(c)) continue;
			const away = distance(c);
			if (away <= here) continue;
			const score = (shot(c) ? 100 : 0) + away;
			if (best && score <= best.score) continue;
			const path = findPath(grid, blocked, self.pos, (p) => same(p, c), free);
			if (path && path.length <= self.speed) best = { path, score };
		}
	}
	return best?.path ?? null;
}

/**
 * The Bell Keeper: guards its post by the Bell and never strays more than
 * LEASH cells from it. It goes first for anyone near the Bell, tolls when
 * the party crowds it (every other turn; every turn once someone has laid
 * hands on the Bell), and otherwise hammers. With nobody to fight, it goes
 * back to its post.
 */
function keeper(situation: Situation, self: Self): Plan {
	const def = ENEMIES.keeper;
	const toll = def.toll!;
	const post = self.post ?? self.pos;
	const seen = seenBy(situation, self);
	const enraged = !!situation.bell?.touched;
	// Crowded: toll, when it is ready (or the Bell has been touched).
	const near = seen.filter(
		(f) =>
			gridDistance(self.pos, f.pos) <= toll.range &&
			inAttackRange(situation.blocked, self.pos, f.pos, toll.range)
	);
	if (near.length && (self.rest === 0 || enraged)) {
		return { path: [], deed: { kind: 'toll', targets: near.map((f) => f.id) } };
	}
	const inGround = seen.filter((f) => gridDistance(post, f.pos) <= LEASH + 1);
	if (inGround.length === 0) return search(situation, { ...self, lastSeen: undefined }, post);
	// Anyone near the Bell first, then the nearest.
	const bellDistance = (f: Foe) =>
		situation.bell
			? Math.min(...situation.bell.cells.map((c) => gridDistance(c, f.pos)))
			: Infinity;
	const byBell = inGround.filter((f) => bellDistance(f) <= BELL_GUARD);
	const pool = byBell.length ? byBell : inGround;
	const target = pool.reduce((a, b) =>
		gridDistance(self.pos, b.pos) < gridDistance(self.pos, a.pos) ? b : a
	);
	const hammer = def.attacks[0];
	const route = pathToward(situation, self.pos, target.pos) ?? [];
	// Never beyond the leash: stop at the last cell still within it.
	const path: GridPos[] = [];
	for (const c of route.slice(0, self.speed)) {
		if (gridDistance(post, c) > LEASH) break;
		path.push(c);
	}
	const end = path.at(-1) ?? self.pos;
	const reaches = inAttackRange(situation.blocked, end, target.pos, hammer.range);
	return {
		path,
		deed: reaches ? { kind: 'attack', attack: hammer, target: target.id } : null,
		target: target.id
	};
}

/** A sentry on its round: where it walks next (one step toward its next waypoint). */
export function patrolStep(
	situation: Pick<Situation, 'grid' | 'blocked' | 'free'>,
	pos: GridPos,
	route: readonly GridPos[],
	leg: number
): { pos: GridPos; leg: number } {
	if (route.length <= 1) return { pos, leg: 0 };
	let next = leg % route.length;
	if (same(pos, route[next])) next = (next + 1) % route.length;
	const goal = route[next];
	const path = findPath(
		situation.grid,
		situation.blocked,
		pos,
		(c) => same(c, goal),
		situation.free
	);
	const step = path?.[0];
	if (!step) return { pos, leg: next };
	return { pos: step, leg: same(step, goal) ? (next + 1) % route.length : next };
}
