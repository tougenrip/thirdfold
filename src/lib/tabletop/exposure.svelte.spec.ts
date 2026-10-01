// Exposure from the focus cell (#233) on the test world after dark, as a player sees it, with no
// light anywhere: looking at a cell the player sees lifts exposure by the cap, a lit one by less,
// and an unseen one not at all; explored (remembered) cells look the same either way, since
// `worldModify` divides them by the lift, and unexplored cells stay exactly black. The lift's
// size is read from `cellUniforms.memoryGain` (2^-lift). WebGL2 only: frames are read back.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Light } from '$lib/game/lights';
import { encodeMask } from '$lib/game/visibility';
import { cellUniforms } from './cell-maps';
import { LIFT_CAP } from './exposure';
import { BACKEND, loadView, mountFixture, settle, type FixtureView, type Mounted } from './testing';

vi.setConfig({ testTimeout: 300_000 });

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
});

const FOCUS = { x: 12, y: 12 };
// Looking almost straight down, so the frame holds the grid alone (the ground past it is no cell).
const POSE = { target: FOCUS, distance: 10, azimuth: 0, elevation: 80 };
/** A box round the focus on screen (x, y, width, height from the top left), where it is seen. */
const FOCUS_BOX = [230, 80, 340, 340];

/** Explored: columns 8-16 of rows 9-15; visible: the 3x3 round the focus, or nothing. */
function fogOf(view: FixtureView, seen: boolean) {
	const { width, height } = view.grid;
	const explored = new Uint8Array(width * height);
	const visible = new Uint8Array(width * height);
	for (let y = 9; y <= 15; y++) for (let x = 8; x <= 16; x++) explored[y * width + x] = 1;
	if (seen)
		for (let dy = -1; dy <= 1; dy++)
			for (let dx = -1; dx <= 1; dx++) visible[(FOCUS.y + dy) * width + FOCUS.x + dx] = 1;
	return {
		...view.fog,
		enabled: true,
		visible: encodeMask(visible),
		explored: encodeMask(explored)
	};
}

const lift = () => -Math.log2(cellUniforms.memoryGain.value);

describe('exposure from the focus cell', () => {
	it('lifts over a seen dark cell, less by a light, never over memory or the unexplored', async (ctx) => {
		if (BACKEND === 'webgpu') ctx.skip();
		const base = await loadView('test-world', 'dark', 'player');
		const view: FixtureView = { ...base, tokens: [], lights: [], fog: fogOf(base, true) };
		mounted = await mountFixture(view, POSE, { reducedMotion: true });
		const t = mounted.tabletop;
		await settle(t);
		expect(lift()).toBeCloseTo(LIFT_CAP, 5);
		const lifted = mounted.pixels();

		// The focus out of sight: no lift, and every pixel away from the focus as it was.
		t.setFog(fogOf(view, false), view.fogMode);
		await settle(t);
		expect(cellUniforms.memoryGain.value).toBe(1);
		const flat = mounted.pixels();
		const [x0, y0, w, h] = FOCUS_BOX;
		let [compared, black, worst] = [0, 0, 0];
		for (let y = 0; y < 500; y++)
			for (let x = 0; x < 800; x++) {
				// Rows bottom first; the box is from the top.
				const top = 499 - y;
				if (x >= x0 && x < x0 + w && top >= y0 && top < y0 + h) continue;
				const o = (y * 800 + x) * 4;
				const a = flat.subarray(o, o + 3);
				const b = lifted.subarray(o, o + 3);
				// Unexplored ground is exactly black in both.
				if (a[0] + a[1] + a[2] + b[0] + b[1] + b[2] === 0) {
					black++;
					continue;
				}
				compared++;
				for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(a[c] - b[c]));
			}
		expect(compared).toBeGreaterThan(5000); // explored ground
		expect(black).toBeGreaterThan(5000); // unexplored ground, black either way
		expect(worst).toBeLessThanOrEqual(2);

		// A light on the focus: the lift is smaller, but still there.
		const torch: Light = { id: 'focus-torch', pos: FOCUS, radius: 3, color: '#ffaa55', on: true };
		t.setFog(fogOf(view, true), view.fogMode);
		t.setLighting(view.ambient, [torch], view.world);
		await settle(t);
		expect(lift()).toBeGreaterThan(0);
		expect(lift()).toBeLessThan(LIFT_CAP - 0.5);
	});
});
