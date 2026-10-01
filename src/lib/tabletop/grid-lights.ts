// GridLights' data (#227, the ADR in docs/RENDERING.md "Many lights"): what the many-light node
// reads with `textureLoad` only, so one graph runs on WebGL2 and WebGPU without compute. Pure (no
// three.js), built on the CPU from the same sight the rules' `litMask` uses:
//
// - `buildLists`: K light indices per cell (1-based, 0 empty), each cell's list taken from the
//   light's `SightCache` sight, so a cell is in a light's list exactly when the rules light it
//   (#228's "rendered > 0 only on lit cells" holds by construction), sorted by contribution.
// - `buildRows`: per light, `ROW_ANGLES` polar occlusion distances (in cells) from the rule origin:
//   each angle marched from the light's own sight mask to the first cell outside it, the distance
//   that of the exact edge it crosses there. No second line-of-sight rule: windows and rising
//   ground come from the sight mask. Cells below the light's floor that it doesn't see (the drop
//   under a balcony's edge) are marched over, so a balcony light still reaches the floor it sees
//   beyond; the lists keep it off the cells it doesn't. Otherwise a row only darkens: it stops at
//   the first hidden cell even if cells beyond it are in sight again.
// - `packLightData`: the entries as `DATA_TEXELS` RGBA32F texels per light, `GRID_LIGHT_CAPACITY`
//   wide, a layout ClusteredLighting can read on ultra too (#357).

import type { GridPos, SquareGrid } from '$lib/game/grid';
import { lightLook, type LightSource } from '$lib/game/lights';
import type { SightCache } from '$lib/game/visibility';

/** Lights the data holds: indices are bytes, 0 meaning none. */
export const GRID_LIGHT_CAPACITY = 255;
/** Angles per occlusion row. */
export const ROW_ANGLES = 256;
/** Texels per light in the data texture (rows of a `GRID_LIGHT_CAPACITY` × 3 texture). */
export const DATA_TEXELS = 3;

// Seam for #226: `lightFalloff` and `renderedReach` land in game/lights.ts; these stand in until
// then. Both in cells; the falloff reaches 0 at the reach, where `lightLevels` does.
/** Stand-in for #226's `renderedReach`: how far a light of `radius` draws, in cells. */
export const standInReach = (radius: number): number => radius + 1;
/** Stand-in for #226's `lightFalloff`: brightness `d` cells from a light of `radius`, 0-1. */
export function standInFalloff(d: number, radius: number): number {
	const x = Math.max(0, 1 - d / standInReach(radius));
	return x * x;
}

/**
 * K light indices per cell (`Uint8Array(width × height × k)`, cell-major: cell `c`'s list is
 * `[c·k, c·k + k)`), each `index + 1` into `sources`, 0 empty, strongest first. `cache` must
 * have been `use`d with the obstacles the rules use. Lights past `GRID_LIGHT_CAPACITY` are left out.
 */
export function buildLists(
	grid: SquareGrid,
	cache: SightCache,
	sources: readonly LightSource[],
	k: number
): Uint8Array {
	const cells = grid.width * grid.height;
	const lists = new Uint8Array(cells * k);
	const scores = new Float32Array(cells * k);
	const count = Math.min(sources.length, GRID_LIGHT_CAPACITY);
	for (let i = 0; i < count; i++) {
		const s = sources[i];
		const sight = cache.sight(grid, s.pos, s.radius);
		const intensity = lightLook(s).intensity;
		const r = Math.floor(s.radius);
		const x0 = Math.max(0, s.pos.x - r);
		const x1 = Math.min(grid.width - 1, s.pos.x + r);
		const y0 = Math.max(0, s.pos.y - r);
		const y1 = Math.min(grid.height - 1, s.pos.y + r);
		for (let y = y0; y <= y1; y++) {
			for (let x = x0; x <= x1; x++) {
				const c = y * grid.width + x;
				if (!sight[c]) continue;
				// A light's own cell still counts, at its full strength; never 0, so it always enters.
				const score =
					intensity * standInFalloff(Math.hypot(x - s.pos.x, y - s.pos.y), s.radius) + 1e-6;
				insert(lists, scores, c * k, k, i + 1, score);
			}
		}
	}
	return lists;
}

