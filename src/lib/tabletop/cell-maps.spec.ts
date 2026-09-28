// The cell maps' pure pieces (#171): which texel a point reads, how each channel is packed, and
// that `worldModify`'s brightness and fog are exactly what the overlays they replace drew.

import { describe, expect, it } from 'vitest';
import { gridToWorld, worldToGrid, type SquareGrid } from '$lib/game/grid';
import type { Ambient } from '$lib/game/lights';
import {
	AMBIENT_DARK,
	FOG_LEVELS,
	PERCEPTION_FILL,
	cellLight,
	fogFactor,
	packFog,
	packGround,
	packLight,
	packSky,
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
		packSky(data, [0, 1, 0]);
		expect([...data]).toEqual([0, 255, 0, 255, 255, 255, 128, 0, 0, 0, 255, 255]);
	});

	it('is neutral without its input: visible, explored, lit, open sky', () => {
		const data = new Uint8Array(2 * 4);
		packFog(data, null, null);
		packLight(data, null);
		packSky(data, null);
		expect([...data]).toEqual(Array(8).fill(255));
	});

	it('packs the ground as floor index and level', () => {
		const data = new Uint8Array(3 * 2).fill(9);
		packGround(data, new Uint8Array([0, 3, 7]), new Uint8Array([2, 0, 10]));
		expect([...data]).toEqual([0, 2, 3, 0, 7, 10]);
		packGround(data, null, null);
		expect([...data]).toEqual([0, 0, 0, 0, 0, 0]);
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
