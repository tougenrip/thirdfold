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
// - `packLight`: one light as the node reads it, a row of `LIGHT_TEXELS` RGBA32F texels (a layer of
//   GridLight's data texture): its `DATA_TEXELS` of data, then its occlusion row four distances to
//   a texel, so a light that changes uploads only its own row; a layout ClusteredLighting can read
//   on ultra too (#357).
// - `bounceField` and `cavityField` (#234): the light lit floors throw back, coloured by their
//   albedo and spread only across open sides within each light's own lit cells (so it never
//   crosses a wall and lights no cell the rules don't), and how shut in each cell is by walls and
//   higher ground; `packIndirect` puts both in the lists texture's tail, a texel per cell.

import { FLOOR_IDS } from '$lib/game/floor';
import type { GridPos, SquareGrid } from '$lib/game/grid';
import { lightFalloff, lightLook, type LightSource } from '$lib/game/lights';
import { asObstacles, MAX_STEP, type Blockers } from '$lib/game/objects';
import type { SightCache } from '$lib/game/visibility';
import { FLOOR_LOOKS } from './floor-looks';

/** Lights the data holds: indices are bytes, 0 meaning none. */
export const GRID_LIGHT_CAPACITY = 255;
/** Angles per occlusion row. */
export const ROW_ANGLES = 256;
/** Data texels per light, before its occlusion row. */
export const DATA_TEXELS = 3;
/** Texels per light in the data texture: its data, then its row four distances to a texel. */
export const LIGHT_TEXELS = DATA_TEXELS + ROW_ANGLES / 4;

/** A light's strength for its radius, over its look's intensity: about M67's point-light pool's at two cells. */
export const strength = (radius: number): number => 2 + radius;

/** How a light ranks on a cell `d` cells from it: its look's intensity times `lightFalloff`. */
export const contribution = (s: LightSource, d: number): number =>
	lightLook(s).intensity * lightFalloff(s.radius, d, d);

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
				const score = contribution(s, Math.hypot(x - s.pos.x, y - s.pos.y)) + 1e-6;
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

/** Flag bits in a light's data (later tasks set them; the layout has them from the start). */
export const LIGHT_FLAGS = { hero: 1, bakeExcluded: 2, noCore: 4 } as const;

/** One light as the node reads it. Positions in world units, colour linear. */
export interface LightEntry {
	/** The placed light's id, or the carrying token's. */
	id: string;
	/** The rules' origin, in cells (its centre is `+ 0.5`): membership, reach and occlusion. */
	ruleOrigin: GridPos;
	/** Where it is drawn from (specular, the hot core): `lightMount`, or the carrier's hand. */
	visual: { x: number; y: number; z: number };
	/** How far it renders from the rule origin, in cells: `renderedReach`. */
	reach: number;
	/** Linear colour. */
	colour: readonly [number, number, number];
	/** Its look's intensity times the strength for its radius. */
	intensity: number;
	/** Flicker profile (#231), 0 for none. */
	profile: number;
	/** Flicker phase, 0-1. */
	phase: number;
	/** `LIGHT_FLAGS` bits: hero (#230), bake-excluded (#234), no-core (#236). */
	flags: number;
}

/**
 * One light's texels into `out` at `offset` (floats): texel 0 the visual position and reach,
 * 1 the colour times intensity and the flags, 2 the rule origin's centre in cells, the flicker
 * profile and phase, then its occlusion row, `ROW_ANGLES` distances four to a texel.
 */
export function packLight(e: LightEntry, row: Float32Array, out: Float32Array, offset = 0): void {
	const [r, g, b] = e.colour;
	out.set([e.visual.x, e.visual.y, e.visual.z, e.reach], offset);
	out.set([r * e.intensity, g * e.intensity, b * e.intensity, e.flags], offset + 4);
	out.set([e.ruleOrigin.x + 0.5, e.ruleOrigin.y + 0.5, e.profile, e.phase], offset + 8);
	out.set(row, offset + DATA_TEXELS * 4);
}

/** How high a light hangs over the floor it bounces off, in cells: a fixture's, about. */
const BOUNCE_HEIGHT = 1.5;
/** Bounce irradiance stored per byte step is this over 255. */
export const BOUNCE_RANGE = 4;
/** Occlusion for each side of a cell shut by a wall, window or door, or rising to higher ground. */
export const CAVITY_PER_SIDE = 0.25;
/** The table's own surface (a plain floor), linear: a mid warm grey. */
const PLAIN_ALBEDO = [0.2, 0.17, 0.13] as const;

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** A `0xrrggbb` (sRGB) as linear RGB. */
const rgbOf = (hex: number) => [hex >> 16, (hex >> 8) & 255, hex & 255].map((c) => linear(c / 255));

