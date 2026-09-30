// The sealed ringing chamber at noon (#219): a dark area the sky's lights never reach, so it looks
// the same with the sun and the sky on as with both off, lit only by its candle stub, while the
// open courtyard beside it plainly takes them (the key light, the hemisphere and the captured
// sky). The frozen monastery at 12:00, as the GM sees it, from straight above the chamber. Runs
// once the table's key light and hemisphere are the sky's own (`SkyLight`, `SkyHemisphere`).

import type * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { atmosphereUniforms } from './atmosphere';
import { SkyHemisphere, SkyLight } from './sky-light';
import { HEIGHT, WIDTH, loadView, mountFixture, readFrame, settle, type Mounted } from './testing';

vi.setConfig({ testTimeout: 120_000 });

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
});

type Read = (x: number, y: number) => number[];
/** The mean luminance of a box of the frame. */
function mean(read: Read, [x0, y0, w, h]: readonly number[]): number {
	let [sum, n] = [0, 0];
	for (let y = y0; y < y0 + h; y += 2)
		for (let x = x0; x < x0 + w; x += 2) {
			const [r, g, b] = read(x, y);
			sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
			n++;
		}
	return sum / n;
}

// Boxes of the frame (x, y, width, height from the top left) at the pose below.
const CHAMBER_BOX = [340, 190, 150, 140];
const COURTYARD_BOX = [450, 360, 200, 60];

describe('the sky’s lights', () => {
	it('leave the dark ringing chamber as dark at noon as with no sun or sky', async (ctx) => {
		const view = await loadView('monastery', 'day', 'gm');
		expect(view.world.time).toBe(720);
		let scene: THREE.Scene | null = null;
		let redraw = () => {};
		const pose = { target: { x: 4, y: 6 }, distance: 22, azimuth: 0, elevation: 80 };
		mounted = await mountFixture(view, pose, { devScene: (s, r) => ([scene, redraw] = [s, r]) });
		const lights: THREE.Light[] = [];
		(scene as THREE.Scene | null)?.traverse((o) => {
			if (o instanceof SkyLight || o instanceof SkyHemisphere) lights.push(o);
		});
		if (!lights.some((l) => l instanceof SkyLight)) ctx.skip();
		const measure = async () => {
			await settle(mounted!.tabletop);
			const read = await readFrame(mounted!.canvas, WIDTH, HEIGHT);
			return [mean(read, CHAMBER_BOX), mean(read, COURTYARD_BOX)];
		};
		const [chamber, courtyard] = await measure();
		// No sun and no sky: the key light, the hemisphere and the captured sky's light (IBL) off.
		const strengths = lights.map((l) => l.intensity);
		const ibl = atmosphereUniforms.ibl.value;
		for (const l of lights) l.intensity = 0;
		atmosphereUniforms.ibl.value = 0;
		redraw();
		const [unlit, unlitCourtyard] = await measure();
		lights.forEach((l, i) => (l.intensity = strengths[i]));
		atmosphereUniforms.ibl.value = ibl;
		expect(Math.abs(chamber - unlit)).toBeLessThan(1.5);
		// Plainly: noon lights the courtyard many times over (by the skies as tuned, about 19 of 255).
		expect(courtyard - unlitCourtyard).toBeGreaterThan(10);
	});
});
