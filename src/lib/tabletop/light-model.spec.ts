import { describe, expect, it } from 'vitest';
import type { SquareGrid } from '../game/grid';
import { LEVEL_CELLS, LIGHT_KINDS } from '../game/lights';
import { edgeKey } from '../game/objects';
import { groundFor, STEP_HEIGHT, WALL_HEIGHT } from './ground';
import {
	FIXTURES,
	fixtureFor,
	mountOf,
	fitShadowFrustum,
	lightBasis,
	lightMount,
	MOUNT_HEIGHT,
	MOUNT_OFFSET,
	type ShadowBounds
} from './light-model';

const grid: SquareGrid = { kind: 'square', cellSize: 2, width: 4, height: 4 };
const pos = { x: 1, y: 1 };
// Cell (1, 1)'s centre in world units, cell size 2.
const cx = -1;
const cz = -1;
const north = edgeKey({ a: { x: 1, y: 1 }, b: { x: 2, y: 1 } });
const east = edgeKey({ a: { x: 2, y: 1 }, b: { x: 2, y: 2 } });
const south = edgeKey({ a: { x: 1, y: 2 }, b: { x: 2, y: 2 } });
const west = edgeKey({ a: { x: 1, y: 1 }, b: { x: 1, y: 2 } });
const off = (0.5 - MOUNT_OFFSET) * grid.cellSize;
const mounted = MOUNT_HEIGHT * WALL_HEIGHT * grid.cellSize;

describe('lightMount (#226)', () => {
	it('hangs a torch off the wall on each side, at mount height', () => {
		const torch = { pos };
		const at = (edge: string) => lightMount(grid, torch, new Set([edge]), null);
		expect(at(north)).toEqual({ x: cx, y: mounted, z: cz - off });
		expect(at(east)).toEqual({ x: cx + off, y: mounted, z: cz });
		expect(at(south)).toEqual({ x: cx, y: mounted, z: cz + off });
		expect(at(west)).toEqual({ x: cx - off, y: mounted, z: cz });
	});

	it('picks a corner deterministically: north, east, south, west', () => {
		const lantern = { pos, kind: 'lantern' as const };
		expect(lightMount(grid, lantern, new Set([west, east]), null).x).toBe(cx + off);
		expect(lightMount(grid, lantern, new Set([south, west, north]), null).z).toBe(cz - off);
	});

	it('stands at the cell centre at its look height without a wall, or for other kinds', () => {
		expect(lightMount(grid, { pos }, new Set(), null)).toEqual({
			x: cx,
			y: 4 * STEP_HEIGHT * grid.cellSize,
			z: cz
		});
		expect(lightMount(grid, { pos, kind: 'brazier' }, new Set([north]), null)).toEqual({
			x: cx,
			y: 2 * STEP_HEIGHT * grid.cellSize,
			z: cz
		});
		expect(lightMount(grid, { pos, kind: 'glow', height: 7 }, new Set(), null).y).toBe(
			7 * STEP_HEIGHT * grid.cellSize
		);
	});

	it('stands on a raised floor', () => {
		const levels = new Uint8Array(16);
		levels[1 * 4 + 1] = 3;
		const ground = groundFor(grid, levels);
		const floor = 3 * STEP_HEIGHT * grid.cellSize;
		expect(lightMount(grid, { pos }, new Set([north]), ground).y).toBeCloseTo(floor + mounted);
		expect(lightMount(grid, { pos }, new Set(), ground).y).toBeCloseTo(
			floor + 4 * STEP_HEIGHT * grid.cellSize
		);
	});

	it("measures levels the renderer's way", () => {
		expect(LEVEL_CELLS).toBe(STEP_HEIGHT);
	});
});

// ---------------------------------------------------------------------------------------------
// The sun and moon's shadow box (#229)
// ---------------------------------------------------------------------------------------------

type V3 = [number, number, number];
const RAD = Math.PI / 180;
const toward = (azimuth: number, elevation: number): V3 => [
	Math.cos(elevation * RAD) * Math.cos(azimuth * RAD),
	Math.sin(elevation * RAD),
	Math.cos(elevation * RAD) * Math.sin(azimuth * RAD)
];

/** A 64×64 table of 1 m cells, walls 3 m above a floor raised 2 m: the box the renderer fits. */
const bounds: ShadowBounds = { min: [-32, 0, -32], max: [32, 5, 32] };
const center: V3 = [0, 2.5, 0];
const reach = 2 * Math.hypot(32, 2.5, 32);
const eyeFor = (dir: V3): V3 => [dir[0] * reach, center[1] + dir[1] * reach, dir[2] * reach];

function corners(b: ShadowBounds): V3[] {
	return Array.from({ length: 8 }, (_, i) => [
		i & 1 ? b.max[0] : b.min[0],
		i & 2 ? b.max[1] : b.min[1],
		i & 4 ? b.max[2] : b.min[2]
	]);
}

