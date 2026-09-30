// Recovery from a lost graphics device (#150): the component makes a new
// tabletop on a fresh canvas and replays the table into it, the camera where
// it was, one tier lower, with nothing left behind.

import { commands, page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { decodeFloor } from '$lib/game/floor';
import { decodeLevels } from '$lib/game/terrain';
import Tabletop from './Tabletop.svelte';
import { BACKEND, loadSidecar, loadView, settle } from './testing';

declare module 'vitest/browser' {
	interface BrowserCommands {
		/** Crashes the GPU process (vite.config.ts). */
		crashGpu: () => Promise<void>;
	}
}
import type { Tabletop as Renderer } from './types';

// Software frames on CI's small runners take seconds since the shader kinds (M64).
vi.setConfig({ testTimeout: 180_000, hookTimeout: 90_000 });

/** The table's stats once its geometry and texture counts hold still for a second. */
async function steady(t: Renderer) {
	let last = t.stats();
	for (let i = 0; i < 20; i++) {
		await new Promise((r) => setTimeout(r, 1000));
		const now = t.stats();
		if (now.geometries === last.geometries && now.textures === last.textures) return now;
		last = now;
	}
	return last;
}

/**
 * After a GPU-process crash Chrome's WebGPU takes a while to come back (adapters are missing, or the
 * instance is dropped), which would fail the tests after this one: wait until a device works.
 */
async function gpuBack(): Promise<void> {
	for (let i = 0; i < 60; i++) {
		try {
			const adapter = await navigator.gpu?.requestAdapter();
			const device = await adapter?.requestDevice();
			if (device) {
				device.queue.submit([device.createCommandEncoder().finish()]);
				await device.queue.onSubmittedWorkDone();
				device.destroy();
				return;
			}
		} catch {
			// not back yet
		}
		await new Promise((r) => setTimeout(r, 250));
	}
}

const perfApi = () => (window as { thirdfoldPerf?: Renderer }).thirdfoldPerf;

afterEach(() => history.replaceState(null, '', location.pathname));

describe('a lost WebGL context or WebGPU device', () => {
	it('brings the same table back on a new canvas, a tier lower, leaking nothing', async () => {
		// ?perf exposes the tabletop's stats; ?tier= fixes the tier this test starts from.
		history.replaceState(null, '', '?perf&tier=high');
		const errors = vi.spyOn(console, 'error');
		const view = await loadView('ref-7', 'day', 'gm');
		const size = view.grid.width * view.grid.height;
		// Wrapped: the component has a prop called `props`, which render() would read as its options.
		render(Tabletop, {
			props: {
				grid: view.grid,
				tokens: view.tokens,
				objects: view.objects,
				props: view.props,
				lights: view.lights,
				ambient: view.ambient,
				environment: view.environment,
				fog: view.fog,
				fogMode: view.fogMode,
				terrain: view.terrain ? decodeLevels(view.terrain, size) : null,
				floor: view.floor ? decodeFloor(view.floor, size) : null
			}
		});
		await expect.poll(() => perfApi()?.stats().frames ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
		const first = perfApi()!;
		const sidecar = await loadSidecar('ref-7');
		first.setGridPose(sidecar.poses.close);
		await settle(first);
		// Models and the environment arrive over a while on a slow machine: count once they have.
		const before = await steady(first);
		// The first table's cover has lifted, so the one after the loss is the rebuild's.
		const cover = () => document.querySelector<HTMLElement>('[data-cover]')?.dataset.cover ?? null;
		await expect.poll(cover, { timeout: 60_000 }).toBeNull();
		const pose = first.cameraPose();
		const oldCanvas = document.querySelector('canvas')!;

		// WebGL2: lose the context. WebGPU: crash the GPU process (a device.destroy() never reaches
		// three's handler, whose reason is then 'destroyed'), a real loss like a driver reset.
		if (BACKEND === 'webgpu') await commands.crashGpu();
		else oldCanvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext();

		// The rebuild's cover says so from the loss until it lifts, whatever stage it is at.
		await expect.poll(cover, { timeout: 10_000 }).toBe('restoring');
		await expect.element(page.getByText('Restoring the table')).toBeInTheDocument();
		await expect
			.poll(() => perfApi() !== first && (perfApi()?.stats().frames ?? 0) > 0, { timeout: 5000 })
			.toBe(true);
		const second = perfApi()!;
		await settle(second);
		await steady(second);
		expect(document.querySelector('canvas')).not.toBe(oldCanvas);
		await expect.poll(cover, { timeout: 60_000 }).toBeNull();
		const after = second.stats();
		expect(after.tier).toBe('medium');
		expect(second.cameraPose()).toEqual(pose);
		// Nothing left behind; the first tabletop also drew (and on WebGPU compiled) placeholder
		// boxes until the models arrived, which the second, with the models loaded, never needs.
		expect(after.geometries).toBeLessThanOrEqual(before.geometries);
		expect(after.textures).toBeLessThanOrEqual(before.textures);
		expect(after.programs).toBeLessThanOrEqual(before.programs);
		if (BACKEND === 'webgpu') await gpuBack();
		expect(errors).not.toHaveBeenCalled();
		errors.mockRestore();
	});
});
