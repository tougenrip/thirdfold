// Renderer stability (milestone 61): frames are deterministic, reloading tables
// or cycling the time of day leaks nothing and compiles nothing new, tiers
// with the same stages share their programs, and measuring works. Apart from
// renderer.svelte.spec.ts so CI runs the two side by side.

import * as THREE from 'three/webgpu';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { loadEnvironment } from './environment';
import { loadModel } from './models';
import { createTabletop } from './renderer';
import { qualityFor, settingsFor, TIERS } from './quality';
import { decodeFloor } from '$lib/game/floor';
import { decodeLevels } from '$lib/game/terrain';
import { decodeMask } from '$lib/game/visibility';
import {
	BACKEND,
	loadSidecar,
	loadView,
	manualClock,
	mountFixture,
	settle,
	wait,
	shardedIt,
	type Mounted,
	type Viewer
} from './testing';

// Software frames on CI's small runners take seconds since the shader kinds (M64).
/** This file's tests, sharded for CI's parallel jobs (`THIRDFOLD_SHARD`). */
const test = shardedIt();

vi.setConfig({ testTimeout: 180_000, hookTimeout: 90_000 });

let errors: ReturnType<typeof vi.spyOn>;
const mounted: Mounted[] = [];
beforeEach(() => {
	errors = vi.spyOn(console, 'error');
});
afterEach(async () => {
	for (const m of mounted.splice(0)) await m.unmount();
	expect(errors, 'console.error was called').not.toHaveBeenCalled();
	errors.mockRestore();
});

async function mount(fixture: string, viewer: Viewer, options: { reducedMotion?: boolean } = {}) {
	const sidecar = await loadSidecar(fixture);
	const view = await loadView(fixture, sidecar.ambient, viewer);
	const m = await mountFixture(view, sidecar.poses.overview, options);
	mounted.push(m);
	await settle(m.tabletop);
	return m;
}

describe('the renderer, over time', () => {
	// Reads pixels back, which only WebGL2 does here; on WebGPU the golden images compare frames.
	test.skipIf(BACKEND === 'webgpu')(
		'draws the same pixels for the same table, pose and frozen clock',
		async () => {
			const sidecar = await loadSidecar('ref-1');
			const view = await loadView('ref-1', sidecar.ambient, 'gm');
			const draw = async () => {
				const m = await mountFixture(view, sidecar.poses.close, { clock: manualClock(5000) });
				// A first mount compiles its shaders; CI's small runners take far longer than 8 s.
				await settle(m.tabletop, 1000, 30_000);
				const pixels = m.pixels();
				await m.unmount();
				return pixels;
			};
			const [a, b] = [await draw(), await draw()];
			expect(a.length).toBeGreaterThan(0);
			expect(a.some((v) => v !== 0)).toBe(true);
			let same = true;
			for (let i = 0; i < a.length && same; i++) same = a[i] === b[i];
			expect(same).toBe(true);
		}
	);

	test('leaks nothing when tables are loaded again', async () => {
		const load = async (fixture: string) => {
			const sidecar = await loadSidecar(fixture);
			return loadView(fixture, sidecar.ambient, 'gm');
		};
		const village = await load('village');
		const hollow = await load('hollow');
		const sidecar = await loadSidecar('village');
		const m = await mountFixture(village, sidecar.poses.overview);
		mounted.push(m);
		const t = m.tabletop;
		// Environments' textures are kept once drawn, like models (#172): loaded once the table is
		// there (its renderer decodes the KTX2 files), so the first round trip draws both looks and fills that cache, whatever the loading takes.
		await Promise.all(
			[village, hollow].map((v) => v.environment && loadEnvironment(v.environment))
		);
		// And both tables' models, as mountFixture loads the one it mounts: on a loaded machine the
		// Hollow's could otherwise still be arriving after the first round trip.
		await Promise.all(
			[village, hollow]
				.flatMap((v) => [
					...v.tokens.flatMap((t) => (t.model ? [t.model] : [])),
					...v.props.map((p) => p.assetId)
				])
				.map((id) => loadModel(id))
		);
		await settle(t);
		const show = async (view: typeof village) => {
			t.setGrid(view.grid);
			t.setTokens(view.tokens);
			t.setObjects(view.objects);
			t.setFog(view.fog, view.fogMode);
			t.setLighting(view.ambient, view.lights);
			t.setProps(view.props);
			t.setEnvironment(view.environment);
			await settle(t);
			return t.stats();
		};
		// The first round trip fills the caches (the Hollow's models and shaders stay loaded,
		// by design); after that, going round again must leave everything where it was.
		await show(hollow);
		const back = await show(village);
		await show(hollow);
		const again = await show(village);
		expect(again.geometries).toBeLessThanOrEqual(back.geometries);
		expect(again.textures).toBeLessThanOrEqual(back.textures);
		expect(again.programs).toBe(back.programs);
	});

	// #380: a new table of another size replaced the cell maps' textures and destroyed the old
	// ones, which a material without nodes still had bound ("Destroyed texture used in a submit" on
	// WebGPU, a console.error that fails the test). WebGL2 is the control. Going round again
	// compiles and keeps nothing more.
	for (const tier of TIERS) {
		// Every tier on WebGPU; WebGL2's control takes the low one (SwiftShader takes minutes a tier).
		const run = BACKEND === 'webgl' && tier !== 'low' ? test.skip : test;
		run(`switches between tables of different sizes on ${tier} without errors`, async () => {
			const views = await Promise.all(
				['dungeon-40', 'crowd-60'].map(async (f) =>
					loadView(f, (await loadSidecar(f)).ambient, 'gm')
				)
			);
			const sidecar = await loadSidecar('dungeon-40');
			const m = await mountFixture(views[0], sidecar.poses.overview, { tier });
			mounted.push(m);
			const t = m.tabletop;
			await settle(t);
			const after: ReturnType<typeof t.stats>[] = [];
			for (const view of [views[1], views[0], views[1]]) {
				const size = view.grid.width * view.grid.height;
				t.setGrid(view.grid);
				t.setTerrain(view.terrain ? decodeLevels(view.terrain, size) : null);
				t.setFloor(view.floor ? decodeFloor(view.floor, size) : null);
				t.setDarkness(view.darkness ? decodeMask(view.darkness, size) : null);
				t.setInterior(view.interior ? decodeMask(view.interior, size) : null);
				t.setEnvironment(view.environment);
				t.setTokens(view.tokens);
				t.setObjects(view.objects);
				t.setFog(view.fog, view.fogMode);
				t.setLighting(view.ambient, view.lights, view.world);
				t.setProps(view.props);
				await t.benchmark(2); // frames at once, as a table arriving draws
				await settle(t);
				after.push(t.stats());
			}
			expect(after[2].textures).toBeLessThanOrEqual(after[0].textures);
			expect(after[2].programs).toBe(after[0].programs);
		});
	}

	// #167: the tiles' seams are the grid; lines show only while building, placing or aiming.
	test('compiles nothing new the second time round the times of day', async () => {
		const { tabletop } = await mount('village', 'gm');
		const view = await loadView('village', 'day', 'gm');
		const cycle = async () => {
			for (const band of ['day', 'dusk', 'dark'] as const) {
				tabletop.setLighting(band, view.lights);
				await settle(tabletop);
			}
		};
		await cycle();
		const programs = tabletop.stats().programs;
		await cycle();
		expect(tabletop.stats().programs).toBe(programs);
	});

	// A tabletop rebuilt before it framed a table (a first visit's shape change) carried the
	// camera from the origin, which then undid the view: nothing to carry until a table is framed.
});

