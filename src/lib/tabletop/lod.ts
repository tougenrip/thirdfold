// Levels of detail (#274): which of a cooked model's levels (`<role>_lod<n>`, models.ts) a figure or
// a prop draws, from its projected size. Pure, so the server project tests it. The renderer asks
// only when the camera, the canvas or the table changed (never on an idle frame), and an instance
// moves between its level's buckets (figures.ts, props.ts). Shadows never change with it: every
// model with levels casts through a proxy at its cheapest level on `SHADOW_PROXY`, a layer only
// the shadow cameras see, so a cached shadow map stays good however the levels change.

/** The layer of shadow proxies: the sun's and hero lights' shadow cameras enable it, nothing else. */
export const SHADOW_PROXY = 2;

/**
 * Projected radius (CSS px) below which an instance drops a level: the first threshold leaves
 * level 0 for 1, the second 1 for 2. Figures keep detail longer than props (they are the focus).
 */
export const FIGURE_LODS: readonly number[] = [36, 14];
export const PROP_LODS: readonly number[] = [48, 18];

/** A level is left at 0.9 of its threshold and taken back at 1.1, so it never flickers. */
const DOWN = 0.9;
const UP = 1.1;

/** A sphere of `radius` at `distance`, as a radius in px on a `viewportPx` high view of `fovY` (radians). */
export function projectedSize(
	radius: number,
	distance: number,
	fovY: number,
	viewportPx: number
): number {
	return ((radius / distance) * viewportPx) / (2 * Math.tan(fovY / 2));
}

/**
 * The level to draw (0 the finest, up to `thresholds.length`), given the one drawn now (`current`,
 * as this returned it) and the tier's `bias` (+1 on low: one level coarser throughout). A
 * degenerate view (the camera inside it, or no size) keeps the finest level the bias allows.
 */
export function lodFor(
	radius: number,
	distance: number,
	fovY: number,
	viewportPx: number,
	thresholds: readonly number[],
	current: number,
	bias: number
): number {
	const most = thresholds.length;
	const size = projectedSize(radius, distance, fovY, viewportPx);
	if (!(distance > 0) || !(radius > 0) || !Number.isFinite(size)) return Math.min(bias, most);
	const was = Math.max(0, current - bias); // the level before the bias, for the hysteresis
	let level = 0;
	thresholds.forEach((t, i) => {
		if (size < t * (was > i ? UP : DOWN)) level = i + 1;
	});
	return Math.min(level + bias, most);
}
