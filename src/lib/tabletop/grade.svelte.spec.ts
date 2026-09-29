// The colour grade (#162): the strips' layout, the blend and loading per tone mapper.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import { readGrades, renderGrade } from '../../../server/assets/grades';
import villageGrades from '../../../assets/grades/village.json';
import { loadEnvironment } from './environment';
import { Post } from './post';
import { postScene } from './post-scene';
import { type ToneMapper } from '../assets/manifest';
import { loadManifest } from '../assets/load';
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

describe('the colour grade', () => {
	it('loads a strip in the layout the pipeline rendered it', async () => {
		const look = await loadEnvironment('village');
		const loaded = look!.grades!.ready.aces!.day;
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
			post.set({ ...settingsFor('low', 'webgl2'), aa: 'off' });
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

	it("loads only the tone mapper in force, and another's strips once when it is picked", async () => {
		const { renderer, post } = await setup();
		const settings = { ...settingsFor('medium', BACKEND === 'webgpu' ? 'webgpu' : 'webgl2') };
		post.set({ ...settings, toneMapper: 'aces' });
		const manifest = await loadManifest();
		const strips = (tm: ToneMapper) =>
			Object.values(manifest.environments.village.lut![tm]).map((id) => manifest.textures[id].file);
		const fetched: string[] = [];
		const fetch = globalThis.fetch;
		const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
			fetched.push(String(input));
			return fetch(input, init);
		});
		const count = (tm: ToneMapper) =>
			fetched.filter((url) => strips(tm).some((file) => url.endsWith(file))).length;
		try {
			const look = await loadEnvironment('village', 'aces');
			const grades = look!.grades!;
			expect(Object.keys(grades.ready)).toEqual(['aces']);
			expect(count('neutral') + count('agx')).toBe(0);
			const data = post.grade.texture.image.data as Uint8Array;
			const at = (now: number) => {
				advanceNodeFrame(renderer);
				post.render(now);
			};
			post.setLook('village', 1, grades, 'day');
			expect([...data]).toEqual([...grades.ready.aces!.day]);
			const onLoad = vi.fn();
			post.grade.onLoad = onLoad;
			// Picked in the Graphics menu: the output recomposes and the strips start loading.
			post.set({ ...settings, toneMapper: 'neutral' });
			// A few frames first: some passes compile on their first frames, not the pipeline's.
			for (const now of [0, 16, 32]) at(now);
			const programs = renderer.info.memory.programs;
			// Until they arrive the grade drawn stays.
			expect(post.blending).toBe(false);
			expect([...data]).toEqual([...grades.ready.aces!.day]);
			await grades.load('neutral');
			expect(onLoad).toHaveBeenCalled();
			expect(post.blending).toBe(true);
			at(100);
			at(2000);
			expect(post.blending).toBe(false);
			expect([...data]).toEqual([...grades.ready.neutral!.day]);
			expect(renderer.info.memory.programs).toBe(programs);
			// Back and forth, and the next table: nothing loads again; agx was never picked.
			post.set({ ...settings, toneMapper: 'aces' });
			post.set({ ...settings, toneMapper: 'neutral' });
			await loadEnvironment('village', 'neutral');
			expect(count('neutral')).toBe(3);
			expect(count('agx')).toBe(0);
			// A rebuild (another tier and back) keeps the grade drawn, and one that changes the
			// tone mapper too loads its strips.
			at(3000);
			at(5000);
			const backend = BACKEND === 'webgpu' ? 'webgpu' : 'webgl2';
			post.set({ ...settingsFor('low', backend), toneMapper: 'neutral' });
			post.set({ ...settings, toneMapper: 'neutral' });
			expect(post.blending).toBe(false);
			expect([...data]).toEqual([...grades.ready.neutral!.day]);
			post.set({ ...settingsFor('low', backend), toneMapper: 'agx' });
			await grades.load('agx');
			expect(count('agx')).toBe(3);
			expect(post.blending).toBe(true);
		} finally {
			spy.mockRestore();
		}
	});
});
