// Every fixture table draws for every viewer without errors (milestone 61),
// apart from the other renderer smoke tests so CI can run them side by side,
// and in shards (`THIRDFOLD_SHARD=k/n`: every nth fixture from the kth). A
// benchmark asked for while the first warm-up holds frames draws too, as the
// perf scripts do (#379): on WebGPU a pipeline error is a console.error, which
// fails the test.

import { afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import {
	FIXTURES,
	loadSidecar,
	loadView,
	mountFixture,
	settle,
	wait,
	type Mounted,
	type Viewer
} from './testing';

// Software frames on CI's small runners take seconds since the shader kinds (M64).
vi.setConfig({ testTimeout: 180_000, hookTimeout: 90_000 });

const [k, n] = inject('shard').split('/').map(Number);
const SHARD = FIXTURES.filter((_, i) => i % n === k - 1);

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

async function mount(fixture: string, viewer: Viewer) {
	const sidecar = await loadSidecar(fixture);
	const view = await loadView(fixture, sidecar.ambient, viewer);
	const m = await mountFixture(view, sidecar.poses.overview);
	mounted.push(m);
	// Frames drawn during the warm-up (which keeps the scene pass's targets set) must wait for it.
	for (let t = 0; t < 5000 && !m.tabletop.stats().holding; t += 20) await wait(20);
	await m.tabletop.benchmark(2);
	await settle(m.tabletop);
	return m;
}

describe('every fixture', () => {
	for (const fixture of SHARD) {
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
