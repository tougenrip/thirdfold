// Picking a cell (milestone 69, #246): an Amanatides-Woo DDA over the grid's
// columns, each standing up to its drawn floor, so a click lands on the cell
// the logic says it does however detailed the ground mesh is. Pure (no
// three.js): its specs run in the server project. docs/RENDERING.md, "Picking
// cells".

import type { GridPos, SquareGrid } from '../../game/grid';
import { STEP_HEIGHT } from '../ground';

export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

/**
 * What a ray points at: the cell whose column it meets first, where, and on
 * which face (`top` its floor, `side` a raised column's wall); or no cell and
 * the ray's point on the y = 0 plane (null if it never meets it), from which
 * corners and edges along the border still snap.
 */
export type CellPick =
	| { cell: GridPos; point: Vec3; face: 'top' | 'side' }
	| { cell: null; point: Vec3 | null; face?: undefined };

/**
 * The cell a ray (from `origin` along `dir`, in world units) meets first.
 * `heightAt(x, y)` is a cell's drawn floor height; a column is solid below it.
 * A cut (`cutLevel`, #281) lowers every column above that level to it.
 * Cost: one step per cell the ray crosses inside the grid.
 */
export function pickCell(
	grid: SquareGrid,
	heightAt: (x: number, y: number) => number,
	origin: Vec3,
	dir: Vec3,
	cutLevel = Infinity
): CellPick {
	const { width, height, cellSize } = grid;
	const cut = cutLevel * STEP_HEIGHT * cellSize;
	// In cell units across the grid (u along x, v along z); y stays in world units.
	const ou = origin.x / cellSize + width / 2;
	const ov = origin.z / cellSize + height / 2;
	const du = dir.x / cellSize;
	const dv = dir.z / cellSize;
	const span = (o: number, d: number, size: number): [number, number] => {
		if (d === 0) return o >= 0 && o <= size ? [-Infinity, Infinity] : [Infinity, -Infinity];
		const a = -o / d;
		const b = (size - o) / d;
		return a < b ? [a, b] : [b, a];
	};
	const [u0, u1] = span(ou, du, width);
	const [v0, v1] = span(ov, dv, height);
	let tIn = Math.max(0, u0, v0);
	const tEnd = Math.min(u1, v1);
	// Beyond the grid the ground is the y = 0 plane: a ray coming in under it met it outside.
	if (tIn <= tEnd && !(tIn > 0 && origin.y + dir.y * tIn < 0)) {
		const clamp = (n: number, size: number) => Math.min(size - 1, Math.max(0, Math.floor(n)));
		let cx = clamp(ou + du * tIn, width);
		let cy = clamp(ov + dv * tIn, height);
		const su = du > 0 ? 1 : -1;
		const sv = dv > 0 ? 1 : -1;
		const dtu = du === 0 ? Infinity : Math.abs(1 / du);
		const dtv = dv === 0 ? Infinity : Math.abs(1 / dv);
		let tu = du === 0 ? Infinity : (cx + (du > 0 ? 1 : 0) - ou) / du;
		let tv = dv === 0 ? Infinity : (cy + (dv > 0 ? 1 : 0) - ov) / dv;
		for (;;) {
			const top = Math.min(heightAt(cx, cy), cut);
			const tOut = Math.min(tu, tv, tEnd);
			if (origin.y + dir.y * tIn < top) return hit(cx, cy, origin, dir, tIn, 'side');
			if (dir.y < 0 && origin.y + dir.y * tOut <= top)
				return hit(cx, cy, origin, dir, (top - origin.y) / dir.y, 'top');
			if (tOut >= tEnd) break;
			if (tu < tv) {
				cx += su;
				tIn = tu;
				tu += dtu;
			} else {
				cy += sv;
				tIn = tv;
				tv += dtv;
			}
			if (cx < 0 || cy < 0 || cx >= width || cy >= height) break;
		}
	}
	if (!(dir.y * origin.y < 0)) return { cell: null, point: null };
	const t = -origin.y / dir.y;
	return { cell: null, point: { x: origin.x + dir.x * t, y: 0, z: origin.z + dir.z * t } };
}

function hit(x: number, y: number, o: Vec3, d: Vec3, t: number, face: 'top' | 'side'): CellPick {
	return { cell: { x, y }, point: { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t }, face };
}
