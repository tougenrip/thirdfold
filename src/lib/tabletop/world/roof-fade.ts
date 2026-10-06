// Which roofs fade (milestone 70, #259): pure, in the lazy `world` chunk, read by roofs.ts
// `RoofLayer`, which eases each region toward its target on the wall clock. docs/RENDERING.md,
// "Roofs (#257)" and "Roof fades (#259)". Everything here is what the viewer already has: its own
// and selected tokens' cells, the camera's pivot, its fog view's visible cells and what it knows.

import type { CellMask } from '../../game/visibility';
import type { RoofRegion } from './roofs';

/** The GM's roofs while a build tool is out: half there, a screen-door pattern. */
export const BUILDING_FADE = 0.5;

export interface RoofFadeInput {
	/** The cells of the viewer's own tokens and the selected one. */
	tokens: readonly number[];
	/** The cell under the camera's pivot, or -1 off the grid. */
	pivot: number;
	/** The viewer's visible cells with fog on, null with fog off (the rules hide nothing). */
	visible: CellMask | null;
	/** The viewer's explored cells, null for the GM and fog off (all known). */
	known: CellMask | null;
	/** The GM with a build tool out. */
	building: boolean;
}

/**
 * Each region's target, in order: 0 (gone) when one of the tokens stands in it, when the pivot
 * is on a known cell of it (a roof over unexplored ground stays: fading it would show only black),
 * or when any of its cells is visible; else `BUILDING_FADE` while building; else 1.
 */
export function roofFade(regions: readonly RoofRegion[], input: RoofFadeInput): number[] {
	const { tokens, pivot, visible, known, building } = input;
	const pivotKnown = pivot >= 0 && (!known || known[pivot] === 1);
	return regions.map((r) => {
		const open = r.cells.some(
			(i) => tokens.includes(i) || (pivotKnown && i === pivot) || visible?.[i] === 1
		);
		return open ? 0 : building ? BUILDING_FADE : 1;
	});
}
