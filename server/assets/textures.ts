// Textures made from recipes: small, seamlessly tiling images (earth,
// flagstones, planks, rock) generated from a seed, so the same source
// always builds the same PNG. An author can also provide a PNG instead.

export const RECIPES = ['noise', 'flagstones', 'planks'] as const;
export type Recipe = (typeof RECIPES)[number];

export interface TextureSource {
	recipe: Recipe;
	/** Width and height in pixels: a power of two, 16 to 512. */
	size: number;
	/** `#rrggbb`: the base colours; flagstones and planks take a third for the joints. */
	colors: string[];
	seed: number;
	/** How many noise cells across the image (coarser for fewer). */
	scale?: number;
}

const COLOR = /^#[0-9a-f]{6}$/;
const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

export function readTextureSource(raw: unknown): TextureSource {
	if (!isRecord(raw)) throw new Error('not an object');
	const recipe = RECIPES.find((r) => r === raw.recipe);
	if (!recipe) throw new Error(`recipe must be one of ${RECIPES.join(', ')}`);
	const size = raw.size;
	if (typeof size !== 'number' || size < 16 || size > 512 || (size & (size - 1)) !== 0) {
		throw new Error('size must be a power of two from 16 to 512');
	}
	const colors = raw.colors;
	const needed = recipe === 'noise' ? 2 : 3;
	if (
		!Array.isArray(colors) ||
		colors.length !== needed ||
		!colors.every((c) => typeof c === 'string' && COLOR.test(c))
	) {
		throw new Error(`needs ${needed} colours`);
	}
	if (typeof raw.seed !== 'number' || !Number.isInteger(raw.seed))
		throw new Error('needs an integer seed');
	const scale = raw.scale ?? 8;
	if (typeof scale !== 'number' || scale < 1 || scale > 64 || !Number.isInteger(scale)) {
		throw new Error('scale must be 1 to 64');
	}
	return { recipe, size, colors: colors as string[], seed: raw.seed, scale };
}

function rgb(hex: string): [number, number, number] {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A small seeded random source (mulberry32). */
function random(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Tiling value noise in 0..1: `cells` random values across, smoothly interpolated, wrapping. */
function noise(size: number, cells: number, rand: () => number): Float32Array {
	const grid = Float32Array.from({ length: cells * cells }, rand);
	const out = new Float32Array(size * size);
	const smooth = (t: number) => t * t * (3 - 2 * t);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const gx = (x / size) * cells;
			const gy = (y / size) * cells;
			const x0 = Math.floor(gx);
			const y0 = Math.floor(gy);
			const tx = smooth(gx - x0);
			const ty = smooth(gy - y0);
			const at = (i: number, j: number) => grid[(j % cells) * cells + (i % cells)];
			const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
			const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
			out[y * size + x] = top * (1 - ty) + bottom * ty;
		}
	}
	return out;
}

/** Two octaves of noise, for surfaces that aren't flat colour. */
function grain(size: number, scale: number, rand: () => number): Float32Array {
	const coarse = noise(size, scale, rand);
	const fine = noise(size, scale * 4, rand);
	return coarse.map((v, i) => v * 0.7 + fine[i] * 0.3);
}

/** The RGBA pixels of a texture source. */
export function renderTexture(source: TextureSource): Uint8Array {
	const { size, recipe } = source;
	const rand = random(source.seed);
	const [a, b, joint] = source.colors.map(rgb);
	const out = new Uint8Array(size * size * 4);
	const put = (i: number, c: readonly number[], shade = 1) => {
		out[i * 4] = Math.round(Math.min(255, c[0] * shade));
		out[i * 4 + 1] = Math.round(Math.min(255, c[1] * shade));
		out[i * 4 + 2] = Math.round(Math.min(255, c[2] * shade));
		out[i * 4 + 3] = 255;
	};
	const mix = (t: number) => [0, 1, 2].map((k) => a[k] * (1 - t) + b[k] * t);
	const g = grain(size, source.scale ?? 8, rand);
	if (recipe === 'noise') {
		for (let i = 0; i < size * size; i++) put(i, mix(g[i]));
		return out;
	}
	if (recipe === 'planks') {
		// Boards running along y, each its own shade, with a dark gap between.
		const boards = 4;
		const width = size / boards;
		const tone = Array.from({ length: boards }, () => 0.85 + rand() * 0.3);
		const lines = noise(size, 16, rand);
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				const i = y * size + x;
				const board = Math.floor(x / width);
				if (x % width < 2) put(i, joint);
				else
					put(i, mix(lines[((y * 7) % size) * size + (x % size)] * 0.6 + g[i] * 0.4), tone[board]);
			}
		}
		return out;
	}
	// Flagstones: irregular stones on a staggered grid, mortar between, each stone its own shade.
	const rows = 4;
	const h = size / rows;
	const w = size / 3;
	const shades = Array.from({ length: rows * 4 }, () => 0.8 + rand() * 0.35);
	for (let y = 0; y < size; y++) {
		const row = Math.floor(y / h);
		const offset = row % 2 ? w / 2 : 0;
		for (let x = 0; x < size; x++) {
			const i = y * size + x;
			const sx = (x + offset) % size;
			const col = Math.floor(sx / w);
			const edge = Math.min(sx % w, w - (sx % w), y % h, h - (y % h));
			// The mortar line wanders a little with the grain.
			if (edge < 1.5 + g[i] * 2) put(i, joint);
			else put(i, mix(g[i]), shades[row * 4 + col]);
		}
	}
	return out;
}
