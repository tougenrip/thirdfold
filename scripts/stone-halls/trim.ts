// The stone-halls pilot kit's trim sheet (#263): one 2048² set (albedo, normal, ORM) shared by
// every piece, painted procedurally for scripts/make-stone-halls-art.ts. 512 px per unit (docs/ART.md
// section 3: a 2048² sheet covers 4 × 4 u), laid out in strips that tile along u:
//
//   ashlar   rows    0-1023  2 u of coursed blocks, a wall's height, 4 u long (the courses
//                            below are the ones the wall pieces are built from, so the
//                            painted joints fall on the geometry's)
//   dressed  rows 1024-1279  smooth tooled stone: copings, frames, mouldings, voussoirs
//   rubble   rows 1280-1535  rough split stones in dark mortar: retaining walls, cliffs
//   flag     rows 1536-1791  worn paving: floor flags, treads, decks
//   timber   rows 1792-1919  oak boards, the grain along u
//   iron     rows 1920-2047, left half    hammered iron
//   glass    rows 1920-2047, right half   leaded glass
//
// Values follow docs/ART.md section 4 (30-240, darks toward blue, warm tops, cavity AO at most 20%
// in the albedo); the ramps are the surface ramps (ashlar, stone, flagstone, planks, slate).

export const SIZE = 2048;
/** Pixels per unit at the sheet's full size. */
export const PX_PER_U = SIZE / 4;

export type RegionId = 'ashlar' | 'dressed' | 'rubble' | 'flag' | 'timber' | 'iron' | 'glass';
export interface Region {
	x: number;
	y: number;
	w: number;
	h: number;
}
export const REGIONS: Record<RegionId, Region> = {
	ashlar: { x: 0, y: 0, w: 2048, h: 1024 },
	dressed: { x: 0, y: 1024, w: 2048, h: 256 },
	rubble: { x: 0, y: 1280, w: 2048, h: 256 },
	flag: { x: 0, y: 1536, w: 2048, h: 256 },
	timber: { x: 0, y: 1792, w: 2048, h: 128 },
	iron: { x: 0, y: 1920, w: 1024, h: 128 },
	glass: { x: 1024, y: 1920, w: 1024, h: 128 }
};
/** UVs keep this many pixels inside a region's rows, so mips don't bleed across. */
export const INSET = 6;

// ---------------------------------------------------------------- the courses

/** Course heights from a wall's floor up: a footing course, then five, 2.0 u in all. */
export const COURSES = [0.4, 0.32, 0.32, 0.32, 0.32, 0.32];
/** The joint between blocks, in units (the geometry leaves the same gap). */
export const JOINT = 0.014;

/** A seeded generator (mulberry32), the same every run. */
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

/** Each course's cuts along the 4 u strip, ascending in [0, 4): blocks run between them, wrapping. */
export const CUTS: number[][] = COURSES.map((_, c) => {
	const rand = rng(263 + c * 31);
	const start = rand() * 0.4;
	const cuts = [start];
	let x = start;
	for (;;) {
		const len = 0.32 + rand() * 0.34;
		if (start + 4 - (x + len) < 0.3) break;
		x += len;
		cuts.push(x);
	}
	return cuts.map((v) => v % 4).sort((a, b) => a - b);
});

/** The course at height y (0-2) and its bottom. */
export function courseAt(y: number): { c: number; y0: number; y1: number } {
	let y0 = 0;
	for (let c = 0; c < COURSES.length; c++) {
		if (y < y0 + COURSES[c] || c === COURSES.length - 1) return { c, y0, y1: y0 + COURSES[c] };
		y0 += COURSES[c];
	}
	throw new Error('unreachable');
}

/** The blocks of course `c` overlapping [a, b] on the strip (a may be past 4: it wraps). */
export function blocksIn(c: number, a: number, b: number): [number, number][] {
	const cuts = CUTS[c];
	const out: [number, number][] = [];
	for (let k = -1; k <= 2; k++) {
		for (let i = 0; i < cuts.length; i++) {
			const x0 = cuts[i] + 4 * k;
			const x1 = (i + 1 < cuts.length ? cuts[i + 1] : cuts[0] + 4) + 4 * k;
			const lo = Math.max(x0, a);
			const hi = Math.min(x1, b);
			if (hi - lo > 1e-6) out.push([lo, hi]);
		}
	}
	return out.sort((p, q) => p[0] - q[0]);
}

