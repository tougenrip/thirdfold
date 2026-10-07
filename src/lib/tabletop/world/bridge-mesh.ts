// A bridge's body under its deck (#256): the faces of its long sides, which
// the ground leaves to it (stairs.ts takes the edges, cliffs.ts draws nothing
// there). Pure, like the rest of world/: positions, normals, a shade per vertex
// and the owning cell of every vertex, in the masonry faces' mesh, so a bridge
// costs no draw call and no program (the rock kind with vertex colours).
//
// Each long side has a deck band (`DECK` deep, `DECK_OUT` proud of the edge),
// and under it, by the cell's mark (bridges.ts `UNDER`):
// - span: a flat spandrel down to the floor below (or the void's floor);
// - pier: the spandrel with a pilaster `PIER_OUT` proud of it;
// - arch: over known void only, an opening right through the bridge, a
//   half-round arch between jambs, its soffit across the bridge's width, the
//   jambs' returns and a floor at the void's floor (so nothing falls through).
// Everything proud of the edge stays within `WALL_HALF_THIN` (0.07) of it, so no
// walkable cell's token disk is touched, and nothing stands over the deck.

import { VOID } from '../../game/floor';
import { ALONG_Y, neighbour, UNDER } from './bridges';
import { chasmY, DEFAULT_CHASM, depthShade, type Chasm } from './chasm';
import type { CliffMesh } from './cliffs';
import { DIRS } from './regions';
import { CHUNK, chunksAcross, type WorldShape } from './shape';
import type { StairPiece } from './stairs';

/** The deck's band under the floor, and how far it stands proud of the edge (cells). */
export const DECK = 0.15;
export const DECK_OUT = 0.03;
/** A pier's pilaster: its half width along the side, how far it stands proud (cells). */
export const PIER_HALF = 0.22;
export const PIER_OUT = 0.06;
/** An arch's jambs at each end of its cell, and the spandrel over its crown (cells). */
export const JAMB = 0.12;
export const CROWN = 0.1;
/** Segments of an arch's curve. */
const ARCH_SEGMENTS = 8;
/** Shades (vertex colours): the deck's band, spandrels, piers, the soffit, the jambs' returns. */
const SHADE = { deck: 1.15, deckTop: 1.25, span: 0.9, pier: 1.05, pierSide: 0.8, soffit: 0.6 };

type V3 = [number, number, number];

/** Faces in world units, each turned to face its normal. */
class Faces {
	private pos: number[] = [];
	private nor: number[] = [];
	private col: number[] = [];
	private idx: number[] = [];
	private own: number[] = [];

	constructor(private readonly cs: number) {}

	/** A quad by its corners in order round it, facing `n`. */
	quad(c: V3[], n: V3, shade: number, owner: number): void {
		const base = this.own.length;
		for (const p of c) {
			this.pos.push(...p);
			this.nor.push(...n);
			const s = shade * depthShade(p[1], this.cs);
			this.col.push(s, s, s);
			this.own.push(owner);
		}
		const u = c[1].map((v, k) => v - c[0][k]);
		const t = c[2].map((v, k) => v - c[0][k]);
		const facing =
			(u[1] * t[2] - u[2] * t[1]) * n[0] +
			(u[2] * t[0] - u[0] * t[2]) * n[1] +
			(u[0] * t[1] - u[1] * t[0]) * n[2];
		if (facing >= 0) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
		else this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
	}

	done(): CliffMesh {
		return {
			positions: new Float32Array(this.pos),
			normals: new Float32Array(this.nor),
			colors: new Float32Array(this.col),
			indices: new Uint32Array(this.idx),
			owners: new Int32Array(this.own)
		};
	}
}

/** A frame on a cell: `at(a, y, b)` from `a` along the run and `b` across it (cells), y in world units. */
function frame(shape: WorldShape, cell: number, along: V3, across: V3) {
	const { width: w, height: h, cellSize: cs } = shape.grid;
	const [cx, cz] = [((cell % w) + 0.5 - w / 2) * cs, (Math.floor(cell / w) + 0.5 - h / 2) * cs];
	return (a: number, y: number, b: number): V3 => [
		cx + (a * along[0] + b * across[0]) * cs,
		y,
		cz + (a * along[2] + b * across[2]) * cs
	];
}

/**
 * A block standing proud of a side, between two corners in its frame (a along, y up, b out from 0
 * on the edge): its front, top, bottom and the ends `ends` asks for (none where it meets the corner
 * of a cell the bridge doesn't own, which may be unexplored); its back is the side itself.
 */
