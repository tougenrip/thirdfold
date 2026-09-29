// The surface library's stylise step (#187, docs/ART.md section 11): a CC0 scan repainted so it
// reads as painted, not photographed. Luminance goes through the surface's ramp (its hue from the
// ramp, a little of the source's own at `detail`), softened and half posterised; cavities are
// darkened and cooled and edges lightened from a difference of box blurs of the height; values
// stay in 30-240; roughness in 0.5-0.9, cavities rougher; the normal is softened and its relief
// scaled by `normalBoost`. Deterministic: integer maths, and floats only through +, -, *, / and
// sqrt, which IEEE rounds the same everywhere, so the same source gives the same bytes on any
// machine. Everything wraps at the edges, so a tiling source still tiles.

/** An RGBA image, 8 bits a channel (decodePng's output). */
export interface Image {
	width: number;
	height: number;
	data: Uint8Array;
}

/** A source set: colour and height, with the normal, roughness and occlusion when it has them. */
export interface SurfaceSource {
	color: Image;
	height: Image;
	normal?: Image;
	roughness?: Image;
	ao?: Image;
}

export interface StyliseRecipe {
	/** 2-8 colours, dark to light (docs/ART.md "Surface ramps"). */
	ramp: string[];
	/** How much of the source's own hue survives, 0-1. */
	detail: number;
	/** The normal's relief, times. */
	normalBoost: number;
}

/** The three maps the shader kinds' slots take: albedo with height in alpha, normal, ORM. */
export interface Stylised {
	albedo: Image;
	normal: Image;
	orm: Image;
}

export const ALBEDO_RANGE = [30, 240] as const;
/** Roughness 0.5-0.9 as bytes. */
export const ROUGHNESS_RANGE = [128, 229] as const;

type Channel = Int32Array;

/** The colour's blur radius, in source texels. */
const SOFTEN = 2;

/** One channel of an image (grey sources are read from red). */
function channel(img: Image, c: number): Channel {
	const out = new Int32Array(img.width * img.height);
	for (let i = 0; i < out.length; i++) out[i] = img.data[i * 4 + c];
	return out;
}

/** A box blur of radius `r`, wrapping at the edges, rounded to integers. */
export function boxBlur(src: Channel, w: number, h: number, r: number): Channel {
	const n = 2 * r + 1;
	const pass = (
		from: Channel,
		len: number,
		lines: number,
		at: (line: number, i: number) => number
	) => {
		const out = new Int32Array(from.length);
		for (let line = 0; line < lines; line++) {
			let sum = 0;
			for (let i = -r; i <= r; i++) sum += from[at(line, (i + len) % len)];
			for (let i = 0; i < len; i++) {
				out[at(line, i)] = sum;
				sum += from[at(line, (i + r + 1) % len)] - from[at(line, (i - r + len) % len)];
			}
		}
		return out;
	};
	const across = pass(src, w, h, (y, x) => y * w + x);
	const down = pass(across, h, w, (x, y) => y * w + x);
	const area = n * n;
	for (let i = 0; i < down.length; i++) down[i] = Math.floor((down[i] + (area >> 1)) / area);
	return down;
}

