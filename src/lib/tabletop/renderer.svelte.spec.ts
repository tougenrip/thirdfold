// Renderer smoke tests (milestone 61): grid lines show and fade, a tabletop
// with no table carries no camera pose, and a disposed tabletop answers
// nothing. When frames are drawn (idle, ambient, converge) is
// scheduling.svelte.spec.ts; every fixture drawing for every viewer is
// fixtures.svelte.spec.ts; determinism, leaks and recompiles are
// stability.svelte.spec.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRID_FADE_MS } from './overlay';
import { createTabletop } from './renderer';
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

// Software frames on CI's small runners take seconds since the shader kinds (M64).
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

describe('the renderer', () => {
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
