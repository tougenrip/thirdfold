// Kit walls (#252) drawn: the built-in pieces and a synthetic kit's, posts at corners, a pool of
// a mesh per piece (M70) refilled only where a chunk's pieces changed, the erase highlight a
// hatched emissive glow, the picking proxy, and none of it compiling a program after the first
// walls (a stand-in, then new chunks' pieces, the kit, the highlight).

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import { groundFor, WALL_HEIGHT } from './ground';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import { shaderStages } from './perf';
import { PICK_LAYER } from './picking';
import { BACKEND } from './testing';
import { WallLayer, type WallKit } from './walls';
import { boxes, KIT_LIFT } from './world/wall-batch';
import { loadEnvironment } from './environment';
import { loadWorld } from './world-layer';

vi.setConfig({ testTimeout: 120_000 });

let renderer: THREE.WebGPURenderer | null = null;
afterEach(() => {
	renderer?.dispose();
	renderer = null;
});

const SIZE = 64;
const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 40, height: 20 };
const wall = (id: string, a: [number, number], b: [number, number]): SceneObject => ({
	id,
	kind: 'wall',
	a: { x: a[0], y: a[1] },
	b: { x: b[0], y: b[1] }
});
/** A room in chunk 0 (an L at each corner) with a wall into it (a T). */
const ROOM = [
	wall('n', [2, 2], [8, 2]),
	wall('e', [8, 2], [8, 8]),
	wall('s', [2, 8], [8, 8]),
	wall('w', [2, 2], [2, 8]),
	wall('t', [5, 2], [5, 5])
];
/** The world's x and z of grid corner (x, y). */
const at = (x: number, y: number) => [x - grid.width / 2, y - grid.height / 2] as const;

/** A synthetic kit: two thick straight variants, an L post, a cap, all plain boxes. */
/** Boxes as a kit piece: with vertex colours, as `pieceOf` makes every kit piece. */
const piece = (...list: Parameters<typeof boxes>[0]) => {
	const mesh = boxes(list);
	return {
		mesh: { ...mesh, colors: new Float32Array(mesh.positions.length).fill(0.6) },
		weight: 1
	};
};
const KIT: WallKit = {
	'wall.straight': [
		piece([-0.5, 0, -0.05, 0.5, WALL_HEIGHT, 0.05]),
		piece([-0.5, 0, -0.06, 0.5, WALL_HEIGHT - 0.1, 0.06])
	],
	'post.L': [piece([-0.12, 0, -0.12, 0.12, WALL_HEIGHT + 0.1, 0.12])],
	cap: [piece([-0.5, 1.9, -0.09, 0.5, WALL_HEIGHT, 0.09])]
};

async function setUp() {
	const build = await loadWorld();
	const r = await createNodeRenderer(document.createElement('canvas'), {
		pixelRatio: 1,
		antialias: false,
		backend: BACKEND === 'webgpu' ? 'webgpu' : 'webgl'
	});
	renderer = r;
	r.setSize(SIZE, SIZE, false);
	const scene = new THREE.Scene();
	scene.add(new THREE.AmbientLight(0xffffff, 2));
	// Straight down onto the room's NW corner, a cell and a half each way.
	const camera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 20);
	const [x, z] = at(2, 2);
	camera.position.set(x, 8, z);
	camera.up.set(0, 0, -1);
	camera.lookAt(x, 0, z);
	const target = new THREE.RenderTarget(SIZE, SIZE);
	const layer = new WallLayer(build);
	const ground = groundFor(grid, null);
	const shape = build.worldShape({ grid, levels: null, floor: null, objects: [], known: null });
	scene.add(layer.group);
	const sync = (objects: SceneObject[]) => layer.sync(objects, shape, ground);
	return {
		layer,
		sync,
		/** Draws the walls (and the stand-ins first time), returning the pixels. */
		async draw(): Promise<Uint8Array> {
			advanceNodeFrame(r);
			r.setRenderTarget(target);
			r.render(scene, camera);
			r.setRenderTarget(null);
			return (await r.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE)) as Uint8Array;
		},
		/** The shader stages alive, by their code. */
		stages: () => new Set(shaderStages(r).keys()),
		gallery: () => scene.add(...layer.gallery()),
		/** The top of what stands at world (x, z): a ray straight down onto the pieces drawn. */
		topAt(wx: number, wz: number): number | null {
			const ray = new THREE.Raycaster(new THREE.Vector3(wx, 10, wz), new THREE.Vector3(0, -1, 0));
			const hits = ray.intersectObjects(
				layer.group.children.filter(
					(o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh && o.visible
				),
				false
			);
			return hits.length ? 10 - hits[0].distance : null;
		}
	};
}

