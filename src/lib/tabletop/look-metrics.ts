// Look metrics (milestone 61): numbers that say how close a render is to a
// reference shot, so "closer to TaleSpire" is measured rather than argued.
// Pure maths on RGBA pixels: both images are centre-cropped to 16:10 and
// downsampled to 480x300, converted to Oklab, and summarised as luminance
// percentiles, the hue and chroma of shadows and highlights, saturation,
// local contrast, vignette falloff, a bloom proxy and the sky's colour.
// `distance` weighs the differences. See docs/LOOK.md.

export const LOOK_WIDTH = 480;
export const LOOK_HEIGHT = 300;

export interface LCh {
	/** Oklab lightness, 0 to 1. */
	L: number;
	/** Chroma. */
	C: number;
	/** Hue in degrees, 0 to 360. */
	h: number;
}

export interface LookMetrics {
	L: { p5: number; p50: number; p95: number };
	shadows: { h: number; C: number };
	highlights: { h: number; C: number };
	/** Mean chroma. */
	chroma: number;
	/** Standard deviation of L minus its 9x9 box blur. */
	localContrast: number;
	/** Mean L of the outer 10% ring over the mean L of the central quarter. */
	vignette: number;
	/** Fraction of pixels with any channel at 95% or more. */
	bloom: number;
	/** The top 4% of rows. */
	zenith: LCh;
	/** A band of rows given per pairing (fractions of the height from the top). */
	horizon: LCh;
}

export interface Image {
	data: Uint8Array | Uint8ClampedArray;
	width: number;
	height: number;
}

/** The weight of each metric in `distance` (versioned with the JSON in docs/look-metrics.json). */
export const WEIGHTS = {
	L: 3,
	shadowsHue: 1,
	shadowsChroma: 2,
	highlightsHue: 1,
	highlightsChroma: 2,
	chroma: 2,
	localContrast: 2,
	vignette: 1,
	bloom: 1,
	zenith: 1,
	horizon: 1
};
export const WEIGHTS_VERSION = 1;

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** sRGB (0-1) to Oklab. */
export function oklab(r: number, g: number, b: number): [number, number, number] {
	const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
	const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
	const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
	const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	];
}

/** Centre-crops to 16:10 and box-downsamples to LOOK_WIDTH x LOOK_HEIGHT; top row first. */
export function normalise(img: Image, bottomUp = false): Image {
	const aspect = LOOK_WIDTH / LOOK_HEIGHT;
	let cw = img.width;
	let ch = Math.round(cw / aspect);
	if (ch > img.height) {
		ch = img.height;
		cw = Math.round(ch * aspect);
	}
	const x0 = Math.floor((img.width - cw) / 2);
	const y0 = Math.floor((img.height - ch) / 2);
	const out = new Uint8ClampedArray(LOOK_WIDTH * LOOK_HEIGHT * 4);
	for (let y = 0; y < LOOK_HEIGHT; y++) {
		const sy0 = y0 + Math.floor((y * ch) / LOOK_HEIGHT);
		const sy1 = Math.max(sy0 + 1, y0 + Math.floor(((y + 1) * ch) / LOOK_HEIGHT));
		for (let x = 0; x < LOOK_WIDTH; x++) {
			const sx0 = x0 + Math.floor((x * cw) / LOOK_WIDTH);
			const sx1 = Math.max(sx0 + 1, x0 + Math.floor(((x + 1) * cw) / LOOK_WIDTH));
			const sum = [0, 0, 0, 0];
			for (let sy = sy0; sy < sy1; sy++) {
				const row = bottomUp ? img.height - 1 - sy : sy;
				for (let sx = sx0; sx < sx1; sx++) {
					const i = (row * img.width + sx) * 4;
					for (let c = 0; c < 4; c++) sum[c] += img.data[i + c];
				}
			}
			const n = (sy1 - sy0) * (sx1 - sx0);
			const o = (y * LOOK_WIDTH + x) * 4;
			for (let c = 0; c < 4; c++) out[o + c] = sum[c] / n;
		}
	}
	return { data: out, width: LOOK_WIDTH, height: LOOK_HEIGHT };
}

const percentile = (sorted: Float32Array, p: number) =>
	sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

const deg = (rad: number) => ((rad * 180) / Math.PI + 360) % 360;

/** Chroma-weighted mean hue and mean chroma of the pixels `pick` selects. */
function hueOf(
	a: Float32Array,
	b: Float32Array,
	pick: (i: number) => boolean
): { h: number; C: number } {
	let sa = 0;
	let sb = 0;
	let c = 0;
	let n = 0;
	for (let i = 0; i < a.length; i++) {
		if (!pick(i)) continue;
		sa += a[i];
		sb += b[i];
		c += Math.hypot(a[i], b[i]);
		n++;
	}
	return n ? { h: deg(Math.atan2(sb, sa)), C: c / n } : { h: 0, C: 0 };
}

function lchOf(
	L: Float32Array,
	a: Float32Array,
	b: Float32Array,
	pick: (i: number) => boolean
): LCh {
	let sl = 0;
	let n = 0;
	for (let i = 0; i < L.length; i++) {
		if (!pick(i)) continue;
		sl += L[i];
		n++;
	}
	const { h, C } = hueOf(a, b, pick);
	return { L: n ? sl / n : 0, C, h };
}