// ---------------------------------------------------------------- noise

function hash(x: number, y: number, seed: number): number {
	let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Value noise; x wraps every `wrap` cells when given. */
function noise(x: number, y: number, seed: number, wrap = 0): number {
	const [x0, y0] = [Math.floor(x), Math.floor(y)];
	const [fx, fy] = [x - x0, y - y0];
	const [sx, sy] = [fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)];
	const w = (i: number) => (wrap ? ((i % wrap) + wrap) % wrap : i);
	const v = (i: number, j: number) => hash(w(x0 + i), y0 + j, seed);
	const a = v(0, 0) + (v(1, 0) - v(0, 0)) * sx;
	const b = v(0, 1) + (v(1, 1) - v(0, 1)) * sx;
	return a + (b - a) * sy;
}
/** Fractal noise over a few octaves, in about 0..1; `wrap` in cells of the first octave. */
function fbm(x: number, y: number, seed: number, wrap = 0, octaves = 4): number {
	let [sum, amp, total] = [0, 1, 0];
	for (let o = 0; o < octaves; o++) {
		const f = 2 ** o;
		sum += amp * noise(x * f, y * f, seed + o * 17, wrap * f);
		total += amp;
		amp /= 2;
	}
	return sum / total;
}
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = (a: number, b: number, v: number) => {
	const t = clamp((v - a) / (b - a));
	return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- colour

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const RAMPS = {
	ashlar: ['#4a4a52', '#6f6c6a', '#948d7f', '#b8ae98'].map(hex),
	stone: ['#3b3f4a', '#5e6068', '#858276', '#aba594'].map(hex),
	flagstone: ['#3a3d48', '#5f5f63', '#86826f', '#aca58d'].map(hex),
	planks: ['#3a2b2b', '#5f4533', '#856342', '#a7855a'].map(hex),
	slate: ['#262a35', '#3d4250', '#5a5f6b', '#7d808a'].map(hex)
};
/** A ramp at t in 0..1, dark to light. */
function ramp(r: RGB[], t: number): RGB {
	const f = clamp(t) * (r.length - 1);
	const i = Math.min(Math.floor(f), r.length - 2);
	const k = f - i;
	return [0, 1, 2].map((c) => r[i][c] + (r[i + 1][c] - r[i][c]) * k) as RGB;
}
const mix = (a: RGB, b: RGB, t: number): RGB =>
	[0, 1, 2].map((c) => a[c] + (b[c] - a[c]) * t) as RGB;
const MOSS: RGB = [74, 86, 62];
const RUST: RGB = [106, 70, 56];

// ---------------------------------------------------------------- the painting

/** One texel as painted: colour (sRGB 0-255), height (0-1, in units of `depth`), roughness, metal. */
interface Texel {
	rgb: RGB;
	h: number;
	rough: number;
	metal: number;
}

/** The ashlar strip at (x, y) in units: x along the 4 u strip, y up the wall from its floor. */
function ashlar(x: number, y: number): Texel {
	const { c, y0, y1 } = courseAt(y);
	const [b0, b1] = blocksIn(c, x - 1, x + 1).find(([a, b]) => a <= x && x < b) ?? [x, x];
	const block = Math.floor((((b0 % 4) + 4) % 4) * 1000) + c * 7919;
	const edge = Math.min(x - b0, b1 - x, y - y0, y1 - y);
	const grain = fbm(x * 6, y * 6, 11, 24);
	if (edge < JOINT / 2) {
		// Mortar: recessed, cool, with moss in the lowest joints.
		const moss = y < 0.5 ? smooth(0.5, 0.15, y) * smooth(0.45, 0.7, fbm(x * 9, y * 9, 5, 36)) : 0;
		const rgb = mix(ramp(RAMPS.ashlar, 0.08 + 0.12 * grain), MOSS, moss * 0.8);
		return { rgb, h: 0.1 * grain, rough: 0.95, metal: 0 };
	}
	// The block's own value and a hue shift, chips at a corner or two, tooling and pits.
	const shade = hash(block, 1, 3);
	const warm = hash(block, 2, 3) - 0.5;
	const bevel = smooth(0, 0.03, edge - JOINT / 2);
	const chip =
		hash(block, 3, 3) < 0.35
			? smooth(0.07, 0.02, Math.hypot(x - (hash(block, 4, 3) < 0.5 ? b0 : b1), y - y1))
			: 0;
	const pits = smooth(0.66, 0.74, fbm(x * 40, y * 40, 7, 160, 2));
	const face = 0.35 + 0.35 * shade + 0.2 * (grain - 0.5) - 0.07 * pits - 0.25 * chip;
	let rgb = ramp(RAMPS.ashlar, face);
	rgb = [rgb[0] + warm * 10, rgb[1] + warm * 4, rgb[2] - warm * 8];
	// Warm, worn top edges; cool joints.
	const top = smooth(0.035, 0.005, y1 - y) * (1 - chip);
	rgb = mix(rgb, ramp(RAMPS.ashlar, 0.95), top * 0.45);
	rgb = mix(ramp(RAMPS.ashlar, 0.15), rgb, 0.55 + 0.45 * bevel);
	const h = 0.55 + 0.45 * bevel - 0.3 * chip - 0.06 * pits + 0.1 * grain;
	return { rgb, h, rough: 0.82 - 0.1 * top, metal: 0 };
}

/** Dressed stone: x along, y across the 0.5 u strip. Long slabs, fine tooling, edge highlights. */
function dressed(x: number, y: number): Texel {
	const slab = Math.floor((x + 0.37) / 1.3);
	const joint = Math.abs(((x + 0.37) % 1.3) - 0.65) > 0.643;
	const grain = fbm(x * 5, y * 5, 21, 20);
	if (joint) return { rgb: ramp(RAMPS.ashlar, 0.2), h: 0.15, rough: 0.95, metal: 0 };
	const tooling = 0.5 + 0.5 * Math.sin(y * 260 + fbm(x * 3, y * 3, 23, 12) * 6);
	const edge = Math.min(y, 0.5 - y);
	const hi = smooth(0.03, 0.004, edge);
	let rgb = ramp(
		RAMPS.ashlar,
		0.6 + 0.12 * hash(slab, 0, 9) + 0.15 * (grain - 0.5) - 0.03 * tooling
	);
	rgb = mix(rgb, ramp(RAMPS.ashlar, 1), hi * 0.4);
	return { rgb, h: 0.7 + 0.08 * tooling + 0.15 * grain - 0.3 * hi, rough: 0.72, metal: 0 };
}

/** Rubble: rough split stones (a jittered Voronoi), wrapping along the strip. */
function rubble(x: number, y: number): Texel {
	const cell = 0.17;
	const [gx, gy] = [Math.floor(x / cell), Math.floor(y / cell)];
	const wrap = Math.round(4 / cell);
	let [d1, d2, id] = [9, 9, 0];
	for (let j = -1; j <= 1; j++)
		for (let i = -1; i <= 1; i++) {
			const cx = gx + i;
			const cy = gy + j;
			const k = ((cx % wrap) + wrap) % wrap;
			const px = (cx + 0.15 + 0.7 * hash(k, cy, 41)) * cell;
			const py = (cy + 0.15 + 0.7 * hash(k, cy, 43)) * cell;
			const d = Math.hypot(x - px, (y - py) * 1.25);
			if (d < d1) [d2, d1, id] = [d1, d, k * 131 + cy];
			else if (d < d2) d2 = d;
		}
	const gap = d2 - d1;
	const grain = fbm(x * 8, y * 8, 45, 32);
	if (gap < 0.012)
		return { rgb: ramp(RAMPS.stone, 0.05 + 0.1 * grain), h: 0, rough: 0.95, metal: 0 };
	const dome = smooth(0.012, 0.06, gap);
	let rgb = ramp(RAMPS.stone, 0.3 + 0.35 * hash(id, 0, 47) + 0.25 * (grain - 0.5));
	rgb = mix(rgb, ramp(RAMPS.stone, 0.95), smooth(0.5, 1, dome) * 0.15);
	return { rgb, h: 0.3 + 0.6 * dome + 0.15 * grain, rough: 0.88, metal: 0 };
}

/** Paving: worn flagstone with mottling, pits and a few hairline cracks. */
function flag(x: number, y: number): Texel {
	const grain = fbm(x * 4, y * 4, 51, 16);
	const fine = fbm(x * 30, y * 30, 53, 120, 2);
	const crack =
		Math.abs(fbm(x * 2.2, y * 2.2, 55, 8, 3) - 0.5) < 0.004 &&
		noise(x * 1.3, y * 1.3, 59, 5.2) > 0.6
			? 1
			: 0;
	const wear = smooth(0.55, 0.75, fbm(x * 1.5, y * 1.5, 57, 6));
	let rgb = ramp(RAMPS.flagstone, 0.45 + 0.3 * (grain - 0.5) + 0.1 * wear - 0.08 * fine);
	rgb = mix(rgb, ramp(RAMPS.flagstone, 0.15), crack * 0.5);
	return {
		rgb,
		h: 0.6 + 0.2 * grain - 0.15 * fine - 0.4 * crack,
		rough: 0.8 - 0.12 * wear,
		metal: 0
	};
}

/** Oak boards: grain along x, a knot or two. */
function timber(x: number, y: number): Texel {
	const warp = fbm(x * 0.8, y * 3, 61, 3.2) * 0.08;
	const rings = 0.5 + 0.5 * Math.sin((y + warp) * 140 + fbm(x * 2, y * 8, 63, 8) * 5);
	const grain = fbm(x * 1.5, y * 40, 65, 6);
	const kx = (x % 1.1) - 0.55;
	const knot = smooth(0.05, 0.0, Math.hypot(kx, (y - 0.12) * 1.6));
	const edge = smooth(0.012, 0.0, Math.min(y, 0.25 - y));
	const t = 0.38 + 0.18 * rings + 0.2 * (grain - 0.5) - 0.3 * knot - 0.25 * edge;
	return { rgb: ramp(RAMPS.planks, t), h: 0.6 + 0.12 * rings - 0.3 * edge, rough: 0.78, metal: 0 };
}

/** Hammered black iron with rust in the low spots. */
function iron(x: number, y: number): Texel {
	const hammer = fbm(x * 18, y * 18, 71, 0, 3);
	const rust = smooth(0.62, 0.78, fbm(x * 6, y * 6, 73, 0, 3));
	const rgb = mix(ramp(RAMPS.slate, 0.25 + 0.3 * hammer), RUST, rust * 0.6);
	return { rgb, h: 0.5 + 0.3 * hammer, rough: 0.5 + 0.35 * rust, metal: 1 - rust };
}

/** Leaded glass: diamond quarries of grey-blue glass, slightly uneven. */
function glass(x: number, y: number): Texel {
	const q = 0.09;
	const a = ((((x + y) / q) % 1) + 1) % 1;
	const b = ((((x - y) / q) % 1) + 1) % 1;
	const lead = Math.min(a, 1 - a, b, 1 - b) < 0.06;
	if (lead) return { rgb: ramp(RAMPS.slate, 0.15), h: 0.9, rough: 0.6, metal: 0 };
	const pane = hash(Math.floor((x + y) / q), Math.floor((x - y) / q), 81);
	const ripple = fbm(x * 12, y * 12, 83, 0, 2);
	const rgb = mix(ramp(RAMPS.slate, 0.35 + 0.2 * pane), [77, 96, 110], 0.5 + 0.2 * ripple);
	return { rgb, h: 0.4 + 0.1 * ripple, rough: 0.22, metal: 0 };
}

const PAINT: Record<RegionId, (x: number, y: number) => Texel> = {
	ashlar: (x, y) => ashlar(x, 2 - y),
	dressed,
	rubble,
	flag,
	timber,
	iron,
	glass
};
/** How deep each region's relief is, in units: what its normal map turns into slopes. */
const DEPTH: Record<RegionId, number> = {
	ashlar: 0.014,
	dressed: 0.006,
	rubble: 0.03,
	flag: 0.006,
	timber: 0.004,
	iron: 0.004,
	glass: 0.003
};

export interface Maps {
	albedo: Uint8Array;
	normal: Uint8Array;
	orm: Uint8Array;
}

/** Paints the three maps at SIZE², RGBA8. */
export function paintTrim(): Maps {
	const n = SIZE * SIZE;
	const height = new Float32Array(n);
	const depth = new Float32Array(n);
	const albedo = new Uint8Array(n * 4);
	const orm = new Uint8Array(n * 4);
	const regionOf = new Uint8Array(n);
	const ids = Object.keys(REGIONS) as RegionId[];
	ids.forEach((id, r) => {
		const R = REGIONS[id];
		for (let py = R.y; py < R.y + R.h; py++)
			for (let px = R.x; px < R.x + R.w; px++) {
				const t = PAINT[id]((px - R.x + 0.5) / PX_PER_U, (py - R.y + 0.5) / PX_PER_U);
				const i = py * SIZE + px;
				height[i] = t.h;
				depth[i] = DEPTH[id];
				regionOf[i] = r;
				albedo.set([...t.rgb.map((v) => Math.round(clamp(v, 30, 240))), 255], i * 4);
				orm.set(
					[255, Math.round(clamp(t.rough) * 255), Math.round(clamp(t.metal) * 255), 255],
					i * 4
				);
			}
	});
	// Within a region: x wraps on the full-width strips, everything clamps at the region's rows.
	const at = (px: number, py: number, r: number) => {
		const R = REGIONS[ids[r]];
		const x = R.w === SIZE ? ((px % SIZE) + SIZE) % SIZE : clamp(px, R.x, R.x + R.w - 1);
		const y = clamp(py, R.y, R.y + R.h - 1);
		return height[y * SIZE + x];
	};
	// Cavity occlusion: how far below its neighbourhood (a 9 px box) a texel sits.
	const normal = new Uint8Array(n * 4);
	for (let py = 0; py < SIZE; py++)
		for (let px = 0; px < SIZE; px++) {
			const i = py * SIZE + px;
			const r = regionOf[i];
			const s = depth[i] * PX_PER_U;
			// OpenGL: +Y is up the image, so rows down are -y.
			const dx = (at(px + 1, py, r) - at(px - 1, py, r)) * 0.5 * s;
			const dy = (at(px, py + 1, r) - at(px, py - 1, r)) * 0.5 * s;
			const len = Math.hypot(dx, dy, 1);
			normal.set(
				[
					(-dx / len) * 127.5 + 127.5,
					(dy / len) * 127.5 + 127.5,
					(1 / len) * 127.5 + 127.5,
					255
				].map(Math.round),
				i * 4
			);
			let mean = 0;
			for (let k = -4; k <= 4; k += 2) mean += at(px + k, py, r) + at(px, py + k, r);
			const cavity = clamp((mean / 10 - height[i]) * 2.5);
			const ao = 1 - 0.45 * cavity;
			orm[i * 4] = Math.round(ao * 255);
			// At most 20% darker in the albedo (docs/ART.md section 4).
			for (let c = 0; c < 3; c++)
				albedo[i * 4 + c] = Math.round(clamp(albedo[i * 4 + c] * (1 - 0.2 * cavity), 30, 240));
		}
	return { albedo, normal, orm };
}

const toLinear = (v: number) => {
	const c = v / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/**
 * The mean colour (linear) of the albedo over a UV rectangle (u wraps): what a vertex colour
 * carries until the walls' material samples the sheet itself.
 */
export function meanColour(albedo: Uint8Array, u0: number, v0: number, u1: number, v1: number) {
	const out = [0, 0, 0];
	const N = 8;
	for (let j = 0; j < N; j++)
		for (let i = 0; i < N; i++) {
			const u = u0 + ((i + 0.5) / N) * (u1 - u0);
			const v = v0 + ((j + 0.5) / N) * (v1 - v0);
			const px = ((Math.floor(u * SIZE) % SIZE) + SIZE) % SIZE;
			const py = clamp(Math.floor(v * SIZE), 0, SIZE - 1);
			for (let c = 0; c < 3; c++) out[c] += toLinear(albedo[(py * SIZE + px) * 4 + c]);
		}
	return out.map((v) => v / (N * N)) as RGB;
}