/** Each cell's floor albedo, linear RGB, three per cell: plain the table's own, the void none. */
export function floorAlbedo(cells: number, floorIds: ArrayLike<number> | null): Float32Array {
	const looks = FLOOR_IDS.map((id) =>
		id === 'plain' ? PLAIN_ALBEDO : id === 'void' ? [0, 0, 0] : rgbOf(FLOOR_LOOKS[id].color)
	);
	const out = new Float32Array(cells * 3);
	for (let c = 0; c < cells; c++) out.set(looks[floorIds?.[c] ?? 0] ?? PLAIN_ALBEDO, c * 3);
	return out;
}

/**
 * The hemisphere's ground colour's tint from the painted floors the viewer knows (#234): their
 * average albedo with its brightness taken out (luminance 1), so the sky palette keeps the level
 * and the floors give the hue. White when nothing is painted.
 */
export function groundTint(floorIds: ArrayLike<number> | null): [number, number, number] {
	const sum = [0, 0, 0];
	let n = 0;
	const looks = FLOOR_IDS.map((id) =>
		id === 'plain' || id === 'void' ? null : rgbOf(FLOOR_LOOKS[id].color)
	);
	for (let c = 0; floorIds && c < floorIds.length; c++) {
		const look = looks[floorIds[c]];
		if (!look) continue;
		for (let i = 0; i < 3; i++) sum[i] += look[i];
		n++;
	}
	const lum = 0.2126 * sum[0] + 0.7152 * sum[1] + 0.0722 * sum[2];
	return n && lum > 0 ? [sum[0] / lum, sum[1] / lum, sum[2] / lum] : [1, 1, 1];
}

/**
 * Each cell's shut sides by `edges` (walls, windows, shut doors): bit 1 its east side, 2 its
 * south. Read off the edges' keys (`edgeKey`), so the cost is the walls', not the grid's.
 */
function shutSides(grid: SquareGrid, edges: ReadonlySet<string>): Uint8Array {
	const { width: w, height: h } = grid;
	const out = new Uint8Array(w * h);
	for (const key of edges) {
		const [axis, x, y] = [key[0], ...key.slice(2).split(':').map(Number)];
		// A vertical line at x parts (x - 1, y) from (x, y); a horizontal one at y, (x, y - 1) from (x, y).
		if (axis === 'v' && x > 0 && x < w && y >= 0 && y < h) out[y * w + x - 1] |= 1;
		if (axis === 'h' && y > 0 && y < h && x >= 0 && x < w) out[(y - 1) * w + x] |= 2;
	}
	return out;
}

/**
 * Which sides of each cell light may spread across, bit 1 east and 2 south: where `canStep` in
 * sight mode crosses both ways (no wall or shut door, neither cell opaque), but not a window, and
 * a level step of at most `MAX_STEP`. Worked out directly, as `canStep` would, for speed.
 */
export function openSides(grid: SquareGrid, blocked: Blockers): Uint8Array {
	const o = asObstacles(blocked);
	const { width: w, height: h } = grid;
	const shut = shutSides(grid, o.edges);
	const out = new Uint8Array(w * h);
	const open = (i: number, j: number) =>
		!o.opaque?.[i] &&
		!o.opaque?.[j] &&
		(!o.levels || Math.abs(o.levels[i] - o.levels[j]) <= MAX_STEP);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			if (x + 1 < w && !(shut[i] & 1) && open(i, i + 1)) out[i] |= 1;
			if (y + 1 < h && !(shut[i] & 2) && open(i, i + w)) out[i] |= 2;
		}
	return out;
}

/**
 * How shut in each cell is, 0-1: `CAVITY_PER_SIDE` for each side closed by a wall, window or shut
 * door, or where the neighbour's floor is higher. The grid's own edge doesn't count.
 */
export function cavityField(grid: SquareGrid, blocked: Blockers): Float32Array {
	const o = asObstacles(blocked);
	const { width: w, height: h } = grid;
	const shut = shutSides(grid, o.edges);
	const out = new Float32Array(w * h);
	const level = (i: number) => o.levels?.[i] ?? 0;
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			// Each side: shut, or the neighbour higher; the grid's edge is neither.
			const sides = [
				x + 1 < w && (shut[i] & 1 || level(i + 1) > level(i)),
				x > 0 && (shut[i - 1] & 1 || level(i - 1) > level(i)),
				y + 1 < h && (shut[i] & 2 || level(i + w) > level(i)),
				y > 0 && (shut[i - w] & 2 || level(i - w) > level(i))
			];
			out[i] = Math.min(1, sides.filter(Boolean).length * CAVITY_PER_SIDE);
		}
	return out;
}

/**
 * The light floors throw back (linear RGB irradiance, three per cell): per light, each cell it lights
 * takes `lightFalloff` from a light `BOUNCE_HEIGHT` up, times its colour, intensity and `strength`,
 * times the cell's floor `albedo`; then two box blurs over that light's lit cells, across `open`
 * sides only (`openSides`). So a light's bounce stays on cells it lights: never through a wall, and
 * nowhere a light doesn't reach. `cache` must have been `use`d with the rules' obstacles.
 */
