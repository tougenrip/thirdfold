// Kit floor tiles drawn (#254), with the stand-in kit (`testTiles`, until #261's greybox kits) on
// the monastery for the GM: a pool of one InstancedMesh per variant on the prop kind, receiving
// shadows and casting none; the tiles packed round the camera's target within the ring, and packed
// again as it moves; the ring's uniforms per tier (none on low); the ground's tops carrying the bed;
// the tiles changing the picture; and nothing compiling as the camera moves, floors are painted
// (`tile` and `grating` among them); the tier's ring. Without tiles the ground is as it was.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLOOR_IDS } from '$lib/game/floor';
import { gridToWorld } from '$lib/game/grid';
import { useTileSet } from './floor-tiles-layer';
import { BED_ATTRIBUTE, ringUniforms } from './materials';
import { shaderCounts } from './perf';
import { settingsFor } from './quality';
import { TILE_RING } from './tile-ring';
import {
	HEIGHT,
	loadSidecar,
	loadView,
	manualClock,
	mountFixture,
	readFrame,
	settle,
	testTiles,
	WIDTH,
	type Mounted
} from './testing';

vi.setConfig({ testTimeout: 240_000 });

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
	useTileSet(null);
	vi.restoreAllMocks();
});

/** The tile pool's meshes: instanced, on the prop kind, never picked or casting. */
function tileMeshes(scene: THREE.Scene): THREE.InstancedMesh[] {
	const out: THREE.InstancedMesh[] = [];
	scene.traverse((o) => {
		if (o instanceof THREE.InstancedMesh && 'tiles' in o.userData) out.push(o);
	});
	return out;
}

async function mount(tiles: boolean) {
	useTileSet(tiles ? testTiles() : null);
	const sidecar = await loadSidecar('monastery');
	const view = await loadView('monastery', sidecar.ambient, 'gm');
	const compile = vi.spyOn(THREE.WebGPURenderer.prototype, 'compileAsync');
	const clock = manualClock();
	const m = await mountFixture(view, sidecar.poses.overview, { clock, heroes: false });
	mounted = m;
	await settle(m.tabletop, 400, 60_000, clock);
	const renderer = compile.mock.contexts[0] as THREE.WebGPURenderer;
	const scene = compile.mock.calls[0][2] as THREE.Scene;
	return { m, view, sidecar, clock, renderer, scene };
}

describe('kit floor tiles', () => {
	it('packs a pool of tiles round the camera, beds the ground, and compiles nothing after', async () => {
		const { m, view, clock, renderer, scene } = await mount(true);
		const t = m.tabletop;
		const set = testTiles();
		const variants = [...set.values()].reduce((n, f) => n + f.tiles.length + f.broken.length, 0);
		const meshes = tileMeshes(scene);
		expect(meshes).toHaveLength(variants);
		expect(t.stats().world!.tiles.meshes).toBe(variants);
		for (const mesh of meshes) {
			expect((mesh.material as { kind?: string }).kind).toBe('prop');
			expect(mesh.castShadow).toBe(false);
			expect(mesh.receiveShadow).toBe(true);
		}
		// The monastery's default ground is tiled, all of it in the medium ring round the target.
		const packed = () => t.stats().world!.tiles.instances;
		expect(packed()).toBeGreaterThan(500);
		const cs = view.grid.cellSize;
		const radius = TILE_RING.medium * cs;
		expect(ringUniforms.radius.value).toBe(radius);
		expect(ringUniforms.bed.value).toBeGreaterThan(0);
		// The tops carry the bed: some of their vertices sink under tiles.
		let bedded = 0;
		scene.traverse((o) => {
			const bed = o instanceof THREE.Mesh ? o.geometry.getAttribute(BED_ATTRIBUTE) : null;
			for (let v = 0; v < (bed?.count ?? 0); v++) bedded += bed!.getX(v);
		});
		expect(bedded).toBeGreaterThan(100);

		// Every packed tile within the ring and its margin of the target, as the target moves.
		// Programs and pipelines (a node state with no new program is code generation, not a compile).
		const compiled = () => {
			const { programs, pipelines } = shaderCounts(renderer);
			return { programs, pipelines };
		};
		const p0 = compiled();
		const within = (target: { x: number; z: number }) => {
			const m4 = new THREE.Matrix4();
			const at = new THREE.Vector3();
			let far = 0;
			for (const mesh of meshes)
				for (let i = 0; i < mesh.userData.tiles; i++) {
					mesh.getMatrixAt(i, m4);
					at.setFromMatrixPosition(m4);
					far = Math.max(far, Math.hypot(at.x - target.x, at.z - target.z));
				}
			return far;
		};
		for (const cell of [
			{ x: 2, y: 2 },
			{ x: 27, y: 17 },
			{ x: 15, y: 10 }
		]) {
			t.setGridPose({ target: cell, distance: 12, azimuth: 30, elevation: 50 });
			await settle(t, 300, 30_000, clock);
			const target = gridToWorld(view.grid, cell);
			expect(ringUniforms.centre.value.x).toBeCloseTo(target.x, 3);
			expect(within(target)).toBeLessThan(radius + 4 * cs);
		}
		// Painting floors, the new ones too, and the tier's ring: data and uniforms only.
		const size = view.grid.width * view.grid.height;
		for (const id of ['tile', 'grating', 'stone', 'grass'] as const) {
			t.setFloor(new Uint8Array(size).fill(FLOOR_IDS.indexOf(id)));
			await settle(t, 300, 30_000, clock);
			if (id === 'grass') expect(packed()).toBe(0);
			else expect(packed()).toBeGreaterThan(100);
		}
		expect(compiled()).toEqual(p0);
		// The tier's ring (a tier switch compiles its own passes, program-count's business).
		const settings = settingsFor('medium', t.capabilities().backend);
		t.setQuality({ ...settings, tier: 'high' });
		await settle(t, 300, 30_000, clock);
		expect(ringUniforms.radius.value).toBe(TILE_RING.high * cs);
	});

	it('draws no tiles and no bed on low, and changes the picture where it does', async () => {
		const { m, renderer, clock } = await mount(true);
		const t = m.tabletop;
		const with_ = await readFrame(m.canvas, WIDTH, HEIGHT);
		const settings = settingsFor('low', t.capabilities().backend);
		t.setQuality(settings);
		await settle(t, 300, 30_000, clock);
		expect(ringUniforms.radius.value).toBe(0);
		expect(ringUniforms.bed.value).toBe(0);
		expect(t.stats().world!.tiles.instances).toBe(0);
		expect(renderer).toBeInstanceOf(THREE.WebGPURenderer);
		await unmountAnd();
		// The same table without tiles: the picture at the table's middle differs where tiles lie.
		const plain = await mount(false);
		expect(plain.m.tabletop.stats().world!.tiles.meshes).toBe(0);
		expect(ringUniforms.bed.value).toBe(0);
		const without = await readFrame(plain.m.canvas, WIDTH, HEIGHT);
		let differ = 0;
		for (let y = 150; y < 350; y += 4)
			for (let x = 250; x < 550; x += 4)
				if (with_(x, y).some((c, i) => Math.abs(c - without(x, y)[i]) > 6)) differ++;
		expect(differ).toBeGreaterThan(100);
	});
});

async function unmountAnd(): Promise<void> {
	await mounted?.unmount();
	mounted = null;
}
