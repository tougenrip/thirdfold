// Flicker in the shader (#231): the TSL mirror of light-model.ts's `flickerAt`, with the same
// waves, read by the GridLights' node per light and, for the fixtures' flames, by their vertex
// stage (#232), so flame and light breathe together. One time uniform from the renderer's injected
// clock (never TSL's `time`, which follows frame time and would break frozen-clock goldens) and one
// amplitude, 0 under reduced motion: flicker changes numbers only, never a program.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { FLICKERS } from '$lib/game/lights';
import { FLICKER_PERIOD, FLICKER_WAVES } from '../light-model';
import type { N } from './tsl';

const t = T as unknown as Record<string, N & ((...args: unknown[]) => N)>;

/** Seconds on the renderer's clock, wrapped at FLICKER_PERIOD (every wave whole cycles in it). */
export const flickerTime = T.uniform(0);
/** 1, or 0 under reduced motion: how much every light and flame wavers. */
export const flickerAmp = T.uniform(1);

/** Each profile's waves (a1, f1, a2, f2), by `FLICKERS` index: a uniform array, so no constants compile. */
const waves = T.uniformArray(
	FLICKERS.map((f) => new THREE.Vector4(...FLICKER_WAVES[f])),
	'vec4'
);

/** Sets the flicker's clock (`now`, ms) and whether it moves (`still`: reduced motion). */
export function setFlicker(now: number, still: boolean): void {
	flickerTime.value = (now / 1000) % FLICKER_PERIOD;
	flickerAmp.value = still ? 0 : 1;
}

/** The flicker factor (about 1) for a profile index and a 0-1 phase, as `flickerAt` works it out. */
export function flickerNode(profile: N, phase: N): N {
	const w = (waves as unknown as N).element(t.int(t.round(profile)));
	const tau = 2 * Math.PI;
	const first = t.sin(w.y.mul(flickerTime).add(phase).mul(tau)).mul(w.x);
	const second = t.sin(w.w.mul(flickerTime).add(phase.mul(2)).mul(tau)).mul(w.z);
	return first.add(second).mul(flickerAmp).add(1);
}
