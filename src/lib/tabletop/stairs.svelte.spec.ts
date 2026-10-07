// Stairs (#255) on the monastery as the renderer draws them: the stone halls' kit (#261) pieces
// once they have loaded (risers, stringers and a balustrade baked into the chunks' faces), the
// ground leaving their edges to them, every step's top at its floor across the token's disk,
// the balustrade over the gallery stair's drop to the nave; a wall along it rebuilding only the
// chunks it touched and taking the rail away, a door rebuilding none, nothing compiling.

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

/** The highest surface of the meshes straight below (x, z). */
function topAt(meshes: THREE.Mesh[], x: number, z: number): number {
	const ray = new THREE.Raycaster(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
	const hits: THREE.Intersection[] = [];
	for (const m of meshes) THREE.Mesh.prototype.raycast.call(m, ray, hits);
	return Math.max(...hits.map((h) => h.point.y));
}

describe('stairs', () => {
	it("draws the monastery's stairs as steps in the chunks, with a rail over the nave", async () => {
		const sidecar = await loadSidecar('monastery');
		const view = await loadView('monastery', sidecar.ambient, 'gm');
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

		// Every step of the gallery stair (x 15 to 18, row 9) and the outside stair (x 22 and 23,
		// rows 10 to 13) at its floor across the disk, and half a level up over the lower edge band.
		const wrong: string[] = [];
		const cells = [
			...[15, 16, 17, 18].map((x) => [x, 9]),
			...[10, 11, 12, 13].flatMap((y) => [22, 23].map((x) => [x, y]))
		];
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
		// The gallery stair's first riser, between x 14 (the nave) and 15: the kit's nosing, at the
		// upper floor, over the nave's edge band. Since the pilot kit (#263) the step is `ashlar-step`
		// (scripts/stone-halls/pieces.ts), whose nosing's top is NOSING_DROP under its pivot (the
		// greybox step's was flush with it): the piece's own geometry, not the ground's.
		const NOSING_DROP = 0.005;
		const edge = gridToWorld(grid, { x: 15, y: 9 });
		expect(topAt(meshes(), edge.x - 0.5 - 0.035, edge.z)).toBeCloseTo(STEP_HEIGHT - NOSING_DROP, 3);
		// A balustrade on the north edge of x 17 (level 3 over the nave): its rail over the edge.
		const rail = () => {
			const c = gridToWorld(grid, { x: 17, y: 9 });
			return topAt(meshes(), c.x, c.z - 0.5) - floorY(17, 9);
		};
		expect(rail()).toBeCloseTo(1, 3); // the stone halls' balustrade
		const before = t.stats();

		// A wall along the gallery stair's north side: the rail goes, nothing compiles.
		const wall: SceneObject = {
			id: 'test-wall',
			kind: 'wall',
			a: { x: 15, y: 9 },
			b: { x: 19, y: 9 }
		};
		t.setObjects([...view.objects, wall]);
		await settle(t, 400, 60_000, clock);
		expect(t.stats().world!.lastRebuilt).toBeGreaterThan(0);
		expect(t.stats().world!.lastRebuilt).toBeLessThanOrEqual(2);
		expect(rail()).toBeLessThan(0.1);
		// A door opening (objects change, walls don't) rebuilds nothing.
		t.setObjects([...view.objects]);
		await settle(t, 400, 60_000, clock);
		expect(rail()).toBeCloseTo(1, 3);
		const built = () => t.stats().timings['world-chunk']?.count ?? 0;
		const chunks = built();
		const doors = view.objects.map((o) => (o.kind === 'door' ? { ...o, open: !o.open } : o));
		t.setObjects(doors);
		await settle(t, 400, 60_000, clock);
		expect(built()).toBe(chunks);
		expect(t.stats().programs).toBe(before.programs);
		expect(t.stats().pipelines).toBe(before.pipelines);
	});
});
