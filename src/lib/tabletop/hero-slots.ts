import type { GridPos } from '../game/grid';

// Hero shadows (#230): a fixed pool of shadow-casting slots per tier goes to the known sources
// nearest the camera's focus, those with casters (tokens, props, raised ground) in their reach
// first. A slot keeps its holder until a challenger beats it by HERO_MARGIN, so small camera moves
// never hand a slot over; a holder that is gone frees its slot. Holders keep their slot index.

/** A source a slot may hold: its id, rule origin (a cell) and reach in cells (`renderedReach`). */
export interface HeroSource {
	id: string;
	pos: GridPos;
	reach: number;
}

/** How much nearer the focus, in cells, a challenger must be to take a slot. */
export const HERO_MARGIN = 2;
/** How much farther a source with no caster in its reach counts, in cells. */
export const HERO_NO_CASTER = 8;
/** Sources farther than this from the focus, in cells, hold no slot. */
export const HERO_RANGE = 16;

/**
 * Each of `slots` slots' holder (a source id, or null), from `previous` (the last assignment):
 * sources scored by their distance from `focus` (cell coordinates, a cell's centre at `+ 0.5`),
 * plus HERO_NO_CASTER without a caster within their reach, those past HERO_RANGE left out. A free
 * slot takes the best source unheld, and the worst holder gives way only to a challenger
 * HERO_MARGIN better. Ties go by id, so the same inputs always give the same slots.
 */
export function assignHeroSlots(
	sources: readonly HeroSource[],
	focus: { x: number; y: number },
	casters: readonly GridPos[],
	slots: number,
	previous: readonly (string | null)[]
): (string | null)[] {
	const score = new Map<string, number>();
	for (const s of sources) {
		const d = Math.hypot(s.pos.x + 0.5 - focus.x, s.pos.y + 0.5 - focus.y);
		if (d > HERO_RANGE) continue;
		const cast = casters.some((c) => Math.hypot(c.x - s.pos.x, c.y - s.pos.y) <= s.reach);
		score.set(s.id, d + (cast ? 0 : HERO_NO_CASTER));
	}
	const of = (id: string) => score.get(id)!;
	const rank = (a: string, b: string) => of(a) - of(b) || (a < b ? -1 : 1);
	const held = Array.from({ length: slots }, (_, i) => {
		const id = previous[i] ?? null;
		return id !== null && score.has(id) ? id : null;
	});
	const free = [...score.keys()].filter((id) => !held.includes(id)).sort(rank);
	for (let i = 0; i < slots; i++) held[i] ??= free.shift() ?? null;
	for (;;) {
		let worst = -1;
		for (let i = 0; i < slots; i++)
			if (held[i] !== null && (worst < 0 || of(held[i]!) > of(held[worst]!))) worst = i;
		const best = free[0];
		if (worst < 0 || best === undefined || of(best) + HERO_MARGIN >= of(held[worst]!)) break;
		free[0] = held[worst]!;
		free.sort(rank);
		held[worst] = best;
	}
	return held;
}
