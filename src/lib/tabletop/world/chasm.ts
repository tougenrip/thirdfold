// Void cells as drops out of the world (#243): what a void cell ('Off the map') is drawn as, by
// the world look's backdrop. Pure, in the lazy `world` chunk. The ground's chunks (ground-mesh.ts)
// sink every void sector to the chasm's floor (`Chasm.y`), so the cliffs (cliffs.ts) fall from
// each walkable neighbour's floor down to it, darkening with depth (`depthShade`), and its floor
// is a mesh of its own (the chunks' `bottom`): mist drifting in the dark (`chasm`), the sea
// (`sea`) or the moving ground under the night train (`scroll`), one material whose look is
// params and slots only (world-layer.ts). Where the backdrop beyond the border is not land
// (`beyondSample`), a known void cell on the border opens outward: no wall at the edge, its floor
// running on under the backdrop's lip. The rules don't change: void stays solid.

import type { GridPos, SquareGrid } from '../../game/grid';
import type { Backdrop, WorldLook } from '../../game/world';
import { VOID } from '../../game/floor';
import { STEP_HEIGHT, type Ground } from '../ground';
import { beyondSample } from './beyond';

export type VoidStyle = 'chasm' | 'sea' | 'scroll';

/** How far below level 0 a chasm's floor lies, in levels (4.8 cells at the world's scale). */
export const CHASM_DEPTH = 12;
/** The moving ground's depth in levels: where the backdrop's skirt lies (beyond.ts). */
export const SCROLL_DEPTH = 2.5;
/** The sea's depth below the backdrop's level, in levels: the skirt's sea (beyond.ts). */
export const SEA_DEPTH = 0.5;
/** How far an open border's floor runs on under the backdrop's lip, in cells (beyond.ts `LIP_CELLS`). */
export const OPEN_REACH = 0.35;

/** A table's void, for the ground's chunks. */
export interface Chasm {
	style: VoidStyle;
	/** The void's floor, in levels (negative: below every walkable floor). */
	depth: number;
	/** Open toward the border: the backdrop beyond is no land. */
	open: boolean;
}

/** What a backdrop kind makes of the void. */
export function voidStyle(kind: Backdrop | null): VoidStyle {
	if (kind === 'sea') return 'sea';
	if (kind === 'prairie-scroll') return 'scroll';
	return 'chasm';
}

/** The void for a scene's backdrop: scene-level only, the same for every viewer. */
export function chasmOf(backdrop: WorldLook['backdrop']): Chasm {
	const style = voidStyle(backdrop.kind);
	const depth =
		style === 'chasm'
			? -CHASM_DEPTH
			: style === 'scroll'
				? -SCROLL_DEPTH
				: Math.min(backdrop.level, 0) - SEA_DEPTH;
	return { style, depth, open: beyondSample(backdrop.kind) !== 'land' };
}

/** A table without a backdrop's: a chasm, closed at the border. */
export const DEFAULT_CHASM = chasmOf({ kind: null, level: 0 });

/** The chasm's floor in world units. */
export const chasmY = (chasm: Chasm, cellSize: number) => chasm.depth * STEP_HEIGHT * cellSize;

/** A face's shade at height y: 1 at and above level 0, darker down the chasm (0.15 at most). */
export function depthShade(y: number, cellSize: number): number {
	return y >= 0 ? 1 : Math.max(0.15, 1 + y / (6 * STEP_HEIGHT * cellSize));
}

/**
 * The ground with picks into the void (#246's DDA) meeting the chasm's floor: a ray into a hole
 * picks the void cell, and one meeting a chasm wall first picks the walkable cell that owns it.
 * Everything standing on the ground keeps `floorY`; `chasm()` is read at each pick.
 */
export function chasmGround(
	grid: SquareGrid,
	ground: Ground,
	floor: Uint8Array,
	chasm: () => Chasm
): Ground {
	const pickY = (c: GridPos) =>
		floor[c.y * grid.width + c.x] === VOID ? chasmY(chasm(), grid.cellSize) : ground.floorY(c);
	return { ...ground, pickY };
}

/**
 * The mist on a chasm's floor: `size`² RGBA texels of grey value noise in two octaves, tiling,
 * the same on every client.
 */
export function mistTexels(size: number): Uint8Array {
	const out = new Uint8Array(size * size * 4);
	const hash = (x: number, y: number, p: number) => {
		let h = Math.imul(((x % p) + p) % p, 374761393) + Math.imul(((y % p) + p) % p, 668265263);
		h = Math.imul(h ^ (h >>> 13), 1274126177);
		return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
	};
	const ease = (f: number) => f * f * (3 - 2 * f);
	const value = (u: number, v: number, p: number) => {
		const [x, y] = [Math.floor(u), Math.floor(v)];
		const [fx, fy] = [ease(u - x), ease(v - y)];
		const a = hash(x, y, p) + (hash(x + 1, y, p) - hash(x, y, p)) * fx;
		const b = hash(x, y + 1, p) + (hash(x + 1, y + 1, p) - hash(x, y + 1, p)) * fx;
		return a + (b - a) * fy;
	};
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const [u, v] = [(x / size) * 4, (y / size) * 4];
			const n = value(u, v, 4) * 0.65 + value(u * 2, v * 2, 8) * 0.35;
			const grey = Math.round(255 * Math.min(1, Math.max(0, (n - 0.3) * 1.6)));
			out.set([grey, grey, grey, 255], (y * size + x) * 4);
		}
	return out;
}
