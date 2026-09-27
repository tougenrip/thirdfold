// Depth of field and tilt-shift (#165): a shot blurs what lies far from its
// focus and keeps the focus sharp; Miniature in the tactical view blurs the
// rows away from the pivot's; at rest nothing of either is left in the frame.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import { STILL } from './focus';
import { Post } from './post';
import { settingsFor } from './quality';
import { BACKEND } from './testing';

vi.setConfig({ testTimeout: 60_000 });

let renderer: THREE.WebGPURenderer | null = null;
afterEach(() => {
	renderer?.dispose();
	renderer = null;
});

const SIZE = 200;

/** A checkered floor running far off, seen from above and behind its middle, where it focuses. */
async function setup(tier: 'medium' | 'high' = 'medium') {
	const canvas = document.createElement('canvas');
	renderer = await createNodeRenderer(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
	renderer.setSize(SIZE, SIZE, false);
	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x000000);
	const data = new Uint8Array(2 * 2 * 4).fill(255);
	data.fill(30, 0, 4);
	data.fill(30, 12, 16);
	const checker = new THREE.DataTexture(data, 2, 2);
	checker.magFilter = THREE.NearestFilter;
	checker.wrapS = checker.wrapT = THREE.RepeatWrapping;
	checker.repeat.set(20, 40);
	checker.needsUpdate = true;
	const floor = new THREE.Mesh(
		new THREE.PlaneGeometry(10, 40),
		new THREE.MeshBasicMaterial({ map: checker })
	);
	floor.rotation.x = -Math.PI / 2;
	floor.position.z = -12;
	scene.add(floor);
	const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
	camera.position.set(0, 3, 5);
	camera.lookAt(0, 0, 0);
	const view = { ...STILL, target: new THREE.Vector3(0, 0, 0) };
	const post = new Post(renderer, scene, camera, new THREE.Scene(), () => view);
	// Medium draws the prepass (MSAA) that depth of field reads; the rest off, to see only it.
	const plain = { ao: false, bloom: false, vignette: false, aberration: false, grain: false };
	post.set({ ...settingsFor(tier, 'webgl2'), ...plain, grade: false });
	const gl = (renderer.backend as unknown as { gl: WebGL2RenderingContext }).gl;
	/** Draws a few frames and reads the picture. */
	const frame = () => {
		for (let i = 0; i < 3; i++) {
			advanceNodeFrame(renderer!);
			post.render();
		}
		const px = new Uint8Array(SIZE * SIZE * 4);
		gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, px);
		return px;
	};
	return { post, view, frame };
}

/** Edge contrast along the rows from `y0` to `y1` (from the bottom): what a blur takes away. */
function contrast(px: Uint8Array, y0: number, y1: number): number {
	let sum = 0;
	for (let y = y0; y < y1; y++)
		for (let x = 40; x < SIZE - 41; x++) {
			const i = (y * SIZE + x) * 4;
			sum += Math.abs(px[i + 1] - px[i + 5]);
		}
	return sum / (y1 - y0);
}

// Pixels are read back on WebGL2 (preserveDrawingBuffer).
describe.skipIf(BACKEND === 'webgpu')('depth of field', () => {
	for (const tier of ['medium', 'high'] as const)
		it(`blurs the far floor during a shot's hold and keeps its focus sharp (${tier})`, async () => {
			const { view, frame } = await setup(tier);
			const rest = frame();
			view.shot = 1;
			const shot = frame();
			// The focus (the origin) is at the middle of the picture; the far floor near the top.
			const [focusRow, farRows] = [
				[95, 105],
				[150, 165]
			] as const;
			expect(contrast(shot, ...farRows)).toBeLessThan(contrast(rest, ...farRows) * 0.6);
			expect(contrast(shot, ...focusRow)).toBeGreaterThan(contrast(rest, ...focusRow) * 0.8);
		});

	it('leaves nothing behind when a shot ends: the frame at rest is as before', async () => {
		const { view, frame } = await setup();
		const before = frame();
		view.shot = 1;
		frame();
		view.shot = 0;
		const after = frame();
		expect(after.every((v, i) => v === before[i])).toBe(true);
	});

	it('tilt-shifts the tactical view with Miniature on, sharp on the pivot row', async () => {
		const { post, view, frame } = await setup();
		const rest = frame();
		view.tactical = true;
		const settings = settingsFor('medium', 'webgl2');
		post.set({ ...settings, ao: false, bloom: false, grain: false, miniature: true });
		const tilted = frame();
		const [pivotRow, farRows] = [
			[95, 105],
			[150, 165]
		] as const;
		expect(contrast(tilted, ...farRows)).toBeLessThan(contrast(rest, ...farRows) * 0.6);
		expect(contrast(tilted, ...pivotRow)).toBeGreaterThan(contrast(rest, ...pivotRow) * 0.8);
	});

	it('shows neither under reduced motion, whatever the shot or Miniature', async () => {
		const { post, view, frame } = await setup();
		const rest = frame();
		const plain = { ao: false, bloom: false, vignette: false, aberration: false, grain: false };
		post.set({ ...settingsFor('medium', 'webgl2'), ...plain, grade: false, miniature: true });
		Object.assign(view, { reduced: true, shot: 1 });
		expect(frame().every((v, i) => v === rest[i])).toBe(true);
	});
});