/** The value below which `share` of `values` lie (of their magnitudes with `abs`). */
function percentile(values: Channel, share: number, abs = false): number {
	let [lo, hi] = [Infinity, -Infinity];
	for (const v of values) {
		const k = abs ? Math.abs(v) : v;
		if (k < lo) lo = k;
		if (k > hi) hi = k;
	}
	const counts = new Int32Array(hi - lo + 1);
	for (const v of values) counts[(abs ? Math.abs(v) : v) - lo]++;
	for (let k = 0, seen = 0; k < counts.length; k++) {
		seen += counts[k];
		if (seen >= values.length * share) return k + lo;
	}
	return hi;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** The ramp as a 256-entry lookup table of RGB, its colours spread evenly dark to light. */
export function rampTable(ramp: string[]): Uint8Array {
	if (ramp.length < 2 || ramp.length > 8 || !ramp.every((c) => /^#[0-9a-f]{6}$/i.test(c))) {
		throw new Error('a ramp is 2-8 colours as #rrggbb');
	}
	const rgb = ramp.map((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)));
	const out = new Uint8Array(256 * 3);
	const spans = ramp.length - 1;
	for (let t = 0; t < 256; t++) {
		const at = t * spans;
		const i = Math.min(Math.floor(at / 255), spans - 1);
		const f = at - i * 255; // 0-255 along the span
		for (let c = 0; c < 3; c++) {
			out[t * 3 + c] = Math.floor((rgb[i][c] * (255 - f) + rgb[i + 1][c] * f + 127) / 255);
		}
	}
	return out;
}

/** Stylises a source set (every map the colour's size). */
export function stylise(src: SurfaceSource, recipe: StyliseRecipe): Stylised {
	const { width: w, height: h } = src.color;
	for (const map of [src.height, src.normal, src.roughness, src.ao]) {
		if (map && (map.width !== w || map.height !== h)) throw new Error('maps of different sizes');
	}
	const size = w * h;
	const ramp = rampTable(recipe.ramp);
	const detail = Math.round(clamp(recipe.detail, 0, 1) * 256);
	// Softened first: the scan's grain is what reads as a photograph.
	const [r, g, b] = [0, 1, 2].map((c) => boxBlur(channel(src.color, c), w, h, SOFTEN));

	// Luminance, stretched over its 2nd-98th percentiles, then half posterised.
	const lum = new Int32Array(size);
	for (let i = 0; i < size; i++) lum[i] = (54 * r[i] + 183 * g[i] + 19 * b[i] + 128) >> 8;
	const lo = percentile(lum, 0.02);
	const hi = Math.max(lo + 1, percentile(lum, 0.98));
	const STEP = 51; // six levels

	// Cavities (negative) and edges (positive) from the height, -256 to 256.
	const height = channel(src.height, 0);
	const near = boxBlur(height, w, h, 2);
	const far = boxBlur(height, w, h, 12);
	const dog = new Int32Array(size);
	for (let i = 0; i < size; i++) dog[i] = near[i] - far[i];
	// At least a moderate relief: a flat surface (plaster) keeps its cavities faint.
	const spread = Math.max(16, percentile(dog, 0.98, true));

	const albedo = new Uint8Array(size * 4);
	const orm = new Uint8Array(size * 4);
	const rough = src.roughness ? channel(src.roughness, 0) : null;
	const ao = src.ao ? channel(src.ao, 0) : null;
	const [lowest, highest] = ALBEDO_RANGE;
	for (let i = 0; i < size; i++) {
		const t0 = clamp(Math.floor(((lum[i] - lo) * 255) / (hi - lo)), 0, 255);
		const t = (t0 + Math.round(t0 / STEP) * STEP) >> 1;
		const d = clamp(Math.trunc((dog[i] * 256) / spread), -256, 256);
		const cavity = d < 0 ? -d : 0;
		const edge = d > 0 ? d : 0;
		const own = [r[i], g[i], b[i]];
		for (let c = 0; c < 3; c++) {
			let v = ramp[t * 3 + c] * 256 + (own[c] - lum[i]) * detail; // ×256
			v = Math.trunc((v * (256 - ((cavity * 77) >> 8))) / 256); // up to 30% darker
			v += (c === 2 ? 6 : c === 0 ? -6 : 0) * cavity; // and cooler
			v += Math.trunc(((255 * 256 - v) * ((edge * 38) >> 8)) / 256); // up to 15% lighter
			albedo[i * 4 + c] = clamp(Math.round(v / 256), lowest, highest);
		}
		albedo[i * 4 + 3] = height[i];
		const [rmin, rmax] = ROUGHNESS_RANGE;
		const base = rmin + Math.floor(((rough ? rough[i] : 200) * (rmax - rmin)) / 255);
		orm[i * 4] = ao ? ao[i] - ((ao[i] * cavity) >> 10) : 255 - (cavity >> 2);
		orm[i * 4 + 1] = clamp(base + ((cavity * 26) >> 8), rmin, rmax);
		orm[i * 4 + 2] = 0;
		orm[i * 4 + 3] = 255;
	}
	return {
		albedo: { width: w, height: h, data: albedo },
		normal: { width: w, height: h, data: normals(src, recipe.normalBoost) },
		orm: { width: w, height: h, data: orm }
	};
}

/** The softened normal with its relief scaled, from the source's (OpenGL) or else from the height. */
function normals(src: SurfaceSource, boost: number): Uint8Array {
	const { width: w, height: h } = src.color;
	let x: Channel, y: Channel, z: Channel;
	if (src.normal) {
		[x, y, z] = [0, 1, 2].map((c) => boxBlur(channel(src.normal!, c), w, h, 1));
	} else {
		// A wrapping Sobel of the height.
		const hgt = channel(src.height, 0);
		const at = (px: number, py: number) => hgt[((py + h) % h) * w + ((px + w) % w)];
		[x, y, z] = [new Int32Array(w * h), new Int32Array(w * h), new Int32Array(w * h)];
		for (let py = 0; py < h; py++)
			for (let px = 0; px < w; px++) {
				const dx =
					at(px + 1, py - 1) +
					2 * at(px + 1, py) +
					at(px + 1, py + 1) -
					(at(px - 1, py - 1) + 2 * at(px - 1, py) + at(px - 1, py + 1));
				const dy =
					at(px - 1, py + 1) +
					2 * at(px, py + 1) +
					at(px + 1, py + 1) -
					(at(px - 1, py - 1) + 2 * at(px, py - 1) + at(px + 1, py - 1));
				const i = py * w + px;
				// Image rows run down; OpenGL's y runs up.
				[x[i], y[i], z[i]] = [128 - (dx >> 3), 128 + (dy >> 3), 255];
			}
	}
	const out = new Uint8Array(w * h * 4);
	for (let i = 0; i < w * h; i++) {
		const nx = ((x[i] - 127.5) / 127.5) * boost;
		const ny = ((y[i] - 127.5) / 127.5) * boost;
		const nz = Math.max((z[i] - 127.5) / 127.5, 0.05);
		const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
		out[i * 4] = Math.round((nx / len) * 127.5 + 127.5);
		out[i * 4 + 1] = Math.round((ny / len) * 127.5 + 127.5);
		out[i * 4 + 2] = Math.round((nz / len) * 127.5 + 127.5);
		out[i * 4 + 3] = 255;
	}
	return out;
}

/**
 * How badly an image's opposite edges meet, as a multiple of how much neighbouring columns and
 * rows differ inside it: about 1 for a tiling image, far more at a seam.
 */
export function seamError(img: Image): number {
	const { width: w, height: h, data } = img;
	const px = (x: number, y: number, c: number) => data[(y * w + x) * 4 + c];
	let seam = 0;
	let inside = 0;
	for (let c = 0; c < 3; c++) {
		for (let y = 0; y < h; y++) {
			seam += Math.abs(px(0, y, c) - px(w - 1, y, c));
			inside += Math.abs(px(w >> 1, y, c) - px((w >> 1) - 1, y, c));
		}
		for (let x = 0; x < w; x++) {
			seam += Math.abs(px(x, 0, c) - px(x, h - 1, c));
			inside += Math.abs(px(x, h >> 1, c) - px(x, (h >> 1) - 1, c));
		}
	}
	return seam / Math.max(inside, 1);
}
