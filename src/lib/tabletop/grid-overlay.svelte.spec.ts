// The shader grid (#245) on the monastery, the showcase of height: every chunk's tops have a twin
// in the overlay's scene on the overlay kind's grid variant, sharing the top's geometry (so the
// lines lie on the gallery, the ledge and the belfry at their levels, and follow a raise), hidden
// while the grid is off; and the modes draw as they should: the full grid in build, less of it
// round the focus in explore, fainter in overview, nothing off, compiling nothing between them.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeLevels } from '$lib/game/terrain';
import type { GridMode } from './grid-modes';
import { loadSidecar, loadView, manualClock, mountFixture, settle, type Mounted } from './testing';

vi.setConfig({ testTimeout: 240_000 });

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
	vi.restoreAllMocks();
});

const shown = (o: THREE.Object3D | null): boolean => !o || (o.visible && shown(o.parent));
const kind = (o: THREE.Object3D) =>
	(o as THREE.Mesh).material as { kind?: string; options?: object };

async function mountMonastery() {
	const sidecar = await loadSidecar('monastery');
	const view = await loadView('monastery', sidecar.ambient, 'gm');
	const compile = vi.spyOn(THREE.WebGPURenderer.prototype, 'compileAsync');
	const clock = manualClock();
	const m = await mountFixture(view, sidecar.poses.overview, { clock, heroes: false });
	mounted = m;
	await settle(m.tabletop, 400, 60_000, clock);
	// The table's scene and the overlay's, as the warm-up compiled them.
	const scenes = new Set(compile.mock.calls.map((c) => c[2] as THREE.Scene));
	const find = (test: (o: THREE.Mesh) => boolean) => {
		const out: THREE.Mesh[] = [];
		for (const s of scenes)
			s.traverse((o) => {
				if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && test(o)) out.push(o);
			});
		return out;
	};
	const tops = () =>
		find(
			(o) =>
				kind(o).kind === 'terrain' && !o.castShadow && o.raycast !== THREE.Mesh.prototype.raycast
		);
	const twins = () =>
		// Not the warm-up's stand-in, which is never culled.
		find((o) => !!(kind(o).options as { grid?: boolean } | undefined)?.grid && o.frustumCulled);
	return { m, view, clock, tops, twins };
}

describe('the shader grid', () => {
	it('puts a twin on every chunk top, sharing its geometry, hidden while off', async () => {
		const { m, view, clock, tops, twins } = await mountMonastery();
		const t = m.tabletop;
		const same = () => {
			const geometries = new Set(twins().map((x) => x.geometry));
			for (const top of tops()) expect(geometries.has(top.geometry)).toBe(true);
			for (const x of twins())
				expect(x.visible).toBe(tops().find((top) => top.geometry === x.geometry)!.visible);
		};
		expect(tops().length).toBe(t.stats().world!.chunks);
		expect(twins()).toHaveLength(tops().length);
		same();
		t.setGridMode('off');
		expect(twins().some(shown)).toBe(false);
		t.setGridMode('build');
		expect(twins().filter(shown).length).toBe(tops().filter(shown).length);
		// Raised two levels everywhere: the chunks rebuild, and their twins follow.
		const size = view.grid.width * view.grid.height;
		const levels = decodeLevels(view.terrain!, size)!;
		t.setTerrain(levels.map((l) => l + 2));
		await settle(t, 400, 60_000, clock);
		same();
		t.setTerrain(levels);
		await settle(t, 400, 60_000, clock);
		same();
	});

	it('draws each mode as it should, compiling nothing between them', async () => {
		const { m, clock } = await mountMonastery();
		const t = m.tabletop;
		const frame = async (mode: GridMode) => {
			t.setGridMode(mode, [{ x: 15, y: 10 }]);
			await settle(t, 400, 60_000, clock);
			return { pixels: m.pixels().slice(), programs: t.stats().programs };
		};
		const off = await frame('off');
		/** Pixels the mode changed from none, and by how much at most. */
		const change = (f: { pixels: Uint8Array }) => {
			let [count, most] = [0, 0];
			for (let i = 0; i < f.pixels.length; i += 4) {
				const d = Math.max(...[0, 1, 2].map((c) => Math.abs(f.pixels[i + c] - off.pixels[i + c])));
				if (d > 2) count++;
				most = Math.max(most, d);
			}
			return { count, most };
		};
		const build = await frame('build');
		const explore = await frame('explore');
		const overview = await frame('overview');
		const [b, e, o] = [change(build), change(explore), change(overview)];
		expect(b.count).toBeGreaterThan(500);
		expect(e.count).toBeGreaterThan(0);
		expect(e.count).toBeLessThan(b.count / 2);
		expect(o.count).toBeGreaterThan(0);
		expect(o.most).toBeLessThan(b.most);
		const again = await frame('off');
		expect(change(again).count).toBe(0);
		for (const f of [build, explore, overview, again]) expect(f.programs).toBe(off.programs);
	});
});
