// Ambient occlusion (#159), bloom (#160) and the output stage (#161), read back as pixels on
// WebGL2 (preserveDrawingBuffer).

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import { Post } from './post';
import { postScene } from './post-scene';
import { settingsFor } from './quality';
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

describe.skipIf(BACKEND === 'webgpu')('ambient occlusion', () => {
	/**
	 * A crate on a floor under a sky light, and a wall face lit head-on by a lamp, drawn with the
	 * AO at `strength`: the luminance at the foot of the crate, and on the lamp-lit face.
	 */
	async function measure(strength: number, tier: 'medium' | 'high') {
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
		post.set(settingsFor(tier, 'webgl2'));
		post.uniforms.aoStrength.value = strength;
		// High's GTAO turns each frame and TRAA averages it: give the history its frames.
		for (let i = 0; i < (tier === 'high' ? 24 : 3); i++) {
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
			programs: renderer.info.memory.programs,
			ao: 'useTemporalFiltering' in post.ao! ? 'gtao' : 'ssao'
		};
		renderer.dispose();
		renderer = null;
		return result;
	}

	for (const [tier, kind] of [
		['medium', 'ssao'],
		['high', 'gtao']
	] as const) {
		it(`darkens the foot of a crate, not a face a lamp lights, on ${tier} (${kind})`, async () => {
			const off = await measure(0, tier);
			const on = await measure(1, tier);
			expect(on.ao).toBe(kind);
			// Medium measured 104 → 92 at the foot; the lamp-lit face does not move.
			expect(on.crease).toBeLessThan(off.crease * 0.95);
			expect(Math.abs(on.face - off.face)).toBeLessThan(off.face * 0.02);
		});

		it(`turns off and on again without compiling anything, on ${tier}`, async () => {
			const { renderer, post, draw } = await setup();
			const at = (strength: number) => {
				post.uniforms.aoStrength.value = strength;
				advanceNodeFrame(renderer);
				post.render();
			};
			draw(tier);
			for (const strength of [1, 1, 1]) at(strength);
			const programs = renderer.info.memory.programs;
			for (const strength of [0, 1, 0, 1]) at(strength);
			// A table's environment writes the AO's uniforms only.
			post.setLook('cavern', 1);
			at(1);
			expect(renderer.info.memory.programs).toBe(programs);
		});
	}
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
