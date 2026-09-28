// A structural-similarity comparator for golden images (#168): mean SSIM over
// luminance in 8×8 windows. TRAA, GTAO's rotating samples and depth of field's
// bokeh differ a little between runs and drivers, which a per-pixel threshold
// either flags as noise or is loosened until it misses real changes; SSIM
// scores structure, so a moved edge or a darkened crease still fails. Plain
// TypeScript, no dependency; it runs in Node, registered in vite.config.ts.

/** The comparator's options: the lowest mean SSIM that passes. */
export interface SsimOptions extends Record<string, unknown> {
	minScore?: number;
}

declare module '@vitest/browser/context' {
	interface ScreenshotComparatorRegistry {
		ssim: SsimOptions;
	}
}

const WINDOW = 8;
// The usual stabilisers for 8-bit values: (0.01 × 255)² and (0.03 × 255)².
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

type Pixels = ArrayLike<number>;

/** Rec. 709 luma of every pixel of RGBA bytes. */
function luma(data: Pixels, count: number): Float32Array {
	const out = new Float32Array(count);
	for (let i = 0; i < count; i++)
		out[i] = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
	return out;
}

/**
 * SSIM of two same-sized RGBA images: the mean over non-overlapping 8×8 windows (a partial
 * window at the right or bottom edge counts as it is), and each window's score, row by row.
 */
export function ssim(
	a: Pixels,
	b: Pixels,
	width: number,
	height: number
): { score: number; windows: Float32Array; columns: number } {
	const la = luma(a, width * height);
	const lb = luma(b, width * height);
	const columns = Math.ceil(width / WINDOW);
	const rows = Math.ceil(height / WINDOW);
	const windows = new Float32Array(columns * rows);
	let total = 0;
	for (let wy = 0; wy < rows; wy++)
		for (let wx = 0; wx < columns; wx++) {
			let sa = 0;
			let sb = 0;
			let saa = 0;
			let sbb = 0;
			let sab = 0;
			let n = 0;
			for (let y = wy * WINDOW; y < Math.min(height, (wy + 1) * WINDOW); y++)
				for (let x = wx * WINDOW; x < Math.min(width, (wx + 1) * WINDOW); x++) {
					const pa = la[y * width + x];
					const pb = lb[y * width + x];
					sa += pa;
					sb += pb;
					saa += pa * pa;
					sbb += pb * pb;
					sab += pa * pb;
					n++;
				}
			const ma = sa / n;
			const mb = sb / n;
			const va = saa / n - ma * ma;
			const vb = sbb / n - mb * mb;
			const cov = sab / n - ma * mb;
			const s = ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
			windows[wy * columns + wx] = s;
			total += s;
		}
	return { score: total / windows.length, windows, columns };
}

interface Image {
	metadata: { width: number; height: number };
	data: Pixels;
}

/**
 * The `ssim` comparator: passes at a mean of `minScore` (0.98 by default) or more. Its diff is
 * each window's 1 − SSIM in red over the actual image dimmed, so a CI artifact shows where the
 * structure changed.
 */
export function ssimComparator(
	reference: Image,
	actual: Image,
	{ createDiff, minScore = 0.98 }: { createDiff: boolean } & SsimOptions
): { pass: boolean; diff: Uint8Array | null; message: string | null } {
	const { width, height } = reference.metadata;
	if (actual.metadata.width !== width || actual.metadata.height !== height) {
		return {
			pass: false,
			diff: null,
			message: `Size ${actual.metadata.width}×${actual.metadata.height}, expected ${width}×${height}.`
		};
	}
	const { score, windows, columns } = ssim(reference.data, actual.data, width, height);
	const pass = score >= minScore;
	let diff: Uint8Array | null = null;
	if (!pass && createDiff) {
		diff = new Uint8Array(width * height * 4);
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++) {
				const i = (y * width + x) * 4;
				const loss = 1 - windows[Math.floor(y / WINDOW) * columns + Math.floor(x / WINDOW)];
				const grey = Math.round(
					0.3 *
						(0.2126 * actual.data[i] + 0.7152 * actual.data[i + 1] + 0.0722 * actual.data[i + 2])
				);
				diff[i] = Math.min(255, grey + Math.round(Math.min(1, loss * 4) * 255));
				diff[i + 1] = diff[i + 2] = grey;
				diff[i + 3] = 255;
			}
	}
	return {
		pass,
		diff,
		message: pass ? null : `Mean SSIM ${score.toFixed(4)}, below ${minScore}.`
	};
}
