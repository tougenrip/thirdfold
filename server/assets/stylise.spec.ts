import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	ALBEDO_RANGE,
	ROUGHNESS_RANGE,
	boxBlur,
	rampTable,
	seamError,
	stylise,
	type Image
} from './stylise';

const SIZE = 64;
const RAMP = ['#3b3f4a', '#5e6068', '#858276', '#aba594'];

/** Seeded noise, blurred with wrapping so it tiles: a stand-in for a scan's map. */
function tiling(seed: number, grey = false): Image {
	let s = seed;
	const next = () => ((s = (s * 1103515245 + 12345) >>> 0) >>> 16) & 255;
	const data = new Uint8Array(SIZE * SIZE * 4);
	for (let c = 0; c < 3; c++) {
		const raw = Int32Array.from({ length: SIZE * SIZE }, next);
		const soft = boxBlur(raw, SIZE, SIZE, 2);
		soft.forEach((v, i) => (data[i * 4 + c] = grey ? 0 : v));
	}
	for (let i = 0; i < SIZE * SIZE; i++) {
		if (grey) data[i * 4 + 1] = data[i * 4 + 2] = data[i * 4] = (i * 7 + seed) & 255;
		data[i * 4 + 3] = 255;
	}
	return { width: SIZE, height: SIZE, data };
}

const source = () => ({ color: tiling(1), height: tiling(2), roughness: tiling(3), ao: tiling(4) });
const recipe = { ramp: RAMP, detail: 0.25, normalBoost: 1.5 };

describe('stylise (#187)', () => {
	it('gives the same bytes for the same source', () => {
		expect(stylise(source(), recipe)).toEqual(stylise(source(), recipe));
	});

	it('keeps albedo in 30-240 and roughness in 0.5-0.9, and puts the height in albedo alpha', () => {
		const { albedo, orm } = stylise(source(), recipe);
		const height = source().height.data;
		for (let i = 0; i < SIZE * SIZE; i++) {
			for (let c = 0; c < 3; c++) {
				expect(albedo.data[i * 4 + c]).toBeGreaterThanOrEqual(ALBEDO_RANGE[0]);
				expect(albedo.data[i * 4 + c]).toBeLessThanOrEqual(ALBEDO_RANGE[1]);
			}
			expect(albedo.data[i * 4 + 3]).toBe(height[i * 4]);
			expect(orm.data[i * 4 + 1]).toBeGreaterThanOrEqual(ROUGHNESS_RANGE[0]);
			expect(orm.data[i * 4 + 1]).toBeLessThanOrEqual(ROUGHNESS_RANGE[1]);
			expect(orm.data[i * 4 + 2]).toBe(0);
		}
	});

	it('writes unit normals, from the height when the set has no normal map', () => {
		for (const set of [source(), { ...source(), normal: tiling(5) }]) {
			const { normal } = stylise(set, recipe);
			for (let i = 0; i < SIZE * SIZE; i++) {
				const [x, y, z] = [0, 1, 2].map((c) => (normal.data[i * 4 + c] - 127.5) / 127.5);
				expect(Math.hypot(x, y, z)).toBeCloseTo(1, 1);
				expect(z).toBeGreaterThan(0);
			}
		}
	});

	it('keeps a tiling source tiling, and the seam check flags one that does not', () => {
		expect(seamError(stylise(source(), recipe).albedo)).toBeLessThan(2);
		const ramp = tiling(1);
		for (let y = 0; y < SIZE; y++)
			for (let x = 0; x < SIZE; x++)
				ramp.data.fill(x * 4, (y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3);
		expect(seamError(ramp)).toBeGreaterThan(10);
	});

	it('spreads the ramp from its darkest colour to its lightest, and refuses a bad one', () => {
		const table = rampTable(RAMP);
		expect([...table.subarray(0, 3)]).toEqual([0x3b, 0x3f, 0x4a]);
		expect([...table.subarray(255 * 3)]).toEqual([0xab, 0xa5, 0x94]);
		expect(() => rampTable(['#fff'])).toThrow(/2-8 colours/);
	});

	it("takes each surface's ramp from docs/ART.md, the one source of the ramps", () => {
		const art = readFileSync('docs/ART.md', 'utf8');
		const dir = path.join('art', 'surfaces');
		for (const id of readdirSync(dir)) {
			const meta = JSON.parse(readFileSync(path.join(dir, id, 'meta.json'), 'utf8'));
			const row = new RegExp(`^\\| ${id}\\s+\\| (.*)\\|$`, 'm').exec(art);
			expect(row?.[1].match(/#[0-9a-f]{6}/g), id).toEqual(meta.ramp);
		}
	});
});
