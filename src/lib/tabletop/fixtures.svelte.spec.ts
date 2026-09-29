// Every fixture table draws for every viewer without errors (milestone 61),
// apart from the other renderer smoke tests so CI can run them side by side,
// and in shards (`THIRDFOLD_SHARD=k/n`: every nth fixture from the kth).

import { afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import {
	FIXTURES,
	loadSidecar,
	loadView,
	mountFixture,
	settle,
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
