// Colour-vision deficiency, for checking colours that carry meaning (#265's seat rings, the
// highlights, #278 and #285): Machado, Oliveira and Fernandes (2009)'s simulation of the three
// dichromacies at severity 1.0, on linear sRGB, and OKLab (Ottosson 2020) to measure how far apart
// two colours look. Pure, no three.js.

export type Deficiency = 'protanopia' | 'deuteranopia' | 'tritanopia';

/** Machado 2009, severity 1.0: rows of a 3×3 matrix on linear RGB. */
export const SIMULATIONS: Record<Deficiency, number[][]> = {
	protanopia: [
		[0.152286, 1.052583, -0.204868],
		[0.114503, 0.786281, 0.099216],
		[-0.003882, -0.048116, 1.051998]
	],
	deuteranopia: [
		[0.367322, 0.860646, -0.227968],
		[0.280085, 0.672501, 0.047413],
		[-0.01182, 0.04294, 0.968881]
	],
	tritanopia: [
		[1.255528, -0.076749, -0.178779],
		[-0.078411, 0.930809, 0.147602],
		[0.004733, 0.691367, 0.3039]
	]
};

/** A 0xrrggbb sRGB colour as linear RGB, 0-1. */
export const linear = (hex: number): number[] =>
	[16, 8, 0].map((s) => {
		const c = ((hex >> s) & 255) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});

const clamp = (v: number) => Math.min(Math.max(v, 0), 1);

/** Linear RGB as a dichromat sees it, clamped to the gamut as a screen would show it. */
export const simulate = (rgb: number[], kind: Deficiency): number[] =>
	SIMULATIONS[kind].map((row) => clamp(row.reduce((sum, k, i) => sum + k * rgb[i], 0)));

/** Linear sRGB to OKLab (L 0-1). */
export function oklab([r, g, b]: number[]): number[] {
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	];
}

/** How far apart two 0xrrggbb colours look in OKLab, as they are or under a deficiency. */
export function oklabDistance(a: number, b: number, kind: Deficiency | null = null): number {
	const [p, q] = [a, b].map((hex) => oklab(kind ? simulate(linear(hex), kind) : linear(hex)));
	return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Each 8-bit sRGB level in linear light. */
const LEVELS = Array.from({ length: 256 }, (_, c) => linear(c)[2]);
/** Linear 0-1 to an 8-bit sRGB level. */
const encode = (v: number) =>
	Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));

/** RGBA pixels (8-bit sRGB, a captured frame's) as a dichromat sees them; alpha kept. */
export function simulatePixels(
	rgba: ArrayLike<number>,
	kind: Deficiency
): Uint8ClampedArray<ArrayBuffer> {
	const out = new Uint8ClampedArray(rgba.length);
	for (let i = 0; i < rgba.length; i += 4) {
		const s = simulate([LEVELS[rgba[i]], LEVELS[rgba[i + 1]], LEVELS[rgba[i + 2]]], kind);
		[out[i], out[i + 1], out[i + 2], out[i + 3]] = [
			encode(s[0]),
			encode(s[1]),
			encode(s[2]),
			rgba[i + 3]
		];
	}
	return out;
}
