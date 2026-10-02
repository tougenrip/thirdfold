// Cover: how much of a target obstacles hide from an attacker, measured the
// way a grid table does it. From the corner of the attacker's cell that sees
// the most, a line runs to each corner of the target's cell; a line that
// crosses a wall, a closed door, something that blocks sight or another
// creature is blocked. What that is worth (a bonus to a defense, or nothing)
// is a ruleset's; this only measures. A target the table's sight rule lets
// the attacker see is never wholly hidden here: whether it can be targeted at
// all is that rule's (visibility.ts).
//
// Heights: an attacker standing at least WALL_LEVELS above its target looks
// down over walls and props, which then hide nothing (as the sight rule has
// it); ground itself is left to the sight rule.

import type { GridPos } from './grid';
import { asObstacles, canStep, type Blockers } from './objects';
import { WALL_LEVELS } from './visibility';

/**
 * Lines from the attacker's best corner to the target's corners: how many
 * are blocked by anything, and how many by things alone (walls, doors,
 * props), not by other creatures (rules may count those for less).
 */
export interface Cover {
	blocked: number;
	objects: number;
	lines: number;
}

export const NO_COVER: Cover = { blocked: 0, objects: 0, lines: 4 };

/** Lines start just inside each corner, so a wall ending at a corner is on one side of them. */
const INSET = 0.02;
/** Samples along a line, per cell of its length. */
const SAMPLES = 16;

const corners = (c: GridPos): [number, number][] => [
	[c.x + INSET, c.y + INSET],
	[c.x + 1 - INSET, c.y + INSET],
	[c.x + INSET, c.y + 1 - INSET],
	[c.x + 1 - INSET, c.y + 1 - INSET]
];

/**
 * The cover a target at `to` has from an attacker at `from`: of the four
 * lines from the attacker's best corner, how many are blocked. `body` says
 * whether a creature stands on a cell (the attacker's and target's own cells
 * never count).
 */
export function coverOf(
	blocked: Blockers,
	from: GridPos,
	to: GridPos,
	body: (cell: GridPos) => boolean = () => false
): Cover {
	if (from.x === to.x && from.y === to.y) return NO_COVER;
	const o = asObstacles(blocked);
	const level = (c: GridPos) => (o.levels ? o.levels[c.y * o.width + c.x] : 0);
	const above = !!o.levels && level(from) >= level(to) + WALL_LEVELS;
	const clear = { walls: above, props: above };
	let best: Cover | null = null;
	// The attacker's best corner: fewest lines blocked by things, then by anything.
	const worse = (a: Cover, b: Cover) => a.objects * 5 + a.blocked > b.objects * 5 + b.blocked;
	for (const a of corners(from)) {
		const seen = { blocked: 0, objects: 0, lines: 4 };
		for (const b of corners(to)) {
			const by = lineBlocked(blocked, a, b, from, to, body, clear);
			if (by) seen.blocked++;
			if (by === 'object') seen.objects++;
		}
		if (!best || worse(best, seen)) best = seen;
		if (best.blocked === 0) break;
	}
	return best ?? NO_COVER;
}

function lineBlocked(
	blocked: Blockers,
	a: [number, number],
	b: [number, number],
	from: GridPos,
	to: GridPos,
	body: (cell: GridPos) => boolean,
	clear: { walls: boolean; props: boolean }
): 'object' | 'body' | null {
	const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * SAMPLES));
	let prev: GridPos = { x: Math.floor(a[0]), y: Math.floor(a[1]) };
	let crowded = false;
	for (let i = 1; i <= steps; i++) {
		const t = i / steps;
		const cell = {
			x: Math.floor(a[0] + (b[0] - a[0]) * t),
			y: Math.floor(a[1] + (b[1] - a[1]) * t)
		};
		if (cell.x === prev.x && cell.y === prev.y) continue;
		if (!canStep(blocked, prev, cell, 'sight', to, clear)) return 'object';
		const own = (cell.x === from.x && cell.y === from.y) || (cell.x === to.x && cell.y === to.y);
		if (!own && body(cell)) crowded = true;
		prev = cell;
	}
	return crowded ? 'body' : null;
}
