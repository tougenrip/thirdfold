// World-aligned mapping (#177) drawn: a wall's texture runs on across the seam between two wall
// instances and raised cells of different heights share its phase (the geometry's own space, as
// a door panel is mapped, would jump there), a door panel's texture moves with the panel, and
// rock's triplanar mapping (biplanar on low, #241) shows a new texture on every face with no new
// program. And against z-fighting and tiling (#181): a lifted instance wins over a coplanar one
// whatever the draw order, and macro variation and anti-tiling change the picture without a new
// program.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import { BACKEND } from './testing';
import {
	LIFT_ATTRIBUTE,
	SLOTS,
	TINT_ATTRIBUTE,
	addInstanceTints,
	createMaterial,
	prepareSlotTexture,
	setParams,
	setSlot,
	type KindMaterial
} from './materials';

vi.setConfig({ testTimeout: 120_000 });

const SIZE = 64;
let renderer: THREE.WebGPURenderer | null = null;
afterEach(() => {
	renderer?.dispose();
	renderer = null;
});

/** An orthographic view down -z of 4×4 units centred on `(cx, cy)`, drawn into a small target. */
async function setup(cx = 0, cy = 0) {
	const canvas = document.createElement('canvas');
	const r = await createNodeRenderer(canvas, {
		pixelRatio: 1,
		antialias: false,
		backend: BACKEND === 'webgpu' ? 'webgpu' : 'webgl'
	});
	renderer = r;
	r.setSize(SIZE, SIZE, false);
	const scene = new THREE.Scene();
	scene.add(new THREE.AmbientLight(0xffffff, 3));
	const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 20);
	camera.position.set(cx, cy, 5);
	const target = new THREE.RenderTarget(SIZE, SIZE);
	return {
		scene,
		camera,
		async draw() {
			advanceNodeFrame(r);
			r.setRenderTarget(target);
			r.render(scene, camera);
			r.setRenderTarget(null);
			// A copy: a backend may hand back the same buffer on the next read.
			return (
				(await r.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE)) as Uint8Array
			).slice();
		},
		programs: () => r.info.memory.programs
	};
}

/** A 16×16 albedo whose red runs across and green up, so any jump in u or v shows. */
function gradient(): THREE.Texture {
	const data = new Uint8Array(16 * 16 * 4);
	for (let y = 0; y < 16; y++)
		for (let x = 0; x < 16; x++) data.set([x * 16, y * 16, 128, 255], (y * 16 + x) * 4);
	return prepareSlotTexture(new THREE.DataTexture(data, 16, 16), SLOTS.albedo);
}

/** One flat colour as an albedo. */
function flat(rgb: [number, number, number]): THREE.Texture {
	const data = new Uint8Array(16).map((_, i) => (i % 4 === 3 ? 255 : rgb[i % 4]));
	return prepareSlotTexture(new THREE.DataTexture(data, 2, 2), SLOTS.albedo);
}

/** The pixel at column x of the middle row: the same row whichever way the backend reads. */
const at = (px: Uint8Array, x: number) => {
	const i = ((SIZE / 2) * SIZE + x) * 4;
	return [px[i], px[i + 1], px[i + 2]];
};
const apart = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

/** Where two boxes meet: away from a whole repeat, where the gradient would wrap anyway. */
const SEAM = 1.3;

/** Two boxes side by side, meeting at x = SEAM, as instances of one mesh (walls, raised cells). */
function pair(material: KindMaterial, depth: number, heights: [number, number]) {
	const geometry = new THREE.BoxGeometry(1, 1, depth);
	addInstanceTints(geometry, 2);
	const mesh = new THREE.InstancedMesh(geometry, material, 2);
	heights.forEach((h, i) =>
		mesh.setMatrixAt(
			i,
			new THREE.Matrix4().compose(
				new THREE.Vector3(SEAM + (i ? 0.5 : -0.5), h / 2, 0),
				new THREE.Quaternion(),
				new THREE.Vector3(1, h, 1)
			)
		)
	);
	return mesh;
}

describe('world-aligned box mapping', () => {
	it.each([
		['a wall', 'surface', 0.14, [2, 2]],
		['raised cells of different heights', 'terrain', 1, [0.4, 1.2]]
	] as const)('runs on across the seam of %s', async (_, kind, depth, heights) => {
		const { scene, draw, programs } = await setup(SEAM, 0.2);
		const world = createMaterial(kind, { instanced: true, slots: { albedo: gradient() } });
		setParams(world, { repeat: { x: 0.37, y: 0.29 } });
		scene.add(pair(world, depth, [...heights]));
		const seam = SIZE / 2;
		let px = await draw();
		expect(apart(at(px, seam - 2), at(px, seam + 1))).toBeLessThan(24);
		const p0 = programs();

		// Another tile size: still continuous, and no new program (#177).
		setParams(world, { repeat: { x: 0.21, y: 0.5 } });
		px = await draw();
		expect(apart(at(px, seam - 2), at(px, seam + 1))).toBeLessThan(24);
		expect(programs()).toBe(p0);

		// The geometry's own space starts over on each instance: the seam shows.
		scene.clear();
		scene.add(new THREE.AmbientLight(0xffffff, 3));
		const local = createMaterial(kind, {
			instanced: true,
			local: true,
			slots: { albedo: gradient() }
		});
		setParams(local, { repeat: { x: 0.37, y: 0.29 } });
		scene.add(pair(local, depth, [...heights]));
		px = await draw();
		expect(apart(at(px, seam - 2), at(px, seam + 1))).toBeGreaterThan(60);
	});

	it('keeps a door panel’s texture on the panel as it moves', async () => {
		const { scene, camera, draw } = await setup();
		const panel = (local: boolean) => {
			const material = createMaterial('surface', { local, slots: { albedo: gradient() } });
			setParams(material, { repeat: { x: 0.8, y: 0.3 } });
			return new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.08), material);
		};
		for (const local of [true, false]) {
			scene.clear();
			scene.add(new THREE.AmbientLight(0xffffff, 3));
			const door = panel(local);
			scene.add(door);
			door.position.x = 0.3;
			camera.position.x = 0.3;
			const before = await draw();
			// Panel and camera move together: a texture fixed to the panel looks the same.
			door.position.x = 0.7;
			camera.position.x = 0.7;
			const after = await draw();
			const moved = apart(at(before, SIZE / 2), at(after, SIZE / 2));
			if (local) expect(moved).toBeLessThan(4);
			else expect(moved).toBeGreaterThan(20);
		}
	});
});

