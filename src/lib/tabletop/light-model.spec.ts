import { describe, expect, it } from 'vitest';
import type { SquareGrid } from '../game/grid';
import { LEVEL_CELLS, LIGHT_KINDS } from '../game/lights';
import { edgeKey } from '../game/objects';
import { groundFor, STEP_HEIGHT, WALL_HEIGHT } from './ground';
import {
	FIXTURES,
	fixtureFor,
	mountOf,
	sideOf,
	fitShadowFrustum,
	lightBasis,
	lightMount,
	MOUNT_HEIGHT,
	MOUNT_OFFSET,
	STRIP_KINDS,
	stripEntries,
	stripSamples,
	BAKE_DEBOUNCE_MS,
	PROBE_HEIGHTS,
	PROBE_LIFT,
	PROBE_MAX,
	PROBES_PER_FRAME,
	ProbeBake,
	probeLayout,
	wantsProbes,
	type ShadowBounds
} from './light-model';
import { LIGHT_FLAGS, type LightEntry } from './grid-lights';

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
		// The quarter turns a wall fixture (modelled on the north wall) is turned by.
		expect(sideOf({ pos }, new Set([north]))).toBe(0);
		expect(sideOf({ pos }, new Set([east]))).toBe(1);
		expect(sideOf({ pos }, new Set([south]))).toBe(2);
		expect(sideOf({ pos }, new Set())).toBe(-1);
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

describe('stripSamples and stripEntries (#236)', () => {
	const entry: LightEntry = {
		id: 'sign',
		ruleOrigin: { x: 3, y: 2 },
		visual: { x: 1, y: 2.4, z: -3 },
		reach: 5,
		colour: [1, 0, 1],
		intensity: 6,
		profile: 0,
		phase: 0.25,
		flags: LIGHT_FLAGS.hero
	};

	it('gives strips two or three samples whose shares add to 1, inside their cell; points none', () => {
		for (const kind of LIGHT_KINDS) {
			const samples = stripSamples({ kind });
			if (!STRIP_KINDS.has(kind)) {
				expect(samples, kind).toEqual([]);
				continue;
			}
			expect(samples.length, kind).toBeGreaterThanOrEqual(2);
			expect(samples.length, kind).toBeLessThanOrEqual(3);
			expect(samples.reduce((n, s) => n + s.share, 0)).toBeCloseTo(1, 12);
			for (const facing of [0, 1, 2, 3])
				for (const s of stripSamples({ kind }, facing)) {
					expect(Math.abs(s.x)).toBeLessThan(0.5);
					expect(Math.abs(s.z)).toBeLessThan(0.5);
				}
		}
	});

	it('spreads a neon bar along its length and turns it with its facing', () => {
		const south = stripSamples({ kind: 'neon' });
		// Facing south (0) the bar runs east-west, a little in front (+z).
		expect(new Set(south.map((s) => s.z)).size).toBe(1);
		expect(south[0].z).toBeGreaterThan(0);
		const xs = south.map((s) => s.x);
		expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.6);
		// Each quarter turn clockwise: west, north, east in front.
		const front = (f: 0 | 1 | 2 | 3) => {
			const s = stripSamples({ kind: 'neon', facing: f })[1];
			return [Math.sign(s.x), Math.sign(s.z)];
		};
		expect([front(0), front(1), front(2), front(3)]).toEqual([
			[0, 1],
			[-1, 0],
			[0, -1],
			[1, 0]
		]);
		// The look's facing is the default; a facing given wins.
		expect(stripSamples({ kind: 'neon', facing: 1 })).toEqual(stripSamples({ kind: 'neon' }, 1));
		const east = stripSamples({ kind: 'neon' }, 3);
		expect(new Set(east.map((s) => s.x)).size).toBe(1);
		expect(east.map((s) => s.z).sort()).toEqual(xs.map((x) => 0 - x).sort());
	});

	it('makes each sample the same light from the same rule origin, its share, no hot core', () => {
		for (const kind of ['neon', 'panel'] as const) {
			const samples = stripSamples({ kind }, 2);
			const entries = stripEntries(entry, samples, 2, LIGHT_FLAGS.noCore);
			expect(entries).toHaveLength(samples.length);
			for (const [i, e] of entries.entries()) {
				expect(e.ruleOrigin).toEqual(entry.ruleOrigin);
				expect(e.ruleOrigin).not.toBe(entry.ruleOrigin);
				expect([e.id, e.reach, e.colour, e.profile, e.phase]).toEqual([
					entry.id,
					entry.reach,
					entry.colour,
					entry.profile,
					entry.phase
				]);
				expect(e.flags).toBe(LIGHT_FLAGS.hero | LIGHT_FLAGS.noCore);
				expect(e.visual.x).toBeCloseTo(entry.visual.x + samples[i].x * 2);
				expect(e.visual.y).toBeCloseTo(entry.visual.y + samples[i].y * 2);
				expect(e.visual.z).toBeCloseTo(entry.visual.z + samples[i].z * 2);
			}
			expect(entries.reduce((n, e) => n + e.intensity, 0)).toBeCloseTo(entry.intensity);
		}
		// A point light is its own entry, untouched.
		const point = stripEntries(entry, stripSamples({ kind: 'torch' }), 2, LIGHT_FLAGS.noCore);
		expect(point).toEqual([entry]);
	});
});

