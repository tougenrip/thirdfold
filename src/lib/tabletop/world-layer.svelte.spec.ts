// The world's ground in chunks (#240), on the Hollow (48x36: nine chunks, levels 0 to 7, the
// lake's void): every chunk drawn, the ground at each cell's floor height, a floor paint or a
// terrain raise rebuilding only the chunks it touches plus the margin, a fogged player's explored
// ground growing step by step rebuilding at most four chunks a step, nothing compiling on any of
// it, and `?off=terrain` drawing the old boxes and play plane instead.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFloor, FLOOR_IDS, VOID } from '$lib/game/floor';
import { gridToWorld } from '$lib/game/grid';
import { decodeLevels } from '$lib/game/terrain';
import { encodeMask } from '$lib/game/visibility';
import { STEP_HEIGHT } from './ground';
import { settingsFor } from './quality';
import { loadSidecar, loadView, manualClock, mountFixture, settle, type Mounted } from './testing';

vi.setConfig({ testTimeout: 240_000 });

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
	vi.restoreAllMocks();
});

/** The chunks' meshes: the terrain kind, not instanced, never picked (world-layer.ts). */
function chunkMeshes(scene: THREE.Scene): THREE.Mesh[] {
	const out: THREE.Mesh[] = [];
	scene.traverse((o) => {
		if (
			o instanceof THREE.Mesh &&
			!(o instanceof THREE.InstancedMesh) &&
			(o.material as { kind?: string }).kind === 'terrain' &&
			o.raycast !== THREE.Mesh.prototype.raycast
		)
			out.push(o);
	});
	return out;
}

/** Shown: the mesh and all its parents visible. */
const shown = (o: THREE.Object3D | null): boolean => !o || (o.visible && shown(o.parent));

describe('the world layer', () => {
	it('draws the Hollow in chunks at every floor, and rebuilds only what an edit touches', async () => {
		const sidecar = await loadSidecar('hollow');
		const view = await loadView('hollow', sidecar.ambient, 'gm');
		const compile = vi.spyOn(THREE.WebGPURenderer.prototype, 'compileAsync');
		const clock = manualClock();
		const m = await mountFixture(view, sidecar.poses.overview, { clock, heroes: false });
		mounted = m;
		const t = m.tabletop;
		await settle(t, 400, 60_000, clock);
		const scene = compile.mock.calls[0][2] as THREE.Scene;
		const { width: w, height: h } = view.grid;
		const size = w * h;
		expect(t.stats().world).toEqual({ chunks: 9, lastRebuilt: 9 });
		const meshes = chunkMeshes(scene).filter(shown);
		// Nine chunks of tops, and sides where the Hollow rises and falls.
		expect(meshes.filter((x) => !x.castShadow)).toHaveLength(9);
		expect(meshes.filter((x) => x.castShadow).length).toBeGreaterThan(0);

		// The ground at each cell's floor (a step below it in the void), straight down from above.
		const levels = decodeLevels(view.terrain!, size)!;
		const floor = (view.floor && decodeFloor(view.floor, size)) || new Uint8Array(size);
		const ray = new THREE.Raycaster();
		const wrong: string[] = [];
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++) {
				const c = gridToWorld(view.grid, { x, y });
				ray.set(new THREE.Vector3(c.x + 0.1, 50, c.z - 0.1), new THREE.Vector3(0, -1, 0));
				const hits: THREE.Intersection[] = [];
				for (const mesh of meshes) THREE.Mesh.prototype.raycast.call(mesh, ray, hits);
				const top = Math.max(...hits.map((hit) => hit.point.y));
				const i = y * w + x;
				const want = (levels[i] - (floor[i] === VOID ? 1 : 0)) * STEP_HEIGHT;
				if (Math.abs(top - want) > 1e-4) wrong.push(`${x},${y}: ${top} not ${want}`);
			}
		expect(wrong).toEqual([]);
		const before = t.stats();

		const rebuilt = () => t.stats().world!.lastRebuilt;
		const paint = (cells: [number, number][], id: (typeof FLOOR_IDS)[number]) => {
			const next = floor.slice();
			for (const [x, y] of cells) next[y * w + x] = FLOOR_IDS.indexOf(id);
			floor.set(next);
			t.setFloor(next);
		};
		const area = (x0: number, y0: number, x1: number, y1: number) => {
			const out: [number, number][] = [];
			for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
			return out;
		};
		// A cell inside the middle chunk, then one on its corner (its margin reaches three more).
		paint([[20, 20]], 'stone');
		expect(rebuilt()).toBe(1);
		paint([[16, 16]], 'grass');
		expect(rebuilt()).toBe(4);
		// Every floor over the middle chunk's inside, then over the whole chunk (and its margin).
		for (const id of FLOOR_IDS.filter((f) => f !== 'void')) {
			paint(area(17, 17, 30, 30), id);
			expect(rebuilt(), id).toBe(1);
		}
		paint(area(16, 16, 31, 31), 'dirt');
		expect(rebuilt()).toBe(9);
		// Raising ground inside the middle chunk.
		const raised = levels.slice();
		for (const [x, y] of area(20, 20, 23, 23)) raised[y * w + x] = 6;
		t.setTerrain(raised);
		expect(rebuilt()).toBe(1);
		await settle(t, 400, 60_000, clock);
		// Painting and raising changed data only: no program, no pipeline.
		expect(t.stats().programs).toBe(before.programs);
		expect(t.stats().pipelines).toBe(before.pipelines);

		// A fogged player crossing the open ground east: their explored disc grows a step at a time.
		const known = new Uint8Array(size);
		const look = (cx: number) => {
			for (let y = 0; y < h; y++)
				for (let x = 0; x < w; x++) if ((x - cx) ** 2 + (y - 18) ** 2 <= 36) known[y * w + x] = 1;
			const explored = encodeMask(known);
			t.setFog({ ...view.fog, enabled: true, explored, visible: explored }, 'player');
		};
		look(6);
		for (let cx = 7; cx < 42; cx++) {
			look(cx);
			expect(rebuilt(), `step to ${cx}`).toBeGreaterThan(0);
			expect(rebuilt(), `step to ${cx}`).toBeLessThanOrEqual(4);
		}

		// ?off=terrain: the old boxes and the play plane, no chunks.
		const settings = settingsFor('medium', t.capabilities().backend);
		settings.shadowedTorches = 0;
		t.setQuality({ ...settings, layers: { ...settings.layers, terrain: false } });
		expect(chunkMeshes(scene).filter(shown)).toEqual([]);
		const boxes: THREE.Object3D[] = [];
		scene.traverse((o) => {
			const kind = o instanceof THREE.InstancedMesh && (o.material as { kind?: string }).kind;
			if (kind === 'terrain' && shown(o)) boxes.push(o);
		});
		expect(boxes).toHaveLength(1);
		t.setQuality({ ...settings, layers: { ...settings.layers, terrain: true } });
		expect(chunkMeshes(scene).filter(shown).length).toBeGreaterThanOrEqual(9);
	});
});
