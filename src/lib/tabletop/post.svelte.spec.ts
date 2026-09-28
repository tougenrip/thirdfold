// The post-processing pipeline (milestone 63, #156): each tier builds its
// passes with the attachments later effects read (8-bit normals and emissive,
// half-float colour), draws through them, and gives every render
// target back when it changes tier or is disposed; with the `post` layer off
// it draws straight to the canvas.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import { OverlayLayer } from './overlay';
import { Post } from './post';
import { postScene } from './post-scene';
import { STILL } from './focus';
import { TONE_MAPPERS } from '../assets/manifest';
import { settingsFor, TIERS } from './quality';
import { BACKEND } from './testing';

// Software rendering under a full run's load takes a while: as the other renderer specs.
vi.setConfig({ testTimeout: 60_000 });

let renderer: THREE.WebGPURenderer | null = null;
afterEach(() => {
	renderer?.dispose();
	renderer = null;
});

/** The shared scene, its renderer disposed after each test. */
async function setup() {
	const scene = await postScene();
	renderer = scene.renderer;
	return scene;
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

	it('draws SMAA on the HDR image, with no MSAA', async () => {
		const { renderer, post, draw } = await setup();
		draw('medium', true, { aa: 'smaa', msaa: 0 });
		expect(post.scenePass!.renderTarget.samples).toBe(0);
		// Its edges, weights and blend targets, on top of the passes'.
		const smaa = renderer.info.memory.renderTargets;
		draw('medium');
		expect(smaa - renderer.info.memory.renderTargets).toBeGreaterThanOrEqual(3);
		expect(renderer.info.render.drawCalls).toBeGreaterThan(0);
	});

	it('gives every target back across tier changes and when disposed', async () => {
		const { renderer, post, draw } = await setup();
		const { memory } = renderer.info;
		draw('medium', false);
		const [targets, bytes] = [memory.renderTargets, memory.texturesSize];
		for (const tier of ['low', 'high', 'medium', 'low'] as const) draw(tier);
		// SMAA (#163), and GTAO at full resolution where ultra runs (#159).
		draw('medium', true, { aa: 'smaa', msaa: 0 });
		if (BACKEND === 'webgpu') draw('ultra');
		post.dispose();
		draw('medium', false);
		expect(memory.renderTargets).toBe(targets);
		// r186's TRAANode keeps one 1×1 half-float texture (8 bytes) past its dispose; in play a
		// change of antialiasing builds a new renderer, which frees it.
		expect(memory.texturesSize - bytes).toBeLessThanOrEqual(64);
		expect(memory.texturesSize).toBeGreaterThanOrEqual(bytes);
	});

	it('compiles nothing new going round the tiers again', async () => {
		const { renderer, draw } = await setup();
		const round = () => {
			// Tiers with other antialiasing get a new renderer (Tabletop.svelte): only these share one.
			for (const tier of ['high', 'ultra', 'high', 'ultra'] as const) {
				draw(tier);
				advanceNodeFrame(renderer);
				draw(tier);
			}
		};
		round();
		const programs = renderer.info.memory.programs;
		const targets = renderer.info.memory.renderTargets;
		round();
		round();
		expect(renderer.info.memory.programs).toBe(programs);
		expect(renderer.info.memory.renderTargets).toBe(targets);
	});

	// #164: the Graphics menu's effect switches are uniforms. Stored off, an effect still draws
	// its passes on the first frames, so turning it on later compiles nothing either.
	const SWITCHES = [
		'ao',
		'bloom',
		'vignette',
		'aberration',
		'grain',
		'grade',
		'miniature'
	] as const;
	const tiers = BACKEND === 'webgpu' ? TIERS : TIERS.filter((t) => t !== 'ultra');
	for (const tier of tiers) {
		it(`switches every effect on the ${tier} tier without compiling anything`, async () => {
			const { renderer, post, view } = await setup();
			const backend = BACKEND === 'webgpu' ? 'webgpu' : 'webgl2';
			const preset = settingsFor(tier, backend);
			// On low the AO needs a prepass the tier doesn't draw: that is a new renderer's shape.
			const switches = SWITCHES.filter((s) => s !== 'ao' || tier !== 'low');
			const off = Object.fromEntries(switches.map((s) => [s, false]));
			const draw = (settings: object) => {
				post.set({ ...preset, ...settings });
				advanceNodeFrame(renderer);
				post.render();
			};
			draw(off);
			draw(off);
			const pipelines = (renderer as unknown as { _pipelines: { caches: Map<unknown, unknown> } })
				._pipelines.caches;
			const before = [renderer.info.memory.programs, pipelines.size];
			for (const s of switches) {
				draw({ ...off, [s]: true });
				draw(off);
			}
			// Miniature in the tactical view (tilt-shift), and a shot's depth of field (#165).
			view.tactical = true;
			draw({ ...off, miniature: true });
			view.tactical = false;
			view.shot = 0.5;
			draw(off);
			view.shot = 0;
			draw({});
			expect([renderer.info.memory.programs, pipelines.size]).toEqual(before);
		});
	}

	// #160: the lens dirt's texture arrives after the pipeline is built, and swaps a binding only.
	it('loads the lens dirt when it is turned up, compiling nothing', async () => {
		const { renderer, post, draw } = await setup();
		const pipelines = (renderer as unknown as { _pipelines: { caches: Map<unknown, unknown> } })
			._pipelines.caches;
		const frame = () => {
			advanceNodeFrame(renderer);
			post.render();
		};
		draw('medium');
		frame();
		const before = [renderer.info.memory.programs, pipelines.size];
		const blank = post.dirt.map.value;
		post.dirt.set(1);
		await vi.waitUntil(() => post.dirt.map.value !== blank, { timeout: 10_000 });
		expect((post.dirt.map.value.image as { width: number }).width).toBeLessThanOrEqual(256);
		frame();
		post.dirt.set(0);
		frame();
		expect([renderer.info.memory.programs, pipelines.size]).toEqual(before);
	});

	it('keeps grain off under reduced motion, whatever is chosen', async () => {
		const { renderer } = await setup();
		let reduced = true;
		const post = new Post(
			renderer,
			new THREE.Scene(),
			new THREE.PerspectiveCamera(),
			new THREE.Scene(),
			() => ({ ...STILL, reduced })
		);
		post.set(settingsFor('high', 'webgl2'));
		post.render();
		expect(post.uniforms.grain.value).toBe(0);
		reduced = false;
		post.render();
		expect(post.uniforms.grain.value).toBeGreaterThan(0);
		post.dispose();
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
		if (world.length) scene.add(...world);
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
		// Hidden at rest since #167: shown as while building.
		overlay.setGridShown(true, 0, true);
		overlay.tick(0);
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

describe.skipIf(BACKEND === 'webgpu')('the tone mapper', () => {
	for (const toneMapper of TONE_MAPPERS) {
		it(`keeps black exactly black under ${toneMapper}`, async () => {
			const canvas = document.createElement('canvas');
			renderer = await createNodeRenderer(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
			renderer.setSize(64, 64, false);
			const scene = new THREE.Scene();
			scene.background = new THREE.Color(0x000000);
			const post = new Post(renderer, scene, new THREE.PerspectiveCamera(), new THREE.Scene());
			post.set({ ...settingsFor('medium', 'webgl2'), toneMapper });
			advanceNodeFrame(renderer);
			post.render();
			const gl = (renderer.backend as unknown as { gl: WebGL2RenderingContext }).gl;
			const px = new Uint8Array(64 * 64 * 4);
			gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
			expect(Math.max(...px.filter((_, i) => i % 4 !== 3))).toBe(0);
		});
	}

	it('switches without compiling the passes again, however often', async () => {
		const { renderer, post, draw } = await setup();
		draw('medium');
		const scene = post.scenePass;
		const pick = (toneMapper: 'agx' | 'aces') => {
			post.set({ ...settingsFor('medium', 'webgl2'), toneMapper });
			advanceNodeFrame(renderer);
			post.render();
		};
		pick('agx');
		pick('aces');
		const programs = renderer.info.memory.programs;
		for (let i = 0; i < 3; i++) {
			pick('agx');
			pick('aces');
		}
		expect(post.scenePass).toBe(scene);
		expect(renderer.info.memory.programs).toBe(programs);
		pick('agx');
		expect(renderer.toneMapping).toBe(THREE.AgXToneMapping);
	});
});
