// Renderer smoke tests (milestone 61): every fixture table draws for every
// viewer without errors, frames are deterministic, an idle table draws
// nothing, ambient animation stays at its slow rate, and reloading tables or
// cycling the time of day leaks nothing and compiles nothing new.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
afterEach(() => {
	for (const m of mounted.splice(0)) m.unmount();
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
	it('draws the same pixels for the same table, pose and frozen clock', async () => {
		const sidecar = await loadSidecar('ref-1');
		const view = await loadView('ref-1', sidecar.ambient, 'gm');
		const draw = async () => {
			const m = await mountFixture(view, sidecar.poses.close, { clock: manualClock(5000) });
			await settle(m.tabletop);
			const pixels = m.pixels();
			m.unmount();
			return pixels;
		};
		const [a, b] = [await draw(), await draw()];
		expect(a.length).toBeGreaterThan(0);
		expect(a.some((v) => v !== 0)).toBe(true);
		let same = true;
		for (let i = 0; i < a.length && same; i++) same = a[i] === b[i];
		expect(same).toBe(true);
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
		// AMBIENT_FRAME_MS is 80: at most about 38 frames in 3 s.
		expect(tabletop.stats().frames - before).toBeLessThanOrEqual(40);
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
		const stub = vi.spyOn(window, 'matchMedia').mockReturnValue(query as unknown as MediaQueryList);
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
