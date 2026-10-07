// The greybox kits' building blocks (#261): parts, seeded jitter, courses, boards, rubble,
// openings, floor slabs and roof slopes, in a piece's own frame (src/lib/assets/kit.ts's pivots).

import type { Style } from './pieces';

export type V3 = [number, number, number];
export interface Part {
	shape: 'box' | 'cylinder' | 'sphere' | 'cone';
	size: V3;
	at: V3;
	turn?: V3;
	color?: string;
	material?: string;
}

const r3 = (v: number[]) => v.map((n) => Math.round(n * 1000) / 1000 || 0) as V3;
/** `#rrggbb` is a colour, anything else a manifest material. */
const paint = (c: string) => (c.startsWith('#') ? { color: c } : { material: c });
const part =
	(shape: Part['shape']) =>
	(size: number[], at: number[], c: string, turn?: number[]): Part => ({
		shape,
		size: r3(size),
		at: r3(at),
		...(turn ? { turn: r3(turn) } : {}),
		...paint(c)
	});
export const box = part('box');
export const cyl = part('cylinder');
export const cone = part('cone');
export const ball = part('sphere');

/** A seeded generator (mulberry32), so jitter is the same every run. */
export function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ---- Edges: x along the edge (±0.5), y up from the higher floor, +z the exterior. ----

/** A run of blocks in courses, staggered every other course, between y0 and y1, ±d/2 thick. */
export function courses(y0: number, y1: number, rows: number, d: number, c: string, seed: number) {
	const rand = rng(seed);
	const h = (y1 - y0) / rows;
	const out: Part[] = [];
	for (let i = 0; i < rows; i++) {
		const cuts = i % 2 ? [-0.5, -0.25, 0.25, 0.5] : [-0.5, 0, 0.5];
		for (let k = 0; k + 1 < cuts.length; k++) {
			const w = cuts[k + 1] - cuts[k] - 0.02;
			const t = d - rand() * 0.02;
			out.push(box([w, h - 0.02, t], [(cuts[k] + cuts[k + 1]) / 2, y0 + (i + 0.5) * h, 0], c));
		}
	}
	return out;
}

/** A plank wall: n boards along x between y0 and y1, alternately proud. */
export function boards(y0: number, y1: number, n: number, d: number, c: string, alt: string) {
	const w = 1 / n;
	return Array.from({ length: n }, (_, i) =>
		box(
			[w - 0.015, y1 - y0, i % 2 ? d : d - 0.02],
			[-0.5 + (i + 0.5) * w, (y0 + y1) / 2, 0],
			i % 3 ? c : alt
		)
	);
}

/** Rough stones heaped between y0 and y1, within z0..z1, kept inside x ±0.5. */
export function rubble(
	y0: number,
	y1: number,
	z0: number,
	z1: number,
	c: string[],
	seed: number,
	rows = 4
) {
	const rand = rng(seed);
	const h = (y1 - y0) / rows;
	const out: Part[] = [];
	for (let i = 0; i < rows; i++) {
		let x = -0.5;
		while (x < 0.5 - 1e-9) {
			let w = Math.min(0.25 + rand() * 0.25, 0.5 - x);
			// No sliver at the end of a course: the last stone takes what is left.
			if (0.5 - x - w < 0.15) w = 0.5 - x;
			const d = (z1 - z0) * (0.75 + rand() * 0.25);
			const tilt = (rand() - 0.5) * 0.12;
			// Turned about z only (z keeps its extent), and kept inside its slot once turned.
			const [sin, cos] = [Math.abs(Math.sin(tilt)), Math.cos(tilt)];
			const [bw, bh] = [w - 0.02 - h * sin, h - 0.02 - w * sin];
			const hx = (bw * cos + bh * sin) / 2;
			const hy = (bh * cos + bw * sin) / 2;
			const cx = Math.min(Math.max(x + w / 2, -0.5 + hx), 0.5 - hx);
			const cy = Math.min(Math.max(y0 + (i + 0.5) * h, y0 + hy), y1 - hy);
			out.push(
				box([bw, bh, d], [cx, cy, z1 - d / 2], c[Math.floor(rand() * c.length)], [0, 0, tilt])
			);
			x += w;
		}
	}
	return out;
}

