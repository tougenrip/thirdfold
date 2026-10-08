// Names on demand (#268): a label drawn at DPR 2 is crisp (its glyph edges step from plate to text
// within a device pixel or two, as an atlas texel lands on one pixel) and, as the overlay pass
// promises (#157), its text comes out exactly as it does with no world and no effects, under bloom,
// the lens, grain, a grade that inverts everything and TRAA. Two draws whatever the label count.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import { OverlayLayer } from './overlay';
import { Post } from './post';
import { STILL } from './focus';
import { LabelLayer } from './label-layer';
import { labelFontReady } from './label-font';
import { TEXT_COLOUR } from './labels';
import { settingsFor, TRAA_CONVERGE } from './quality';
import { BACKEND } from './testing';

vi.setConfig({ testTimeout: 60_000 });

/** CSS pixels, drawn at DPR 2. */
const SIZE = 200;
const DPR = 2;
const PX = SIZE * DPR;

let renderer: THREE.WebGPURenderer | null = null;
afterEach(() => {
	renderer?.dispose();
	renderer = null;
});

/** A bright checker table that blooms: what a label must never take on. */
function world(): THREE.Object3D[] {
	const data = new Uint8Array(16 * 16 * 4);
	for (let i = 0; i < 256; i++) data.fill(((i % 16) + (i >> 4)) % 2 ? 250 : 40, i * 4, i * 4 + 4);
	const checker = new THREE.DataTexture(data, 16, 16);
	checker.colorSpace = THREE.SRGBColorSpace;
	checker.needsUpdate = true;
	const plane = new THREE.Mesh(
		new THREE.PlaneGeometry(6, 6),
		new THREE.MeshStandardMaterial({ map: checker, emissive: 0xffffff, emissiveIntensity: 1 })
	);
	plane.rotation.x = -Math.PI / 2;
	return [plane, new THREE.AmbientLight(0xffffff, 2)];
}

/** Draws `count` labelled minis (the first at the middle) over `objects`; each frame's pixels. */
async function draw(objects: THREE.Object3D[], effects: boolean, frames: number, count = 1) {
	const canvas = document.createElement('canvas');
	renderer = await createNodeRenderer(canvas, { pixelRatio: DPR, preserveDrawingBuffer: true });
	renderer.setSize(SIZE, SIZE, false);
	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x000000);
	if (objects.length) scene.add(...objects);
	const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
	camera.position.set(0, 5, 5);
	camera.lookAt(0, 1, 0);
	const overlay = new OverlayLayer();
	const roots = Array.from({ length: count }, (_, i) => {
		const root = new THREE.Object3D();
		root.position.set(i === 0 ? 0 : -2 + (i % 5), 0, i === 0 ? 0 : -2 + Math.floor(i / 5));
		return root;
	});
	const labels = new LabelLayer(
		overlay,
		(id) => roots[Number(id)] ?? null,
		() => 1234
	);
	labels.setTokens(roots.map((_, i) => ({ id: String(i), name: i ? `Mini ${i}` : 'The Warden' })));
	labels.set({ always: true });
	const view = { ...STILL, shot: effects ? 1 : 0, target: new THREE.Vector3(0, 0, 0) };
	const post = new Post(renderer, scene, camera, overlay.scene, () => view);
	const settings = settingsFor('high', 'webgl2');
	post.set(
		effects
			? settings
			: { ...settings, bloom: false, vignette: false, aberration: false, grain: false }
	);
	if (effects) {
		const u = post.uniforms;
		u.vignette.value = 1;
		u.aberration.value = 0.05;
		u.bloomStrength.value = 1;
		(post as unknown as { grain: number }).grain = 0.2;
	}
	const gl = (renderer.backend as unknown as { gl: WebGL2RenderingContext }).gl;
	const out: Uint8Array[] = [];
	let calls = 0;
	for (let i = 0; i < frames; i++) {
		advanceNodeFrame(renderer);
		renderer.info.reset();
		post.render(1234);
		calls = renderer.info.render.drawCalls;
		const px = new Uint8Array(PX * PX * 4);
		gl.readPixels(0, 0, PX, PX, gl.RGBA, gl.UNSIGNED_BYTE, px);
		out.push(px);
	}
	post.dispose();
	labels.dispose();
	renderer.dispose();
	renderer = null;
	return { frames: out, calls };
}

const TEXT = [1, 3, 5].map((i) => parseInt(TEXT_COLOUR.slice(i, i + 2), 16));
const isText = (px: Uint8Array, i: number) =>
	TEXT.every((c, k) => Math.abs(px[i * 4 + k] - c) <= 2);
const luma = (px: Uint8Array, i: number) =>
	0.3 * px[i * 4] + 0.6 * px[i * 4 + 1] + 0.1 * px[i * 4 + 2];

describe.skipIf(BACKEND === 'webgpu')('labels on demand (#268)', () => {
	it('draws a crisp name at DPR 2, its text untouched by every effect', async () => {
		await labelFontReady;
		const { frames: alone } = await draw([], false, 2);
		const text = Array.from({ length: PX * PX }, (_, i) => i).filter((i) => isText(alone[1], i));
		expect(text.length, 'text pixels').toBeGreaterThan(150);
		// Crisp: glyph edges step from the plate to the text in one device pixel, often.
		let steps = 0;
		for (const i of text)
			if (i % PX > 0 && luma(alone[1], i) - luma(alone[1], i - 1) > 150) steps++;
		expect(steps, 'sharp glyph edges').toBeGreaterThan(30);
		// Exactly the same text under the world, every effect and TRAA's jitter, frame after frame.
		const { frames } = await draw(world(), true, TRAA_CONVERGE + 2);
		for (const px of frames.slice(2))
			for (const i of text)
				expect([...px.slice(i * 4, i * 4 + 3)]).toEqual([...alone[1].slice(i * 4, i * 4 + 3)]);
	});

	it('costs the same draws for one name or forty', async () => {
		const one = await draw([], false, 2, 1);
		const forty = await draw([], false, 2, 40);
		expect(forty.calls).toBe(one.calls);
	});
});