describe('kit walls', () => {
	it('draw posts at corners from the built-in pieces, then from a kit, compiling nothing new', async () => {
		const t = await setUp();
		t.gallery();
		t.sync(ROOM);
		await t.draw();
		// r186 may order a graph's functions differently the first time it is built (the lobby's
		// gallery builds every kind first, lobby.ts), so what counts is that no new code appears.
		const before = t.stages();
		const fresh = () => [...t.stages()].filter((code) => !before.has(code));
		const meshes = () =>
			t.layer.group.children.filter(
				(o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh && o.visible
			);
		// The room's chunk drawn; every piece is off the pick layer.
		expect(t.layer.stats().chunks).toBe(1);
		for (const m of meshes()) expect(m.layers.isEnabled(PICK_LAYER)).toBe(false);
		// The L at (2, 2) has a post over the caps; mid-edge the cap is the top; the T at (5, 2) too.
		expect(t.topAt(...at(2, 2))).toBeCloseTo(WALL_HEIGHT + 0.04, 3);
		expect(t.topAt(...at(5, 2))).toBeCloseTo(WALL_HEIGHT + 0.04, 3);
		expect(t.topAt(at(3, 2)[0] + 0.5, at(3, 2)[1])).toBeCloseTo(WALL_HEIGHT, 3);
		// Inside the room nothing.
		expect(t.topAt(...at(4, 6))).toBeNull();

		// A wall in another chunk: only that chunk rebuilt, no program.
		t.sync([...ROOM, wall('far', [30, 4], [30, 10])]);
		await t.draw();
		expect(t.layer.stats()).toMatchObject({ chunks: 2, lastRebuilt: 1 });
		expect(fresh()).toEqual([]);

		// The kit: its L post and straight variants, its cap on its walls; no program.
		t.layer.setLook(null, KIT);
		await t.draw();
		// Its post and cap a little over the walls' tops (KIT_LIFT), never in their plane.
		expect(t.topAt(...at(2, 2))).toBeCloseTo(WALL_HEIGHT + 0.1 + KIT_LIFT.post, 4);
		const mid = t.topAt(at(3, 2)[0] + 0.5, at(3, 2)[1]);
		expect(mid).toBeCloseTo(WALL_HEIGHT + KIT_LIFT.cap, 4); // the kit's cap on either variant
		// The T keeps the built-in post: the kit has none.
		expect(t.topAt(...at(5, 2))).toBeCloseTo(WALL_HEIGHT + 0.04, 3);
		expect(fresh()).toEqual([]);

		// Taking a wall away rebuilds its chunk alone; taking all draws no piece.
		t.sync(ROOM);
		await t.draw();
		expect(t.layer.stats()).toMatchObject({ chunks: 1, lastRebuilt: 1 });
		t.sync([]);
		await t.draw();
		expect(t.layer.stats().chunks).toBe(0);
		expect(meshes()).toEqual([]);
		t.sync(ROOM);
		await t.draw();
		expect(fresh()).toEqual([]);
		t.layer.dispose();
	});

	it('draw an environment’s own kit, its pieces in their baked colours', async () => {
		const t = await setUp();
		t.gallery();
		t.sync(ROOM);
		await t.draw();
		const before = t.stages();
		const look = await loadEnvironment('village');
		expect(look?.kit?.['wall.straight']?.length).toBe(2);
		expect(look?.kit?.['post.L']?.[0].mesh.colors?.length).toBeGreaterThan(0);
		t.layer.setLook(look!.walls, look!.kit);
		await t.draw();
		// Every piece of the room is the kit's (vertex colours, a mesh per piece), none built in.
		const drawn = t.layer.group.children.filter(
			(o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh && o.visible
		);
		expect(drawn.length).toBeGreaterThan(1);
		for (const m of drawn) expect(m.geometry.getAttribute('color')).toBeDefined();
		// The village's L post (2 u) a little over the walls, scaled to the corner.
		expect(t.topAt(...at(2, 2))).toBeCloseTo(WALL_HEIGHT + KIT_LIFT.post, 3);
		expect([...t.stages()].filter((code) => !before.has(code))).toEqual([]);
		t.layer.dispose();
	});

	it('glow the hovered wall with a hatch and pick walls by their proxy', async () => {
		const t = await setUp();
		t.gallery();
		t.sync(ROOM);
		const plain = await t.draw();
		const before = t.stages();
		const fresh = () => [...t.stages()].filter((code) => !before.has(code));
		expect(t.layer.setHovered('n')).toBe(true);
		const hot = await t.draw();
		expect(fresh()).toEqual([]);
		// The north wall's cap east of the corner: brighter, warmer, and striped (not one value).
		const row = SIZE / 2;
		const reds: number[] = [];
		let warmer = 0;
		for (let x = SIZE / 2 + 12; x < SIZE - 2; x++) {
			const i = (row * SIZE + x) * 4;
			reds.push(hot[i]);
			if (hot[i] > plain[i] + 8 && hot[i] - hot[i + 2] > plain[i] - plain[i + 2]) warmer++;
		}
		expect(warmer).toBeGreaterThan(5);
		expect(new Set(reds).size).toBeGreaterThan(2);
		// The west wall (not hovered) is as it was.
		const i = ((SIZE / 2 - 14) * SIZE + SIZE / 2) * 4;
		expect(hot.slice(i, i + 3)).toEqual(plain.slice(i, i + 3));

		// Picks hit the proxy: mid-edge and at a post, straight down.
		const pick = (x: number, z: number) => {
			const ray = new THREE.Raycaster(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
			ray.layers.set(PICK_LAYER);
			return t.layer.pick(ray);
		};
		expect(pick(at(3, 8)[0] + 0.5, at(3, 8)[1])).toBe('s');
		expect(['n', 'w']).toContain(pick(...at(2, 2)));
		expect(pick(...at(4, 6))).toBeNull();
		t.layer.dispose();
	});
});
