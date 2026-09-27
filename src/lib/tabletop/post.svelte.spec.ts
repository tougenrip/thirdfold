// The post-processing pipeline (milestone 63, #156): each tier builds its
// passes with the attachments later effects read (8-bit normals and emissive,
// half-float colour), draws through them, and gives every render
// target back when it changes tier or is disposed; with the `post` layer off
// it draws straight to the canvas.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it } from 'vitest';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import { OverlayLayer } from './overlay';
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
	const post = new Post(renderer, scene, camera, new THREE.Scene());
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

// Pixels are read back on WebGL2 (preserveDrawingBuffer); WebGPU compares golden images.
describe.skipIf(BACKEND === 'webgpu')('the overlay', () => {
	/** A top-down view of a 4×4 table, the overlay drawn over `world`. */
	async function view(world: THREE.Object3D[], overlay: OverlayLayer, size = 200) {
		const canvas = document.createElement('canvas');
		renderer = await createNodeRenderer(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
		renderer.setSize(size, size, false);
		const scene = new THREE.Scene();
		scene.background = new THREE.Color(0x000000);
		scene.add(...world);
		const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 20);
		camera.position.set(0, 10, 0);
		camera.lookAt(0, 0, 0);
		const post = new Post(renderer, scene, camera, overlay.scene);
		post.set(settingsFor('medium', 'webgl2'));
		// The first frame compiles the passes; the overlay tests depth from the second on.
		const draw = () => {
			for (let i = 0; i < 2; i++) {
				advanceNodeFrame(renderer!);
				post.render();
			}
		};
		draw();
		const gl = (renderer.backend as unknown as { gl: WebGL2RenderingContext }).gl;
		const resize = (next: number) => {
			size = next;
			renderer!.setSize(size, size, false);
			draw();
		};
		/** The pixel at world (x, z), RGB. */
		const at = (x: number, z: number) => {
			const px = new Uint8Array(4);
			gl.readPixels(
				Math.round(((x + 2) * size) / 4),
				Math.round(((z + 2) * size) / 4),
				1,
				1,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				px
			);
			return [...px.slice(0, 3)];
		};
		return Object.assign(at, { resize });
	}
	const plane = (color: number, y: number, material?: THREE.Material) => {
		const m = new THREE.Mesh(
			new THREE.PlaneGeometry(4, 4),
			material ?? new THREE.MeshBasicMaterial({ color })
		);
		m.rotation.x = -Math.PI / 2;
		m.position.y = y;
		return m;
	};
	const marker = (x: number, y: number) => {
		const m = new THREE.Mesh(
			new THREE.PlaneGeometry(0.5, 0.5),
			new THREE.MeshBasicMaterial({ color: 0x40c070 })
		);
		m.rotation.x = -Math.PI / 2;
		m.position.set(x, y, 0);
		return m;
	};

	it('shows opaque overlay pixels exactly, whatever the world beneath', async () => {
		const bare = new OverlayLayer();
		bare.scene.add(marker(0, 0.1));
		const alone = (await view([], bare))(0, 0);
		renderer!.dispose();
		const glow = new THREE.MeshStandardMaterial({ emissive: 0xffe0a0, emissiveIntensity: 4 });
		const over = new OverlayLayer();
		over.scene.add(marker(0, 0.1));
		const lit = (await view([plane(0, 0, glow)], over))(0, 0);
		expect(alone).toEqual([0x40, 0xc0, 0x70]);
		expect(lit).toEqual(alone);
	});

	it('hides what the world stands in front of', async () => {
		const overlay = new OverlayLayer();
		// One marker under a raised slab (hidden), one beside it (shown).
		overlay.scene.add(marker(-1, 0.1), marker(1, 0.1));
		const slab = plane(0x808080, 1);
		slab.scale.set(0.5, 1, 1);
		slab.position.x = -1;
		const at = await view([slab], overlay);
		expect(at(1, 0)).toEqual([0x40, 0xc0, 0x70]);
		expect(at(-1, 0)).not.toEqual([0x40, 0xc0, 0x70]);
		// Still after the canvas resizes (every target is reallocated).
		at.resize(120);
		expect(at(1, 0)).toEqual([0x40, 0xc0, 0x70]);
		expect(at(-1, 0)).not.toEqual([0x40, 0xc0, 0x70]);
	});

	it('draws no grid line over a cell the fog hides', async () => {
		const overlay = new OverlayLayer();
		overlay.setGrid({ kind: 'square', width: 4, height: 4, cellSize: 1 });
		// The west half hidden (alpha 255), the east half seen.
		const fog = new THREE.DataTexture(new Uint8Array(16 * 4), 4, 4);
		for (let i = 0; i < 16; i++) if (i % 4 < 2) fog.image.data![i * 4 + 3] = 255;
		fog.needsUpdate = true;
		overlay.setMasks(null, fog, null);
		const at = await view([], overlay);
		// Across a row, pixel by pixel, over the line x = -1 (hidden) and x = 1 (seen).
		const across = (from: number) =>
			Array.from({ length: 40 }, (_, i) => at(from + i * 0.02, -0.5)).flat();
		expect(Math.max(...across(-1.4))).toBe(0);
		expect(Math.max(...across(0.6))).toBeGreaterThan(0);
	});
});