describe('triplanar rock, and biplanar on low (#241)', () => {
	it.each([
		['triplanar', true],
		['biplanar', false]
	])('shows a new texture on every face it draws (%s), with no new program', async (_, tiled) => {
		const { scene, camera, draw, programs } = await setup();
		camera.position.set(3, 3, 5);
		camera.lookAt(0, 0, 0);
		const rock = createMaterial('rock', {
			antiTiled: tiled,
			slots: { albedo: flat([255, 0, 0]) }
		});
		const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), rock);
		mesh.rotation.y = 0.4;
		scene.add(mesh);
		const drawn = (px: Uint8Array) => {
			const out: number[][] = [];
			for (let i = 0; i < px.length; i += 4)
				if (px[i] + px[i + 1] + px[i + 2] > 0) out.push([px[i], px[i + 1], px[i + 2]]);
			return out;
		};
		let px = drawn(await draw());
		expect(px.length).toBeGreaterThan(SIZE * 4);
		expect(px.every(([r, g, b]) => r > g + 40 && r > b + 40)).toBe(true);
		const p0 = programs();

		setSlot(rock, 'albedo', flat([0, 255, 0]));
		px = drawn(await draw());
		expect(px.every(([r, g, b]) => g > r + 40 && g > b + 40)).toBe(true);
		expect(programs()).toBe(p0);
	});
});

describe('micro-offsets and macro variation (#181)', () => {
	it('lift an instance off a coplanar one, whatever the draw order', async () => {
		const { scene, draw, programs } = await setup();
		const geometry = new THREE.PlaneGeometry(2, 2);
		addInstanceTints(geometry, 2);
		// Two sheets in the same plane: the first red and lifted most, the second green.
		const tints = geometry.getAttribute(TINT_ATTRIBUTE) as THREE.InstancedBufferAttribute;
		tints.setXYZW(0, 1, 0, 0, 1);
		tints.setXYZW(1, 0, 1, 0, 1);
		const lifts = geometry.getAttribute(LIFT_ATTRIBUTE) as THREE.InstancedBufferAttribute;
		lifts.setX(0, 0.9);
		lifts.setX(1, 0.1);
		// Black, so only the tints show.
		const material = createMaterial('prop', { instanced: true, params: { color: 0x000000 } });
		const sheets = new THREE.InstancedMesh(geometry, material, 2);
		scene.add(sheets);
		const [r, g] = at(await draw(), SIZE / 2);
		expect(r).toBeGreaterThan(g + 60);
		const p0 = programs();

		// Without the lift the sheets are coplanar and the one drawn last shows.
		setParams(material, { lift: 0 });
		const [r0, g0] = at(await draw(), SIZE / 2);
		expect(g0).toBeGreaterThan(r0 + 60);
		expect(programs()).toBe(p0);
	});

	it('vary tint by strength, and anti-tile, without a new program for the strength', async () => {
		const { scene, camera, draw, programs } = await setup();
		camera.position.set(0, 8, 0.01);
		camera.lookAt(0, 0, 0);
		const plain = createMaterial('terrain', { slots: { albedo: gradient() } });
		setParams(plain, { macroTint: 0, macroRoughness: 0, macroScale: 0.7 });
		const ground = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 4), plain);
		scene.add(ground);
		const before = await draw();
		const p0 = programs();
		setParams(plain, { macroTint: 0.6, macroRoughness: 0.3 });
		const varied = await draw();
		expect(programs()).toBe(p0);
		let most = 0;
		for (let i = 0; i < before.length; i++) most = Math.max(most, Math.abs(before[i] - varied[i]));
		expect(most).toBeGreaterThan(10);
		setParams(plain, { macroTint: 0, macroRoughness: 0 });
		expect([...(await draw())]).toEqual([...before]);

		// The anti-tiled graph (medium tier and up) draws the same ground differently.
		const errors = vi.spyOn(console, 'error');
		const antiTiled = createMaterial('terrain', { antiTiled: true, slots: { albedo: gradient() } });
		setParams(antiTiled, { macroTint: 0, macroRoughness: 0, repeat: { x: 1.3, y: 1.3 } });
		setParams(plain, { repeat: { x: 1.3, y: 1.3 } });
		const tiled = await draw();
		ground.material = antiTiled;
		const broken = await draw();
		expect(errors).not.toHaveBeenCalled();
		let changed = 0;
		for (let i = 0; i < tiled.length; i += 4) if (tiled[i] !== broken[i]) changed++;
		expect(changed).toBeGreaterThan(SIZE * 4);
	});
});
