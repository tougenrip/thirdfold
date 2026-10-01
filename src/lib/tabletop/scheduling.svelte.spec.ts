// When the renderer draws (milestone 61, #148, #163): an idle table draws
// nothing, torchlight flickers at the slow ambient rate and stops for a hidden
// tab or reduced motion, and TRAA converges and then stops. Apart from
// renderer.svelte.spec.ts so CI runs the two side by side.

import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import type { Ambient } from '$lib/game/lights';
import { settingsFor, withOverrides } from './quality';
import {
	loadSidecar,
	loadView,
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

async function mount(
	fixture: string,
	viewer: Viewer,
	options: { reducedMotion?: boolean; band?: Ambient } = {}
) {
	const sidecar = await loadSidecar(fixture);
	const view = await loadView(fixture, options.band ?? sidecar.ambient, viewer);
	const m = await mountFixture(view, sidecar.poses.overview, options);
	mounted.push(m);
	// At rest for a while: on a loaded machine something loading can land after a short quiet
	// spell and draw once, which is the table arriving, not what these tests count.
	await settle(m.tabletop, 2000, 30_000);
	return m;
}

describe('the render scheduler', () => {
	test('converges TRAA within 32 frames of a move, then draws nothing', async () => {
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

	test('draws nothing while a daylight table is idle', async () => {
		const { tabletop } = await mount('ref-7', 'gm', { reducedMotion: false });
		const before = tabletop.stats().frames;
		await wait(3000);
		expect(tabletop.stats().frames - before).toBe(0);
	});

	test('draws nothing by day, though a torch burns: its flicker does not read (#231)', async () => {
		const { tabletop } = await mount('ref-1', 'gm', { reducedMotion: false, band: 'day' });
		const before = tabletop.stats().frames;
		await wait(3000);
		expect(tabletop.stats().frames - before).toBe(0);
	});

	test('draws nothing at night when no light in view flickers (#231)', async () => {
		const m = await mount('ref-1', 'gm', { reducedMotion: false });
		const view = await loadView('ref-1', (await loadSidecar('ref-1')).ambient, 'gm');
		const steady = view.lights.map((l) => ({ ...l, flicker: 'none' as const }));
		m.tabletop.setLighting(view.ambient, steady, view.world);
		await settle(m.tabletop);
		const before = m.tabletop.stats().frames;
		await wait(3000);
		expect(m.tabletop.stats().frames - before).toBe(0);
	});

	test('draws flickering torchlight at the slow ambient rate, never every frame', async () => {
		const { tabletop } = await mount('ref-1', 'gm', { reducedMotion: false });
		const before = tabletop.stats().frames;
		await wait(3000);
		// AMBIENT_MS is 80 (scheduler.ts): at most about 38 frames in 3 s.
		expect(tabletop.stats().frames - before).toBeLessThanOrEqual(40);
	});

	test('draws no ambient frames while the tab is hidden, and reports its mode', async () => {
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

	test('draws nothing in the dark while motion is reduced', async () => {
		const { tabletop } = await mount('ref-1', 'gm', { reducedMotion: true });
		const before = tabletop.stats().frames;
		await wait(3000);
		expect(tabletop.stats().frames - before).toBe(0);
	});

	test('stops ambient frames as soon as the system asks for reduced motion', async () => {
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
});