/** Puts `index` into the sorted list at `at`, dropping the weakest when it is full. */
function insert(
	lists: Uint8Array,
	scores: Float32Array,
	at: number,
	k: number,
	index: number,
	score: number
): void {
	let j = k;
	while (j > 0 && (lists[at + j - 1] === 0 || scores[at + j - 1] < score)) j--;
	if (j >= k) return;
	for (let m = k - 1; m > j; m--) {
		lists[at + m] = lists[at + m - 1];
		scores[at + m] = scores[at + m - 1];
	}
	lists[at + j] = index;
	scores[at + j] = score;
}

/** Ties closer than this are a corner crossing. */
const CORNER = 1e-9;

/**
 * Occlusion distances (cells, from the centre of `origin`) for `ROW_ANGLES` angles, angle `a`
 * at `2π·a / ROW_ANGLES` from +x towards +y: how far that ray stays on cells in `sight` (the
 * light's sight mask) or, with `levels`, below the origin's floor. The distance is the exact
 * crossing of the edge into the first cell that is neither (or off the map). Through a corner
 * the ray needs the diagonal cell and one side, as `hasLineOfSight` does.
 */
export function buildRows(
	grid: SquareGrid,
	sight: Uint8Array,
	origin: GridPos,
	levels: Uint8Array | null = null
): Float32Array {
	const rows = new Float32Array(ROW_ANGLES);
	const floor = levels ? levels[origin.y * grid.width + origin.x] : 0;
	const inSight = (x: number, y: number) => {
		if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return false;
		const c = y * grid.width + x;
		return sight[c] !== 0 || (levels !== null && levels[c] < floor);
	};
	for (let a = 0; a < ROW_ANGLES; a++) {
		const angle = (2 * Math.PI * a) / ROW_ANGLES;
		const dx = Math.cos(angle);
		const dy = Math.sin(angle);
		const sx = Math.sign(dx);
		const sy = Math.sign(dy);
		// Distance to the next vertical (x) and horizontal (y) grid line; the origin is a centre.
		const stepX = Math.abs(dx) > 1e-12 ? 1 / Math.abs(dx) : Infinity;
		const stepY = Math.abs(dy) > 1e-12 ? 1 / Math.abs(dy) : Infinity;
		let nextX = stepX / 2;
		let nextY = stepY / 2;
		let x = origin.x;
		let y = origin.y;
		let t: number;
		for (;;) {
			if (Math.abs(nextX - nextY) < CORNER) {
				t = nextX;
				const open = inSight(x + sx, y + sy) && (inSight(x + sx, y) || inSight(x, y + sy));
				if (!open) break;
				x += sx;
				y += sy;
				nextX += stepX;
				nextY += stepY;
			} else if (nextX < nextY) {
				t = nextX;
				if (!inSight(x + sx, y)) break;
				x += sx;
				nextX += stepX;
			} else {
				t = nextY;
				if (!inSight(x, y + sy)) break;
				y += sy;
				nextY += stepY;
			}
		}
		rows[a] = t;
	}
	return rows;
}

/** One light as the node reads it. Positions and reach in world units, colour linear. */
export interface GridLightEntry {
	/** Where it is drawn from (specular, the hot core): `lightMount`'s position (#226). */
	visual: { x: number; y: number; z: number };
	/** How far it draws, world units. */
	reach: number;
	/** Linear colour times intensity. */
	rgb: readonly [number, number, number];
	/** The rules' origin, in cells (its centre is `+ 0.5`): membership, reach and occlusion. */
	ruleOrigin: GridPos;
	/** Flicker profile (#231), 0 for none. */
	profile: number;
	/** Flicker phase, 0-1. */
	phase: number;
	/** Bit flags: hero (#230), bake-excluded (#234), no-core (#236). */
	flags: number;
}

/**
 * The entries as an RGBA32F texture's data, `GRID_LIGHT_CAPACITY` wide and `DATA_TEXELS` high:
 * row 0 visual position and reach, row 1 colour and flags, row 2 the rule origin's centre in
 * cells, flicker profile and phase.
 */
export function packLightData(entries: readonly GridLightEntry[]): Float32Array {
	const line = GRID_LIGHT_CAPACITY * 4;
	const data = new Float32Array(line * DATA_TEXELS);
	const count = Math.min(entries.length, GRID_LIGHT_CAPACITY);
	for (let i = 0; i < count; i++) {
		const e = entries[i];
		const o = i * 4;
		data.set([e.visual.x, e.visual.y, e.visual.z, e.reach], o);
		data.set([e.rgb[0], e.rgb[1], e.rgb[2], e.flags], line + o);
		data.set([e.ruleOrigin.x + 0.5, e.ruleOrigin.y + 0.5, e.profile, e.phase], 2 * line + o);
	}
	return data;
}