/** The metrics of an image (normalised first unless it already is). */
export function lookMetrics(
	image: Image,
	horizon: [number, number] = [0.3, 0.4],
	bottomUp = false
): LookMetrics {
	const img =
		image.width === LOOK_WIDTH && image.height === LOOK_HEIGHT && !bottomUp
			? image
			: normalise(image, bottomUp);
	const size = LOOK_WIDTH * LOOK_HEIGHT;
	const L = new Float32Array(size);
	const A = new Float32Array(size);
	const B = new Float32Array(size);
	let bright = 0;
	for (let i = 0; i < size; i++) {
		const [r, g, b] = [img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]];
		[L[i], A[i], B[i]] = oklab(r / 255, g / 255, b / 255);
		if (Math.max(r, g, b) >= 242) bright++;
	}
	const sorted = Float32Array.from(L).sort();
	const p25 = percentile(sorted, 0.25);
	const p75 = percentile(sorted, 0.75);

	let chroma = 0;
	for (let i = 0; i < size; i++) chroma += Math.hypot(A[i], B[i]);

	// Local contrast: L against its 9x9 box mean, through a summed-area table.
	const W = LOOK_WIDTH;
	const H = LOOK_HEIGHT;
	const sat = new Float64Array((W + 1) * (H + 1));
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			sat[(y + 1) * (W + 1) + x + 1] =
				L[y * W + x] + sat[y * (W + 1) + x + 1] + sat[(y + 1) * (W + 1) + x] - sat[y * (W + 1) + x];
		}
	}
	let sq = 0;
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const [x0, x1, y0, y1] = [
				Math.max(0, x - 4),
				Math.min(W, x + 5),
				Math.max(0, y - 4),
				Math.min(H, y + 5)
			];
			const sum =
				sat[y1 * (W + 1) + x1] -
				sat[y0 * (W + 1) + x1] -
				sat[y1 * (W + 1) + x0] +
				sat[y0 * (W + 1) + x0];
			const d = L[y * W + x] - sum / ((x1 - x0) * (y1 - y0));
			sq += d * d;
		}
	}

	// Vignette: the outer 10% ring against the central quarter.
	const ring = (i: number) => {
		const x = i % W;
		const y = Math.floor(i / W);
		return x < W * 0.1 || x >= W * 0.9 || y < H * 0.1 || y >= H * 0.9;
	};
	const centre = (i: number) => {
		const x = i % W;
		const y = Math.floor(i / W);
		return x >= W * 0.25 && x < W * 0.75 && y >= H * 0.25 && y < H * 0.75;
	};
	const meanL = (pick: (i: number) => boolean) => {
		let s = 0;
		let n = 0;
		for (let i = 0; i < size; i++) {
			if (!pick(i)) continue;
			s += L[i];
			n++;
		}
		return n ? s / n : 0;
	};
	const row = (i: number) => Math.floor(i / W) / H;

	return {
		L: {
			p5: percentile(sorted, 0.05),
			p50: percentile(sorted, 0.5),
			p95: percentile(sorted, 0.95)
		},
		shadows: hueOf(A, B, (i) => L[i] <= p25),
		highlights: hueOf(A, B, (i) => L[i] >= p75),
		chroma: chroma / size,
		localContrast: Math.sqrt(sq / size),
		vignette: meanL(ring) / Math.max(1e-6, meanL(centre)),
		bloom: bright / size,
		zenith: lchOf(L, A, B, (i) => row(i) < 0.04),
		horizon: lchOf(L, A, B, (i) => row(i) >= horizon[0] && row(i) < horizon[1])
	};
}

/** Angular difference of two hues, 0 to 1 (180° apart is 1). */
const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180) / 180;

/**
 * How far a render is from a reference: a weighted sum of normalised
 * differences, hue gaps weighted by how colourful both sides are (the hue of
 * a grey means nothing). 0 is identical.
 */
export function distance(ours: LookMetrics, ref: LookMetrics, weights = WEIGHTS): number {
	const d = (a: number, b: number, scale: number) => Math.min(1, Math.abs(a - b) / scale);
	const hue = (x: { h: number; C: number }, y: { h: number; C: number }) =>
		hueGap(x.h, y.h) * Math.min(1, Math.min(x.C, y.C) / 0.05);
	const lch = (x: LCh, y: LCh) => (d(x.L, y.L, 0.5) + d(x.C, y.C, 0.15) + hue(x, y)) / 3;
	const parts = {
		L:
			(d(ours.L.p5, ref.L.p5, 0.5) +
				d(ours.L.p50, ref.L.p50, 0.5) +
				d(ours.L.p95, ref.L.p95, 0.5)) /
			3,
		shadowsHue: hue(ours.shadows, ref.shadows),
		shadowsChroma: d(ours.shadows.C, ref.shadows.C, 0.15),
		highlightsHue: hue(ours.highlights, ref.highlights),
		highlightsChroma: d(ours.highlights.C, ref.highlights.C, 0.15),
		chroma: d(ours.chroma, ref.chroma, 0.15),
		localContrast: d(ours.localContrast, ref.localContrast, 0.1),
		vignette: d(ours.vignette, ref.vignette, 1),
		bloom: d(ours.bloom, ref.bloom, 0.1),
		zenith: lch(ours.zenith, ref.zenith),
		horizon: lch(ours.horizon, ref.horizon)
	};
	let total = 0;
	let sum = 0;
	for (const [k, w] of Object.entries(weights) as [keyof typeof parts, number][]) {
		total += w * parts[k];
		sum += w;
	}
	return total / sum;
}
