// The post-processing pipeline (milestone 63, #156): each tier builds its
// passes with the attachments later effects read (8-bit normals and emissive,
// half-float colour), draws through them, and gives every render
// target back when it changes tier or is disposed; with the `post` layer off
// it draws straight to the canvas.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import { readGrades, renderGrade } from '../../../server/assets/grades';
import villageGrades from '../../../assets/grades/village.json';
import { loadEnvironment } from './environment';
import { OverlayLayer } from './overlay';
import { Post } from './post';
import { TONE_MAPPERS } from '../assets/manifest';
import { settingsFor, type Tier } from './quality';
import { BACKEND } from './testing';

// Software rendering under a full run's load takes a while: as the other renderer specs.
vi.setConfig({ testTimeout: 60_000 });

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
	const box = new THREE.Mesh(new THREE.BoxGeometry(), glow);
	const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshStandardMaterial());
	floor.rotation.x = -Math.PI / 2;
	floor.position.y = -0.5;
	box.castShadow = floor.receiveShadow = true;
	// A sun casting shadows, as on the table: shadowed materials are the ones that recompile.
	const sun = new THREE.DirectionalLight('white', 2);
	sun.position.set(2, 4, 1);
	sun.castShadow = true;
	scene.add(box, floor, sun, new THREE.AmbientLight('white', 1));
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

	it('compiles nothing new going round the tiers again', async () => {
		const { renderer, draw } = await setup();
		const round = () => {
			for (const tier of ['low', 'medium', 'high', 'low', 'medium'] as const) {
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

describe.skipIf(BACKEND === 'webgpu')('ambient occlusion', () => {
	/**
	 * A crate on a floor under a sky light, and a wall face lit head-on by a lamp, drawn with the
	 * AO at `strength`: the luminance at the foot of the crate, and on the lamp-lit face.
	 */
	async function measure(strength: number) {
		const canvas = document.createElement('canvas');
		renderer = await createNodeRenderer(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
		renderer.setSize(400, 300, false);
		const scene = new THREE.Scene();
		scene.background = new THREE.Color(0x000000);
		const grey = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 1 });
		const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), grey);
		floor.rotation.x = -Math.PI / 2;
		const crate = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), grey);
		crate.position.set(-1, 0.5, 0);
		const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.2), grey);
		wall.position.set(1.5, 1, 0);
		const lamp = new THREE.PointLight(0xffffff, 6, 4, 2);
		lamp.position.set(1.5, 1, 1.2);
		scene.add(floor, crate, wall, lamp, new THREE.HemisphereLight(0xffffff, 0x404040, 1.5));
		const camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 50);
		camera.position.set(0, 2.2, 4.5);
		camera.lookAt(0, 0.4, 0);
		camera.updateMatrixWorld();
		const post = new Post(renderer, scene, camera, new THREE.Scene());
		const settings = settingsFor('high', 'webgl2');
		post.set(settings);
		post.uniforms.aoStrength.value = strength;
		for (let i = 0; i < 3; i++) {
			advanceNodeFrame(renderer);
			post.render();
		}
		const gl = (renderer.backend as unknown as { gl: WebGL2RenderingContext }).gl;
		const lum = (x: number, y: number, z: number) => {
			const p = new THREE.Vector3(x, y, z).project(camera);
			const px = new Uint8Array(4);
			gl.readPixels(
				Math.round((p.x + 1) * 200),
				Math.round((p.y + 1) * 150),
				1,
				1,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				px
			);
			return 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];
		};
		const result = {
			crease: lum(-1, 0.02, 0.55),
			face: lum(1.5, 1, 0.11),
			open: lum(-3, 0, 2),
			programs: renderer.info.memory.programs
		};
		renderer.dispose();
		renderer = null;
		return result;
	}

	it('darkens the foot of a crate, not a face a lamp lights', async () => {
		const off = await measure(0);
		const on = await measure(1);
		// Measured 104 → 92 at the foot; the lamp-lit face does not move.
		expect(on.crease).toBeLessThan(off.crease * 0.95);
		expect(Math.abs(on.face - off.face)).toBeLessThan(off.face * 0.02);
	});

	it('turns off and on again without compiling anything', async () => {
		const { renderer, post, draw } = await setup();
		const at = (strength: number) => {
			post.uniforms.aoStrength.value = strength;
			advanceNodeFrame(renderer);
			post.render();
		};
		draw('high');
		for (const strength of [1, 1, 1]) at(strength);
		const programs = renderer.info.memory.programs;
		for (const strength of [0, 1, 0, 1]) at(strength);
		expect(renderer.info.memory.programs).toBe(programs);
	});
});

