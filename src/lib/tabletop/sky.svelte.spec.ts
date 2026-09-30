// The sky layer (#214) and its capture (#216), on a 16 px target: the capture scene holds the
// dome alone (no table can show in a reflection), the sky writes "shown" (0) to the `hidden`
// attachment the output stage re-masks by, and a tier switch, a day's hours, another sky and a
// capture compile nothing once the warm-up gallery was drawn. A render spec (RENDER_SPECS).

import * as THREE from 'three/webgpu';
import { mrt, output, vec4 } from 'three/tsl';
import { afterEach, expect, it, vi } from 'vitest';
import type { SkyDef } from '$lib/assets/manifest';
import temperate from '../../../assets/skies/temperate.json';
import underground from '../../../assets/skies/underground.json';
import { atmosphereAt, presetOf } from './atmosphere-curve';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import { SkyLayer, SKY_CUBE } from './sky';
import { BACKEND } from './testing';

vi.setConfig({ testTimeout: 120_000 });

const SIZE = 16;
let renderer: THREE.WebGPURenderer | null = null;
let sky: SkyLayer | null = null;
afterEach(() => {
	sky?.dispose();
	renderer?.dispose();
	sky = renderer = null;
});

async function setup() {
	const r = await createNodeRenderer(document.createElement('canvas'), {
		pixelRatio: 1,
		antialias: false,
		backend: BACKEND === 'webgpu' ? 'webgpu' : 'webgl'
	});
	renderer = r;
	r.setSize(SIZE, SIZE, false);
	sky = new SkyLayer();
	const scene = new THREE.Scene();
	scene.add(sky.group);
	// A low camera, so the horizon, the sun's side and the ground below it are all in view.
	const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
	camera.position.set(0, 2, 0);
	camera.lookAt(10, 2, 0);
	// The scene pass's outputs: colour, and `hidden` (1 where the world hides a cell).
	const target = new THREE.RenderTarget(SIZE, SIZE, { count: 2, type: THREE.HalfFloatType });
	target.textures[0].name = 'output';
	target.textures[1].name = 'hidden';
	const outputs = mrt({ output, hidden: vec4(1, 1, 1, 1) });
	return {
		sky,
		scene,
		draw() {
			advanceNodeFrame(r);
			r.setClearColor(0xffffff, 1);
			r.setRenderTarget(target);
			r.setMRT(outputs);
			r.render(scene, camera);
			r.setMRT(null);
			r.setRenderTarget(null);
		},
		read: async (index: number) =>
			(await r.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE, index)) as Uint16Array,
		programs: () => r.info.memory.programs,
		renderer: r
	};
}

const at = (def: unknown, minute: number) =>
	atmosphereAt(presetOf(def as SkyDef), minute, { kind: 'none', intensity: 0 });

it('captures the dome alone, writes 0 to hidden, and a tier or sky switch compiles nothing', async () => {
	const errors = vi.spyOn(console, 'error');
	const warnings = vi.spyOn(console, 'warn');
	const s = await setup();
	const layer = s.sky;
	// The capture scene: the dome (the moon is drawn in it), sharing the layer's material.
	expect(layer.envScene.children).toHaveLength(1);
	const [captured] = layer.envScene.children as THREE.Mesh[];
	expect(captured.material).toBe(layer.dome.material);
	// Nothing of the sky takes the scene's fog, and each writes its own `hidden`.
	for (const o of [layer.dome, layer.stars]) {
		const material = (o as THREE.Mesh).material as THREE.NodeMaterial;
		expect(material.fog).toBe(false);
		expect(material.mrtNode?.has('hidden')).toBe(true);
	}

	// Warm up as the table does: low (dome hidden), with the gallery's stand-ins drawn once.
	layer.setTier('low');
	layer.apply(at(temperate, 23 * 60));
	expect(layer.dome.visible).toBe(false);
	const held = new THREE.Group();
	held.position.y = -1000;
	held.scale.setScalar(1e-6);
	held.add(...layer.gallery());
	s.scene.add(held);
	s.draw();
	held.removeFromParent();
	layer.capture(s.renderer);
	s.draw();
	const programs = s.programs();

	// The sky at night, shown: every pixel is sky, and `hidden` is 0 under all of it.
	layer.setTier('high');
	expect(layer.dome.visible).toBe(true);
	expect(layer.stars.visible).toBe(true);
	s.draw();
	const [colour, hidden] = [await s.read(0), await s.read(1)];
	const texels = SIZE * SIZE;
	let [shown, drawn] = [0, 0];
	const WHITE = THREE.DataUtils.toHalfFloat(1);
	for (let i = 0; i < texels; i++) {
		if (hidden[i * 4] === 0) shown++;
		if (colour[i * 4] !== WHITE) drawn++;
	}
	expect(drawn).toBe(texels);
	expect(shown).toBe(texels);

	// A day's hours, the tiers, an enclosed sky and captures: no new program.
	for (const tier of ['medium', 'ultra', 'low', 'high'] as const) {
		layer.setTier(tier);
		for (let hour = 0; hour < 24; hour += 3) {
			layer.apply(at(temperate, hour * 60));
			layer.setTime(hour * 1000);
			s.draw();
		}
		layer.capture(s.renderer);
	}
	layer.apply(at(underground, 0));
	layer.uniforms.shell.value = 1;
	layer.setReducedMotion(true);
	s.draw();
	layer.capture(s.renderer);
	expect(s.programs()).toBe(programs);
	// The capture drew into the cube (its one attachment is the mrt's `output`).
	layer.apply(at(temperate, 12 * 60));
	s.renderer.setClearColor(0x000000, 0);
	layer.capture(s.renderer);
	const face = (await s.renderer.readRenderTargetPixelsAsync(
		SKY_CUBE,
		0,
		0,
		4,
		4,
		0,
		2
	)) as Uint16Array;
	expect(face.some((x) => x !== 0)).toBe(true);
	expect(errors).not.toHaveBeenCalled();
	expect(warnings).not.toHaveBeenCalled();
	vi.restoreAllMocks();
});
