// When levels of detail are picked (#274, lod.ts): before a frame, only if the camera moved or
// zoomed, the canvas resized, the tier's bias changed or the table did (`due`). Idle frames are
// never drawn, and a frame with the camera still (a flicker, a tween) costs one comparison.

import type * as THREE from 'three/webgpu';
import type { PerfRecorder } from './perf';
import type { Tier } from './quality';

interface Levelled {
	chooseLods(camera: THREE.PerspectiveCamera, viewportPx: number, bias: number): boolean;
}

export class LodWatch {
	/** Set when the table changed: tokens, props or a model arriving. */
	due = true;
	private last: number[] = [];

	constructor(
		private readonly camera: THREE.PerspectiveCamera,
		private readonly canvas: HTMLCanvasElement,
		private readonly layers: readonly Levelled[],
		private readonly perf: PerfRecorder
	) {}

	/**
	 * Picks every layer's levels if anything they depend on changed (timed as `lod`): one level
	 * coarser on the low tier (phones, software GL, compat WebGPU).
	 */
	run(tier: Tier): void {
		const { camera } = this;
		const bias = tier === 'low' ? 1 : 0;
		const px = this.canvas.clientHeight;
		const now = [...camera.position.toArray(), camera.fov, px, bias];
		if (!this.due && now.every((v, i) => v === this.last[i])) return;
		this.due = false;
		this.last = now;
		const t0 = performance.now();
		for (const layer of this.layers) layer.chooseLods(camera, px, bias);
		this.perf.add('lod', performance.now() - t0);
	}
}
