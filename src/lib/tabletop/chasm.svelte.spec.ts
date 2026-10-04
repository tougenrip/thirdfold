// Void cells as chasms (#243), drawn: the Hollow with void painted north of its lake (its abyss
// backdrop makes a chasm, open at the border) drops to the chasm's floor, cliffs falling to it,
// the floor on the surface kind in mist; every backdrop kind moves the floor (the sea, the moving
// ground) and none compiles; the night train's gaps and edges show the moving ground, its clock
// running on AMBIENT frames and held still, with no frame at all, under reduced motion. A render
// spec (RENDER_SPECS, the `chasm` job in rendering.yml).

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFloor, VOID } from '$lib/game/floor';
import { gridToWorld } from '$lib/game/grid';
import type { WorldLook } from '$lib/game/world';
import { STEP_HEIGHT } from './ground';
import { worldTime } from './materials';
import { CHASM_DEPTH, SCROLL_DEPTH, SEA_DEPTH } from './world/chasm';
import { VOID_FLOOR } from './world-layer';
import {
	HEIGHT,
	loadSidecar,
	loadView,
	manualClock,
	mountFixture,
	readFrame,
	settle,
	wait,
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

/** The void's floors drawn now (world-layer.ts), and every chunk mesh a ray down may meet. */
function meshes(scene: THREE.Scene) {
	const floors: THREE.Mesh[] = [];
	const ground: THREE.Mesh[] = [];
	scene.traverse((o) => {
		if (!(o instanceof THREE.Mesh) || !o.visible || o.raycast === THREE.Mesh.prototype.raycast)
			return;
		const kind = (o.material as { kind?: string }).kind;
		if (o.name === VOID_FLOOR) floors.push(o);
		if (o.name === VOID_FLOOR || kind === 'terrain' || kind === 'rock') ground.push(o);
	});
	return { floors, ground };
}

/** Every height a mesh's vertices stand at, to a thousandth. */
function heights(list: THREE.Mesh[]): Set<number> {
	const out = new Set<number>();
	for (const m of list) {
		const p = m.geometry.getAttribute('position');
		for (let v = 0; v < p.count; v++) out.add(Math.round(p.getY(v) * 1000) / 1000);
	}
	return out;
}

/** The highest ground straight below (x, z). */
function topAt(list: THREE.Mesh[], x: number, z: number): number {
	const ray = new THREE.Raycaster(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
	const hits: THREE.Intersection[] = [];
	for (const m of list) THREE.Mesh.prototype.raycast.call(m, ray, hits);
	return Math.max(...hits.map((h) => h.point.y));
}

describe('the void as chasms', () => {
	it("drops the Hollow's void to the chasm's floor, and every backdrop kind compiles nothing", async () => {
		const sidecar = await loadSidecar('hollow');
		const view = await loadView('hollow', sidecar.ambient, 'gm');
		const compile = vi.spyOn(THREE.WebGPURenderer.prototype, 'compileAsync');
		const clock = manualClock();
		const m = await mountFixture(view, sidecar.poses.overview, { clock, heroes: false });
		mounted = m;
		const t = m.tabletop;
		await settle(t, 400, 60_000, clock);
		const scene = compile.mock.calls[0][2] as THREE.Scene;
		const before = t.stats();
		expect(meshes(scene).floors).toEqual([]); // no void yet: the lake is water at level 0

		// Void over the lake's northern rows, out to the border.
		const { width: w, height: h } = view.grid;
		const floor = (view.floor && decodeFloor(view.floor, w * h)) || new Uint8Array(w * h);
		for (let y = 0; y < 2; y++) for (let x = 16; x < 32; x++) floor[y * w + x] = VOID;
		t.setFloor(floor.slice());
		await settle(t, 400, 60_000, clock);
		const chasm = -CHASM_DEPTH * STEP_HEIGHT;
		let { floors, ground } = meshes(scene);
		expect(floors.length).toBeGreaterThan(0);
		expect([...heights(floors)]).toEqual([Math.round(chasm * 1000) / 1000]);
		for (const f of floors) {
			expect((f.material as { kind?: string }).kind).toBe('surface');
			expect(f.castShadow).toBe(false);
		}
		const at = (x: number, y: number) => gridToWorld(view.grid, { x, y });
		expect(topAt(ground, at(20, 0).x, at(20, 0).z)).toBeCloseTo(chasm);
		expect(topAt(ground, at(20, 2).x, at(20, 2).z)).toBeCloseTo(0); // the lake beside it
		// The cliffs fall all the way down, darkening.
		const faces = ground.filter((g) => (g.material as { kind?: string }).kind === 'rock');
		expect(Math.min(...heights(faces))).toBeLessThan(chasm + 0.01);

		// Every backdrop kind: the sea's floor, the moving ground's, the chasm's; data only.
		const look = (backdrop: WorldLook['backdrop']): WorldLook => ({ ...view.world, backdrop });
		const want = { sea: -SEA_DEPTH, 'prairie-scroll': -SCROLL_DEPTH, none: -CHASM_DEPTH };
		for (const [kind, depth] of Object.entries(want)) {
			t.setLighting(view.ambient, view.lights, look({ kind: kind as 'sea', level: 0 }));
			await settle(t, 400, 60_000, clock);
			({ floors, ground } = meshes(scene));
			expect([...heights(floors)], kind).toEqual([Math.round(depth * STEP_HEIGHT * 1000) / 1000]);
			expect(topAt(ground, at(20, 0).x, at(20, 0).z), kind).toBeCloseTo(depth * STEP_HEIGHT);
		}
		t.setLighting(view.ambient, view.lights, view.world);
		t.setFloor(null);
		await settle(t, 400, 60_000, clock);
		expect(meshes(scene).floors).toEqual([]);
		expect(t.stats().programs).toBe(before.programs);
		expect(t.stats().pipelines).toBe(before.pipelines);
	});

	it("runs the night train's moving ground under its gaps, its clock still under reduced motion", async () => {
		const view = await loadView('railcar', 'day', 'gm');
		expect(view.world.backdrop.kind).toBe('prairie-scroll');
		const compile = vi.spyOn(THREE.WebGPURenderer.prototype, 'compileAsync');
		const clock = manualClock();
		// Over the gap between the dining car and the coach (x = 46), from above.
		const pose = { target: { x: 46, y: 3 }, distance: 9, azimuth: 0, elevation: 70 };
		let redraw = () => {};
		let m = await mountFixture(view, pose, {
			clock,
			heroes: false,
			reducedMotion: false,
			devScene: (_, draw) => (redraw = draw)
		});
		mounted = m;
		await settle(m.tabletop, 400, 60_000, clock);
		const scene = compile.mock.calls[0][2] as THREE.Scene;
		const { floors, ground } = meshes(scene);
		const drop = Math.round(-SCROLL_DEPTH * STEP_HEIGHT * 1000) / 1000;
		expect([...heights(floors)]).toEqual([drop]);
		const at = (x: number, y: number) => gridToWorld(view.grid, { x, y });
		for (const x of [14, 29, 46]) {
			expect(topAt(ground, at(x, 1).x, at(x, 1).z), `gap ${x}`).toBeCloseTo(drop);
			expect(topAt(ground, at(x, 3).x, at(x, 3).z), `gangway ${x}`).toBeCloseTo(0);
		}
		// The ground slides along the train (x), and so does the skirt beyond it.
		const material = floors[0].material as unknown as { params: { flow: THREE.Vector2 } };
		expect(material.params.flow.x).toBeGreaterThan(0);
		expect(material.params.flow.y).toBe(0);
		// The floors are drawn: taking them away changes the frame, under the gaps.
		const lit = await readFrame(m.canvas, WIDTH, HEIGHT);
		for (const f of floors) f.visible = false;
		redraw();
		await settle(m.tabletop, 400, 60_000, clock);
		const without = await readFrame(m.canvas, WIDTH, HEIGHT);
		for (const f of floors) f.visible = true;
		let changed = 0;
		let most = 0;
		for (let y = 0; y < HEIGHT; y += 2)
			for (let x = 0; x < WIDTH; x += 2) {
				const d = Math.max(...lit(x, y).map((c, k) => Math.abs(c - without(x, y)[k])));
				most = Math.max(most, d);
				if (d > 2) changed++;
			}
		// Dim in the GM's view of ground the party hasn't seen, under the enclosed sky: 173 pixels of
		// every fourth (by up to 4 levels) on SwiftShader.
		expect(changed, 'pixels the moving ground draws').toBeGreaterThan(50);
		expect(most).toBeGreaterThan(2);
		// Its clock runs on ambient frames as the held clock moves on.
		const t0 = worldTime.value;
		clock.set(clock.now() + 1500);
		await expect.poll(() => worldTime.value, { timeout: 20_000 }).not.toBe(t0);
		expect(m.tabletop.stats().mode).toBe('ambient');
		await m.unmount();

		// Reduced motion: still, and no frame drawn at all.
		m = await mountFixture(view, pose, { clock, heroes: false, reducedMotion: true });
		mounted = m;
		await settle(m.tabletop, 400, 60_000, clock);
		const [held, frames] = [worldTime.value, m.tabletop.stats().frames];
		clock.set(clock.now() + 1500);
		await wait(2000);
		expect(worldTime.value).toBe(held);
		expect(m.tabletop.stats().frames - frames).toBe(0);
	});
});
