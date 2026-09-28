// The arithmetic of world-aligned mapping (#177), free of three so the server project tests it:
// which face of a box a normal picks, and how tall a vertical repeat is on walls and raised
// ground. mapping.ts builds the same choice in TSL; `repeatFor` gives a material its `repeat`.

/** The axis a box projection samples along: the largest component of the normal. */
export type Axis = 'x' | 'y' | 'z';

/**
 * The face of a box projection a normal picks, as mapping.ts's graph does: x wins ties with y
 * and z, y wins ties with z, so a 45° edge takes the same face on every instance.
 */
export function dominantAxis(n: { x: number; y: number; z: number }): Axis {
	const [ax, ay, az] = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
	if (ax >= ay && ax >= az) return 'x';
	return ay >= az ? 'y' : 'z';
}

/**
 * How tall one vertical repeat of a texture is on walls and raised ground, in world units: a
 * whole number of level steps, or a step divided evenly (a course, `wallHeight / n` with n a
 * multiple of the wall's levels), whichever is nearest `width` (the horizontal repeat), so a
 * repeat's rows fall on every level step or on every k-th, and walls standing on raised ground
 * stay in phase with the ground beside them. Derived from `step` (`STEP_HEIGHT`), never a
 * hard-coded height, so the world scale (#152) can move it.
 */
export function repeatHeight(width: number, step: number): number {
	if (!(width > 0 && step > 0)) return step;
	const up = Math.max(1, Math.round(width / step)) * step;
	const down = step / Math.max(1, Math.round(step / width));
	return Math.abs(Math.log(up / width)) <= Math.abs(Math.log(down / width)) ? up : down;
}

/**
 * A world-mapped material's `repeat`: repeats per world unit across (one repeat covers `cells`
 * cells, `Look.cells`) and up (`repeatHeight`). Tops of raised ground use `x` both ways.
 */
export function repeatFor(cells: number, cellSize: number, step: number): { x: number; y: number } {
	const width = cells * cellSize;
	return { x: 1 / width, y: 1 / repeatHeight(width, step * cellSize) };
}
