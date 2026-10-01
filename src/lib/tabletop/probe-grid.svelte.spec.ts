// The probe grid (#235) on the high tier: a bake compiles nothing (its programs come in the
// warm-up's hold), the renderer is idle once it has converged, no fragment stage samples more than
// WebGPU's 16 textures with the probes' atlas, and the tiers below high make no grid. On the real
// GPU (the client-webgpu project) it also times the Hollow's bake on WebGPU and on WebGL2, for
// docs/PERFORMANCE.md. Unexplored ground under probes is in unexplored-black.svelte.spec.ts.

import * as THREE from 'three/webgpu';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Light } from '$lib/game/lights';
import { shaderStages } from './perf';
import { settingsFor, type Tier } from './quality';
import {
	BACKEND,
	loadSidecar,
	loadView,
	mountFixture,
	settle,
	wait,
	type Mounted,
	type Viewer
} from './testing';
import type { Tabletop } from './types';

vi.setConfig({ testTimeout: 900_000, hookTimeout: 90_000 });

/** WebGPU's default `maxSampledTexturesPerShaderStage`. */
const STAGE_LIMIT = 16;

let errors: ReturnType<typeof vi.spyOn>;
let mounted: Mounted | null = null;
beforeEach(() => {
	errors = vi.spyOn(console, 'error');
});
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
	expect(errors, 'console.error was called').not.toHaveBeenCalled();
	vi.restoreAllMocks();
});

/** A fixture on a tier with the probes' layer on, on a real clock (the bake's debounce runs). */
async function mount(fixture: string, viewer: Viewer, tier: Tier, webgl = false) {
	const sidecar = await loadSidecar(fixture);
	const view = await loadView(fixture, sidecar.ambient, viewer);
	const compile = vi.spyOn(THREE.WebGPURenderer.prototype, 'compileAsync');
	const clock = { now: () => performance.now() };
	const m = await mountFixture(view, sidecar.poses.overview, { clock, tier, webgl });
	mounted = m;
	const settings = settingsFor(tier, m.tabletop.capabilities().backend);
	m.tabletop.setQuality({ ...settings, layers: { ...settings.layers, probes: true } });
	await settle(m.tabletop, 1500, 120_000);
	const renderer = compile.mock.contexts[0] as THREE.WebGPURenderer;
	expect(renderer).toBeInstanceOf(THREE.WebGPURenderer);
	return { m, view, renderer };
}

/** Bakes finished so far. */
const bakes = (t: Tabletop) => t.stats().timings['probe-bake']?.count ?? 0;

/** Waits for the bake after `from` bakes, then for the table to come to rest. */
async function baked(t: Tabletop, from: number, limitMs = 600_000) {
	const until = performance.now() + limitMs;
	while (bakes(t) <= from && performance.now() < until) await wait(100);
	expect(bakes(t), 'a bake finished').toBeGreaterThan(from);
	await settle(t, 1500, 120_000);
}

/** The most textures any fragment stage samples, and whether the ground's samples a 3D texture. */
function stages(renderer: THREE.WebGPURenderer) {
	let most = 0;
	let volume = false;
	for (const [code, label] of shaderStages(renderer)) {
		if (!label.endsWith(' fragment')) continue;
		const wgsl = code.match(/var\s+\w+\s*:\s*texture_/g)?.length ?? 0;
		const glsl = code.match(/uniform\s+(?:(?:high|medium|low)p\s+)?\w*sampler\w*/g)?.length ?? 0;
		most = Math.max(most, wgsl, glsl);
		// The probes' atlas, not the grade's LUT (post-processing's own stages).
		volume ||=
			label === 'terrain fragment' &&
			/:\s*texture_3d<|uniform\s+(?:\w+p\s+)?sampler3D\s/.test(code);
	}
	return { most, volume };
}

const TORCH: Light = {
	id: 'probe-torch',
	pos: { x: 3, y: 3 },
	radius: 4,
	color: '#ff9a3c',
	on: true
};

describe(`the probe grid on ${BACKEND}`, () => {
	it('bakes on high without compiling, then draws nothing', async () => {
		const { m, view, renderer } = await mount('test-world', 'gm', 'high');
		const t = m.tabletop;
		await baked(t, 0);
		const before = t.stats();
		const sampled = stages(renderer);
		console.info(`high: ${JSON.stringify(sampled)}; programs ${before.programs}`);
		expect(sampled.volume, 'the probes are drawn').toBe(true);
		expect(sampled.most, `fragment stages over ${STAGE_LIMIT} textures`).toBeLessThanOrEqual(
			STAGE_LIMIT
		);
		// A light comes: the probes bake again, compiling nothing.
		const n = bakes(t);
		t.setLighting(view.ambient, [...view.lights, TORCH], view.world);
		await baked(t, n);
		const after = t.stats();
		expect([after.programs, after.pipelines]).toEqual([before.programs, before.pipelines]);
		// Converged: three seconds without a frame.
		const frames = t.stats().frames;
		await wait(3000);
		expect(t.stats().frames, 'frames after the bake converged').toBe(frames);
	});

	it('makes no grid below high', async () => {
		const { m, renderer } = await mount('test-world', 'gm', 'medium');
		m.tabletop.setPose(m.tabletop.cameraPose()!);
		await wait(2000);
		await settle(m.tabletop, 1500, 120_000);
		expect(bakes(m.tabletop)).toBe(0);
		expect(stages(renderer).volume).toBe(false);
	});

	// The Hollow's bake time on the reference GPU (an RTX 4060 Laptop): docs/PERFORMANCE.md.
	for (const webgl of [false, true])
		it.skipIf(BACKEND !== 'webgpu')(
			`times the Hollow's bake on ${webgl ? 'WebGL2' : 'WebGPU'}`,
			async () => {
				const { m } = await mount('hollow', 'gm', 'high', webgl);
				const t = m.tabletop;
				await baked(t, 0);
				t.resetStats();
				t.setLighting('dark', [TORCH]); // a change, and a whole bake timed from its first step
				await baked(t, 0);
				const { timings, frames, backend, adapter } = t.stats();
				const bake = timings['probe-bake'];
				const steps = timings.probes;
				console.info(
					`hollow on ${backend} (${adapter}): bake ${bake.last.toFixed(0)} ms over ${steps.count} steps ` +
						`(${steps.total.toFixed(0)} ms in them, the longest ${steps.max.toFixed(1)} ms), ` +
						`${frames} frames`
				);
				expect(bake.last).toBeGreaterThan(0);
			}
		);
});
