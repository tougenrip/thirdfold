// Lighting. The room has an ambient level; light comes from GM-placed light
// sources and from tokens carrying a light (a torch, a lantern). Light spreads
// like sight: a round radius, blocked by walls and closed doors.
//
// Rules: only in the dark does light matter for visibility (a token then sees
// lit cells within its vision, plus its own cell). Day and dusk are look only.

import { inBounds, type GridPos, type SquareGrid } from './grid';
import { addVision, cellIndex, emptyMask, hasLineOfSight, type CellMask } from './visibility';

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
	blocked: ReadonlySet<string>,
	sources: Iterable<LightSource>
): CellMask {
	const mask = emptyMask(grid);
	for (const s of sources) addVision(grid, blocked, s.pos, s.radius, mask);
	return mask;
}

/**
 * Brightness per cell in [0, 1], fading out towards each light's edge, for
 * rendering. Uses the same reach and line of sight as litMask, so every cell
 * with brightness > 0 is lit by the rules.
 */
export function lightLevels(
	grid: SquareGrid,
	blocked: ReadonlySet<string>,
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