/** A window's or door's opening in a wall: parapet, jambs and lintel round an opening. */
export function opening(s: Style, bottom: number, top: number, half: number): Part[] {
	const t = 0.12;
	const out: Part[] = [];
	if (bottom > 0) out.push(box([1, bottom, t], [0, bottom / 2, 0], s.wall));
	const jamb = 0.5 - half;
	for (const side of [-1, 1])
		out.push(
			box([jamb, top - bottom, t], [side * (0.5 - jamb / 2), (top + bottom) / 2, 0], s.wall)
		);
	out.push(box([1, 2 - top, t], [0, (2 + top) / 2, 0], s.wall));
	// The frame, proud of the wall on both faces.
	for (const side of [-1, 1])
		out.push(
			box([0.06, top - bottom, 0.14], [side * (half + 0.03), (top + bottom) / 2, 0], s.trim)
		);
	out.push(box([2 * half + 0.12, 0.08, 0.14], [0, top + 0.04, 0], s.trim));
	if (s.gothic) out.push(...pointed(half, top - 0.14, half * 1.4, 0.75, s.trim));
	return out;
}

/**
 * A pointed head: two voussoirs leaning in from x = ±half to meet near y + len/2·sin(angle), each
 * deep enough to fill the spandrel above it.
 */
export function pointed(half: number, y: number, len: number, angle: number, c: string): Part[] {
	const d = 0.24;
	const [sin, cos] = [Math.sin(angle), Math.cos(angle)];
	const lift = (d - 0.09) / 2;
	const apex = y + lift * cos - (d / 2) * cos + (len / 2) * sin;
	return [
		...[-1, 1].map((side) =>
			box([len, d, 0.13], [side * (half * 0.48 + lift * sin), y + lift * cos, 0], c, [
				0,
				0,
				-side * angle
			])
		),
		// The keystone closes the notch where the voussoirs' ends meet.
		box([0.13, 0.13, 0.13], [0, apex + 0.08, 0], c, [0, 0, Math.PI / 4])
	];
}

// ---- Cells: x and z about the cell's centre, y up from its floor. ----

/** A floor tile's pieces: slabs whose tops sit at y = 0 with grout gaps between. */
export function slabs(
	cells: number[][],
	d: number,
	colors: string[],
	seed: number,
	broken = false
) {
	const rand = rng(seed);
	return cells.map(([x0, z0, x1, z1], i) => {
		const sink = broken && i % 2 === 0 ? 0.05 + rand() * 0.04 : rand() * 0.008;
		const tilt = broken && i % 2 === 0 ? (rand() - 0.5) * 0.12 : 0;
		const w = x1 - x0 - 0.03;
		const l = z1 - z0 - 0.03;
		// A tilted slab is shrunk by its rise so no corner lifts above the floor.
		const lift = (Math.abs(Math.sin(tilt)) * l) / 2;
		return box(
			[w, d, l],
			[(x0 + x1) / 2, -d / 2 - sink - lift, (z0 + z1) / 2],
			colors[Math.floor(rand() * colors.length)],
			tilt ? [tilt, 0, 0] : undefined
		);
	});
}

/** One roof slope over the cell from z0 (high) to z1 (low), its top at y = 2 + (zr - z)·tan. */
export function slope(
	s: Style,
	z0: number,
	z1: number,
	zr: number,
	c: string,
	x0 = -0.5,
	x1 = 0.5
) {
	const p = (s.roof!.pitch * Math.PI) / 180;
	const t = Math.tan(p);
	const dir = Math.sign(z1 - z0);
	const run = Math.abs(z1 - z0);
	const th = 0.08;
	const zc = (z0 + z1) / 2;
	const yc = 2 + dir * (zr - zc) * t - th / 2 / Math.cos(p);
	return box([x1 - x0, th, run / Math.cos(p)], [(x0 + x1) / 2, yc, zc], c, [dir * p, 0, 0]);
}

/**
 * A hipped corner or a cell's pyramid as terraces (boxes can't make the triangles): layers rising
 * by the pitch from the eave inward. A corner's eaves are at +x and +z (it runs on at -x and -z),
 * a hip's all round.
 */
export function terraces(s: Style, c: string, hip: boolean, steps = 5) {
	const t = Math.tan((s.roof!.pitch * Math.PI) / 180);
	const e = s.roof!.eave;
	const run = hip ? 0.5 + e : 1 + e;
	const th = 0.08;
	return Array.from({ length: steps }, (_, k) => {
		const d = (k * run) / steps;
		const y = 2 - e * t + (d + run / steps) * t;
		const y0 = 2 - e * t + d * t - th;
		const reach = 0.5 + e - d;
		const [lo, hi] = hip ? [-reach, reach] : [-0.5, reach];
		return box([hi - lo, y - y0, hi - lo], [(lo + hi) / 2, (y + y0) / 2, (lo + hi) / 2], c);
	});
}