function block(
	out: Faces,
	at: (a: number, y: number, b: number) => V3,
	[a0, y0, b0]: V3,
	[a1, y1, b1]: V3,
	along: V3,
	across: V3,
	shade: { front: number; side: number; top: number },
	owner: number,
	ends: readonly [boolean, boolean] = [true, true]
): void {
	const sides: [V3[], V3, number, boolean][] = [
		[[at(a0, y0, b1), at(a1, y0, b1), at(a1, y1, b1), at(a0, y1, b1)], across, shade.front, true],
		[[at(a1, y0, b0), at(a1, y1, b0), at(a1, y1, b1), at(a1, y0, b1)], along, shade.side, ends[1]],
		[
			[at(a0, y0, b0), at(a0, y0, b1), at(a0, y1, b1), at(a0, y1, b0)],
			[-along[0], 0, -along[2]],
			shade.side,
			ends[0]
		],
		[[at(a0, y1, b0), at(a0, y1, b1), at(a1, y1, b1), at(a1, y1, b0)], [0, 1, 0], shade.top, true],
		[[at(a0, y0, b0), at(a1, y0, b0), at(a1, y0, b1), at(a0, y0, b1)], [0, -1, 0], shade.side, true]
	];
	for (const [c, n, s, on] of sides) if (on) out.quad(c, n, s, owner);
}

/**
 * The bridges' bodies of a chunk's cells, as meshes by `CLIFF_STYLES` index: all masonry (a bridge
 * is built, whatever its floor), the earth mesh empty.
 */
export function bridgeTrim(
	shape: WorldShape,
	chunk: number,
	chasm: Chasm = DEFAULT_CHASM
): CliffMesh[] {
	const { grid } = shape;
	const { width: w, height: h, cellSize: cs } = grid;
	const across = chunksAcross(grid);
	const [x0, y0] = [(chunk % across.x) * CHUNK, Math.floor(chunk / across.x) * CHUNK];
	const out = new Faces(cs);
	const marks = (shape.stairs as { bridges?: Uint8Array } | undefined)?.bridges;
	const voidY = chasmY(chasm, cs);
	// A bridge's open sides: its parapets (stairs.ts; no other rail stands on a bridge cell).
	const sides = new Set<number>();
	for (const p of (shape.stairs as { pieces?: StairPiece[] } | undefined)?.pieces ?? [])
		if (p.role === 'railing' && marks?.[p.cell]) sides.add(p.cell * 4 + p.dir);
	for (let y = y0; y < Math.min(y0 + CHUNK, h); y++)
		for (let x = x0; x < Math.min(x0 + CHUNK, w); x++) {
			const cell = y * w + x;
			const mark = marks?.[cell] ?? 0;
			if (!mark) continue;
			const under = mark & 3;
			const alongY = (mark & ALONG_Y) !== 0;
			const floorY = shape.ground.floorY({ x, y });
			const deckY = floorY - DECK * cs;
			for (const d of [0, 1, 2, 3]) {
				const j = neighbour(shape, cell, d);
				if (j < 0 || !sides.has(cell * 4 + d)) continue;
				// The side's frame: a along the edge, b out over it (0 on the edge).
				const out3: V3 = [DIRS[d].dx, 0, DIRS[d].dy];
				const along: V3 = [-DIRS[d].dy, 0, DIRS[d].dx];
				const centre = frame(shape, cell, along, out3);
				const at = (a: number, yy: number, b: number) => centre(a, yy, b + 0.5);
				const lo = shape.floor[j] === VOID ? voidY : shape.ground.floorY(cellOf(shape, j));
				// The deck's band closes its ends only against the bridge's own next cells.
				const ends = [(d + 3) & 3, (d + 1) & 3].map((e) => {
					const k = neighbour(shape, cell, e);
					return k >= 0 && (marks?.[k] ?? 0) !== 0;
				}) as [boolean, boolean];
				const deck = { front: SHADE.deck, side: SHADE.deck * 0.8, top: SHADE.deckTop };
				block(out, at, [-0.5, deckY, 0], [0.5, floorY, DECK_OUT], along, out3, deck, cell, ends);
				// The side behind the band and below it: flat, or an arch over the void.
				const top = under === UNDER.arch ? deckY : floorY;
				if (under === UNDER.arch) archSide(out, at, deckY, lo, out3, cell, cs);
				const quad = (y0: number, y1: number) =>
					out.quad(
						[at(-0.5, y0, 0), at(0.5, y0, 0), at(0.5, y1, 0), at(-0.5, y1, 0)],
						out3,
						SHADE.span,
						cell
					);
				if (under === UNDER.arch) quad(deckY, floorY);
				else quad(lo, top);
				if (under === UNDER.pier) {
					const pier = { front: SHADE.pier, side: SHADE.pierSide, top: SHADE.pier };
					block(
						out,
						at,
						[-PIER_HALF, lo, 0],
						[PIER_HALF, deckY, PIER_OUT],
						along,
						out3,
						pier,
						cell
					);
				}
			}
			if (under === UNDER.arch) archThrough(shape, out, cell, alongY, deckY, voidY);
		}
	return [new Faces(cs).done(), out.done()];
}

