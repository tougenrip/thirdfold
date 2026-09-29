// The great bell's pilot art (#196), its shape and paint: the atlas, the bell's profile and
// the maps painted over it, for scripts/make-bell-art.ts, which builds and exports the model.

/** Painted at 2K, the largest texture detail; the cook makes the 512 base and the 1K from it. */
export const SIZE = 2048;
/** The atlas was laid out at 1024 px: its regions, insets and relief scale by this. */
const K = SIZE / 1024;
export const GLOW = 256 * K;

// The atlas, in pixels: the bell's outside, then timber, iron and the bell's inside.
export type Region = { x: number; y: number; w: number; h: number };
const region = (x: number, y: number, w: number, h: number): Region => ({
	x: x * K,
	y: y * K,
	w: w * K,
	h: h * K
});
export const BELL = region(0, 0, 768, 1024);
export const WOOD = region(768, 0, 256, 512);
export const IRON = region(768, 512, 256, 256);
export const INNER = region(768, 768, 256, 256);
const REGIONS = [BELL, WOOD, IRON, INNER];
/** A few texels of the 1024 layout: UVs keep this far inside their region, so mips don't bleed across. */
const EDGE = 4 * K;
export const inset = (r: Region, s: number, t: number) => [
	(r.x + EDGE + s * (r.w - 2 * EDGE)) / SIZE,
	(r.y + EDGE + t * (r.h - 2 * EDGE)) / SIZE
];

const LIP = 1.0;
const CROWN = 3.45;
const BANDS = [0.13, 0.52, 0.85];
const gauss = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));
/** The bell's outer radius `t` of the way from lip to shoulder, with its three raised bands. */
const outer = (t: number) =>
	0.625 + 0.555 * (1 - t) ** 2.4 + BANDS.reduce((sum, c) => sum + 0.03 * gauss(t, c, 0.022), 0);

/** The bell's profile from the outer crown down to the lip and up the inside, with arc lengths. */
export function profile() {
	const pts: { r: number; y: number; outside: boolean }[] = [];
	const crown = 8;
	for (let i = 0; i <= crown; i++) {
		const f = (i / crown) * (Math.PI / 2);
		pts.push({ r: outer(1) * Math.sin(f), y: CROWN + 0.1 * Math.cos(f), outside: true });
	}
	const body = 64;
	for (let i = body - 1; i >= 0; i--) {
		const t = i / body;
		pts.push({ r: outer(t), y: LIP + (CROWN - LIP) * t, outside: true });
	}
	const thick = (t: number) => 0.13 - 0.07 * t;
	pts.push({ r: outer(0) - 0.03, y: LIP - 0.02, outside: false });
	pts.push({ r: outer(0) - thick(0) + 0.02, y: LIP - 0.02, outside: false });
	const inside = 24;
	for (let i = 0; i <= inside; i++) {
		const t = i / inside;
		pts.push({
			r: outer(t) - thick(t) - 0.03 * gauss(t, 0.13, 0.03),
			y: LIP + 2.35 * t,
			outside: false
		});
	}
	for (let i = 1; i <= crown; i++) {
		const f = (i / crown) * (Math.PI / 2);
		const r0 = outer(1) - thick(1);
		pts.push({ r: r0 * Math.cos(f), y: LIP + 2.35 + 0.05 * Math.sin(f), outside: false });
	}
	return pts;
}

// ---------------------------------------------------------------- painting