describe('probeLayout (#235)', () => {
	it('puts a probe every 3 cells over the grid, up to a wall above the highest floor', () => {
		const levels = new Uint8Array(48 * 36);
		levels[5] = 7;
		const hollow = probeLayout({ width: 48, height: 36 }, levels);
		expect(hollow.counts).toEqual([17, PROBE_HEIGHTS, 13]);
		expect(hollow.min).toEqual([0.5, PROBE_LIFT, 0.5]);
		expect(hollow.max).toEqual([47.5, 7 * STEP_HEIGHT + WALL_HEIGHT, 35.5]);
		expect(probeLayout({ width: 8, height: 8 }, null).max[1]).toBe(WALL_HEIGHT);
	});

	it('keeps two probes a side on a tiny table and spreads them past the cap on a huge one', () => {
		expect(probeLayout({ width: 1, height: 2 }, null).counts).toEqual([2, PROBE_HEIGHTS, 2]);
		expect(probeLayout({ width: 100, height: 64 }, null).counts).toEqual([PROBE_MAX, 3, 22]);
	});
});

describe('wantsProbes (#235)', () => {
	const gpu = { backend: 'webgpu', vendor: 'nvidia', architecture: 'lovelace' };
	const on = { probes: true };
	it('bakes only with the layer on, on high and ultra', () => {
		expect(wantsProbes({ tier: 'high', layers: on }, gpu)).toBe(true);
		expect(wantsProbes({ tier: 'ultra', layers: on }, gpu)).toBe(true);
		expect(wantsProbes({ tier: 'medium', layers: on }, gpu)).toBe(false);
		expect(wantsProbes({ tier: 'low', layers: on }, gpu)).toBe(false);
		expect(wantsProbes({ tier: 'high', layers: { probes: false } }, gpu)).toBe(false);
	});

	it('never on WebGL2 on an integrated GPU', () => {
		const igpu = { backend: 'webgl2', vendor: 'intel', architecture: null };
		expect(wantsProbes({ tier: 'high', layers: on }, igpu)).toBe(false);
		expect(wantsProbes({ tier: 'high', layers: on }, { ...igpu, backend: 'webgpu' })).toBe(true);
		expect(wantsProbes({ tier: 'high', layers: on }, { ...gpu, backend: 'webgl2' })).toBe(true);
	});
});

describe('ProbeBake (#235)', () => {
	it('waits out the debounce, then bakes at most PROBES_PER_FRAME a frame to the end', () => {
		const bake = new ProbeBake();
		expect(bake.wait(0)).toBe(Infinity);
		expect(bake.change(['a'], 20, 0)).toBe(true);
		expect(bake.step(BAKE_DEBOUNCE_MS - 1)).toBeNull();
		expect(bake.wait(100)).toBe(BAKE_DEBOUNCE_MS - 100);
		const steps = [];
		for (let s; (s = bake.step(BAKE_DEBOUNCE_MS));) steps.push(s);
		expect(steps).toEqual([
			{ start: 0, count: PROBES_PER_FRAME, last: false },
			{ start: 8, count: PROBES_PER_FRAME, last: false },
			{ start: 16, count: 4, last: true }
		]);
		expect(bake.wait(1e9)).toBe(Infinity);
	});

	it('restarts on a change to what it captures, and only then', () => {
		const bake = new ProbeBake();
		const walls = {};
		bake.change([walls, 'x'], 20, 0);
		bake.step(1000);
		expect(bake.change([walls, 'x'], 20, 1000)).toBe(false);
		expect(bake.change([{}, 'x'], 20, 1000)).toBe(true);
		expect(bake.step(1000 + BAKE_DEBOUNCE_MS - 1)).toBeNull();
		expect(bake.step(1000 + BAKE_DEBOUNCE_MS)).toEqual({ start: 0, count: 8, last: false });
		expect(bake.change([{}, 'x'], 30, 2000)).toBe(true); // another table's size
	});
});
