// The overlay under every effect (milestone 63, #157): with chromatic
// aberration, grain, the vignette, bloom and depth of field at full strength,
// TRAA converging and a grade that recolours everything, opaque overlay pixels
// come out exactly as an overlay drawn alone, in their material colours, and
// hold still from frame to frame while TRAA jitters the world beneath.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import { OverlayLayer } from './overlay';
import { Post } from './post';
import { STILL } from './focus';
import { HIGHLIGHT } from './previews';
import { LUT_SIZE, type Grades } from './environment';
import { GRADE_BANDS, TONE_MAPPERS } from '../assets/manifest';
import { settingsFor, TRAA_CONVERGE } from './quality';
import { BACKEND } from './testing';

vi.setConfig({ testTimeout: 60_000 });

const SIZE = 200;

let renderer: THREE.WebGPURenderer | null = null;
afterEach(() => {
	renderer?.dispose();
	renderer = null;
});

/** A grade that inverts every colour: nothing the world shows keeps its colour. */
function inverted(): Grades {
	const lut = new Uint8Array(LUT_SIZE ** 3 * 4);
	for (let i = 0; i < LUT_SIZE ** 3; i++) {
		const [r, g, b] = [
			i % LUT_SIZE,
			Math.floor(i / LUT_SIZE) % LUT_SIZE,
			Math.floor(i / LUT_SIZE ** 2)
		];
		lut.set(
			[r, g, b].map((v) => 255 - Math.round((v * 255) / (LUT_SIZE - 1))),
			i * 4
		);
		lut[i * 4 + 3] = 255;
	}
	const bands = Object.fromEntries(GRADE_BANDS.map((b) => [b, lut]));
	return Object.fromEntries(TONE_MAPPERS.map((t) => [t, bands])) as Grades;
}

/** Opaque markers in the three highlight colours, west to east along z = 0, above the table. */
const MARKERS = [
	{ x: -1.2, color: HIGHLIGHT.move },
	{ x: 0, color: HIGHLIGHT.blocked },
	{ x: 1.2, color: HIGHLIGHT.place }
];
function markers(): OverlayLayer {
	const overlay = new OverlayLayer();
	for (const { x, color } of MARKERS) {
		const m = new THREE.Mesh(
			new THREE.PlaneGeometry(0.5, 0.5),
			new THREE.MeshBasicMaterial({ color })
		);
		m.rotation.x = -Math.PI / 2;
		m.position.set(x, 0.1, 0);
		overlay.scene.add(m);
	}
	return overlay;
}

/** A glowing checker table under a top-down view of 4×4 world units. */
function world(): THREE.Object3D[] {
	const data = new Uint8Array(16 * 16 * 4);
	for (let i = 0; i < 256; i++) data.fill(((i % 16) + (i >> 4)) % 2 ? 230 : 40, i * 4, i * 4 + 4);
	const checker = new THREE.DataTexture(data, 16, 16);
	checker.colorSpace = THREE.SRGBColorSpace;
	checker.needsUpdate = true;
	const plane = new THREE.Mesh(
		new THREE.PlaneGeometry(3.6, 3.6),
		new THREE.MeshStandardMaterial({
			map: checker,
			emissive: 0xffa040,
			emissiveIntensity: 0.6
		})
	);
	plane.rotation.x = -Math.PI / 2;
	return [plane, new THREE.AmbientLight(0xffffff, 2)];
}

/**
 * Draws `overlay` over `objects` on the high tier (TRAA), `frames` frames on a held clock: with
 * `effects`, every lens effect, bloom and depth of field at full strength and the inverted grade;
 * without, none of them. Returns each frame's pixels (RGBA, bottom row first).
 */
async function draw(
	objects: THREE.Object3D[],
	overlay: OverlayLayer,
	effects: boolean,
	frames: number
) {
	const canvas = document.createElement('canvas');
	renderer = await createNodeRenderer(canvas, { pixelRatio: 1, preserveDrawingBuffer: true });
	renderer.setSize(SIZE, SIZE, false);
	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x000000);
	if (objects.length) scene.add(...objects);
	const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 20);
	camera.position.set(0, 10, 0);
	camera.lookAt(0, 0, 0);
	// A cinematic shot's full depth of field, focused on the table's centre.
	const view = { ...STILL, shot: effects ? 1 : 0, target: new THREE.Vector3() };
	const post = new Post(renderer, scene, camera, overlay.scene, () => view);
	const settings = settingsFor('high', 'webgl2');
	post.set(
		effects
			? settings
			: {
					...settings,
					bloom: false,
					vignette: false,
					aberration: false,
					grain: false,
					grade: false
				}
	);
	if (effects) {
		post.setLook(null, 1, inverted());
		const u = post.uniforms;
		u.vignette.value = 1;
		u.aberration.value = 0.05;
		u.bloomStrength.value = 1;
		(post as unknown as { grain: number }).grain = 0.2;
	}
	const gl = (renderer.backend as unknown as { gl: WebGL2RenderingContext }).gl;
	const out: Uint8Array[] = [];
	for (let i = 0; i < frames; i++) {
		advanceNodeFrame(renderer);
		post.render(1234);
		const px = new Uint8Array(SIZE * SIZE * 4);
		gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, px);
		out.push(px);
	}
	if (effects) expect(post.focus.uniforms.dof.value).toBe(1);
	post.dispose();
	renderer.dispose();
	renderer = null;
	return out;
}

/** The pixel at world (x, z), RGB. */
const at = (px: Uint8Array, x: number, z: number) => {
	const o = (Math.round(((z + 2) * SIZE) / 4) * SIZE + Math.round(((x + 2) * SIZE) / 4)) * 4;
	return [...px.slice(o, o + 3)];
};
const rgb = (hex: number) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

// Pixels are read back on WebGL2 (preserveDrawingBuffer).
describe.skipIf(BACKEND === 'webgpu')('the overlay under every effect', () => {
	it('shows opaque overlay pixels exactly, in their colours, and holds them still under TRAA', async () => {
		const [alone] = await draw([], markers(), false, 2);
		const frames = await draw(world(), markers(), true, TRAA_CONVERGE + 2);
		// The effects are on: the inverted grade turns the black beyond the table white.
		const last = frames[frames.length - 1];
		expect(Math.min(...at(last, 1.95, 1.95))).toBeGreaterThan(200);
		// Every pixel inside each marker, on every frame after the first two (which compile).
		const inside = MARKERS.flatMap(({ x }) =>
			Array.from({ length: 81 }, (_, i) => [
				x - 0.2 + (i % 9) * 0.05,
				-0.2 + Math.floor(i / 9) * 0.05
			])
		);
		for (const { x, color } of MARKERS) expect(at(alone, x, 0)).toEqual(rgb(color));
		for (const px of frames.slice(2))
			for (const [x, z] of inside) expect(at(px, x, z)).toEqual(at(alone, x, z));
		// Where the markers cover, pixel for pixel, never moves while the world is jittered.
		const covered = (px: Uint8Array) =>
			Array.from({ length: SIZE * SIZE }, (_, i) =>
				MARKERS.some(({ color }) => rgb(color).every((c, k) => px[i * 4 + k] === c))
			);
		const first = covered(frames[2]);
		expect(first.filter(Boolean).length).toBeGreaterThan(3 * 20 * 20);
		for (const px of frames.slice(3)) expect(covered(px)).toEqual(first);
	});
});
