// Glazed windows (milestone 70, #260): which building walls carry a glazed window, which of them
// light after dusk, and how brightly, from what the viewer was sent. Pure, in the lazy `world`
// chunk, server-tested (glazing.spec.ts). docs/RENDERING.md, "Window glow (#260)".
//
// - A facade is a straight wall between equal floors, both cells known, one inside a building
//   (the tile input's building context, #257) and the other not: the rules' wall, never a rules
//   window (those are open gaps and never glow). A share of facades, by a hash of the edge's key,
//   is glazed: the walls draw it as a window frame (wall-batch.ts) with a pane in its opening.
// - A share of panes lights after dusk, by another hash of the same key, so the same windows light
//   on every client; none whose inside cell is in a dark area the viewer was sent.
// - How bright: `windowGlow` of the sky's night glow (atmosphere-curve.ts), 0 by day.

import { cornerToWorld } from '../../game/grid';
import type { CellMask } from '../../game/visibility';
import { WALL_HEIGHT } from '../ground';
import { keySeed, type TileInput } from './autotile';
import { EDGE_BUILT } from './shape';
import { boxes, compose, edgeIndex, type PieceMesh } from './wall-batch';

/** The share of facade units that are glazed. */
export const GLAZED_SHARE = 0.35;
/** The share of glazed windows that light after dusk. */
export const LIT_SHARE = 0.6;
/** The sky's night glow by day (every sky's day keys), and at night. */
const DAY_GLOW = 0.5;

/**
 * How brightly windows glow (0-1) at a sky's night glow: 0 by day (0.5), 1 at night (1), on the
 * curve's own ramp between (temperate: from 17:30 to 19:30, and down from 06:00 to 08:00).
 */
export function windowGlow(nightGlow: number): number {
	return Math.min(1, Math.max(0, (nightGlow - DAY_GLOW) / (1 - DAY_GLOW)));
}

/** A seed's share in [0, 1) under `salt`: murmur3's finaliser, so shares don't follow the variants. */
export function shareOf(seed: number, salt: number): number {
	let h = (seed ^ Math.imul(salt, 0x9e3779b9)) >>> 0;
	h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

/** Whether an edge's key seed (`keySeed`) lights, if glazed. */
export const lightsUp = (seed: number) => shareOf(seed, 2) < LIT_SHARE;

/** The glazed windows: the facade edges the walls draw as frames, and a pane in each. */
export interface Glazing {
	/** `edgeIndex` of every glazed edge. */
	edges: Set<number>;
	count: number;
	/** Column-major 4x4 per pane. */
	matrices: Float32Array;
	seed: Uint32Array;
	/** The building cell behind each pane, which a dark area keeps dark. */
	inside: Int32Array;
}

export function glazing(t: TileInput): Glazing {
	const { shape, building } = t;
	const { grid, known } = shape;
	const { width: w, height: h, cellSize: cs } = grid;
	const found: { edge: number; seed: number; inside: number; m: Float32Array }[] = [];
	if (building)
		for (const axis of ['h', 'v'] as const)
			t.views[axis].forEach((e, i) => {
				if (!e || e.kind !== EDGE_BUILT.wall || e.outer || e.boundary || e.high !== e.low) return;
				const across = axis === 'h' ? w : w + 1;
				const [x, y] = [i % across, Math.floor(i / across)];
				const p = axis === 'h' ? (y > 0 ? (y - 1) * w + x : -1) : x > 0 ? y * w + x - 1 : -1;
				const q = x < w && y < h ? y * w + x : -1;
				const isKnown = (c: number) => c >= 0 && (!known || known[c] === 1);
				if (!isKnown(p) || !isKnown(q) || building[p] === building[q]) return;
				const seed = keySeed(axis, x, y);
				if (shareOf(seed, 1) >= GLAZED_SHARE) return;
				const c = cornerToWorld(grid, { x, y });
				const m = new Float32Array(16);
				const [cx, cz] = axis === 'h' ? [c.x + cs / 2, c.z] : [c.x, c.z + cs / 2];
				compose(m, 0, cx, e.high, cz, e.rotation, cs, cs);
				found.push({ edge: edgeIndex(grid, axis, x, y), seed, inside: building[p] ? p : q, m });
			});
	const out: Glazing = {
		edges: new Set(found.map((f) => f.edge)),
		count: found.length,
		matrices: new Float32Array(found.length * 16),
		seed: Uint32Array.from(found, (f) => f.seed),
		inside: Int32Array.from(found, (f) => f.inside)
	};
	found.forEach((f, i) => out.matrices.set(f.m, i * 16));
	return out;
}

/** Each pane's lighting after dusk: its hash, unless its inside cell is in a dark area. */
export function litPanes(g: Glazing, dark: CellMask | null): Uint8Array {
	return Uint8Array.from(g.seed, (s, i) => (lightsUp(s) && !dark?.[g.inside[i]] ? 1 : 0));
}

/** The pane's colour: the greybox kits' glass (#5d6a78), linear. */
const GLASS_RGB = [0x5d, 0x6a, 0x78].map((c) => ((c / 255 + 0.055) / 1.055) ** 2.4);
/**
 * A pane's half, in kit units: it fills a window frame's opening, built-in (0.7-1.6 between jambs
 * at ±0.42) or the greybox kits' (0.85-1.65, ±0.33), its edges inside the frame, within ±0.01 of
 * the wall's plane: the outer half (+z, out of the building) is what glows, the inner never does.
 * Its colour baked in as a kit piece's (#261).
 */
export function paneMesh(outer: boolean): PieceMesh {
	const H = WALL_HEIGHT;
	const [z0, z1] = outer ? [0, 0.01] : [-0.01, 0];
	const pane = boxes([[-0.45, 0.35 * H, z0, 0.45, 0.83 * H, z1]]);
	const colors = new Float32Array(pane.positions.length);
	for (let i = 0; i < colors.length; i++) colors[i] = GLASS_RGB[i % 3];
	return { ...pane, colors };
}
