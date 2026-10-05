import { describe, expect, it } from 'vitest';
import type { SquareGrid } from '$lib/game/grid';
import { groundFor, STEP_HEIGHT, WALL_HEIGHT } from './ground';
import { PreviewLayer, previewPlacements } from './previews';

// A 6x4 table: columns 3 and up of every row raised to level 2, cell (0, 0) to level 5.
const grid: SquareGrid = { kind: 'square', width: 6, height: 4, cellSize: 1 };
const levels = new Uint8Array(24).map((_, i) => (i === 0 ? 5 : i % 6 >= 3 ? 2 : 0));
const ground = groundFor(grid, levels);
const step = STEP_HEIGHT;

describe('previewPlacements (#247)', () => {
	it('steps an area across two levels, one tile per patch at its floor', () => {
		const { reveal } = previewPlacements(
			[{ kind: 'area', from: { x: 1, y: 3 }, to: { x: 4, y: 1 }, tone: 'reveal' }],
			grid,
			ground
		);
		const tiles = reveal.map((p) => ({ x: p.x, z: p.z, y: p.y, sx: p.sx, sz: p.sz }));
		expect(tiles).toHaveLength(2);
		// Cells 1-2 of rows 1-3 at level 0, cells 3-4 at level 2: world x = cell - 2.5.
		expect(tiles).toContainEqual({ x: -1, z: 0.5, y: 0.02, sx: 2, sz: 3 });
		expect(tiles).toContainEqual({ x: 1, z: 0.5, y: 2 * step + 0.02, sx: 2, sz: 3 });
	});

	it('draws a flat area of any size as one tile', () => {
		const flat = groundFor({ kind: 'square' as const, width: 100, height: 100, cellSize: 1 }, null);
		const { hide } = previewPlacements(
			[{ kind: 'area', from: { x: 0, y: 0 }, to: { x: 99, y: 99 }, tone: 'hide' }],
			{ kind: 'square' as const, width: 100, height: 100, cellSize: 1 },
			flat
		);
		expect(hide).toEqual([{ x: 0, y: 0.02, z: 0, sx: 100, sy: 0.04, sz: 100, ry: 0 }]);
	});

	it('stands a corner on the highest floor round it, a balcony edge included', () => {
		const at = (x: number, y: number) =>
			previewPlacements([{ kind: 'corner', at: { x, y } }], grid, ground).corner[0].y;
		expect(at(1, 1)).toBeCloseTo(5 * step + 0.15); // beside (0, 0) at level 5
		expect(at(3, 2)).toBeCloseTo(2 * step + 0.15); // the raised columns' edge
		expect(at(2, 3)).toBeCloseTo(0.15);
		expect(at(6, 4)).toBeCloseTo(2 * step + 0.15); // the table's corner: one cell round it
	});

	it('runs a segment on a cliff edge from the lower floor to above the higher', () => {
		// Along x = 3 from y = 0 to y = 4: level 0 on the left, 2 on the right, all the way.
		const [box, more] = previewPlacements(
			[{ kind: 'segment', a: { x: 3, y: 0 }, b: { x: 3, y: 4 }, tone: 'valid' }],
			grid,
			ground
		).valid;
		expect(more).toBeUndefined();
		const top = 2 * step + WALL_HEIGHT * 0.5;
		expect(box.y - box.sy / 2).toBeCloseTo(0);
		expect(box.y + box.sy / 2).toBeCloseTo(top);
		expect(box.sx).toBeCloseTo(4.12); // its ends reach past its corners
		expect(Math.abs(box.ry)).toBeCloseTo(Math.PI / 2);
		// Along y = 1 from x = 0 to 6: the floors beside it change, so it breaks into runs.
		const runs = previewPlacements(
			[{ kind: 'segment', a: { x: 0, y: 1 }, b: { x: 6, y: 1 }, tone: 'door' }],
			grid,
			ground
		).door;
		expect(runs.map((r) => +(r.y - r.sy / 2).toFixed(3))).toEqual([0, 0, 2 * step]);
		expect(runs.map((r) => +(r.y + r.sy / 2).toFixed(3))).toEqual(
			[5 * step, 0, 2 * step].map((h) => +(h + WALL_HEIGHT * 0.9).toFixed(3))
		);
		expect(runs.reduce((n, r) => n + r.sx, 0)).toBeCloseTo(6.12);
	});

	it('puts the beacon on its cell’s floor', () => {
		const { beacon, beaconRing } = previewPlacements(
			[{ kind: 'beacon', at: { x: 4, y: 2 } }],
			grid,
			ground
		);
		expect(beaconRing[0].y).toBeCloseTo(2 * step + 0.03);
		expect(beacon[0].y).toBeCloseTo(2 * step + 1.1);
	});
});

describe('PreviewLayer', () => {
	it('rewrites its pool and makes no meshes on a hover (#247)', () => {
		const layer = new PreviewLayer();
		const meshes = layer.group.children.slice();
		expect(meshes).toHaveLength(8);
		for (let i = 0; i < 100; i++) {
			layer.set(
				[
					{ kind: 'area', from: { x: 0, y: 0 }, to: { x: i % 6, y: i % 4 }, tone: 'reveal' },
					{ kind: 'corner', at: { x: i % 7, y: 0 } },
					{ kind: 'segment', a: { x: 0, y: 1 }, b: { x: 1 + (i % 5), y: 1 }, tone: 'valid' }
				],
				grid,
				ground
			);
		}
		expect(layer.group.children).toEqual(meshes);
		const counts = [...layer.pool].map(([b, m]) => [b, m.count]);
		expect(Object.fromEntries(counts)).toMatchObject({ reveal: 4, corner: 1, hide: 0 });
		layer.set([], grid, ground);
		expect([...layer.pool.values()].every((m) => m.count === 0)).toBe(true);
		layer.dispose();
	});
});