export function bounceField(
	grid: SquareGrid,
	cache: SightCache,
	sources: readonly LightSource[],
	albedo: Float32Array,
	open: Uint8Array
): Float32Array {
	const { width: w } = grid;
	const out = new Float32Array(w * grid.height * 3);
	for (const s of sources.slice(0, GRID_LIGHT_CAPACITY)) {
		const sight = cache.sight(grid, s.pos, s.radius);
		const rgb = rgbOf(parseInt(s.color.slice(1), 16) || 0);
		const power = lightLook(s).intensity * strength(s.radius);
		const span = Math.floor(s.radius);
		const [x0, y0] = [Math.max(0, s.pos.x - span), Math.max(0, s.pos.y - span)];
		const x1 = Math.min(w - 1, s.pos.x + span);
		const y1 = Math.min(grid.height - 1, s.pos.y + span);
		const bw = x1 - x0 + 1;
		const cells: number[] = [];
		let field = new Float32Array(bw * (y1 - y0 + 1) * 3);
		for (let y = y0; y <= y1; y++)
			for (let x = x0; x <= x1; x++) {
				const c = y * w + x;
				if (!sight[c]) continue;
				const d2 = (x - s.pos.x) ** 2 + (y - s.pos.y) ** 2; // not Math.hypot: slow in V8
				const d3 = Math.sqrt(d2 + BOUNCE_HEIGHT * BOUNCE_HEIGHT);
				const e = power * lightFalloff(s.radius, Math.sqrt(d2), d3);
				const at = ((y - y0) * bw + x - x0) * 3;
				for (let i = 0; i < 3; i++) field[at + i] = e * rgb[i] * albedo[c * 3 + i];
				cells.push(c);
			}
		// Each lit cell's place in the field, and its neighbours across open sides that this light
		// lights too (-1 none): found once, then both passes are sums over them.
		const at = new Int32Array(cells.length);
		const near = new Int32Array(cells.length * 4).fill(-1);
		cells.forEach((c, k) => {
			const [x, y] = [c % w, (c - (c % w)) / w];
			const here = ((y - y0) * bw + x - x0) * 3;
			at[k] = here;
			if (x < x1 && open[c] & 1 && sight[c + 1]) near[k * 4] = here + 3;
			if (x > x0 && open[c - 1] & 1 && sight[c - 1]) near[k * 4 + 1] = here - 3;
			if (y < y1 && open[c] & 2 && sight[c + w]) near[k * 4 + 2] = here + bw * 3;
			if (y > y0 && open[c - w] & 2 && sight[c - w]) near[k * 4 + 3] = here - bw * 3;
		});
		for (let pass = 0; pass < 2; pass++) {
			const next = new Float32Array(field.length);
			for (let k = 0; k < cells.length; k++) {
				const here = at[k];
				let [r, g, b, n] = [field[here], field[here + 1], field[here + 2], 1];
				for (let j = k * 4; j < k * 4 + 4; j++) {
					const o = near[j];
					if (o < 0) continue;
					r += field[o];
					g += field[o + 1];
					b += field[o + 2];
					n++;
				}
				next[here] = r / n;
				next[here + 1] = g / n;
				next[here + 2] = b / n;
			}
			field = next;
		}
		cells.forEach((c, k) => {
			for (let i = 0; i < 3; i++) out[c * 3 + i] += field[at[k] + i];
		});
	}
	return out;
}

/** Open-side bits in a packed texel's A (`packIndirect`): east, west, south (y + 1), north. */
export const OPEN_BITS = { east: 1, west: 2, south: 4, north: 8 } as const;

/**
 * A texel per cell: bounce (`BOUNCE_RANGE` to a byte) in RGB, and in A the cell's shut sides
 * (`cavity / CAVITY_PER_SIDE`, 0-4) times 16 plus its `OPEN_BITS` from `open` (`openSides`), so
 * the shader smooths a cell only toward neighbours across open sides.
 */
export function packIndirect(
	width: number,
	bounce: Float32Array,
	cavity: Float32Array,
	open: Uint8Array
): Uint8Array {
	const out = new Uint8Array(cavity.length * 4);
	const byte = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v)));
	for (let c = 0; c < cavity.length; c++) {
		for (let i = 0; i < 3; i++) out[c * 4 + i] = byte(bounce[c * 3 + i] / BOUNCE_RANGE);
		const x = c % width;
		const bits =
			(open[c] & 1 ? OPEN_BITS.east : 0) |
			(x > 0 && open[c - 1] & 1 ? OPEN_BITS.west : 0) |
			(open[c] & 2 ? OPEN_BITS.south : 0) |
			(c >= width && open[c - width] & 2 ? OPEN_BITS.north : 0);
		out[c * 4 + 3] = Math.round(cavity[c] / CAVITY_PER_SIDE) * 16 + bits;
	}
	return out;
}
