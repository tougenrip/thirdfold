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
import { asObstacles, type Blockers } from './objects';
import { TOKEN_COLOR_PATTERN } from './token';
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

/** What a light is and how it is drawn; look only, never a rule. Every field is optional. */
export const LIGHT_KINDS = [
	'torch',
	'candle',
	'brazier',
	'lantern',
	'glow',
	'magic',
	'fire',
	'neon',
	'panel'
] as const;
export type LightKind = (typeof LIGHT_KINDS)[number];
export const FLICKERS = ['none', 'candle', 'torch', 'fire', 'pulse'] as const;
export type Flicker = (typeof FLICKERS)[number];
export const MAX_LIGHT_INTENSITY = 4;
/** How high a light hangs, in levels above its cell's floor. */
export const MAX_LIGHT_HEIGHT = 10;

export interface LightLook {
	kind: LightKind;
	/** 0 to MAX_LIGHT_INTENSITY. */
	intensity: number;
	/** Levels above its floor, 0 to MAX_LIGHT_HEIGHT. */
	height: number;
	flicker: Flicker;
	shadows: boolean;
	/** Whether a fixture (a lantern, a sconce) is drawn, or only the light. */
	fixture: boolean;
	/** Quarter turns clockwise, for lights on a wall. */
	facing: 0 | 1 | 2 | 3;
}

/** The look fields, in order. */
export const LIGHT_LOOK_KEYS: readonly (keyof LightLook)[] = [
	'kind',
	'intensity',
	'height',
	'flicker',
	'shadows',
	'fixture',
	'facing'
];

const kindLook = (
	kind: LightKind,
	intensity: number,
	height: number,
	flicker: Flicker,
	fixture: boolean
): LightLook => ({ kind, intensity, height, flicker, shadows: true, fixture, facing: 0 });

/** Each kind's look, which a light's own fields override; starting points for #238 to tune. */
export const LIGHT_KIND_DEFAULTS: Readonly<Record<LightKind, LightLook>> = {
	torch: kindLook('torch', 1, 4, 'torch', true),
	candle: kindLook('candle', 0.5, 1, 'candle', true),
	brazier: kindLook('brazier', 1.5, 2, 'fire', true),
	lantern: kindLook('lantern', 1, 4, 'candle', true),
	glow: kindLook('glow', 1, 1, 'none', false),
	magic: kindLook('magic', 1, 3, 'pulse', true),
	fire: kindLook('fire', 1.5, 0, 'fire', false),
	neon: kindLook('neon', 1, 3, 'none', true),
	panel: kindLook('panel', 0.8, 3, 'none', true)
};

/** A kind's name for people: 'Torch'. */
export const lightKindName = (kind: LightKind): string => kind[0].toUpperCase() + kind.slice(1);

/** A light's whole look: its own fields over its kind's (no kind is a torch, the look lights always had). */
export function lightLook(light: Partial<LightLook>): LightLook {
	const look: Record<string, unknown> = { ...LIGHT_KIND_DEFAULTS[light.kind ?? 'torch'] };
	for (const key of LIGHT_LOOK_KEYS) if (light[key] !== undefined) look[key] = light[key];
	return look as unknown as LightLook;
}

