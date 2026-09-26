// Recovery from a lost graphics device (#150): the component makes a new
// tabletop on a fresh canvas and replays the table into it, the camera where
// it was, one tier lower, with nothing left behind.

import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { decodeFloor } from '$lib/game/floor';
import { decodeLevels } from '$lib/game/terrain';
import Tabletop from './Tabletop.svelte';
import { loadSidecar, loadView, settle } from './testing';
import type { Tabletop as Renderer } from './types';

vi.setConfig({ testTimeout: 60_000 });

const perfApi = () => (window as { thirdfoldPerf?: Renderer }).thirdfoldPerf;

afterEach(() => history.replaceState(null, '', location.pathname));

describe('a lost WebGL context', () => {
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
		const before = first.stats();
		const pose = first.cameraPose();
		const oldCanvas = document.querySelector('canvas')!;

		oldCanvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext();

		await expect.element(page.getByText('Restoring the table…')).toBeInTheDocument();
		await expect
			.poll(() => perfApi() !== first && (perfApi()?.stats().frames ?? 0) > 0, { timeout: 5000 })
			.toBe(true);
		const second = perfApi()!;
		await settle(second);
		expect(document.querySelector('canvas')).not.toBe(oldCanvas);
		await expect.element(page.getByText('Restoring the table…')).not.toBeInTheDocument();
		const after = second.stats();
		expect(after.tier).toBe('medium');
		expect(second.cameraPose()).toEqual(pose);
		// Nothing left behind; the first tabletop also drew placeholder boxes until the models
		// arrived, which the second, with the models loaded, never needs.
		expect(after.geometries).toBeLessThanOrEqual(before.geometries);
		expect(after.textures).toBeLessThanOrEqual(before.textures);
		expect(after.programs).toBe(before.programs);
		expect(errors).not.toHaveBeenCalled();
		errors.mockRestore();
	});
});
