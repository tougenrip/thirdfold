// Renderer smoke tests (milestone 61): every fixture table draws for every
// viewer without errors, frames are deterministic, an idle table draws
// nothing, ambient animation stays at its slow rate, and reloading tables or
// cycling the time of day leaks nothing and compiles nothing new.

import * as THREE from 'three/webgpu';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTabletop } from './renderer';
import { qualityFor, settingsFor, withOverrides } from './quality';
import {
	BACKEND,
	FIXTURES,
	loadSidecar,
	loadView,
	manualClock,
	mountFixture,
	settle,
	wait,
	type Mounted,
	type Viewer
} from './testing';

vi.setConfig({ testTimeout: 60_000 });

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

describe('every fixture', () => {
	for (const fixture of FIXTURES) {
		for (const viewer of ['gm', 'player', 'spectator'] as const) {
			it(`${fixture} draws for the ${viewer}`, async () => {
				const { tabletop } = await mount(fixture, viewer);
				const stats = tabletop.stats();
				expect(stats.frames).toBeGreaterThanOrEqual(1);
				expect(stats.drawCalls).toBeGreaterThan(0);
			});
		}
	}
});

describe('the renderer', () => {
	// Reads pixels back, which only WebGL2 does here; on WebGPU the golden images compare frames.
	it.skipIf(BACKEND === 'webgpu')(
		'draws the same pixels for the same table, pose and frozen clock',
		async () => {
			const sidecar = await loadSidecar('ref-1');
			const view = await loadView('ref-1', sidecar.ambient, 'gm');
			const draw = async () => {
				const m = await mountFixture(view, sidecar.poses.close, { clock: manualClock(5000) });
				await settle(m.tabletop);
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

	it('converges TRAA within 32 frames of a move, then draws nothing', async () => {
		const sidecar = await loadSidecar('ref-7');
		const view = await loadView('ref-7', 'day', 'gm');
		// A real clock, so the move's tween ends.
		const m = await mountFixture(view, sidecar.poses.overview, {
			reducedMotion: false,
			clock: { now: () => performance.now() }
		});
		mounted.push(m);
		const t = m.tabletop;
		const backend = t.capabilities().backend;
		// Low with TRAA on: High's full AO makes software rendering too slow to wait out.
		t.setQuality(withOverrides(settingsFor('low', backend), { aa: 'traa' }, backend));
		await settle(t);
		const token = view.tokens[0];
		t.setTokens(
			view.tokens.map((k) => (k === token ? { ...k, pos: { ...k.pos, x: k.pos.x + 1 } } : k))
		);
		// The frames from the end of the move until the table is idle.
		await expect.poll(() => t.stats().mode, { timeout: 30_000, interval: 20 }).toBe('converge');
		const moved = t.stats().frames;
		await expect.poll(() => t.stats().mode, { timeout: 60_000, interval: 50 }).toBe('idle');
		const converge = t.stats().frames - moved;
		expect(converge).toBeGreaterThan(0);
		expect(converge).toBeLessThanOrEqual(32);
		const settled = t.stats().frames;
		await wait(3000);
		expect(t.stats().frames - settled).toBe(0);
	});

	it('draws nothing while a daylight table is idle', async () => {
		const { tabletop } = await mount('ref-7', 'gm', { reducedMotion: false });
		const before = tabletop.stats().frames;
		await wait(3000);
		expect(tabletop.stats().frames - before).toBe(0);
	});

	it('draws flickering torchlight at the slow ambient rate, never every frame', async () => {
		const { tabletop } = await mount('ref-1', 'gm', { reducedMotion: false });
		const before = tabletop.stats().frames;
		await wait(3000);
		// AMBIENT_MS is 80 (scheduler.ts): at most about 38 frames in 3 s.
		expect(tabletop.stats().frames - before).toBeLessThanOrEqual(40);
	});

	it('draws no ambient frames while the tab is hidden, and reports its mode', async () => {
		const { tabletop } = await mount('ref-1', 'gm', { reducedMotion: false });
		// On a slow machine the table may still be settling (active) at first.
		await expect.poll(() => tabletop.stats().mode, { timeout: 10_000 }).toBe('ambient');
		const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
		document.dispatchEvent(new Event('visibilitychange'));
		await wait(300);
		const before = tabletop.stats().frames;
		await wait(1000);
		expect(tabletop.stats().frames - before).toBe(0);
		expect(tabletop.stats().mode).toBe('idle');
		hidden.mockRestore();
		document.dispatchEvent(new Event('visibilitychange'));
		await wait(500);
		expect(tabletop.stats().frames).toBeGreaterThan(before);
	});

	it('draws nothing in the dark while motion is reduced', async () => {
		const { tabletop } = await mount('ref-1', 'gm', { reducedMotion: true });
		const before = tabletop.stats().frames;
		await wait(3000);
		expect(tabletop.stats().frames - before).toBe(0);
	});

	it('stops ambient frames as soon as the system asks for reduced motion', async () => {
		let listener: ((e: { matches: boolean }) => void) | null = null;
		const query = {
			matches: false,
			addEventListener: (_: string, fn: typeof listener) => (listener = fn),
			removeEventListener: () => {}
		};
		// Only the reduced-motion query: the canvas also watches the screen's resolution.
		const real = window.matchMedia.bind(window);
		const stub = vi
			.spyOn(window, 'matchMedia')
			.mockImplementation((q) =>
				q.includes('reduced-motion') ? (query as unknown as MediaQueryList) : real(q)
			);
		const { tabletop } = await mount('ref-1', 'gm', { reducedMotion: undefined });
		stub.mockRestore();
		const flickering = tabletop.stats().frames;
		await wait(1000);
		expect(tabletop.stats().frames).toBeGreaterThan(flickering);
		expect(listener).not.toBeNull();
		listener!({ matches: true });
		await settle(tabletop);
		const before = tabletop.stats().frames;
		await wait(3000);
		expect(tabletop.stats().frames - before).toBe(0);
	});

	it('leaks nothing when tables are loaded again', async () => {
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

	it('compiles nothing new the second time round the times of day', async () => {
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
	it('has no camera pose to carry before it frames a table', async () => {
		const canvas = document.createElement('canvas');
		document.body.appendChild(canvas);
		const t = await createTabletop(
			canvas,
			{ onClick: () => {}, onHover: () => {} },
			{ backend: BACKEND === 'webgpu' ? 'webgpu' : 'webgl' }
		);
		expect(t.cameraPose()).toBeNull();
		await t.dispose();
		canvas.remove();
		const { tabletop } = await mount('ref-7', 'gm');
		expect(tabletop.cameraPose()).not.toBeNull();
	});

	it('disposes cleanly and stops answering the pointer', async () => {
		const sidecar = await loadSidecar('ref-1');
		const view = await loadView('ref-1', sidecar.ambient, 'gm');
		const events = { onClick: vi.fn(), onHover: vi.fn() };
		const m = await mountFixture(view, sidecar.poses.overview, { events });
		await settle(m.tabletop);
		expect(() => m.tabletop.dispose()).not.toThrow();
		const at = { clientX: 400, clientY: 250, bubbles: true };
		m.canvas.dispatchEvent(new PointerEvent('pointermove', at));
		m.canvas.dispatchEvent(new PointerEvent('pointerdown', at));
		m.canvas.dispatchEvent(new PointerEvent('pointerup', at));
		expect(events.onHover).not.toHaveBeenCalled();
		expect(events.onClick).not.toHaveBeenCalled();
		m.canvas.remove();
	});
});

describe('measuring', () => {
	it('reports what it draws, still after a second idle, and benchmarks', async () => {
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

	it('resolves no timestamps outside ?perf', async () => {
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
	it('find a software rasteriser under SwiftShader (low), and a GPU on WebGPU', async () => {
		const { tabletop } = await mount('ref-7', 'gm');
		const caps = tabletop.capabilities();
		expect(caps.software).toBe(BACKEND === 'webgl');
		if (BACKEND === 'webgl') expect(qualityFor(caps)).toBe('low');
		else expect(qualityFor(caps)).not.toBe('low');
	});

	it('keep 4K at DPR 2 on medium within 2.1 MP', async () => {
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
	it('change no program between tiers with the same post-processing stages', async () => {
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