describe('measuring', () => {
	test('reports what it draws, still after a second idle, and benchmarks', async () => {
		const sidecar = await loadSidecar('ref-7');
		const view = await loadView('ref-7', sidecar.ambient, 'gm');
		const m = await mountFixture(view, sidecar.poses.overview, { perf: true });
		mounted.push(m);
		await settle(m.tabletop);
		await wait(1000);
		const stats = m.tabletop.stats();
		expect(stats.drawCalls).toBeGreaterThan(0);
		expect(stats.programs).toBeGreaterThan(0);
		expect(stats.memoryBytes).toBeGreaterThan(0);
		const b = await m.tabletop.benchmark(2);
		expect(Number.isFinite(b.cpu)).toBe(true);
		expect(b.drawCalls).toBeGreaterThan(0);
		if (BACKEND === 'webgl') {
			// SwiftShader, WebGL2: software, whose timestamps mean nothing, so frames are waited for.
			expect(stats.backend).toBe('webgl2');
			expect(stats.adapter).toMatch(/swiftshader/i);
			expect(b.gpuTimer).toBe('sync');
		} else {
			// The real GPU on WebGPU (vite.config.ts), timed by its own clock.
			expect(stats.backend).toBe('webgpu');
			expect(stats.adapter).not.toMatch(/swiftshader/i);
			expect(b.gpuTimer).toBe('timestamp');
		}
		expect(Number.isFinite(b.gpu)).toBe(true);
	});

	test('resolves no timestamps outside ?perf', async () => {
		const resolve = vi.spyOn(THREE.WebGPURenderer.prototype, 'resolveTimestampsAsync');
		const { tabletop } = await mount('ref-7', 'gm');
		await tabletop.sampleGpu();
		await tabletop.benchmark(2);
		expect(resolve).not.toHaveBeenCalled();
		expect(tabletop.stats().gpuMs).toBeNull();
		resolve.mockRestore();
	});
});

describe('quality tiers', () => {
	test('find a software rasteriser under SwiftShader (low), and a GPU on WebGPU', async () => {
		const { tabletop } = await mount('ref-7', 'gm');
		const caps = tabletop.capabilities();
		expect(caps.software).toBe(BACKEND === 'webgl');
		if (BACKEND === 'webgl') expect(qualityFor(caps)).toBe('low');
		else expect(qualityFor(caps)).not.toBe('low');
	});

	test('keep 4K at DPR 2 on medium within 2.1 MP', async () => {
		const dpr = vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);
		const canvas = document.createElement('canvas');
		canvas.style.cssText = 'display:block;width:3840px;height:2160px';
		document.body.appendChild(canvas);
		const t = await createTabletop(
			canvas,
			{ onClick: () => {}, onHover: () => {} },
			{
				backend: BACKEND === 'webgpu' ? 'webgpu' : 'webgl',
				preserveDrawingBuffer: BACKEND === 'webgl'
			}
		);
		t.setQuality(settingsFor('medium', t.capabilities().backend));
		expect(canvas.width * canvas.height).toBeLessThanOrEqual(2.1e6 + 3840);
		expect(canvas.width * canvas.height).toBeGreaterThan(1.9e6);
		await t.dispose();
		canvas.remove();
		dpr.mockRestore();
	});

	// Tiers with other antialiasing or no prepass get a new renderer (Tabletop.svelte).
	test('change no program between tiers with the same post-processing stages', async () => {
		const { tabletop } = await mount('ref-7', 'gm');
		const backend = tabletop.capabilities().backend;
		tabletop.setQuality(settingsFor('high', backend));
		await settle(tabletop);
		const programs = tabletop.stats().programs;
		for (const tier of ['ultra', 'high', 'ultra'] as const) {
			tabletop.setQuality(settingsFor(tier, backend));
			await settle(tabletop);
		}
		expect(tabletop.stats().programs).toBe(programs);
	});
});
