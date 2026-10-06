// Window frames, door frames and kit door leaves (#253) drawn: a window's frame round an open gap
// at eye height, a door's leaf swinging open and shut on the injected clock in DOOR_SWING_MS (and
// snapping under reduced motion), a pick on the leaf naming its door, shut and open, the hover a
// colour, a kit's leaf, and none of it compiling a program after the first walls.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import { EYE_LEVELS } from '$lib/game/visibility';
import { loadEnvironment } from './environment';
import { groundFor, STEP_HEIGHT, WALL_HEIGHT } from './ground';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import { initModels, releaseModels } from './models';
import { shaderStages } from './perf';
import { PICK_LAYER } from './picking';
import { BACKEND } from './testing';
import { WallLayer } from './walls';
import { loadWorld } from './world-layer';

vi.setConfig({ testTimeout: 120_000 });

let renderer: THREE.WebGPURenderer | null = null;
afterEach(() => {
	if (renderer) releaseModels();
	renderer?.dispose();
	renderer = null;
});

const SIZE = 64;
const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 12, height: 8 };
const at = (x: number, y: number) => [x - grid.width / 2, y - grid.height / 2] as const;
/** A room's north wall with a window of two units (an arcade) and one alone, and a door south. */
const objects = (open: boolean): SceneObject[] => [
	{ id: 'n1', kind: 'wall', a: { x: 1, y: 2 }, b: { x: 3, y: 2 } },
	{ id: 'win', kind: 'wall', a: { x: 3, y: 2 }, b: { x: 5, y: 2 }, window: true },
	{ id: 'n2', kind: 'wall', a: { x: 5, y: 2 }, b: { x: 7, y: 2 } },
	{ id: 'lone', kind: 'wall', a: { x: 7, y: 2 }, b: { x: 8, y: 2 }, window: true },
	{ id: 'n3', kind: 'wall', a: { x: 8, y: 2 }, b: { x: 10, y: 2 } },
	{ id: 's1', kind: 'wall', a: { x: 1, y: 6 }, b: { x: 4, y: 6 } },
	{ id: 'door', kind: 'door', a: { x: 4, y: 6 }, b: { x: 5, y: 6 }, open },
	{ id: 's2', kind: 'wall', a: { x: 5, y: 6 }, b: { x: 10, y: 6 } }
];
const SWING_MS = 260;

async function setUp() {
	const build = await loadWorld();
	const r = await createNodeRenderer(document.createElement('canvas'), {
		pixelRatio: 1,
		antialias: false,
		backend: BACKEND === 'webgpu' ? 'webgpu' : 'webgl'
	});
	renderer = r;
	initModels(r); // the stone halls' pilot pieces are cooked: meshopt needs the decoders
	r.setSize(SIZE, SIZE, false);
	const scene = new THREE.Scene();
	scene.add(new THREE.AmbientLight(0xffffff, 2));
	// Straight down onto the door.
	const camera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 20);
	const [x, z] = at(4.5, 6);
	camera.position.set(x, 8, z);
	camera.up.set(0, 0, -1);
	camera.lookAt(x, 0, z);
	const target = new THREE.RenderTarget(SIZE, SIZE);
	let now = 1000;
	const layer = new WallLayer(build, () => now);
	const shape = build.worldShape({ grid, levels: null, floor: null, objects: [], known: null });
	scene.add(layer.group, ...layer.gallery());
	return {
		layer,
		sync: (open: boolean, list = objects(open)) => layer.sync(list, shape, groundFor(grid, null)),
		clock: (t: number) => (now = t),
		now: () => now,
		async draw(): Promise<void> {
			advanceNodeFrame(r);
			r.setRenderTarget(target);
			r.render(scene, camera);
			r.setRenderTarget(null);
			await r.readRenderTargetPixelsAsync(target, 0, 0, 1, 1);
		},
		stages: () => new Set(shaderStages(r).keys()),
		/** The door or wall a ray from `from` along `dir` picks (PICK_LAYER only). */
		pick(from: THREE.Vector3, dir: THREE.Vector3) {
			const ray = new THREE.Raycaster(from, dir.normalize());
			ray.layers.set(PICK_LAYER);
			return layer.pick(ray);
		},
		/** Whether a horizontal ray north at height `y` across grid x `gx` hits any drawn piece. */
		blocked(gx: number, y: number): boolean {
			const [wx, wz] = at(gx, 2);
			const ray = new THREE.Raycaster(
				new THREE.Vector3(wx, y, wz + 1),
				new THREE.Vector3(0, 0, -1)
			);
			ray.far = 2;
			const drawn = layer.group.children.filter((o) => o instanceof THREE.BatchedMesh);
			return ray.intersectObjects(drawn, false).length > 0;
		}
	};
}