/** The opening's half width and its curve: the intrados' height at `a` (cells along). */
const RADIUS = 0.5 - JAMB;
const intrados = (a: number, crownY: number, cs: number) =>
	crownY - RADIUS * cs + Math.sqrt(Math.max(0, RADIUS * RADIUS - a * a)) * cs;
const arcAt = (k: number) => -RADIUS + (2 * RADIUS * k) / ARCH_SEGMENTS;

/** A long side over the void with its arch: jambs down to the void's floor, spandrel over the curve. */
function archSide(
	out: Faces,
	at: (a: number, y: number, b: number) => V3,
	deckY: number,
	lo: number,
	n: V3,
	cell: number,
	cs: number
): void {
	const crownY = deckY - CROWN * cs;
	for (const [a0, a1] of [
		[-0.5, -RADIUS],
		[RADIUS, 0.5]
	])
		out.quad(
			[at(a0, lo, 0), at(a1, lo, 0), at(a1, deckY, 0), at(a0, deckY, 0)],
			n,
			SHADE.span,
			cell
		);
	for (let k = 0; k < ARCH_SEGMENTS; k++) {
		const [a0, a1] = [arcAt(k), arcAt(k + 1)];
		const [b0, b1] = [intrados(a0, crownY, cs), intrados(a1, crownY, cs)];
		out.quad(
			[at(a0, b0, 0), at(a1, b1, 0), at(a1, deckY, 0), at(a0, deckY, 0)],
			n,
			SHADE.span,
			cell
		);
	}
}

/** Through an arch cell: the soffit, the jambs' returns and the floor, across the whole cell. */
function archThrough(
	shape: WorldShape,
	out: Faces,
	cell: number,
	alongY: boolean,
	deckY: number,
	voidY: number
): void {
	const cs = shape.grid.cellSize;
	const along: V3 = alongY ? [0, 0, 1] : [1, 0, 0];
	const across: V3 = alongY ? [1, 0, 0] : [0, 0, 1];
	const at = frame(shape, cell, along, across);
	const crownY = deckY - CROWN * cs;
	const springY = crownY - RADIUS * cs;
	for (let k = 0; k < ARCH_SEGMENTS; k++) {
		const [a0, a1] = [arcAt(k), arcAt(k + 1)];
		const [y0, y1] = [intrados(a0, crownY, cs), intrados(a1, crownY, cs)];
		// Facing the arch's centre, down and in.
		const mid = (a0 + a1) / 2;
		const up = (y0 + y1) / 2 - springY;
		const len = Math.hypot(mid * cs, up) || 1;
		const n: V3 = [(-mid * cs * along[0]) / len, -up / len, (-mid * cs * along[2]) / len];
		out.quad(
			[at(a0, y0, -0.5), at(a0, y0, 0.5), at(a1, y1, 0.5), at(a1, y1, -0.5)],
			n,
			SHADE.soffit,
			cell
		);
	}
	for (const s of [-1, 1]) {
		const a = s * RADIUS;
		const n: V3 = [-s * along[0], 0, -s * along[2]];
		out.quad(
			[at(a, voidY, -0.5), at(a, voidY, 0.5), at(a, springY, 0.5), at(a, springY, -0.5)],
			n,
			SHADE.pierSide,
			cell
		);
	}
	out.quad(
		[at(-0.5, voidY, -0.5), at(0.5, voidY, -0.5), at(0.5, voidY, 0.5), at(-0.5, voidY, 0.5)],
		[0, 1, 0],
		1,
		cell
	);
}

const cellOf = (shape: WorldShape, i: number) => ({
	x: i % shape.grid.width,
	y: Math.floor(i / shape.grid.width)
});
