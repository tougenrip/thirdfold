// Glazed windows (#260): the glow from the atmosphere curve (0 by day, a slow ramp to 1 after
// dusk), the hashes that pick glazed and lit windows (the same every run, near their shares),
// which walls are facades (a known building cell on one side only, never a rules window, a door
// or an unexplored side), dark areas keeping windows dark, the frames drawn on glazed facades, and
// the village's facades.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '$lib/assets/manifest-parse';
import { WALL_HALF_THIN } from '$lib/assets/kit';
import { decodeMaskExact } from '$lib/game/visibility';
import type { SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import { parseSceneFile } from '$lib/game/scene-file';
import { atmosphereAt, createAtmosphereState, presetOf, type SkyPreset } from '../atmosphere-curve';
import { autotile, keySeed, tileInput, TILE_ROLES } from './autotile';
import {
	GLAZED_SHARE,
	glazing,
	LIT_SHARE,
	litPanes,
	lightsUp,
	paneMesh,
	shareOf,
	windowGlow
} from './glazing';
import { roofFootprint } from './roofs';
import { worldShape } from './shape';
import { BATCH_ROLES, edgeIndex, VARIANTS, wallInstances } from './wall-batch';

const built = parseManifest(JSON.parse(readFileSync('static/assets/manifest.json', 'utf8')));
if (!built.ok) throw new Error(built.error);
const skies = built.manifest.skies;
const NONE = { kind: 'none', intensity: 0 } as const;
const glowAt = (minute: number, sky = 'temperate') =>
	windowGlow(atmosphereAt(presetOf(skies[sky]), minute, NONE, createAtmosphereState()).nightGlow);

describe('the glow', () => {
	it('is 0 by day, 0 at 17:00, and 1 from 20:00 through the night', () => {
		for (let m = 8 * 60; m <= 17 * 60; m += 15) expect(glowAt(m), `${m}`).toBe(0);
		for (const m of [20 * 60, 21 * 60, 23 * 60, 0, 3 * 60, 4 * 60 + 30])
			expect(glowAt(m), `${m}`).toBe(1);
	});

	it('ramps up after dusk and down after dawn, slowly: never a flash', () => {
		let last = glowAt(17 * 60);
		for (let m = 17 * 60 + 1; m <= 20 * 60; m++) {
			const g = glowAt(m);
			expect(g).toBeGreaterThanOrEqual(last);
			expect(g - last, `${m}`).toBeLessThan(0.03);
			last = g;
		}
		expect(glowAt(18 * 60 + 30)).toBeGreaterThan(0.2);
		expect(glowAt(18 * 60 + 30)).toBeLessThan(0.8);
		for (let m = 6 * 60; m < 8 * 60; m++) expect(glowAt(m + 1)).toBeLessThanOrEqual(glowAt(m));
	});

	it('follows an enclosed sky by band: dark by day, lit at dusk and in the dark', () => {
		// The layer uses the key at the band's canonical hour whole (atmosphere.ts `presetFor`).
		const band = (minute: number) => {
			const key = skies.underground.keys.find((k) => k.minute === minute)!;
			const preset = { kind: 'enclosed', keys: [key] } as SkyPreset;
			return windowGlow(atmosphereAt(preset, 0, NONE, createAtmosphereState()).nightGlow);
		};
		expect([720, 1170, 1380].map(band)).toEqual([0, 1, 1]);
	});

	it('is clamped to 0-1', () => {
		expect([0, 0.5, 0.75, 1, 1.5].map(windowGlow)).toEqual([0, 0, 0.5, 1, 1]);
	});
});

describe('the hashes', () => {
	const keys = Array.from({ length: 1000 }, (_, i) => keySeed(i % 2 ? 'h' : 'v', i % 37, i >> 3));

	it('light 55-65% of windows, identically on two runs', () => {
		const run = () => keys.map(lightsUp);
		const lit = run().filter(Boolean).length / keys.length;
		expect(lit).toBeGreaterThanOrEqual(0.55);
		expect(lit).toBeLessThanOrEqual(0.65);
		expect(run()).toEqual(run());
		expect(LIT_SHARE).toBe(0.6);
	});

	it('glaze about their share of facades, independently of the lit hash', () => {
		const glazed = keys.filter((k) => shareOf(k, 1) < GLAZED_SHARE);
		expect(glazed.length / keys.length).toBeGreaterThan(GLAZED_SHARE - 0.05);
		expect(glazed.length / keys.length).toBeLessThan(GLAZED_SHARE + 0.05);
		const litGlazed = glazed.filter(lightsUp).length / glazed.length;
		expect(litGlazed).toBeGreaterThan(0.5);
		expect(litGlazed).toBeLessThan(0.7);
	});
});

const grid = (width: number, height: number): SquareGrid => ({
	kind: 'square',
	cellSize: 1,
	width,
	height
});
let n = 0;
const wall = (a: [number, number], b: [number, number], window = false): SceneObject => ({
	id: `w${n++}`,
	kind: 'wall',
	a: { x: a[0], y: a[1] },
	b: { x: b[0], y: b[1] },
	...(window ? { window: true } : {})
});

describe('facades', () => {
	// A long house, cells (1-30, 1-2) of a 32x4 table, its long south wall a run of facades.
	const g = grid(32, 4);
	const house = [
		wall([1, 1], [31, 1]),
		wall([1, 1], [1, 3]),
		wall([31, 1], [31, 3]),
		wall([1, 3], [31, 3])
	];
	const building = Uint8Array.from({ length: 128 }, (_, i) => {
		const [x, y] = [i % 32, Math.floor(i / 32)];
		return x >= 1 && x < 31 && y >= 1 && y < 3 ? 1 : 0;
	});
	const input = (
		objects: SceneObject[],
		known: Uint8Array | null = null,
		b: Uint8Array | null = building
	) => tileInput(worldShape({ grid: g, levels: null, floor: null, objects, known }), objects, b);

	it('are building walls with a known outside: some glazed, each pane on its edge', () => {
		const glass = glazing(input(house));
		// 60 long units and 4 short ones; the north and south rows face the table's border rows.
		expect(glass.count).toBeGreaterThan(10);
		expect(glass.count).toBeLessThan(40);
		for (let i = 0; i < glass.count; i++) {
			const m = glass.matrices.subarray(i * 16, i * 16 + 16);
			const [x, z] = [m[12] + 16, m[14] + 2];
			// On a horizontal edge (y 1 or 3) or a vertical one (x 1 or 31), at its midpoint.
			const onH = Number.isInteger(z) && (z === 1 || z === 3) && x % 1 === 0.5;
			const onV = Number.isInteger(x) && (x === 1 || x === 31) && z % 1 === 0.5;
			expect(onH || onV, `${x}, ${z}`).toBe(true);
			expect(building[glass.inside[i]]).toBe(1);
		}
		// Every glazed edge is a facade's, and a facade's hash says glazed.
		for (const e of glass.edges) expect(e).toBeGreaterThanOrEqual(0);
		expect(glass.edges.size).toBe(glass.count);
	});

	it('are none without a building context, between two buildings or toward unexplored ground', () => {
		expect(glazing(input(house, null, null)).count).toBe(0);
		expect(glazing(input(house, null, new Uint8Array(128).fill(1))).count).toBe(0);
		// The player knows only the inside: no facade has a known outside.
		expect(glazing(input(house, building)).count).toBe(0);
	});

	it('are never rules windows or doors, which are open gaps', () => {
		const windows = house.map((w) => ({ ...w, window: true }));
		expect(glazing(input(windows)).count).toBe(0);
		const doors = house.map((w) => ({ ...w, kind: 'door' as const, open: false }));
		expect(glazing(input(doors)).count).toBe(0);
	});

	it('stay dark into a dark area, and light by the hash elsewhere', () => {
		const glass = glazing(input(house));
		const lit = litPanes(glass, null);
		expect([...lit]).toEqual([...glass.seed].map((s) => (lightsUp(s) ? 1 : 0)));
		expect(lit.some((l) => l === 1)).toBe(true);
		expect([...litPanes(glass, building)].every((l) => l === 0)).toBe(true);
	});

	it('draw a window frame on a glazed facade and the wall elsewhere', () => {
		const t = input(house);
		const glass = glazing(t);
		const frame = BATCH_ROLES.indexOf('window.frame');
		const straight = BATCH_ROLES.indexOf('wall.straight');
		let frames = 0;
		for (const pieces of autotile(t).values()) {
			const inst = wallInstances(pieces, g, {}, glass.edges);
			for (let i = 0; i < inst.count; i++) {
				const role = Math.floor(inst.key[i] / VARIANTS);
				if (glass.edges.has(inst.edge[i])) expect(role).toBe(frame);
				if (role === frame) frames++;
				else if (inst.edge[i] >= 0) expect(role).not.toBe(frame);
			}
			// Without the glazing every unit is a wall.
			const plain = wallInstances(pieces, g, {});
			for (let i = 0; i < plain.count; i++)
				expect(Math.floor(plain.key[i] / VARIANTS)).not.toBe(frame);
			expect(straight).toBe(TILE_ROLES.indexOf('wall.straight'));
		}
		expect(frames).toBe(glass.count);
		expect(edgeIndex(g, 'h', 0, 0)).toBe(0);
	});

	it('hold a pane within the wall: in the frame opening, ±0.01 of the wall plane', () => {
		for (const outer of [true, false]) {
			const p = paneMesh(outer);
			for (let v = 0; v < p.positions.length / 3; v++) {
				const z = p.positions[v * 3 + 2];
				// The outer half (which glows) on the +z side, out of the building; the inner behind.
				expect(outer ? z >= 0 && z <= 0.01 : z <= 0 && z >= -0.01).toBe(true);
				expect(Math.abs(p.positions[v * 3])).toBeLessThan(0.5);
			}
			expect(p.colors!.length).toBe(p.positions.length);
		}
		expect(0.01).toBeLessThan(WALL_HALF_THIN);
	});
});

describe('the village', () => {
	const scene = parseSceneFile(
		JSON.parse(readFileSync('tests/fixtures/scenes/village.json', 'utf8'))
	);
	if (!scene.ok) throw new Error(scene.error);
	const s = scene.scene;
	const size = s.grid.width * s.grid.height;
	const interior = s.interior ? decodeMaskExact(s.interior, size) : null;

	it('has lit windows on its houses for the GM, the same each time', () => {
		const run = () => {
			const shape = worldShape({ ...s, levels: null, floor: null, known: null });
			const building = roofFootprint(shape, s.objects, interior, true);
			return glazing(tileInput(shape, s.objects, building));
		};
		const glass = run();
		expect(glass.count).toBeGreaterThan(8);
		const lit = litPanes(glass, null).filter((l) => l === 1).length;
		expect(lit / glass.count).toBeGreaterThan(0.35);
		expect(lit / glass.count).toBeLessThan(0.85);
		expect(run().seed).toEqual(glass.seed);
	});
});