describe('window frames, door frames and leaves', () => {
	it('frame windows round an open gap at eye height, built in and from a kit', async () => {
		const t = await setUp();
		t.sync(false);
		await t.draw();
		const eye = EYE_LEVELS * STEP_HEIGHT;
		const check = () => {
			for (const gx of [3.3, 4.7, 7.3]) {
				expect(t.blocked(gx, eye), `gap at ${gx}`).toBe(false);
				expect(t.blocked(gx, 0.3), `sill at ${gx}`).toBe(true);
				expect(t.blocked(gx, WALL_HEIGHT - 0.2), `lintel at ${gx}`).toBe(true);
			}
			expect(t.blocked(3.02, eye), 'a jamb').toBe(true);
			expect(t.blocked(2.5, eye), 'the wall').toBe(true);
		};
		check();
		// The village's kit: its frames (the arcade has no arch there) keep the gap.
		const village = await loadEnvironment('village');
		t.layer.setLook(village!.walls, village!.kit);
		t.sync(false);
		check();
		// The stone halls' kit has an arch: the arcade's two units are arches, open at eye height.
		const halls = await loadEnvironment('stone-halls');
		expect(halls?.kit?.arch?.length).toBeGreaterThan(0);
		t.layer.setLook(halls!.walls, halls!.kit);
		t.sync(false);
		for (const gx of [3.3, 4.7]) expect(t.blocked(gx, eye), `arch at ${gx}`).toBe(false);
		t.layer.dispose();
	});

	it('swing a leaf open and shut in DOOR_SWING_MS, snap it under reduced motion, pick it, compile nothing', async () => {
		const t = await setUp();
		t.sync(false);
		await t.draw();
		const before = t.stages();
		const fresh = () => [...t.stages()].filter((code) => !before.has(code));
		const angle = () => t.layer.doorAngles().get('door')!;
		expect(angle()).toBe(0);
		// One batch for every leaf, on the pick layer.
		const leaves = t.layer.group.children.filter(
			(o) => o instanceof THREE.BatchedMesh && o.layers.isEnabled(PICK_LAYER)
		);
		expect(leaves.length).toBe(1);

		// Shut: a ray down onto the leaf mid-edge picks the door.
		const [dx, dz] = at(4.5, 6);
		const down = new THREE.Vector3(0, -1, 0);
		expect(t.pick(new THREE.Vector3(dx, 5, dz), down)).toBe('door');

		// Open: a quarter turn over SWING_MS on the clock, halfway at half the time.
		const start = t.now();
		t.sync(true);
		expect(t.layer.tick(start + SWING_MS / 2)).toBe(true);
		expect(angle()).toBeCloseTo(Math.PI / 4, 5);
		await t.draw();
		expect(t.layer.tick(start + SWING_MS)).toBe(false);
		expect(angle()).toBeCloseTo(Math.PI / 2, 6);
		await t.draw();
		// The leaf now stands along the grid line from its hinge, into the room's south side (+z).
		// Its hinge is the built-in leaf's end, 0.08 in from the corner (the jamb's width).
		const [hx, hz] = at(4.08, 6);
		expect(t.pick(new THREE.Vector3(hx, 5, hz + 0.4), down)).toBe('door');
		expect(t.pick(new THREE.Vector3(dx, 5, dz), down)).toBeNull();

		// Hovering is a colour; closing under reduced motion snaps shut at once.
		t.layer.setHovered('door');
		await t.draw();
		t.layer.setHovered(null);
		t.layer.setReducedMotion(true);
		t.clock(start + 10_000);
		t.sync(false);
		expect(angle()).toBe(0);
		expect(t.layer.tick(t.now())).toBe(false);
		await t.draw();

		// A kit's leaf in place of the built-in one: the same batch's program.
		const village = await loadEnvironment('village');
		expect(village?.kit?.['door.leaf']?.length).toBe(1);
		t.layer.setLook(village!.walls, village!.kit);
		t.sync(false);
		await t.draw();
		// Off the middle: the kit's leaf is four planks with a hair between the middle two.
		expect(t.pick(new THREE.Vector3(dx + 0.1, 5, dz), down)).toBe('door');
		t.layer.setReducedMotion(false);
		t.clock(start + 20_000);
		t.sync(true);
		t.layer.tick(t.now() + SWING_MS);
		await t.draw();
		expect(angle()).toBeCloseTo(Math.PI / 2, 6);
		expect(fresh()).toEqual([]);

		// The door gone, its leaf goes.
		t.sync(
			false,
			objects(false).filter((o) => o.id !== 'door')
		);
		expect(t.layer.doorAngles().size).toBe(0);
		t.layer.dispose();
	});
});