/** A light source standing on a cell. */
export interface Light extends Partial<LightLook> {
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const inRange = (v: unknown, max: number) =>
	typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;

/** The look fields present on `raw`, or null when any is invalid. Absent fields stay absent. */
export function parseLightLook(raw: Record<string, unknown>): Partial<LightLook> | null {
	const look: Partial<LightLook> = {};
	const { kind, intensity, height, flicker, shadows, fixture, facing } = raw;
	if (kind !== undefined) {
		if (!LIGHT_KINDS.includes(kind as LightKind)) return null;
		look.kind = kind as LightKind;
	}
	if (intensity !== undefined) {
		if (!inRange(intensity, MAX_LIGHT_INTENSITY)) return null;
		look.intensity = intensity as number;
	}
	if (height !== undefined) {
		if (!inRange(height, MAX_LIGHT_HEIGHT)) return null;
		look.height = height as number;
	}
	if (flicker !== undefined) {
		if (!FLICKERS.includes(flicker as Flicker)) return null;
		look.flicker = flicker as Flicker;
	}
	for (const [key, value] of [
		['shadows', shadows],
		['fixture', fixture]
	] as const) {
		if (value === undefined) continue;
		if (typeof value !== 'boolean') return null;
		look[key] = value;
	}
	if (facing !== undefined) {
		if (facing !== 0 && facing !== 1 && facing !== 2 && facing !== 3) return null;
		look.facing = facing;
	}
	return look;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * A saved list of lights (a scene's, or what a player remembers), checked
 * like live ones: ids unique (also against `taken`, which gains them), on the
 * table, within limits. The lights, or what is wrong.
 */
export function parseLightList(
	raw: unknown,
	grid: SquareGrid,
	taken = new Set<string>()
): Light[] | string {
	if (!Array.isArray(raw) || raw.length > MAX_LIGHTS_PER_ROOM) {
		return `A scene holds at most ${MAX_LIGHTS_PER_ROOM} lights.`;
	}
	const lights: Light[] = [];
	for (const l of raw as unknown[]) {
		if (!isRecord(l) || typeof l.id !== 'string' || !ID.test(l.id) || taken.has(l.id)) {
			return 'A light has a missing or duplicate id.';
		}
		const pos = isRecord(l.pos) ? { x: l.pos.x as number, y: l.pos.y as number } : null;
		if (!pos || !inBounds(grid, pos)) return 'A light is off the map.';
		const radius = l.radius;
		if (
			!Number.isInteger(radius) ||
			(radius as number) < 1 ||
			(radius as number) > MAX_LIGHT_RADIUS
		) {
			return 'A light has an invalid radius.';
		}
		if (typeof l.color !== 'string' || !TOKEN_COLOR_PATTERN.test(l.color)) {
			return 'A light has an invalid colour.';
		}
		if (typeof l.on !== 'boolean') return 'A light is neither on nor off.';
		const look = parseLightLook(l);
		if (!look) return 'A light has an invalid look.';
		taken.add(l.id);
		lights.push({ id: l.id, pos, radius: radius as number, color: l.color, on: l.on, ...look });
	}
	return lights;
}

/** Suggested light colours; any `#rrggbb` is accepted. */
export const LIGHT_COLORS = [
	{ name: 'Torch', color: '#ffa04d' },
	{ name: 'Candle', color: '#ffd27a' },
	{ name: 'Moonlight', color: '#b8c8ff' },
	{ name: 'Arcane', color: '#8f7bff' },
	{ name: 'Fel', color: '#6fe08a' }
] as const;

/** The colour of a carried light when its token names none. */
export const CARRIED_LIGHT_COLOR = '#ffa04d';

/** Anything that gives off light: a placed source, or a token carrying one. The rules read only pos, radius and colour. */
export interface LightSource extends Partial<LightLook> {
	pos: GridPos;
	radius: number;
	color: string;
}

/** Light sources in effect: switched-on lights plus tokens with a light radius. */
export function lightSources(
	lights: Iterable<Light>,
	tokens: Iterable<{ pos: GridPos; light: number; lightColor?: string }>
): LightSource[] {
	const sources: LightSource[] = [];
	for (const l of lights) if (l.on && l.radius > 0) sources.push(l);
	for (const t of tokens) {
		if (t.light > 0)
			sources.push({ pos: t.pos, radius: t.light, color: t.lightColor ?? CARRIED_LIGHT_COLOR });
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

// The rendered falloff (#226): one definition of how far and how brightly a light renders, shared
// by the renderer (#228's shader mirrors these numbers) and the tests. The contract: zero exactly
// where the rules are dark, readable everywhere they light, reach and occlusion from the rule
// origin (the light's cell centre). Distances are in cells.

/**
 * How the body of a light fades with 3D distance: `1 / d^LIGHT_DECAY`. About 1 keeps the tail
 * readable (inverse-square leaves a rule-lit rim nearly black). Allowed: FALLOFF_RANGES.decay.
 */
export const LIGHT_DECAY = 1;
/** Inside this 3D distance the hot core rises, roughly inverse-square. Allowed: FALLOFF_RANGES.coreRadius. */
export const CORE_RADIUS = 1.25;
/** The most the falloff reaches, at the flame. Allowed: FALLOFF_RANGES.coreMax. */
export const CORE_MAX = 4;
/**
 * The least point light a rule-lit cell centre shows: where the window is tiny (the diagonal rim
 * of a large radius, about 1e-6 at radius 20, black in float32), the shader tops the light up to
 * this in the source's colour. Allowed: FALLOFF_RANGES.readableEdge.
 */
export const READABLE_EDGE = 0.05;

export interface FalloffTune {
	decay: number;
	coreRadius: number;
	coreMax: number;
}
export const FALLOFF: Readonly<FalloffTune> = {
	decay: LIGHT_DECAY,
	coreRadius: CORE_RADIUS,
	coreMax: CORE_MAX
};
/**
 * The ranges #238 may tune the constants within; the spec holds across all of them. A core radius
 * of at least 1 keeps the body at most 1, so the falloff never passes `coreMax`.
 */
export const FALLOFF_RANGES = {
	decay: [0.5, 2],
	coreRadius: [1, 2],
	coreMax: [1, 8],
	readableEdge: [0.02, 0.2]
} as const;

/** How far a light renders, horizontally from its rule origin: just past the rules' rim. */
export function renderedReach(radius: number): number {
	// With r = floor(radius), lit cell centres have d² ≤ r² + r < (r + 0.5)², the rest
	// d² ≥ r² + r + 1 > (r + 0.5)², so the window ends exactly between the two.
	return Math.floor(radius) + 0.5;
}

/** The rules window (Frostbite's): 1 at the origin, 0 at and beyond `reach`. */
export function lightWindow(dxz: number, reach: number): number {
	const q = (dxz / reach) ** 4;
	return q >= 1 ? 0 : (1 - q) ** 2;
}

/**
 * How brightly a light of `radius` renders: the rules window on the horizontal distance `dxz`
 * from the rule origin, times a body `1 / max(d3, coreRadius)^decay` on the 3D distance `d3` from
 * the visual position, times a hot core inside `coreRadius` (inverse-square, at most `coreMax`).
 * The core only multiplies inside the window, so it never widens the lit area.
 */
export function lightFalloff(
	radius: number,
	dxz: number,
	d3: number,
	tune: FalloffTune = FALLOFF
): number {
	const window = lightWindow(dxz, renderedReach(radius));
	if (window === 0) return 0;
	const body = 1 / Math.max(d3, tune.coreRadius) ** tune.decay;
	const core = d3 >= tune.coreRadius ? 1 : Math.min(tune.coreMax, (tune.coreRadius / d3) ** 2);
	return window * body * core;
}

/** The point-light top-up for a cell of rules light level `level` (lightLevels): READABLE_EDGE where lit. */
export function readableFill(level: number, edge = READABLE_EDGE): number {
	// lightLevels floors lit cells at 0.2 ≥ every allowed edge, so this is `edge` exactly there.
	return Math.min(level, edge);
}

/**
 * A level in cells (a level is 0.4 of a cell: the renderer's STEP_HEIGHT, ground.ts), for the
 * vertical part of a light's 3D distance.
 */
export const LEVEL_CELLS = 0.4;

/**
 * Per cell, the max over sources of `value(source, dxz, cell)` on the cells the source lights
 * by the rules (litMask's radius and line of sight; the origin always). Values ≤ 0 are skipped.
 */
function perLitCell(
	grid: SquareGrid,
	blocked: Blockers,
	sources: Iterable<LightSource>,
	value: (s: LightSource, dxz: number, c: GridPos) => number
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
				const level = value(s, Math.sqrt(d2), c);
				if (level <= levels[i] || !hasLineOfSight(blocked, s.pos, c)) continue;
				levels[i] = level;
			}
		}
	}
	return levels;
}

/**
 * Brightness per cell in [0, 1], fading out towards each light's edge through the rendered
 * window, never below 0.2 where lit; for rendering (the cell maps' light level). Uses the same
 * reach and line of sight as litMask, so every cell with brightness > 0 is lit by the rules.
 */
export function lightLevels(
	grid: SquareGrid,
	blocked: Blockers,
	sources: Iterable<LightSource>
): Float32Array {
	return perLitCell(grid, blocked, sources, (s, dxz) =>
		Math.max(0.2, lightWindow(dxz, renderedReach(s.radius)))
	);
}

/**
 * What the shader's point light computes at each cell centre: the max over sources of
 * `lightFalloff`, the 3D distance from the light's height (its look's, in levels above its
 * floor) to the cell's floor, where the rules light the cell. For the spec; 0 where unlit.
 */
export function renderedLevels(
	grid: SquareGrid,
	blocked: Blockers,
	sources: Iterable<LightSource>,
	tune: FalloffTune = FALLOFF
): Float32Array {
	const levels = asObstacles(blocked).levels ?? null;
	const level = (c: GridPos) => (levels ? levels[cellIndex(grid, c)] : 0);
	return perLitCell(grid, blocked, sources, (s, dxz, c) => {
		const up = (level(s.pos) + lightLook(s).height - level(c)) * LEVEL_CELLS;
		return lightFalloff(s.radius, dxz, Math.hypot(dxz, up), tune);
	});
}
