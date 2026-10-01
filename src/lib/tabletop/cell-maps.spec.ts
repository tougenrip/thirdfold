// The cell maps' pure pieces (#171): which texel a point reads, how each channel is packed, and
// that `worldModify`'s brightness and fog are exactly what the overlays they replace drew.

import type * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { MAP_SIDE, Staged } from './cell-maps-kept';
import { gridToWorld, worldToGrid, type SquareGrid } from '$lib/game/grid';
import type { Ambient } from '$lib/game/lights';
import {
	AMBIENT_DARK,
	FOG_LEVELS,
	INDOOR_FILL,
	PERCEPTION_FILL,
	cellLight,
	fogFactor,
	packFog,
	packGround,
	packLight,
	packSky,
	skyVisibilityMap,
	texelAt
} from './cell-maps';

const grid = (width: number, height: number, cellSize = 1): SquareGrid => ({
	kind: 'square',
	cellSize,
	width,
	height
});

describe('texelAt', () => {
	it('reads the texel of the cell worldToGrid names, on odd and even grids', () => {
		for (const g of [grid(4, 6), grid(5, 3), grid(7, 7, 1.5), grid(1, 2, 0.5)]) {
			for (let y = 0; y < g.height; y++)
				for (let x = 0; x < g.width; x++) {
					const w = gridToWorld(g, { x, y });
					const cell = worldToGrid(g, w)!;
					expect(cell).toEqual({ x, y });
					expect(texelAt(g, w.x, w.z)).toBe(y * g.width + x);
					// Just inside a cell's corners too, which a flip or an off-by-half would miss.
					const e = g.cellSize * 0.49;
					expect(texelAt(g, w.x - e, w.z - e)).toBe(y * g.width + x);
					expect(texelAt(g, w.x + e, w.z + e)).toBe(y * g.width + x);
				}
		}
	});

	it('is outside the grid past its edges', () => {
		const g = grid(4, 3);
		expect(texelAt(g, -2.01, 0)).toBe(-1);
		expect(texelAt(g, 2, 0)).toBe(-1);
		expect(texelAt(g, 0, 1.5)).toBe(-1);
		expect(texelAt(g, -2, -1.5)).toBe(0);
	});
});

describe('packing', () => {
	it('writes each channel alone, in grid order', () => {
		const data = new Uint8Array(3 * 4).fill(7);
		packFog(data, [0, 1, 0], [1, 1, 0]);
		expect([...data]).toEqual([0, 255, 7, 7, 255, 255, 7, 7, 0, 0, 7, 7]);
		packLight(data, [0, 0.5, 1]);
		packSky(data, [1, 0, 1]);
		expect([...data]).toEqual([0, 255, 0, 255, 255, 255, 128, 0, 0, 0, 255, 255]);
	});

	it('is neutral without its input: visible, explored, lit, open sky', () => {
		const data = new Uint8Array(2 * 4);
		packFog(data, null, null);
		packLight(data, null);
		packSky(data, null);
		expect([...data]).toEqual(Array(8).fill(255));
	});

	it('packs the ground as floor index and level, keeping the fades in B and A', () => {
		const data = new Uint8Array(3 * 4).fill(9);
		packGround(data, new Uint8Array([0, 3, 7]), new Uint8Array([2, 0, 10]));
		expect([...data]).toEqual([0, 2, 9, 9, 3, 0, 9, 9, 7, 10, 9, 9]);
		packGround(data, null, null);
		expect([...data]).toEqual([0, 0, 9, 9, 0, 0, 9, 9, 0, 0, 9, 9]);
	});
});

// The overlays as they were (lighting.ts's darkness overlay, fog.ts's fog plane).
const OLD_DARK: Record<Ambient, number> = { day: 0, dusk: 0.35, dark: 0.82 };
const OLD_FOG_ALPHA = { player: { hidden: 255, explored: 173 }, gm: { hidden: 128, explored: 69 } };

function oldBrightness(ambient: Ambient, darkArea: boolean, level: number, shown: boolean, k = 0) {
	const darkness = OLD_DARK[ambient];
	if (darkness === 0 && !darkArea) return 1; // the overlay hidden
	const lit = Math.max(level, shown ? 0.55 : 0);
	const shade = darkArea ? Math.max(darkness, OLD_DARK.dark) : darkness;
	const alpha = Math.round(255 * shade * (1 - lit));
	return 1 - (alpha / 255) * (1 - 0.85 * k);
}

describe('brightness', () => {
	it('equals the old overlay in every case', () => {
		const ambients: Ambient[] = ['day', 'dusk', 'dark'];
		let cases = 0;
		for (const ambient of ambients)
			for (const darkArea of [false, true])
				for (const fogOn of [false, true])
					for (const mode of ['player', 'gm'] as const)
						for (const visible of [false, true])
							for (const k of [0, 0.4, 1])
								for (const level of [0, 0.2, 0.37, 0.8, 1]) {
									// The fill is a fogged player's visible cells' (renderer.ts passed `visible` only then).
									const shown = fogOn && mode === 'player' && visible;
									const packed = Math.round(255 * level) / 255;
									const now = cellLight({
										ambientDark: AMBIENT_DARK[ambient],
										level: packed,
										sky: darkArea ? 0 : 1,
										fill: shown ? PERCEPTION_FILL : 0,
										flash: k
									});
									expect(now).toBeCloseTo(oldBrightness(ambient, darkArea, level, shown, k), 2);
									cases++;
								}
		expect(cases).toBe(3 * 2 * 2 * 2 * 2 * 3 * 5);
	});

	it('never leaves a cell the rules show black', () => {
		for (const ambient of ['day', 'dusk', 'dark'] as const)
			for (const sky of [0, 1]) {
				const at = (level: number, fill: number) =>
					cellLight({ ambientDark: AMBIENT_DARK[ambient], level, sky, fill, flash: 0 });
				// A fogged player's visible cell has the fill; a lit cell a level of 0.2 or more.
				expect(at(0, PERCEPTION_FILL)).toBeGreaterThan(0.5);
				expect(at(0.2, 0)).toBeGreaterThan(0.3);
			}
	});
});