/** A hash of integer cells to 0..1, for noise with no state. */
function hash(x: number, y: number, seed: number): number {
	let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Value noise; `wrap` makes x tile every that many cells (round the bell). */
function noise(x: number, y: number, seed: number, wrap = 0): number {
	const [x0, y0] = [Math.floor(x), Math.floor(y)];
	const [tx, ty] = [x - x0, y - y0].map((t) => t * t * (3 - 2 * t));
	const w = (i: number) => (wrap ? ((i % wrap) + wrap) % wrap : i);
	const at = (i: number, j: number) => hash(w(i), j, seed);
	const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
	return top * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
}
function fbm(x: number, y: number, seed: number, wrap = 0): number {
	let [sum, amp, total] = [0, 1, 0];
	for (let o = 0; o < 4; o++) {
		sum += noise(x, y, seed + o, wrap) * amp;
		total += amp;
		[x, y, wrap, amp] = [x * 2, y * 2, wrap * 2, amp * 0.5];
	}
	return sum / total;
}
const smooth = (a: number, b: number, x: number) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

const BRONZE = hex('#7c5936');
const WORN = hex('#b48a55');
const PATINA = hex('#566050');
const CRUST = hex('#3f4744');
const CRACK = hex('#2c2830');
const TIMBER = ['#2f2629', '#4a3830', '#65503e', '#7e6649'].map(hex);
const IRONS = hex('#34343d');
const RUST = hex('#6a4533');

/** Heights down the bell's outside (0 crown to 1 lip) to the lip-to-shoulder `t` of `outer`. */
const OUTSIDE = (() => {
	const pts = profile().filter((p) => p.outside);
	const arc = [0];
	for (let j = 1; j < pts.length; j++)
		arc.push(arc[j - 1] + Math.hypot(pts[j].r - pts[j - 1].r, pts[j].y - pts[j - 1].y));
	return (v: number) => {
		const j = Math.max(
			1,
			arc.findIndex((a) => a >= v * arc.at(-1)!)
		);
		return (pts[j].y - LIP) / (CROWN - LIP);
	};
})();

/** Where the crack runs: its distance round the bell (0..1) at `t`, or null above it. */
const crackAt = (t: number) =>
	t > 0.34 ? null : 0.262 + 0.006 * Math.sin(t * 40) + 0.008 * (noise(t * 30, 0, 91) - 0.5);

/** A glyph's dot: letters of 4×6 dots, random, in the band around `t`. */
function lettering(s: number, t: number): number {
	for (const c of BANDS.slice(1)) {
		const row = (t - c - 0.035) / 0.03;
		if (row < 0 || row >= 1) continue;
		const col = s * 96;
		const [cell, x, y] = [Math.floor(col), Math.floor((col % 1) * 5), Math.floor(row * 7)];
		if (x === 4 || y === 6 || hash(cell, 0, 7) < 0.15) return 0;
		return hash(cell * 31 + x, y, Math.round(c * 100)) < 0.45 ? 1 : 0;
	}
	return 0;
}

type Texel = { albedo: number[]; height: number; ao: number; rough: number; metal: number };

function bellTexel(s: number, v: number): Texel {
	const t = OUTSIDE(v);
	const cast = fbm(s * 24, v * 32, 3, 24);
	const bands = BANDS.reduce((m, c) => Math.max(m, gauss(t, c, 0.02)), 0);
	const under = BANDS.reduce((m, c) => Math.max(m, gauss(t, c - 0.035, 0.02)), 0);
	const letter = lettering(s, t) * (fbm(s * 60, v * 60, 5, 60) > 0.35 ? 1 : 0.4);
	// Patina runs down in streaks from the shoulder and from under each band.
	const streak = fbm(s * 40, v * 3, 11, 40);
	const recess = Math.max(under, smooth(0.8, 1.02, t) * 0.8, letter ? 0 : bands * 0.2);
	const patina = Math.min(1, smooth(0.45, 0.75, streak) * 0.8 + recess * 0.7 + (cast - 0.5) * 0.4);
	const worn = Math.max(smooth(0.05, 0.0, t) * 0.9, bands * 0.8, letter * 0.9) * (1 - patina * 0.5);
	const crack = crackAt(t);
	const inCrack = crack === null ? 0 : smooth(0.0022, 0.0008, Math.abs(s - crack));
	let albedo = mix(BRONZE, WORN, worn);
	albedo = mix(albedo, mix(PATINA, CRUST, recess), patina * (1 - worn * 0.7));
	albedo = mix(albedo, CRACK, inCrack);
	return {
		albedo: albedo.map((c) => c * (0.92 + cast * 0.16)),
		height: cast * 0.08 + letter * 0.9 + patina * 0.15 - inCrack * 1.2,
		ao: 1 - recess * 0.3 - inCrack * 0.5,
		rough: 0.42 - worn * 0.12 + patina * 0.4,
		metal: 1 - smooth(0.4, 0.8, patina * (1 - worn))
	};
}

function woodTexel(s: number, v: number): Texel {
	const grain = fbm(s * 10 + fbm(s * 3, v * 2, 21) * 3, v * 1.5, 23);
	const rings = Math.abs(Math.sin(grain * 30));
	const lum = Math.min(0.999, grain * 0.8 + rings * 0.25);
	const k = lum * (TIMBER.length - 1);
	return {
		albedo: mix(TIMBER[Math.floor(k)], TIMBER[Math.floor(k) + 1], k % 1),
		height: rings * 0.5 + fbm(s * 30, v * 4, 25) * 0.2,
		ao: 0.85 + rings * 0.15,
		rough: 0.82,
		metal: 0
	};
}

function ironTexel(s: number, v: number, inner: boolean): Texel {
	const dents = fbm(s * 12, v * 12, 31);
	const rust = smooth(0.55, 0.75, fbm(s * 8, v * 8, 33));
	if (inner) {
		const p = smooth(0.5, 0.8, fbm(s * 12, v * 12, 35));
		return {
			albedo: mix(mix(BRONZE, CRUST, 0.35), PATINA, p * 0.6).map((c) => c * (0.9 + dents * 0.2)),
			height: dents * 0.3,
			ao: 0.7,
			rough: 0.55 + p * 0.3,
			metal: 1 - p
		};
	}
	return {
		albedo: mix(IRONS, RUST, rust).map((c) => c * (0.88 + dents * 0.24)),
		height: dents * 0.25 + rust * 0.1,
		ao: 0.95,
		rough: 0.62 + rust * 0.25,
		metal: 1 - rust
	};
}

export function paint() {
	const texels: Texel[] = [];
	const region = new Uint8Array(SIZE * SIZE);
	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			const r = REGIONS.findIndex((g) => x >= g.x && x < g.x + g.w && y >= g.y && y < g.y + g.h);
			const g = REGIONS[r];
			const [s, v] = [
				(x - g.x - EDGE + 0.5) / (g.w - 2 * EDGE),
				(y - g.y - EDGE + 0.5) / (g.h - 2 * EDGE)
			];
			region[y * SIZE + x] = r;
			texels.push(
				g === BELL ? bellTexel(s, v) : g === WOOD ? woodTexel(s, v) : ironTexel(s, v, g === INNER)
			);
		}
	}
	const albedo = new Uint8Array(SIZE * SIZE * 4);
	const orm = new Uint8Array(SIZE * SIZE * 4);
	const normal = new Uint8Array(SIZE * SIZE * 4);
	const byte = (x: number) => Math.round(Math.min(255, Math.max(0, x)));
	// Heights to tangent-space normals (OpenGL, +y up the image), Sobel within each region; the
	// bell's outside wraps round.
	const h = (x: number, y: number, r: number) => {
		const g = REGIONS[r];
		if (r === 0) x = ((x % g.w) + g.w) % g.w;
		const [cx, cy] = [
			Math.min(g.x + g.w - 1, Math.max(g.x, x)),
			Math.min(g.y + g.h - 1, Math.max(g.y, y))
		];
		return texels[cy * SIZE + cx].height;
	};
	const relief = 1.6 * K;
	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			const i = y * SIZE + x;
			const t = texels[i];
			const r = region[i];
			albedo.set([...t.albedo.map((c) => byte(Math.min(240, Math.max(30, c)))), 255], i * 4);
			orm.set([byte(t.ao * 255), byte(t.rough * 255), byte(t.metal * 255), 255], i * 4);
			const dx =
				h(x + 1, y - 1, r) +
				2 * h(x + 1, y, r) +
				h(x + 1, y + 1, r) -
				(h(x - 1, y - 1, r) + 2 * h(x - 1, y, r) + h(x - 1, y + 1, r));
			const dy =
				h(x - 1, y + 1, r) +
				2 * h(x, y + 1, r) +
				h(x + 1, y + 1, r) -
				(h(x - 1, y - 1, r) + 2 * h(x, y - 1, r) + h(x + 1, y - 1, r));
			const [nx, ny, nz] = [-dx * relief, dy * relief, 1];
			const len = Math.hypot(nx, ny, nz);
			normal.set([nx, ny, nz].map((n) => byte(((n / len) * 0.5 + 0.5) * 255)).concat(255), i * 4);
		}
	}
	// The rim's faint cold glow: the bell's lip, outside, at a quarter the size.
	const glow = new Uint8Array(GLOW * GLOW * 4);
	const scale = SIZE / GLOW;
	for (let y = 0; y < GLOW; y++) {
		for (let x = 0; x < GLOW; x++) {
			const v = (y * scale + scale / 2 - EDGE) / (BELL.h - 2 * EDGE);
			const k = x * scale < BELL.w ? smooth(0.965, 0.995, v) : 0;
			glow.set([byte(80 * k), byte(130 * k), byte(220 * k), 255], (y * GLOW + x) * 4);
		}
	}
	return { albedo, orm, normal, glow };
}
