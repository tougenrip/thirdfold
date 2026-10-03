// Fake translucency (#237): a translucent prop lit from behind glows on the camera's side, and lit
// from the front only it looks as it would opaque. Each test draws a fixture twice from one pose,
// as it is and with every translucent material's `translucency` at 0, so what differs is the
// term's light alone; bloom, the lens and grain are off, motion is reduced (no flicker). Ref 1's
// tent stands between the camera and the torch, ref 6's crystals between it and the braziers.
// `VITE_TRANSLUCENCY_SHOT=1` writes each lit frame to .vitest-attachments/.

import * as THREE from 'three/webgpu';
import { commands } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GridPose } from './poses';
import { settingsFor } from './quality';
import { BACKEND, HEIGHT, WIDTH, loadView, mountFixture, settle, type Mounted } from './testing';

vi.setConfig({ testTimeout: 300_000 });

const WRITE = import.meta.env.VITE_TRANSLUCENCY_SHOT === '1';

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
});

type Translucent = { params: { translucency: number } };

/** Writes a frame (rows bottom-up, as read back) as a PNG. */
async function writePng(path: string, pixels: Uint8Array) {
	const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
	const ctx = canvas.getContext('2d')!;
	const image = ctx.createImageData(WIDTH, HEIGHT);
	const row = WIDTH * 4;
	for (let y = 0; y < HEIGHT; y++)
		image.data.set(pixels.subarray((HEIGHT - 1 - y) * row, (HEIGHT - y) * row), y * row);
	ctx.putImageData(image, 0, 0);
	const bytes = new Uint8Array(
		await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()
	);
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	await commands.writeFile(path, btoa(binary), { encoding: 'base64' });
}

/**
 * How much the term brightens `assetId`'s props in the frame at `pose`: the sum over pixels of
 * what their translucency adds to the brightest channel, in 0-255 steps. Also checks the term
 * compiles nothing.
 */
async function gain(
	fixture: string,
	assetId: string,
	pose: GridPose,
	shot?: string
): Promise<number> {
	let scene: THREE.Scene | null = null;
	const devScene = (s: THREE.Scene) => (scene = s);
	const view = structuredClone(await loadView(fixture, 'dark', 'gm'));
	const m = await mountFixture(view, pose, { reducedMotion: true, devScene });
	mounted = m;
	const t = m.tabletop;
	const settings = settingsFor('medium', t.capabilities().backend);
	const quiet = { bloom: false, aberration: false, grain: false, vignette: false };
	t.setQuality({ ...settings, ...quiet, miniature: false });
	t.setFog(null, 'gm');
	await settle(t, 500, 60_000);
	const translucent: Translucent[] = [];
	(scene as THREE.Scene | null)?.traverse((o) => {
		const material = (o as THREE.Mesh).material as Partial<Translucent> | undefined;
		if (o.userData.assetId === assetId && material?.params?.translucency)
			translucent.push(material as Translucent);
	});
	expect(translucent.length).toBeGreaterThan(0);
	const lit = m.pixels().slice();
	if (WRITE && shot) await writePng(`.vitest-attachments/translucency-${shot}.png`, lit);
	const programs = t.stats().programs;
	const strengths = translucent.map((x) => x.params.translucency);
	for (const x of translucent) x.params.translucency = 0;
	t.setPose(t.cameraPose()!); // asks for a frame, as setting a value does not
	await settle(t, 500, 60_000);
	const opaque = m.pixels();
	if (WRITE && shot) await writePng(`.vitest-attachments/translucency-${shot}-opaque.png`, opaque);
	expect(t.stats().programs).toBe(programs);
	translucent.forEach((x, i) => (x.params.translucency = strengths[i]));
	let sum = 0;
	for (let i = 0; i < lit.length; i += 4) {
		const a = Math.max(lit[i], lit[i + 1], lit[i + 2]);
		const b = Math.max(opaque[i], opaque[i + 1], opaque[i + 2]);
		sum += a - b;
	}
	return sum;
}

// Pixels are read back on WebGL2 (preserveDrawingBuffer).
describe.skipIf(BACKEND === 'webgpu')('translucency', () => {
	it("glows on the camera's side of a tent with the torch behind it, not from the front", async () => {
		// The tent's footprint is (3..4, 3..4), the torch at (1, 1): from the south-east it stands
		// between the camera and the torch, from the north-west the torch lights its near side.
		const target = { x: 3, y: 3 };
		const back = await gain(
			'ref-1',
			'tent',
			{ target, distance: 6, azimuth: 45, elevation: 30 },
			'tent'
		);
		await mounted?.unmount();
		mounted = null;
		const front = await gain(
			'ref-1',
			'tent',
			{ target, distance: 6, azimuth: 225, elevation: 55 },
			'tent-front'
		);
		console.info(`tent: back-lit +${back}, front-lit +${front}`);
		// About 25,000 with #238's torch (0.7, the core capped at 2.5); 40,000 at the old torch of 1.
		expect(back).toBeGreaterThan(20_000);
		expect(front).toBeLessThan(back / 10);
	});

	it('glows through a crystal with a brazier behind it', async () => {
		// The west crystal at (4, 6), its brazier at (4, 5) north of it.
		const target = { x: 4, y: 6 };
		const back = await gain(
			'ref-6',
			'crystal',
			{ target, distance: 5, azimuth: 0, elevation: 25 },
			'crystal'
		);
		console.info(`crystal: back-lit +${back}`);
		expect(back).toBeGreaterThan(20_000);
	});
});
