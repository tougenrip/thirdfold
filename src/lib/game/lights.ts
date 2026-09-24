// Lighting. The room has an ambient level; light comes from GM-placed light
// sources and from tokens carrying a light (a torch, a lantern). Light spreads
// like sight: a round radius, blocked by walls and closed doors.
//
// Rules: light matters for visibility only where it is dark: everywhere when
// the ambient is dark, else in the table's dark areas (a sealed chamber, a
// cellar). There a token sees only lit cells within its vision, plus its own
// cell. Elsewhere, by day and at dusk, light is look only. A flash (a bell's
// toll lighting up a cavern) makes everything lit for a moment.

import { inBounds, type GridPos, type SquareGrid } from './grid';
import type { Blockers } from './objects';
import {
	addVision,
	cellIndex,
	emptyMask,
	hasLineOfSight,
	type CellMask,
	type VisionAdder
} from './visibility';

export type Ambient = 'day' | 'dusk' | 'dark';
export const AMBIENTS: readonly Ambient[] = ['day', 'dusk', 'dark'];

/** A light source standing on a cell. */
export interface Light {
	id: string;
	pos: GridPos;
	/** Reach in cells. */
	radius: number;
	/** `#rrggbb`. */
	color: string;
	on: boolean;
}

export const MAX_LIGHTS_PER_ROOM = 100;
export const MAX_LIGHT_RADIUS = 20;
export const DEFAULT_LIGHT_RADIUS = 4;

/** Suggested light colours; any `#rrggbb` is accepted. */
export const LIGHT_COLORS = [
	{ name: 'Torch', color: '#ffa04d' },
	{ name: 'Candle', color: '#ffd27a' },
	{ name: 'Moonlight', color: '#b8c8ff' },
	{ name: 'Arcane', color: '#8f7bff' },
	{ name: 'Fel', color: '#6fe08a' }
] as const;

/** Anything that gives off light: a placed source, or a token carrying one. */
export interface LightSource {
	pos: GridPos;
	radius: number;
	color: string;
}

/** Light sources in effect: switched-on lights plus tokens with a light radius. */
export function lightSources(
	lights: Iterable<Light>,
	tokens: Iterable<{ pos: GridPos; light: number }>
): LightSource[] {
	const sources: LightSource[] = [];
	for (const l of lights) if (l.on && l.radius > 0) sources.push(l);
	for (const t of tokens) {
		if (t.light > 0) sources.push({ pos: t.pos, radius: t.light, color: '#ffa04d' });
	}
	return sources;
}

/** Cells reached by any light source. */
export function litMask(
	grid: SquareGrid,
	blocked: Blockers,
	sources: Iterable<LightSource>,
	add: VisionAdder = addVision
): CellMask {
	const mask = emptyMask(grid);
	for (const s of sources) add(grid, blocked, s.pos, s.radius, mask);
	return mask;
}

/**
 * Cells a viewer can see by the light: every lit cell, and every cell that
 * isn't dark in the first place. Null when nothing is dark (everything counts
 * as lit). `darkness` marks the dark areas, for any ambient but dark.
 */
export function seenByLight(
	grid: SquareGrid,
	blocked: Blockers,
	ambient: Ambient,
	darkness: CellMask | null,
	sources: Iterable<LightSource>,
	add: VisionAdder = addVision
): CellMask | null {
	if (ambient !== 'dark' && !darkness) return null;
	const lit = litMask(grid, blocked, sources, add);
	if (ambient !== 'dark' && darkness) {
		for (let i = 0; i < lit.length; i++) if (!darkness[i]) lit[i] = 1;
	}
	return lit;
}

/** `mask` with the area from `from` to `to` set dark or not; null once nothing is dark. */
export function withDarkness(
	mask: CellMask | null,
	grid: SquareGrid,
	from: GridPos,
	to: GridPos,
	dark: boolean
): CellMask | null {
	const next = mask ? mask.slice() : emptyMask(grid);
	for (let y = Math.min(from.y, to.y); y <= Math.max(from.y, to.y); y++) {
		for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++) {
			if (inBounds(grid, { x, y })) next[cellIndex(grid, { x, y })] = dark ? 1 : 0;
		}
	}
	return next.some((v) => v) ? next : null;
}

/**
 * Brightness per cell in [0, 1], fading out towards each light's edge, for
 * rendering. Uses the same reach and line of sight as litMask, so every cell
 * with brightness > 0 is lit by the rules.
 */
export function lightLevels(
	grid: SquareGrid,
	blocked: Blockers,
	sources: Iterable<LightSource>
): Float32Array {
	const levels = new Float32Array(grid.width * grid.height);
	for (const s of sources) {
		if (!inBounds(grid, s.pos)) continue;
		const r = Math.floor(s.radius);
		const limit = r * r + r;
		for (let dy = -r; dy <= r; dy++) {
			for (let dx = -r; dx <= r; dx++) {
				const d2 = dx * dx + dy * dy;
				if (d2 > limit) continue;
				const c = { x: s.pos.x + dx, y: s.pos.y + dy };
				if (!inBounds(grid, c)) continue;
				const i = cellIndex(grid, c);
				const level = Math.max(0.2, 1 - Math.sqrt(d2) / (r + 1));
				if (level <= levels[i] || !hasLineOfSight(blocked, s.pos, c)) continue;
				levels[i] = level;
			}
		}
	}
	return levels;
}
