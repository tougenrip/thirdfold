// The painted-miniature detail on props and minis (#178): its maps arrive after the graphs are
// built and change a binding only, tuning it compiles nothing, 1 and 200 props share one
// material and program, and the paint stays on a prop that glides (object space, not the
// instance-transformed position).

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import { BACKEND } from './testing';
import { addInstanceTints, createMaterial, loadPaint, paint } from './materials';
import { paintMaps } from './materials/paint';

vi.setConfig({ testTimeout: 120_000 });

const SIZE = 64;
const TUNING = { strength: paint.strength.value, gloss: paint.gloss.value };
let renderer: THREE.WebGPURenderer | null = null;
afterEach(() => {
	renderer?.dispose();
	renderer = null;
	paint.strength.value = TUNING.strength;
	paint.gloss.value = TUNING.gloss;
});

interface Internals {
	_nodes: { nodeBuilderCache: Map<number, unknown> };
}

/** A lit scene seen straight down through an orthographic camera, 16 pixels to a cell. */
async function setup() {
	const r = await createNodeRenderer(document.createElement('canvas'), {
		pixelRatio: 1,
		antialias: false,
		backend: BACKEND === 'webgpu' ? 'webgpu' : 'webgl'
	});
	renderer = r;
	r.setSize(SIZE, SIZE, false);
	const scene = new THREE.Scene();
	scene.add(new THREE.AmbientLight(0xffffff, 0.3));
	const sun = new THREE.DirectionalLight(0xffffff, 3);
	sun.position.set(1, 2, 0.5);
	scene.add(sun);
	const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 10);
	camera.position.set(0, 5, 0);
	camera.up.set(0, 0, -1);
	camera.lookAt(0, 0, 0);
	const target = new THREE.RenderTarget(SIZE, SIZE);
	return {
		scene,
		draw() {
			advanceNodeFrame(r);
			r.setRenderTarget(target);
			r.render(scene, camera);
			r.setRenderTarget(null);
		},
		read: async () => (await r.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE)) as Uint8Array,
		programs: () => r.info.memory.programs,
		states: () => (r as unknown as Internals)._nodes.nodeBuilderCache.size
	};
}

/** A flat square prop lying on the table, as an InstancedMesh of `count`. */
function props(count: number, material = createMaterial('prop', { instanced: true })) {
	const geometry = new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2);
	addInstanceTints(geometry, count);
	return new THREE.InstancedMesh(geometry, material, count);
}

const loaded = () => (paintMaps.normal.value.image as { width: number }).width === 256;

describe('paint detail', () => {
	it('arrives, and is tuned, without a new program', async () => {
		const { scene, draw, programs, states } = await setup();
		const mini = new THREE.Mesh(
			new THREE.SphereGeometry(0.5),
			createMaterial('mini', { vertexColors: false })
		);
		mini.position.x = 1;
		scene.add(props(2), mini);
		draw();
		const [p0, s0] = [programs(), states()];
		await loadPaint();
		expect(loaded()).toBe(true);
		expect((paintMaps.gloss.value.image as { width: number }).width).toBe(256);
		expect(paintMaps.normal.value.colorSpace).toBe(THREE.NoColorSpace);
		draw();
		paint.strength.value = 0;
		paint.gloss.value = 0.9;
		draw();
		expect(programs()).toBe(p0);
		expect(states()).toBe(s0);
	});

	it('gives 1 and 200 props the same material and programs', async () => {
		const { scene, draw, programs } = await setup();
		const material = createMaterial('prop', { instanced: true });
		const mesh = props(200, material);
		mesh.count = 1;
		scene.add(mesh);
		draw();
		const p0 = programs();
		mesh.count = 200;
		for (let i = 0; i < 200; i++)
			mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation((i % 20) * 0.1 - 1, 0, 0));
		mesh.instanceMatrix.needsUpdate = true;
		draw();
		expect(programs()).toBe(p0);
		expect(mesh.material).toBe(material);
	});

	it('stays on a prop as it glides', async () => {
		await loadPaint();
		const { scene, draw, read } = await setup();
		paint.strength.value = 3;
		const mesh = props(1);
		scene.add(mesh);
		/** The 16×16 pixels over the middle of the prop, standing at x cells from the middle. */
		const patch = async (x: number) => {
			mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(x, 0, 0));
			mesh.instanceMatrix.needsUpdate = true;
			draw();
			const px = await read();
			const out: number[] = [];
			const left = SIZE / 2 - 8 + x * 16;
			for (let row = SIZE / 2 - 8; row < SIZE / 2 + 8; row++)
				for (let col = left; col < left + 16; col++)
					for (let c = 0; c < 3; c++) out.push(px[(row * SIZE + col) * 4 + c]);
			return out;
		};
		const here = await patch(0);
		const there = await patch(1);
		// The paint shows (the patch isn't flat) and moved with the prop, pixel for pixel.
		expect(Math.max(...here) - Math.min(...here)).toBeGreaterThan(20);
		const worst = Math.max(...here.map((v, i) => Math.abs(v - there[i])));
		expect(worst).toBeLessThanOrEqual(2);
	});
});
