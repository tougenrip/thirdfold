// The post-processing pipeline (milestone 63, #156): each tier builds its
// passes with the attachments later effects read (8-bit normals and emissive,
// half-float colour and velocity), draws through them, and gives every render
// target back when it changes tier or is disposed; with the `post` layer off
// it draws straight to the canvas.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeRenderer } from './loop';
import { Post } from './post';
import { settingsFor, type Tier } from './quality';
import { BACKEND } from './testing';

let renderer: THREE.WebGPURenderer | null = null;
afterEach(() => {
	renderer?.dispose();
	renderer = null;
});

async function setup() {
	const canvas = document.createElement('canvas');
	canvas.width = 320;
	canvas.height = 200;
	renderer = await createNodeRenderer(canvas, { pixelRatio: 1, backend: BACKEND });
	renderer.setSize(320, 200, false);
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 50);
	camera.position.set(2, 2, 3);
	camera.lookAt(0, 0, 0);
	const glow = new THREE.MeshStandardMaterial({ color: 'orange', emissive: 'orange' });
	scene.add(new THREE.Mesh(new THREE.BoxGeometry(), glow), new THREE.AmbientLight('white', 1));
	const post = new Post(renderer, scene, camera);
	const backend = BACKEND === 'webgpu' ? 'webgpu' : 'webgl2';
	const draw = (tier: Tier, on = true) => {
		const settings = settingsFor(tier, backend);
		post.set({ ...settings, layers: { ...settings.layers, post: on } });
		renderer!.info.reset();
		post.render();
	};
	return { renderer, post, draw };
}

describe('the post-processing pipeline', () => {
	for (const tier of ['low', 'medium', 'high'] as const) {
		it(`draws the ${tier} tier through 8-bit normals and emissive and half-float colour`, async () => {
			const { renderer, post, draw } = await setup();
			draw(tier);
			const scene = post.scenePass!;
			expect(scene.getTexture('emissive').type).toBe(THREE.UnsignedByteType);
			expect(scene.renderTarget.texture.type).toBe(THREE.HalfFloatType);
			expect(scene.renderTarget.samples).toBe(settingsFor(tier, 'webgl2').msaa);
			if (tier === 'low') expect(post.prepass).toBeNull();
			else {
				expect(post.prepass!.renderTarget.texture.type).toBe(THREE.UnsignedByteType);
				expect(post.prepass!.getTexture('velocity').type).toBe(THREE.HalfFloatType);
			}
			expect(renderer.info.memory.renderTargets).toBeGreaterThan(0);
		});
	}

	it('gives every target back across tier changes and when disposed', async () => {
		const { renderer, post, draw } = await setup();
		const { memory } = renderer.info;
		draw('medium', false);
		const [targets, bytes] = [memory.renderTargets, memory.texturesSize];
		for (const tier of ['low', 'high', 'medium', 'low'] as const) draw(tier);
		post.dispose();
		draw('medium', false);
		expect(memory.renderTargets).toBe(targets);
		expect(memory.texturesSize).toBe(bytes);
	});

	it('draws straight to the canvas with the post layer off', async () => {
		const { renderer, post, draw } = await setup();
		draw('high', false);
		expect(post.scenePass).toBeNull();
		expect(post.targets()).toEqual([]);
		expect(renderer.info.render.drawCalls).toBeGreaterThan(0);
	});
});