describe.skipIf(BACKEND === 'webgpu')('bloom', () => {
	/** A flame (emissive 4) beside a sunlit wall, bloom at `strength`: luminance near each. */
	async function measure(strength: number) {
		const canvas = document.createElement('canvas');
		renderer = await createNodeRenderer(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
		renderer.setSize(400, 300, false);
		const scene = new THREE.Scene();
		scene.background = new THREE.Color(0x000000);
		const flame = new THREE.Mesh(
			new THREE.SphereGeometry(0.15),
			new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xffa040, emissiveIntensity: 4 })
		);
		flame.position.set(-1, 0, 0);
		const wall = new THREE.Mesh(
			new THREE.PlaneGeometry(1.5, 2),
			new THREE.MeshStandardMaterial({ color: 0xc8c0a8, roughness: 1 })
		);
		wall.position.set(1.2, 0, 0);
		const sun = new THREE.DirectionalLight(0xffffff, 2.5);
		sun.position.set(0, 0, 5);
		scene.add(flame, wall, sun, new THREE.AmbientLight(0xffffff, 0.3));
		const camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 50);
		camera.position.set(0, 0, 5);
		camera.updateMatrixWorld();
		const post = new Post(renderer, scene, camera, new THREE.Scene());
		post.set(settingsFor('medium', 'webgl2'));
		post.uniforms.bloomStrength.value = strength;
		for (let i = 0; i < 3; i++) {
			advanceNodeFrame(renderer);
			post.render();
		}
		const gl = (renderer.backend as unknown as { gl: WebGL2RenderingContext }).gl;
		const lum = (x: number, y: number) => {
			const p = new THREE.Vector3(x, y, 0).project(camera);
			const px = new Uint8Array(4);
			const [sx, sy] = [Math.round((p.x + 1) * 200), Math.round((p.y + 1) * 150)];
			gl.readPixels(sx, sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
			return 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];
		};
		const result = { halo: lum(-1.3, 0), wall: lum(1.2, 0) };
		renderer.dispose();
		renderer = null;
		return result;
	}

	it('glows around a flame, not over a sunlit wall', async () => {
		const off = await measure(0);
		const on = await measure(0.3);
		expect(on.halo).toBeGreaterThan(off.halo + 10);
		expect(Math.abs(on.wall - off.wall)).toBeLessThanOrEqual(2);
	});

	it('turns off and on again without compiling anything', async () => {
		const { renderer, post, draw } = await setup();
		const at = (strength: number) => {
			post.uniforms.bloomStrength.value = strength;
			advanceNodeFrame(renderer);
			post.render();
		};
		draw('high');
		for (const strength of [0.3, 0.3, 0.3]) at(strength);
		const programs = renderer.info.memory.programs;
		for (const strength of [0, 0.3, 0, 0.3]) at(strength);
		expect(renderer.info.memory.programs).toBe(programs);
	});
});

