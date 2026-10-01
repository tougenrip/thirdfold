// The Bell's flash on the table (#222, #223): the frozen monastery at noon, as the GM sees it,
// from straight above the sealed ringing chamber (a dark area lit only by its candle stub). On
// the flash the chamber lights up, and it is back as it was by FLASH_MS and a frame; frames
// sampled through the envelope stay within WCAG 2.3.1 (three flashes a second, no red flash),
// normally and with Reduce flashing (a fade of 500 ms or more), for one flash and for tolls back
// to back; and switching Reduce flashing compiles nothing. WebGL2 only: frames are read back.
// Two CI shards (shardedIt): `THIRDFOLD_SHARD=k/2`.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, vi } from 'vitest';
import { FLASH_MS } from '$lib/game/chat';
import { countFlashes, frameSample, REDUCED_RISE_MS, type FrameSample } from './flash';
import { shaderCounts } from './perf';
import {
	BACKEND,
	HEIGHT,
	WIDTH,
	loadView,
	manualClock,
	mountFixture,
	readFrame,
	settle,
	shardedIt,
	type Mounted
} from './testing';

vi.setConfig({ testTimeout: 300_000 });
const test = shardedIt();

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
	vi.restoreAllMocks();
});

// A box over the chamber at the pose below (x, y, width, height from the top left).
const CHAMBER_BOX = [340, 190, 150, 140];
const POSE = { target: { x: 4, y: 6 }, distance: 22, azimuth: 0, elevation: 80 };
const T0 = 1_000_000;

async function mount() {
	const compile = vi.spyOn(THREE.WebGPURenderer.prototype, 'compileAsync');
	const view = await loadView('monastery', 'day', 'gm');
	const clock = manualClock(T0);
	mounted = await mountFixture(view, POSE, { clock });
	await settle(mounted.tabletop);
	const renderer = compile.mock.contexts[0] as THREE.WebGPURenderer;
	const t = mounted.tabletop;
	/** Moves the held clock to `at` and waits for a frame drawn at it, or for the table at rest. */
	const frameAt = async (at: number) => {
		clock.set(at);
		const from = t.stats().frames;
		const until = performance.now() + 20_000;
		let idle = 0;
		while (t.stats().frames < from + 1 && performance.now() < until && idle < 3) {
			await new Promise(requestAnimationFrame);
			idle = t.stats().mode === 'idle' ? idle + 1 : 0;
		}
	};
	const chamber = async () => {
		const read = await readFrame(mounted!.canvas, WIDTH, HEIGHT);
		const [x0, y0, w, h] = CHAMBER_BOX;
		let [sum, n] = [0, 0];
		for (let y = y0; y < y0 + h; y += 2)
			for (let x = x0; x < x0 + w; x += 2) {
				const [r, g, b] = read(x, y);
				sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
				n++;
			}
		return sum / n;
	};
	return {
		t,
		renderer,
		frameAt,
		chamber,
		sample: (at: number) => frameSample(at, mounted!.pixels())
	};
}

/** Frames every `step` ms from before the first cue to after the last's window. */
async function capture(m: Awaited<ReturnType<typeof mount>>, cues: number[], step = 100) {
	const samples: FrameSample[] = [];
	const end = T0 + Math.max(...cues) + FLASH_MS + 200;
	const pending = [...cues];
	for (let at = T0 - 200; at <= end; at += step) {
		while (pending.length && T0 + pending[0] <= at) {
			// The cue lands at its own moment, as a log entry would.
			await m.frameAt(T0 + pending.shift()!);
			m.t.playCue('flash', null);
		}
		await m.frameAt(at);
		samples.push(m.sample(at));
	}
	return samples;
}

describe('the flash', () => {
	test('lights the dark chamber and is gone by FLASH_MS and a frame', async (ctx) => {
		if (BACKEND === 'webgpu') ctx.skip();
		const m = await mount();
		const before = await m.chamber();
		m.t.playCue('flash', null);
		await m.frameAt(T0 + 0.2 * FLASH_MS);
		const lit = await m.chamber();
		await m.frameAt(T0 + FLASH_MS + 17);
		const after = await m.chamber();
		expect(lit - before).toBeGreaterThan(20);
		expect(Math.abs(after - before)).toBeLessThan(1.5);
	});

	// Normally and reduced, each a test of its own: a CI shard each (shardedIt).
	for (const reduce of [false, true])
		test(
			`stays within WCAG 2.3.1, ${reduce ? 'reduced' : 'normally'}, for one flash and tolls back to back`,
			{ timeout: 600_000 },
			async (ctx) => {
				if (BACKEND === 'webgpu') ctx.skip();
				const m = await mount();
				// One flash; the Keeper's tolls at the enemy turn delay; a cue again inside the hold.
				const runs: [string, number[]][] = [
					['one', [0]],
					['tolls', [0, 2500, 5000]],
					['held', [0, 600]]
				];
				m.t.setReduceFlashing(reduce);
				for (const [name, cues] of runs) {
					const count = countFlashes(await capture(m, cues));
					expect(count.flashes, name).toBeLessThanOrEqual(3);
					expect(count.redFlashes, name).toBe(0);
					// A reduced flash is a fade: no swing of luminance quicker than its rise (to a sample).
					if (reduce) expect(count.fastestMs, name).toBeGreaterThanOrEqual(REDUCED_RISE_MS - 100);
				}
			}
		);

	test('compiles nothing when Reduce flashing switches, or while a reduced flash plays', async (ctx) => {
		if (BACKEND === 'webgpu') ctx.skip();
		const m = await mount();
		// One flash each way first, so every uniform has been drawn at a lift.
		m.t.playCue('flash', null);
		await m.frameAt(T0 + 500);
		await m.frameAt(T0 + FLASH_MS + 17);
		const was = shaderCounts(m.renderer);
		m.t.setReduceFlashing(true);
		m.t.playCue('flash', null);
		for (const at of [0.1, 0.3, 0.6, 1.1]) await m.frameAt(T0 + FLASH_MS + at * FLASH_MS);
		m.t.setReduceFlashing(false);
		await m.frameAt(T0 + 3 * FLASH_MS);
		const now = shaderCounts(m.renderer);
		expect({ programs: now.programs, pipelines: now.pipelines }).toEqual({
			programs: was.programs,
			pipelines: was.pipelines
		});
	});
});
