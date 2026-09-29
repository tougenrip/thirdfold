// A real cinematic shot on a fixture table (#165): at its hold depth of field
// is at full strength, blurring the far village while the focus stays sharp,
// and once the shot is over the frame is the one from before it.
// With VITE_LOOK_SHOT=1 the hold frame is written to docs/look/m63-dof/shot-hold.png.

import { commands } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GRAIN_MS } from './post';
import { settingsFor } from './quality';
import { SHOT_MS, SHOT_TOTAL, shotFocus } from './shots';
import {
	BACKEND,
	HEIGHT,
	loadSidecar,
	loadView,
	manualClock,
	mountFixture,
	settle,
	WIDTH,
	type Mounted
} from './testing';

// Software frames on CI's small runners take seconds since the shader kinds (M64).
vi.setConfig({ testTimeout: 300_000, hookTimeout: 90_000 });

const WRITE = import.meta.env.VITE_LOOK_SHOT === '1';

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
});

/** Edge contrast along rows `y0` to `y1` (from the bottom): what a blur takes away. */
function contrast(px: Uint8Array, y0: number, y1: number): number {
	let sum = 0;
	for (let y = y0; y < y1; y++)
		for (let x = 100; x < WIDTH - 101; x++) {
			const i = (y * WIDTH + x) * 4;
			sum += Math.abs(px[i + 1] - px[i + 5]);
		}
	return sum / (y1 - y0);
}

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

// Pixels are read back on WebGL2 (preserveDrawingBuffer).
describe.skipIf(BACKEND === 'webgpu')('a cinematic shot on a table', () => {
	it('focuses at its hold, blurring the far village, and leaves the frame as it was', async () => {
		// Midway through a grain frame: the dither moves on with the clock (post.ts).
		const clock = manualClock(1_000_000 + GRAIN_MS / 2);
		const sidecar = await loadSidecar('village');
		// By day, and the GM's view without fog: the whole village, textured to the horizon.
		const view = structuredClone(await loadView('village', 'day', 'gm'));
		view.fog = { ...view.fog, enabled: false };
		// No flames: they flicker by the clock, which moves on through the shot.
		view.lights = [];
		mounted = await mountFixture(view, sidecar.poses.overview, { clock, reducedMotion: false });
		const t = mounted.tabletop;
		// No grain: it would differ between frames drawn at different times.
		const plain = { ...settingsFor('medium', t.capabilities().backend), grain: false };
		t.setQuality(plain);
		await settle(t);

		/**
		 * Moves the clock and waits for the frame it brings: a quiet spell alone can come before
		 * the scheduler's next frame on a loaded machine, and read the last one.
		 */
		const advance = async (to: number) => {
			const drawn = t.stats().frames;
			clock.set(to);
			await expect.poll(() => t.stats().frames, { timeout: 30_000 }).toBeGreaterThan(drawn);
			await settle(t, 250, 3000);
		};
		// A whole cycle of the dither on, so whatever blends in on the clock (the grade) has, and
		// the frame before the shot is the table at rest.
		const cycle = 4096 * GRAIN_MS;
		// At rest nothing asks for a frame when the clock moves: draw one.
		clock.set(clock.now() + cycle);
		await t.benchmark(1);
		await settle(t);
		const before = mounted.pixels();
		const start = clock.now();
		t.playShot({ focus: { x: 18, y: 20 }, frame: 'close' });
		// The shot's clock stands still in its hold, where depth of field is at full strength.
		const hold = SHOT_MS.go + 500;
		expect(shotFocus(hold)).toBe(1);
		await advance(start + hold);
		const focused = mounted.pixels();
		if (WRITE) await writePng('docs/look/m63-dof/shot-hold.png', focused);
		// The same pose with depth of field switched off, to compare like for like.
		t.setQuality({ ...plain, layers: { ...plain.layers, dof: false } });
		await settle(t, 250, 3000);
		const sharp = mounted.pixels();
		t.setQuality(plain);
		// The focus cell is in the middle of the picture; the far village at the top.
		const [focusRows, farRows] = [
			[240, 260],
			[440, 480]
		] as const;
		expect(contrast(focused, ...farRows)).toBeLessThan(contrast(sharp, ...farRows) * 0.8);
		// The band runs a little in front of and behind the focus: the plaster's fine texture there
		// (#187) softens a touch (0.83 of sharp in M65), the far village far more (0.56).
		expect(contrast(focused, ...focusRows)).toBeGreaterThan(contrast(sharp, ...focusRows) * 0.8);

		// Long after the shot, on the same frame of the dither: home again, nothing of the blur left.
		expect(SHOT_TOTAL).toBeLessThan(3 * cycle);
		await advance(start + 3 * cycle);
		await settle(t);
		const after = mounted.pixels();
		expect(after.every((v, i) => v === before[i])).toBe(true);
	});
});
