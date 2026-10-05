// Bridges (#256) on the Hollow as the renderer draws them: the high bridge and the causeway with
// their tops at their floors across the token's disk, the cavern kit's parapets over their long
// edges, their bodies down to the lake (no arch: the lake is walkable), all in the chunks' faces;
// a wall along the high bridge rebuilding only its chunks and taking its parapet away, nothing
// compiling.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gridToWorld } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import { decodeLevels } from '$lib/game/terrain';
import { STEP_HEIGHT } from './ground';
import { loadSidecar, loadView, manualClock, mountFixture, settle, type Mounted } from './testing';

vi.setConfig({ testTimeout: 240_000 });

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
	vi.restoreAllMocks();
});

/** The world's chunk meshes (never picked, not instanced) on the terrain and rock kinds, shown. */
function chunkMeshes(scene: THREE.Scene): THREE.Mesh[] {
	const out: THREE.Mesh[] = [];
	const shown = (o: THREE.Object3D | null): boolean => !o || (o.visible && shown(o.parent));
	scene.traverse((o) => {
		const kind = o instanceof THREE.Mesh && (o.material as { kind?: string }).kind;
		if (
			o instanceof THREE.Mesh &&
			!(o instanceof THREE.InstancedMesh) &&
			(kind === 'terrain' || kind === 'rock') &&
			o.raycast !== THREE.Mesh.prototype.raycast &&
			shown(o)
		)
			out.push(o);
	});
	return out;
}

/** The nearest hit of the meshes along a ray, or null. */
function cast(meshes: THREE.Mesh[], from: THREE.Vector3, dir: THREE.Vector3) {
	const ray = new THREE.Raycaster(from, dir.normalize());
	const hits: THREE.Intersection[] = [];
	for (const m of meshes) THREE.Mesh.prototype.raycast.call(m, ray, hits);
	hits.sort((a, b) => a.distance - b.distance);
	return hits[0] ?? null;
}
const topAt = (meshes: THREE.Mesh[], x: number, z: number) =>
	cast(meshes, new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0))?.point.y ?? -Infinity;

describe('bridges', () => {
	it("draws the Hollow's high bridge and causeway with parapets and bodies to the lake", async () => {
		const sidecar = await loadSidecar('hollow');
		const view = await loadView('hollow', sidecar.ambient, 'gm');
		const compile = vi.spyOn(THREE.WebGPURenderer.prototype, 'compileAsync');
		const clock = manualClock();
		const m = await mountFixture(view, sidecar.poses.overview, { clock, heroes: false });
		mounted = m;
		const t = m.tabletop;
		await settle(t, 400, 60_000, clock);
		const scene = compile.mock.calls[0][2] as THREE.Scene;
		const { grid } = view;
		const levels = decodeLevels(view.terrain!, grid.width * grid.height)!;
		const meshes = () => chunkMeshes(scene);
		const floorY = (x: number, y: number) => levels[y * grid.width + x] * STEP_HEIGHT;

		// Every bridge cell's top at its floor across the disk.
		const cells = [
			...[32, 33, 34, 35, 36, 37].map((x) => [x, 9]),
			...[19, 22, 25, 28].flatMap((y) => [23, 24].map((x) => [x, y]))
		];
		const wrong: string[] = [];
		for (const [x, y] of cells) {
			const c = gridToWorld(grid, { x, y });
			for (const [dx, dz] of [
				[0, 0],
				[0.3, 0],
				[-0.3, 0.2],
				[0.2, -0.3]
			]) {
				const top = topAt(meshes(), c.x + dx, c.z + dz);
				if (Math.abs(top - floorY(x, y)) > 1e-4) wrong.push(`${x},${y} +${dx},${dz}: ${top}`);
			}
		}
		expect(wrong).toEqual([]);

		// The causeway's parapets over its outer edges: the cavern kit's railing, 1 over the floor.
		const parapet = (x: number, y: number, side: number) => {
			const c = gridToWorld(grid, { x, y });
			return topAt(meshes(), c.x + side * 0.5, c.z) - floorY(x, y);
		};
		expect(parapet(23, 24, -1)).toBeCloseTo(1, 3);
		expect(parapet(24, 24, 1)).toBeCloseTo(1, 3);
		// Its body: a ray across the lake a level up meets the causeway's west side at its edge.
		const c = gridToWorld(grid, { x: 23, y: 24 });
		const side = cast(
			meshes(),
			new THREE.Vector3(c.x - 3, STEP_HEIGHT, c.z),
			new THREE.Vector3(1, 0, 0)
		);
		expect(side).not.toBeNull();
		expect(side!.point.x).toBeGreaterThan(c.x - 0.5 - 0.071);
		expect(side!.point.x).toBeLessThan(c.x - 0.5 + 1e-4);
		const before = t.stats();

		// A wall along the high bridge's north side: no bridge, no parapet, nothing compiles.
		const north = () => {
			const b = gridToWorld(grid, { x: 34, y: 9 });
			return topAt(meshes(), b.x, b.z - 0.5) - floorY(34, 9);
		};
		expect(north()).toBeCloseTo(1, 3);
		const wall: SceneObject = {
			id: 'test-wall',
			kind: 'wall',
			a: { x: 32, y: 9 },
			b: { x: 38, y: 9 }
		};
		t.setObjects([...view.objects, wall]);
		await settle(t, 400, 60_000, clock);
		expect(t.stats().world!.lastRebuilt).toBeGreaterThan(0);
		expect(t.stats().world!.lastRebuilt).toBeLessThanOrEqual(2);
		t.setObjects([...view.objects]);
		await settle(t, 400, 60_000, clock);
		expect(north()).toBeCloseTo(1, 3);
		expect(t.stats().programs).toBe(before.programs);
		expect(t.stats().pipelines).toBe(before.pipelines);
	});
});
