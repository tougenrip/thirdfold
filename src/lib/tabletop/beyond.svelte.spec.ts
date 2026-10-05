// What lies beyond the grid (#244), drawn: on the village at dusk as a fogged player sees it, the
// skirt and the two silhouettes (the forest and the mountain with its monastery) are there, never
// picked and casting nothing, the mountain shows where the first bell looks (not black for a player,
// changed by taking the backdrop away), and every backdrop kind and every environment compile
// nothing. A render spec (RENDER_SPECS).

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKDROPS, type WorldLook } from '$lib/game/world';
import { loadManifest } from '$lib/assets/load';
import { loadEnvironment } from './environment';
import {
	HEIGHT,
	loadSidecar,
	loadView,
	manualClock,
	mountFixture,
	readFrame,
	settle,
	WIDTH,
	type Mounted
} from './testing';

vi.setConfig({ testTimeout: 300_000 });

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
	vi.restoreAllMocks();
});

/** The backdrop's meshes: the surface kind, not instanced, never picked, casting nothing. */
function beyondMeshes(scene: THREE.Scene): THREE.Mesh[] {
	const out: THREE.Mesh[] = [];
	scene.traverse((o) => {
		if (
			o instanceof THREE.Mesh &&
			!(o instanceof THREE.InstancedMesh) &&
			(o.material as { kind?: string }).kind === 'surface' &&
			o.raycast !== THREE.Mesh.prototype.raycast &&
			o.visible
		)
			out.push(o);
	});
	return out;
}

/** Mean brightness (0-255) of the frame's pixels in a box, from the top left. */
function mean(
	read: (x: number, y: number) => number[],
	x0: number,
	y0: number,
	x1: number,
	y1: number
) {
	let sum = 0;
	let n = 0;
	for (let y = y0; y < y1; y += 2)
		for (let x = x0; x < x1; x += 2) {
			const [r, g, b] = read(x, y);
			sum += (r + g + b) / 3;
			n++;
		}
	return sum / n;
}

describe('the backdrop', () => {
	it('shows a fogged player the village’s mountain, and kinds and environments compile nothing', async () => {
		const sidecar = await loadSidecar('village');
		const view = await loadView('village', sidecar.ambient, 'player');
		const compile = vi.spyOn(THREE.WebGPURenderer.prototype, 'compileAsync');
		const clock = manualClock();
		// Low over the square, looking up the mountain path (azimuth 30: toward the north-west).
		const pose = { target: { x: 18, y: 14 }, distance: 45, azimuth: 30, elevation: 12 };
		const m = await mountFixture(view, pose, { clock, heroes: false });
		mounted = m;
		const t = m.tabletop;
		await settle(t, 400, 60_000, clock);
		const scene = compile.mock.calls[0][2] as THREE.Scene;

		// The skirt, the forest and the mountain: received, never cast, never picked.
		const meshes = beyondMeshes(scene);
		expect(meshes).toHaveLength(3);
		for (const mesh of meshes) expect(mesh.castShadow).toBe(false);

		// The mountain stands over the horizon in the middle of the view, not black for a player;
		// taking the backdrop away changes it.
		const box = [WIDTH / 2 - 80, HEIGHT * 0.12, WIDTH / 2 + 80, HEIGHT * 0.4] as const;
		const withIt = mean(await readFrame(m.canvas, WIDTH, HEIGHT), ...box);
		expect(withIt).toBeGreaterThan(8);
		const look = (backdrop: WorldLook['backdrop']): WorldLook => ({ ...view.world, backdrop });
		t.setLighting(view.ambient, view.lights, look({ kind: 'none', level: 0 }));
		await settle(t, 400, 60_000, clock);
		expect(beyondMeshes(scene)).toHaveLength(1); // the skirt alone
		const without = mean(await readFrame(m.canvas, WIDTH, HEIGHT), ...box);
		expect(Math.abs(withIt - without)).toBeGreaterThan(2);

		// Every kind at two levels, then every environment: geometry, params and slots only.
		const before = t.stats();
		for (const kind of BACKDROPS)
			for (const level of [0, 2]) {
				t.setLighting(view.ambient, view.lights, look({ kind, level }));
				await settle(t, 400, 60_000, clock);
			}
		t.setLighting(view.ambient, view.lights, view.world);
		for (const env of Object.keys((await loadManifest()).environments)) {
			t.setEnvironment(env);
			await loadEnvironment(env);
			await settle(t, 400, 60_000, clock);
			expect(beyondMeshes(scene).length, env).toBeGreaterThan(1);
		}
		expect(t.stats().programs).toBe(before.programs);
		expect(t.stats().pipelines).toBe(before.pipelines);
	});
});