describe.skipIf(BACKEND === 'webgpu')('the output stage', () => {
	/**
	 * A 200×200 frame of `world` (a checker plane and a flame, or black), every lens effect and
	 * the bloom at `lens` strength, drawn at clock `now`: its pixels.
	 */
	async function frame(world: 'checker' | 'black', lens: 0 | 1, now = 0) {
		const canvas = document.createElement('canvas');
		renderer = await createNodeRenderer(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
		renderer.setSize(200, 200, false);
		const scene = new THREE.Scene();
		scene.background = new THREE.Color(0x000000);
		if (world === 'checker') {
			const data = new Uint8Array(16 * 16 * 4);
			for (let i = 0; i < 256; i++)
				data.fill(((i % 16) + (i >> 4)) % 2 ? 230 : 40, i * 4, i * 4 + 4);
			const checker = new THREE.DataTexture(data, 16, 16);
			checker.needsUpdate = true;
			const plane = new THREE.Mesh(
				new THREE.PlaneGeometry(2, 2),
				new THREE.MeshBasicMaterial({ map: checker })
			);
			const flame = new THREE.Mesh(
				new THREE.SphereGeometry(0.1),
				new THREE.MeshStandardMaterial({ emissive: 0xffa040, emissiveIntensity: 4 })
			);
			flame.position.z = 0.1;
			scene.add(plane, flame);
		}
		const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
		camera.position.z = 5;
		const post = new Post(renderer, scene, camera, new THREE.Scene());
		post.set(settingsFor('high', 'webgl2'));
		const u = post.uniforms;
		if (lens === 0) u.vignette.value = u.aberration.value = u.bloomStrength.value = 0;
		else {
			u.vignette.value = 1;
			u.aberration.value = 0.05;
			u.bloomStrength.value = 1;
		}
		(post as unknown as { grain: number }).grain = lens ? 0.2 : 0;
		for (let i = 0; i < 3; i++) {
			advanceNodeFrame(renderer);
			post.render(now);
		}
		const gl = (renderer.backend as unknown as { gl: WebGL2RenderingContext }).gl;
		const px = new Uint8Array(200 * 200 * 4);
		gl.readPixels(0, 0, 200, 200, gl.RGBA, gl.UNSIGNED_BYTE, px);
		renderer.dispose();
		renderer = null;
		return px;
	}
	const at = (px: Uint8Array, x: number, y: number) => [
		...px.slice((y * 200 + x) * 4, (y * 200 + x) * 4 + 3)
	];

	it('keeps black exactly black with every effect at full strength', async () => {
		const px = await frame('black', 1, 1234);
		expect(Math.max(...px.filter((_, i) => i % 4 !== 3))).toBe(0);
	});

	it('leaves the centre alone and fringes the edges', async () => {
		const plain = await frame('checker', 0);
		const lens = await frame('checker', 1);
		// Off the flame's glow, at the centre row: the middle barely moves, the edge does.
		const diff = (x: number, y: number) =>
			at(plain, x, y).reduce((d, c, i) => d + Math.abs(c - at(lens, x, y)[i]), 0);
		expect(diff(62, 100)).toBeLessThan(diff(3, 100));
		expect(diff(3, 100)).toBeGreaterThan(20);
	});

	it('draws the same grain and dither for the same clock, and moves them with it', async () => {
		const a = await frame('checker', 1, 5000);
		const b = await frame('checker', 1, 5000);
		const c = await frame('checker', 1, 6000);
		expect(a.every((v, i) => v === b[i])).toBe(true);
		expect(a.some((v, i) => v !== c[i])).toBe(true);
	});
});

describe('the colour grade', () => {
	it('loads a strip in the layout the pipeline rendered it', async () => {
		const look = await loadEnvironment('village');
		const loaded = look!.grades!.aces.day;
		const expected = renderGrade(readGrades(villageGrades).day.aces);
		for (const [r, g, b] of [
			[0, 0, 0],
			[31, 0, 0],
			[3, 20, 11],
			[31, 31, 31]
		]) {
			const strip = (g * 1024 + b * 32 + r) * 4;
			const cube = ((b * 32 + g) * 32 + r) * 4;
			expect([...loaded.slice(cube, cube + 3)]).toEqual([...expected.slice(strip, strip + 3)]);
		}
	});

	it.skipIf(BACKEND === 'webgpu')(
		'draws within one step of no grade through the identity table',
		async () => {
			const canvas = document.createElement('canvas');
			renderer = await createNodeRenderer(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
			renderer.setSize(64, 64, false);
			const scene = new THREE.Scene();
			const data = new Uint8Array(64 * 64 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 256));
			const colours = new THREE.DataTexture(data, 64, 64);
			colours.needsUpdate = true;
			scene.background = colours;
			const post = new Post(renderer, scene, new THREE.PerspectiveCamera(), new THREE.Scene());
			post.set(settingsFor('low', 'webgl2'));
			const gl = (renderer.backend as unknown as { gl: WebGL2RenderingContext }).gl;
			const draw = (grade: number) => {
				post.uniforms.grade.value = grade;
				advanceNodeFrame(renderer!);
				post.render();
				const px = new Uint8Array(64 * 64 * 4);
				gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
				return px;
			};
			const [none, identity] = [draw(0), draw(1)];
			expect(none.every((v, i) => Math.abs(v - identity[i]) <= 1)).toBe(true);
		}
	);

	it('blends to a new grade over 1.5 s, compiling nothing', async () => {
		const { renderer, post, draw } = await setup();
		draw('medium');
		const look = await loadEnvironment('village');
		const at = (now: number) => {
			advanceNodeFrame(renderer);
			post.render(now);
		};
		at(0);
		const programs = renderer.info.memory.programs;
		// A new environment's grade is in place at once; a new band blends in.
		post.setLook('village', 1, look!.grades, 'day');
		expect(post.blending).toBe(false);
		post.setLook('village', 1, look!.grades, 'dusk');
		expect(post.blending).toBe(true);
		at(1000);
		at(1700);
		expect(post.blending).toBe(true);
		at(3300);
		expect(post.blending).toBe(false);
		post.setLook('village', 1, look!.grades, 'dark');
		expect(post.blending).toBe(true);
		at(4000);
		at(6000);
		expect(post.blending).toBe(false);
		expect(renderer.info.memory.programs).toBe(programs);
	});
});