describe('fog', () => {
	it('lets through what the old fog plane did', () => {
		for (const mode of ['player', 'gm'] as const) {
			const alpha = OLD_FOG_ALPHA[mode];
			expect(fogFactor(true, mode, false, false)).toBeCloseTo(1 - alpha.hidden / 255, 6);
			expect(fogFactor(true, mode, false, true)).toBeCloseTo(1 - alpha.explored / 255, 6);
			expect(fogFactor(true, mode, true, false)).toBe(1);
			expect(fogFactor(true, mode, true, true)).toBe(1);
			for (const [v, e] of [
				[false, false],
				[true, true]
			])
				expect(fogFactor(false, mode, v, e)).toBe(1);
		}
		// A player's hidden cells are exactly black.
		expect(FOG_LEVELS.player.hidden).toBe(0);
	});
});

describe('skyVisibilityMap (#219)', () => {
	// The shader's terms, as world-modify.ts reads A at a cell's centre.
	const sun = (a: number) => Math.min(1, Math.max(0, (a - INDOOR_FILL) / (1 - INDOOR_FILL)));
	const mask = (w: number, h: number, cells: [number, number][]) => {
		const m = new Uint8Array(w * h);
		for (const [x, y] of cells) m[y * w + x] = 1;
		return m;
	};

	it('is open sky everywhere without dark areas or roofs', () => {
		expect([...skyVisibilityMap(grid(3, 2), null, null)]).toEqual(Array(6).fill(1));
	});

	it('keeps dark cells at 0 under the blur, roofs at the fill, and open ground at 1', () => {
		const g = grid(9, 7);
		// A dark block, a roofed block, open ground well away from both.
		const dark = mask(9, 7, [
			[1, 1],
			[2, 1],
			[1, 2],
			[2, 2]
		]);
		const roof = mask(9, 7, [
			[6, 1],
			[7, 1],
			[6, 2],
			[7, 2]
		]);
		const sky = skyVisibilityMap(g, dark, roof);
		const at = (x: number, y: number) => sky[y * 9 + x];
		for (let i = 0; i < sky.length; i++) {
			// Dark: no ambient, no sun. Roof: the fill, no sun. Nowhere below the fill but in the dark.
			if (dark[i]) expect(sky[i]).toBe(0);
			else if (roof[i]) {
				expect(sky[i]).toBeCloseTo(INDOOR_FILL, 6);
				expect(sun(sky[i])).toBeCloseTo(0, 6);
			} else expect(sky[i]).toBeGreaterThanOrEqual(Math.fround(INDOOR_FILL));
			expect(sky[i]).toBeLessThanOrEqual(1);
		}
		expect([at(4, 5), sun(at(4, 5))]).toEqual([1, 1]);
		// Beside the dark area the open side softens, and never lifts a dark cell.
		expect(at(3, 1)).toBeLessThan(1);
		expect(sun(at(3, 1))).toBeLessThan(1);
		expect(INDOOR_FILL).toBeGreaterThanOrEqual(PERCEPTION_FILL);
	});

	it('leaves a dark area dark at every size, and ignores masks of another size', () => {
		const g = grid(4, 4);
		const all = new Uint8Array(16).fill(1);
		expect([...skyVisibilityMap(g, all, null)]).toEqual(Array(16).fill(0));
		expect([...skyVisibilityMap(g, all, all)]).toEqual(Array(16).fill(0));
		expect([...skyVisibilityMap(g, new Uint8Array(9).fill(1), null)]).toEqual(Array(16).fill(1));
		// A lone dark cell in the open: its neighbours soften, it stays 0.
		const one = skyVisibilityMap(g, mask(4, 4, [[1, 1]]), null);
		expect(one[5]).toBe(0);
		expect(Math.min(...[...one].filter((_, i) => i !== 5))).toBeGreaterThanOrEqual(
			Math.fround(INDOOR_FILL)
		);
	});

	it('packs into A as the shader reads it', () => {
		const sky = skyVisibilityMap(grid(3, 1), mask(3, 1, [[0, 0]]), mask(3, 1, [[2, 0]]));
		const data = new Uint8Array(12);
		packSky(data, sky);
		expect([data[3], data[11]]).toEqual([0, Math.round(255 * INDOOR_FILL)]);
	});
});

describe('the kept maps (#380)', () => {
	it('copy a grid’s rows into the corner of the kept texture on each update', () => {
		const into = { image: { data: new Uint8Array(MAP_SIDE * MAP_SIDE * 4) }, needsUpdate: false };
		const staged = new Staged(grid(3, 2), into as unknown as THREE.DataTexture, 7);
		expect(into.needsUpdate).toBe(true);
		staged.image.data[(1 * 3 + 2) * 4] = 9; // cell (2, 1)
		staged.needsUpdate = true;
		const at = (x: number, y: number) => into.image.data[(y * MAP_SIDE + x) * 4];
		expect([at(0, 0), at(2, 0), at(2, 1), at(3, 0), at(0, 2)]).toEqual([7, 7, 9, 0, 0]);
	});
});