describe('fixtureFor (#232)', () => {
	it('picks each kind its fixture, on a wall and on the floor', () => {
		const at = (kind: (typeof LIGHT_KINDS)[number]) => [
			fixtureFor({ kind, fixture: true }, 'wall'),
			fixtureFor({ kind, fixture: true }, 'floor')
		];
		expect(Object.fromEntries(LIGHT_KINDS.map((k) => [k, at(k)]))).toEqual({
			torch: ['wall-sconce', 'standing-torch'],
			candle: ['candle-cluster', 'candle-cluster'],
			brazier: ['brazier', 'brazier'],
			lantern: ['wall-lantern', 'post-lantern'],
			glow: [null, null],
			magic: ['glow-crystal', 'glow-crystal'],
			fire: ['ground-flame', 'ground-flame'],
			neon: ['neon-bar', 'neon-bar'],
			panel: ['light-panel', 'light-panel']
		});
	});

	it('draws none for fixture: false, and follows the kind defaults (no kind is a torch)', () => {
		expect(fixtureFor({}, 'wall')).toBe('wall-sconce');
		expect(fixtureFor({ fixture: false }, 'floor')).toBeNull();
		expect(fixtureFor({ kind: 'lantern', fixture: false }, 'wall')).toBeNull();
		// A glow and a fire are light alone unless a light asks for its fixture.
		expect(fixtureFor({ kind: 'glow' }, 'floor')).toBeNull();
		expect(fixtureFor({ kind: 'fire' }, 'floor')).toBeNull();
		expect(fixtureFor({ kind: 'fire', fixture: true }, 'floor')).toBe('ground-flame');
	});

	it('mounts on a wall exactly where lightMount does', () => {
		expect(mountOf({ pos }, new Set([east]))).toBe('wall');
		expect(mountOf({ pos, kind: 'lantern' }, new Set([south]))).toBe('wall');
		expect(mountOf({ pos }, new Set())).toBe('floor');
		expect(mountOf({ pos, kind: 'brazier' }, new Set([north]))).toBe('floor');
		// Only torches and lanterns hang, so every other kind's two fixtures are the same.
		for (const kind of LIGHT_KINDS.filter((k) => k !== 'torch' && k !== 'lantern'))
			expect(FIXTURES[kind].wall).toBe(FIXTURES[kind].floor);
	});
});

describe('fitShadowFrustum', () => {
	it('holds every grid corner and wall top for the light from any direction', () => {
		for (let elevation = 12; elevation <= 90; elevation += 6) {
			for (let azimuth = 0; azimuth < 360; azimuth += 15) {
				const eye = eyeFor(toward(azimuth, elevation));
				const f = fitShadowFrustum(bounds, eye, center, 2048);
				const { x, y, z } = lightBasis(eye, center);
				for (const p of corners(bounds)) {
					const d = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
					const dot = (a: readonly number[]) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
					const at = `${azimuth}° ${elevation}°`;
					expect(dot(x), at).toBeGreaterThanOrEqual(f.left);
					expect(dot(x), at).toBeLessThanOrEqual(f.right);
					expect(dot(y), at).toBeGreaterThanOrEqual(f.bottom);
					expect(dot(y), at).toBeLessThanOrEqual(f.top);
					expect(-dot(z), at).toBeGreaterThan(f.near);
					expect(-dot(z), at).toBeLessThan(f.far);
				}
			}
		}
	});

	it('gives the 64×64 table at least 20 texels a cell on a 2048 map', () => {
		for (let azimuth = 0; azimuth < 360; azimuth += 5) {
			const f = fitShadowFrustum(bounds, eyeFor(toward(azimuth, 12)), center, 2048);
			expect(2048 / Math.max(f.right - f.left, f.top - f.bottom)).toBeGreaterThanOrEqual(20);
		}
	});

	it('keeps the same box, on whole texels, while the light turns a tenth of a degree', () => {
		let same = 0;
		let steps = 0;
		for (let azimuth = 30; azimuth < 60; azimuth += 0.1) {
			const a = fitShadowFrustum(bounds, eyeFor(toward(azimuth, 40)), center, 2048);
			const b = fitShadowFrustum(bounds, eyeFor(toward(azimuth + 0.1, 40)), center, 2048);
			const texel = (a.right - a.left) / 2048;
			// The box's centre sits on a texel corner.
			const mid = (a.left + a.right) / 2 / texel;
			expect(Math.abs(mid - Math.round(mid))).toBeLessThan(1e-6);
			steps++;
			if (a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom)
				same++;
		}
		// The size steps by half a cell: almost every tenth of a degree keeps it.
		expect(same / steps).toBeGreaterThan(0.9);
	});
});
