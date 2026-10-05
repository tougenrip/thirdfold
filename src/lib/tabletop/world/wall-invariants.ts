// The invariant harness for wall pieces (#251), beside invariants.ts (which
// re-exports it): autotile's pieces as plan envelopes, checked against every
// walkable cell's base disk and the continuation rule. Test support, pure.
//
// The envelopes are the kit contract's clearance (#250 moves the constants to
// src/lib/assets/kit.ts): an edge piece is the unit edge, `WALL_HALF_THIN`
// thick on each side, but `WALL_HALF_THICK` on a `wall.outer`'s +z face (the
// void, or beyond the grid); a post is `POST_SIZE` square on its corner.

import { VOID } from '../../game/floor';
import { SITE, TILE_ROLES, type WallPieces } from './autotile';
import { TOKEN_DISK, type WorldShape } from './shape';

export const WALL_HALF_THIN = 0.07;
export const WALL_HALF_THICK = 0.35;
export const POST_SIZE = 0.3;

const OUTER = TILE_ROLES.indexOf('wall.outer');

export interface WallViolation {
	rule: 'wall-disk' | 'wall-unexplored';
	piece: string;
	cell: number;
}

/** Plan rectangle of piece k in grid units (cell (x, y) spans x..x+1, y..y+1). */
function envelope(p: WallPieces, k: number): [number, number, number, number] {
	const [x, y] = [p.x[k], p.y[k]];
	if (p.site[k] === SITE.corner) {
		const r = POST_SIZE / 2;
		return [x - r, y - r, x + r, y + r];
	}
	const front = p.role[k] === OUTER ? WALL_HALF_THICK : WALL_HALF_THIN;
	// +z faces S, E, N, W at rotations 0-3: the thick side is +y, +x, -y or -x.
	const [lo, hi] = p.rotation[k] < 2 ? [WALL_HALF_THIN, front] : [front, WALL_HALF_THIN];
	return p.site[k] === SITE.h ? [x, y - lo, x + 1, y + hi] : [x - lo, y, x + hi, y + 1];
}

/**
 * Where pieces break the rules: one enters the base disk (`TOKEN_DISK`, no intrusion allowance) of
 * a walkable cell (anything but known void; unexplored counts as walkable), or stands where no
 * cell beside it is known.
 */
export function checkWallPieces(shape: WorldShape, pieces: Iterable<WallPieces>): WallViolation[] {
	const { width: w, height: h } = shape.grid;
	const known = (i: number) => !shape.known || shape.known[i] === 1;
	const out: WallViolation[] = [];
	for (const p of pieces) {
		for (let k = 0; k < p.count; k++) {
			const name = `${TILE_ROLES[p.role[k]]} at ${p.x[k]},${p.y[k]} site ${p.site[k]}`;
			const [x0, y0, x1, y1] = envelope(p, k);
			let anyKnown = false;
			for (let cy = Math.floor(y0) - 1; cy <= Math.floor(y1) + 1; cy++) {
				for (let cx = Math.floor(x0) - 1; cx <= Math.floor(x1) + 1; cx++) {
					if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
					const i = cy * w + cx;
					// A cell the piece touches (its rectangle reaches the cell's square).
					const touches = x1 >= cx && x0 <= cx + 1 && y1 >= cy && y0 <= cy + 1;
					if (touches && known(i)) anyKnown = true;
					if (known(i) && shape.floor[i] === VOID) continue;
					const dx = Math.max(x0 - (cx + 0.5), 0, cx + 0.5 - x1);
					const dy = Math.max(y0 - (cy + 0.5), 0, cy + 0.5 - y1);
					if (Math.hypot(dx, dy) < TOKEN_DISK - 1e-9)
						out.push({ rule: 'wall-disk', piece: name, cell: i });
				}
			}
			if (!anyKnown) out.push({ rule: 'wall-unexplored', piece: name, cell: -1 });
		}
	}
	return out;
}
