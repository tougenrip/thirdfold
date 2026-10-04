// The grid's display modes and the hover highlight's patterns (#245), pure: what the shader grid
// (materials/grid.ts) draws, mirrored here in plain maths so the server project can test it.
// The grid is a gameplay overlay, never the world's art (docs/LOOK.md, gap 12): lines projected
// onto whatever ground is there, shown as much as the moment needs.

/** The highlight's kinds (`HighlightKind` in types.ts, which the server's build doesn't load). */
type HighlightKind = 'move' | 'blocked' | 'place';

/**
 * How much grid shows. `build`: all of it (the GM building, a token or enemy being placed, or the
 * Graphics menu's Grid: Always). `explore`: round the hovered cell and the selected token, in play.
 * `overview`: faint, in the tactical view with nothing selected. `off`: none (Grid: Off).
 */
export type GridMode = 'build' | 'explore' | 'overview' | 'off';
export const GRID_MODES: readonly GridMode[] = ['build', 'explore', 'overview', 'off'];

/** The lines' strength by mode: the `strength` uniform. */
export const GRID_STRENGTH: Record<GridMode, number> = {
	build: 1,
	explore: 1,
	overview: 0.4,
	off: 0
};

/** The lines' colour and their opacity at full strength. */
export const GRID_COLOR = 0xd8cfb4;
export const GRID_OPACITY = 0.5;
/** A line's width, in cells; never drawn thinner than a pixel (it fades instead). */
export const LINE_WIDTH = 0.03;
/** Explore mode: the lines fade out between these distances from a focus cell's centre, in cells. */
export const EXPLORE_INNER = 2;
export const EXPLORE_RADIUS = 3.5;
/** The lines fade out between these camera distances, in cells (beyond, they would only shimmer). */
export const FADE_NEAR = 40;
export const FADE_FAR = 90;

const smoothstep = (a: number, b: number, x: number) => {
	const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
	return t * t * (3 - 2 * t);
};

/** Explore mode's term for a fragment `d` cells from the nearest focus: 1 near, 0 past the radius. */
export const exploreTerm = (d: number) => 1 - smoothstep(EXPLORE_INNER, EXPLORE_RADIUS, d);

/** The camera-distance fade for a fragment `d` cells from the camera. */
export const distanceFade = (d: number) => 1 - smoothstep(FADE_NEAR, FADE_FAR, d);

/**
 * One axis of Golus's pristine grid ("The best darn grid shader yet"): the coverage of the line
 * through the nearest integer of `u` (a coordinate in cells), given `deriv`, how far `u` moves
 * across a pixel. The drawn width is clamped to at least a pixel, its coverage scaled down to the
 * line's true width, and toward the line's average (its width) as cells shrink below a pixel, so
 * far lines go grey instead of shimmering. The shader's `lineAxis` is the same, per axis.
 */
export function lineCoverage(u: number, deriv: number, width = LINE_WIDTH): number {
	const d = Math.max(deriv, 1e-6);
	const drawWidth = Math.min(Math.max(width, d), 0.5);
	const aa = d * 1.5;
	const g = 1 - Math.abs((u - Math.floor(u)) * 2 - 1);
	let line = smoothstep(drawWidth + aa, drawWidth - aa, g);
	line *= Math.min(Math.max(width / drawWidth, 0), 1);
	return line + (width - line) * Math.min(Math.max(d * 2 - 1, 0), 1);
}

/** The highlight's pattern by kind: the `pattern` uniform (0 none). Each kind is told by shape. */
export const HIGHLIGHT_PATTERN: Record<HighlightKind, number> = { move: 1, blocked: 2, place: 3 };
/** Each pattern's opacity where it covers. */
export const PATTERN_OPACITY = [0, 0.4, 0.6, 0.9] as const;
/** Inset from the cell's edges, in cells: the highlight never covers the grid line. */
export const PATTERN_INSET = 0.04;
/** Hatch stripes across a cell (blocked), and the bracket's arm and band (place). */
export const HATCH_STRIPES = 3;
export const BRACKET_ARM = 0.32;
export const BRACKET_BAND = 0.1;

/**
 * Whether pattern `p` covers the point (x, y) of its cell (0-1 each way): the shader's
 * `highlightCover` without its antialiasing. Move fills the cell, blocked hatches it diagonally,
 * place draws its corner brackets.
 */
export function patternCovers(p: number, x: number, y: number): boolean {
	const edge = Math.min(x, 1 - x, y, 1 - y);
	if (p === 0 || edge < PATTERN_INSET) return false;
	if (p === 1) return true;
	if (p === 2) return Math.abs((((x + y) * HATCH_STRIPES) % 1) - 0.5) > 0.25;
	const corner = Math.max(Math.min(x, 1 - x), Math.min(y, 1 - y)) < BRACKET_ARM;
	return corner && edge < PATTERN_INSET + BRACKET_BAND;
}

/** The Graphics menu's Grid (`GraphicsPrefs.grid`): as the moment calls for, always, or never. */
export type GridSetting = 'auto' | 'always' | 'off';
export const GRID_SETTINGS: readonly GridSetting[] = ['auto', 'always', 'off'];

/** The mode the viewer's setting makes of the moment's: Always is the full grid, Off none. */
export const withGridSetting = (mode: GridMode, setting: GridSetting): GridMode =>
	setting === 'auto' ? mode : setting === 'always' ? 'build' : 'off';

/** A saved Grid setting, Auto when unreadable; #167's switch (`alwaysGrid`) reads as Always. */
export const readGridSetting = (grid: unknown, alwaysGrid: unknown): GridSetting =>
	GRID_SETTINGS.includes(grid as GridSetting)
		? (grid as GridSetting)
		: alwaysGrid === true
			? 'always'
			: 'auto';
