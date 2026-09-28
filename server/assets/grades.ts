// Colour grades (milestone 63, #162): each environment's look per ambient band,
// as 32³ lookup tables on the tone-mapped (display) colour. A grade is a few
// numbers, not a picture: assets/grades/<environment>.json gives a band's
// contrast, lift, gamma, gain, saturation and split toning, with adjustments
// for each tone mapper it is rendered after (a grade is tied to the curve it
// follows, #158), and the pipeline renders each band for each tone mapper into
// a 1024×32 strip: 32 slices of 32×32 side by side, blue choosing the slice,
// red across and green down, the layout three's LUTImageLoader reads. Every
// strip maps black to exactly black, so unexplored cells stay black (#161).

import { TONE_MAPPERS, type ToneMapper } from '../../src/lib/assets/manifest';

export const LUT_SIZE = 32;
export const BANDS = ['day', 'dusk', 'dark'] as const;
export type Band = (typeof BANDS)[number];

type RGB = [number, number, number];

/** One band's grade. Neutral values leave every colour as it is. */
export interface Grade {
	/** Contrast round `pivot` (1: none), a curve that keeps 0 and 1 where they are. */
	contrast: number;
	pivot: number;
	/** A toe that lifts the darks per channel without moving black (0: none). */
	lift: RGB;
	/** Per channel: above 1 brightens the mids. */
	gamma: RGB;
	/** Per channel multipliers. */
	gain: RGB;
	/** 1: as is; 0: grey. */
	saturation: number;
	/** Multipliers toward which the darks and the lights are tinted (1, 1, 1: none). */
	shadows: RGB;
	highlights: RGB;
}

export const NEUTRAL: Grade = {
	contrast: 1,
	pivot: 0.45,
	lift: [0, 0, 0],
	gamma: [1, 1, 1],
	gain: [1, 1, 1],
	saturation: 1,
	shadows: [1, 1, 1],
	highlights: [1, 1, 1]
};

/**
 * How a grade changes for the curve it follows, before any change the file makes: AgX
 * desaturates and flattens, so its grades get saturation and contrast back (#158); Neutral runs
 * warm and saturated, so a touch less saturation.
 */
const AFTER: Record<ToneMapper, (g: Grade) => Partial<Grade>> = {
	aces: () => ({}),
	agx: (g) => ({ saturation: g.saturation + 0.15, contrast: g.contrast + 0.08 }),
	neutral: (g) => ({ saturation: g.saturation - 0.05 })
};

/** A band's grade as written: the grade, and changes to it after AgX or Neutral. */
export type GradeSource = Partial<Grade> & Partial<Record<ToneMapper, Partial<Grade>>>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const inRange = (v: unknown, min: number, max: number): v is number =>
	typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** Checks a grade's fields (any may be left out), with the ranges a sane grade stays in. */
function readGradeFields(raw: Record<string, unknown>, where: string): Partial<Grade> {
	const out: Partial<Grade> = {};
	const scalar = (key: 'contrast' | 'pivot' | 'saturation', min: number, max: number) => {
		if (!(key in raw)) return;
		if (!inRange(raw[key], min, max)) throw new Error(`${where}.${key}: ${min} to ${max}`);
		out[key] = raw[key] as number;
	};
	const rgb = (
		key: 'lift' | 'gamma' | 'gain' | 'shadows' | 'highlights',
		min: number,
		max: number
	) => {
		if (!(key in raw)) return;
		const v = raw[key];
		if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => inRange(n, min, max))) {
			throw new Error(`${where}.${key}: three numbers from ${min} to ${max}`);
		}
		out[key] = v as RGB;
	};
	scalar('contrast', 0.5, 2);
	scalar('pivot', 0.1, 0.9);
	scalar('saturation', 0, 2);
	rgb('lift', 0, 0.5);
	rgb('gamma', 0.5, 2);
	rgb('gain', 0.5, 1.5);
	rgb('shadows', 0.5, 1.5);
	rgb('highlights', 0.5, 1.5);
	return out;
}

/** An environment's grades file: `{ day, dusk, dark }`, each a grade and its tone-mapper changes. */
export function readGrades(raw: unknown): Record<Band, Record<ToneMapper, Grade>> {
	if (!isRecord(raw)) throw new Error('a grades file is an object of day, dusk and dark');
	const unknown = Object.keys(raw).filter((k) => !BANDS.includes(k as Band));
	if (unknown.length) throw new Error(`unknown band ${unknown[0]}`);
	const out = {} as Record<Band, Record<ToneMapper, Grade>>;
	for (const band of BANDS) {
		const source = raw[band];
		if (!isRecord(source)) throw new Error(`${band}: missing`);
		const base = { ...NEUTRAL, ...readGradeFields(source, band) };
		out[band] = {} as Record<ToneMapper, Grade>;
		for (const tm of TONE_MAPPERS) {
			const changes = source[tm];
			if (changes !== undefined && !isRecord(changes)) throw new Error(`${band}.${tm}: an object`);
			const adjusted = { ...base, ...AFTER[tm](base) };
			out[band][tm] = { ...adjusted, ...readGradeFields(changes ?? {}, `${band}.${tm}`) };
		}
	}
	return out;
}

/** The contrast curve: a power either side of the pivot, so 0 and 1 stay put. */
function contrastCurve(c: number, contrast: number, pivot: number): number {
	if (c <= pivot) return pivot * Math.pow(c / pivot, contrast);
	return 1 - (1 - pivot) * Math.pow((1 - c) / (1 - pivot), contrast);
}

/** A display colour (0-1 per channel) through a grade. Black stays black. */
export function gradeColor(input: RGB, g: Grade): RGB {
	let c = input.map((v, i) => {
		let x = contrastCurve(v, g.contrast, g.pivot);
		// The toe: zero at 0 and at 1, largest a third of the way up.
		x += g.lift[i] * x * (1 - x) * (1 - x) * 4;
		x = Math.pow(Math.max(x, 0), 1 / g.gamma[i]);
		return x * g.gain[i];
	}) as RGB;
	const luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
	c = c.map((v) => luma + (v - luma) * g.saturation) as RGB;
	// Split toning, by multiplying, weighted toward the darks or the lights.
	const l = Math.min(Math.max(luma, 0), 1);
	const [ws, wh] = [(1 - l) * (1 - l), l * l];
	c = c.map((v, i) => v * (1 + (g.shadows[i] - 1) * ws) * (1 + (g.highlights[i] - 1) * wh)) as RGB;
	return c.map((v) => Math.min(Math.max(v, 0), 1)) as RGB;
}

/** A grade as a 1024×32 RGBA strip (see the top of this file for the layout). */
export function renderGrade(g: Grade): Uint8Array {
	const n = LUT_SIZE;
	const width = n * n;
	const out = new Uint8Array(width * n * 4);
	for (let b = 0; b < n; b++) {
		for (let gr = 0; gr < n; gr++) {
			for (let r = 0; r < n; r++) {
				const c = gradeColor([r / (n - 1), gr / (n - 1), b / (n - 1)], g);
				const o = (gr * width + b * n + r) * 4;
				for (let i = 0; i < 3; i++) out[o + i] = Math.round(c[i] * 255);
				out[o + 3] = 255;
			}
		}
	}
	return out;
}

/** What is wrong with a rendered strip, or null: black must stay exactly black. */
export function stripProblem(strip: Uint8Array): string | null {
	if (strip.length !== LUT_SIZE * LUT_SIZE * LUT_SIZE * 4) return 'not a 1024×32 strip';
	if (strip[0] !== 0 || strip[1] !== 0 || strip[2] !== 0) return 'black does not stay black';
	return null;
}
