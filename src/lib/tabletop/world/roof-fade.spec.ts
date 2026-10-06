// Which roofs fade (#259): every rule, fog off, the GM's building and roofs over unexplored ground.

import { describe, expect, it } from 'vitest';
import type { SquareGrid } from '$lib/game/grid';
import { BUILDING_FADE, roofFade, type RoofFadeInput } from './roof-fade';
import { roofRegions } from './roofs';
import { worldShape } from './shape';

// Two 2x2 roofs on an 8x4 table: cells (1-2, 1-2) and (5-6, 1-2).
const g: SquareGrid = { kind: 'square', cellSize: 1, width: 8, height: 4 };
const cell = (x: number, y: number) => y * g.width + x;
const mask = (inside: (x: number, y: number) => boolean) =>
	Uint8Array.from({ length: 32 }, (_, i) => (inside(i % 8, Math.floor(i / 8)) ? 1 : 0));
const roofed = mask((x, y) => y >= 1 && y < 3 && (x === 1 || x === 2 || x === 5 || x === 6));
const regions = roofRegions(
	worldShape({ grid: g, levels: null, floor: null, objects: [], known: null }),
	roofed
);
const none: RoofFadeInput = { tokens: [], pivot: -1, visible: null, known: null, building: false };
const fade = (input: Partial<RoofFadeInput>) => roofFade(regions, { ...none, ...input });

describe('roof fades', () => {
	it('keep every roof with nothing inside or in sight', () => {
		expect(regions).toHaveLength(2);
		expect(fade({})).toEqual([1, 1]);
		expect(fade({ tokens: [cell(0, 0), cell(3, 3)], pivot: cell(4, 1) })).toEqual([1, 1]);
	});

	it('fade a roof with an own or selected token inside', () => {
		expect(fade({ tokens: [cell(2, 2)] })).toEqual([0, 1]);
		expect(fade({ tokens: [cell(5, 1), cell(1, 1)] })).toEqual([0, 0]);
	});

	it('fade a roof with the camera’s pivot on a known cell of it', () => {
		expect(fade({ pivot: cell(6, 2) })).toEqual([1, 0]);
		const known = mask((x) => x < 4);
		expect(fade({ pivot: cell(1, 2), known })).toEqual([0, 1]);
		// Over unexplored ground the roof stays: fading it would show only black.
		expect(fade({ pivot: cell(6, 2), known })).toEqual([1, 1]);
	});

	it('fade a roof while any of its cells is visible, and skip that rule with fog off', () => {
		const visible = mask((x, y) => x === 6 && y === 2);
		expect(fade({ visible })).toEqual([1, 0]);
		expect(fade({ visible: null })).toEqual([1, 1]);
		expect(fade({ visible: mask(() => false) })).toEqual([1, 1]);
	});

	it('half-fade the GM’s roofs while building, and fully what is open', () => {
		expect(fade({ building: true })).toEqual([BUILDING_FADE, BUILDING_FADE]);
		expect(fade({ building: true, pivot: cell(1, 1) })).toEqual([0, BUILDING_FADE]);
	});
});
