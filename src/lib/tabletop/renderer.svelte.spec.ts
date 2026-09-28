// Renderer smoke tests (milestone 61): an idle table draws nothing, ambient
// animation stays at its slow rate, TRAA converges, grid lines show and fade,
// and a disposed tabletop answers nothing. Every fixture drawing for every
// viewer is fixtures.svelte.spec.ts; determinism, leaks and recompiles are
// stability.svelte.spec.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRID_FADE_MS } from './overlay';
import { createTabletop } from './renderer';
import { settingsFor, withOverrides } from './quality';
import {
	BACKEND,
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

describe('the renderer', () => {
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

	it('draws no grid lines at rest, one draw call when shown, compiling nothing', async () => {
		const { tabletop } = await mount('village', 'gm');
		await settle(tabletop);
		const draw = async (shown: boolean) => {
			tabletop.setGridShown(shown);
			await settle(tabletop);
			await tabletop.benchmark(1);
			return tabletop.stats();
		};
		const rest = await draw(false);
		const shown = await draw(true);
		expect(shown.drawCalls).toBe(rest.drawCalls + 1);
		const again = await draw(false);
		expect(again.drawCalls).toBe(rest.drawCalls);
		expect(again.programs).toBe(shown.programs);
	});

	it('fades the grid lines in and out on the clock, drawing until they are gone', async () => {
		const clock = manualClock();
		const sidecar = await loadSidecar('ref-7');
		const view = await loadView('ref-7', 'day', 'gm');
		const m = await mountFixture(view, sidecar.poses.overview, { clock, reducedMotion: false });
		mounted.push(m);
		const t = m.tabletop;
		await settle(t);
		const drawAt = async (ms: number) => {
			clock.set(clock.now() + ms);
			await settle(t);
			await t.benchmark(1);
			return t.stats();
		};
		const rest = await drawAt(0);
		t.setGridShown(true);
		const shown = await drawAt(GRID_FADE_MS);
		expect(shown.drawCalls).toBe(rest.drawCalls + 1);
		// Halfway out the clock stands still: the lines are still drawn, and frames keep coming.
		t.setGridShown(false);
		clock.set(clock.now() + GRID_FADE_MS / 2);
		const frames = t.stats().frames;
		await wait(300);
		expect(t.stats().frames).toBeGreaterThan(frames);
		expect(t.stats().mode).toBe('active');
		await t.benchmark(1);
		expect(t.stats().drawCalls).toBe(rest.drawCalls + 1);
		// Faded out, they cost no draw call, the table goes quiet, and nothing was compiled.
		const gone = await drawAt(GRID_FADE_MS);
		expect(gone.drawCalls).toBe(rest.drawCalls);
		expect(gone.programs).toBe(shown.programs);
		const quiet = t.stats().frames;
		await wait(1000);
		expect(t.stats().frames).toBe(quiet);
	});

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
