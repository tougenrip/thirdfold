// What the renderer costs, measured as it runs: how many frames it drew and
// how long each took, and how long each kind of update (a new table, tokens
// moving, light) took on the main thread. Cheap enough to leave on: a few
// performance.now() calls per frame or update. Read by the perf overlay
// (`?perf` in the URL) and by the measurements in docs/PERFORMANCE.md.

import type * as THREE from 'three/webgpu';
import { RESHADOWS, TIMED, type Tabletop } from './types';

/** Running totals for one kind of work. */
export interface Timing {
	count: number;
	/** Total milliseconds. */
	total: number;
	/** The slowest one, in milliseconds. */
	max: number;
	/** The most recent one, in milliseconds. */
	last: number;
}

export interface PerfStats {
	/** Frames drawn since the renderer started. */
	frames: number;
	/** Frames drawn in the last second. */
	fps: number;
	/** Main-thread time of a frame (the scene updated and drawn), by kind of work. */
	timings: Record<string, Timing>;
	/** From three.js: what the last frame drew, and what lives on the GPU. */
	drawCalls: number;
	triangles: number;
	geometries: number;
	textures: number;
	programs: number;
	/** Frames are held while shaders warm up (warmup.ts): the picture is about to change. */
	holding: boolean;
}

export class PerfRecorder {
	frames = 0;
	private readonly timings = new Map<string, Timing>();
	/** Times of the frames drawn in the last second. */
	private readonly recent: number[] = [];

	/** Runs `fn`, adding its duration to `label`. */
	time<T>(label: string, fn: () => T): T {
		const start = performance.now();
		try {
			return fn();
		} finally {
			this.add(label, performance.now() - start);
		}
	}

	add(label: string, ms: number): void {
		const t = this.timings.get(label) ?? { count: 0, total: 0, max: 0, last: 0 };
		t.count++;
		t.total += ms;
		t.max = Math.max(t.max, ms);
		t.last = ms;
		this.timings.set(label, t);
	}

	frame(now: number): void {
		this.frames++;
		this.recent.push(now);
		while (this.recent.length && this.recent[0] < now - 1000) this.recent.shift();
	}

	/** Frames in the second up to `now`. */
	fps(now: number): number {
		return this.recent.filter((t) => t >= now - 1000).length;
	}

	snapshot(now: number): Pick<PerfStats, 'frames' | 'fps' | 'timings'> {
		return {
			frames: this.frames,
			fps: this.fps(now),
			timings: Object.fromEntries([...this.timings].map(([k, v]) => [k, { ...v }]))
		};
	}

	reset(): void {
		this.frames = 0;
		this.timings.clear();
		this.recent.length = 0;
	}
}

/** What the renderer has cost so far, with what three.js reports the last frame drew and what it holds. */
export function rendererStats(
	renderer: THREE.WebGPURenderer,
	perf: PerfRecorder,
	holding: boolean
): PerfStats {
	const { render, memory } = renderer.info;
	return {
		...perf.snapshot(performance.now()),
		drawCalls: render.drawCalls,
		triangles: render.triangles,
		geometries: memory.geometries,
		textures: memory.textures,
		programs: (memory as { programs?: number }).programs ?? 0,
		holding
	};
}

/** The WebGL2 context behind the renderer, or null on the WebGPU backend. */
function glOf(renderer: THREE.WebGPURenderer): WebGL2RenderingContext | null {
	const backend = renderer.backend as { gl?: WebGL2RenderingContext };
	return backend.gl ?? null;
}

/**
 * Draws the current view `frames` times: the main thread's ms per frame
 * (`cpu`) and, on the WebGL2 backend, the whole frame's until drawn (`gpu`,
 * by reading a pixel back). `draw` draws one frame as the tabletop does.
 */
export function benchmark(
	renderer: THREE.WebGPURenderer,
	draw: () => void,
	frames: number
): { cpu: number; gpu: number; drawCalls: number } {
	const gl = glOf(renderer);
	const pixel = new Uint8Array(4);
	let cpu = 0;
	let gpu = 0;
	for (let i = 0; i < frames; i++) {
		const start = performance.now();
		draw();
		cpu += performance.now() - start;
		// Reading a pixel back waits until the frame has been drawn.
		if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
		gpu += performance.now() - start;
	}
	return {
		cpu: cpu / frames,
		gpu: gl ? gpu / frames : NaN,
		drawCalls: renderer.info.render.drawCalls
	};
}

/**
 * Wraps the tabletop's updates: each marks the table changed (`onChange`, so
 * the sun's shadows are drawn again), and those from the room are timed under
 * their own names (what each costs on the main thread).
 */
export function instrument(tabletop: Tabletop, perf: PerfRecorder, onChange: () => void): void {
	for (const key of [...TIMED, ...RESHADOWS]) {
		const update = tabletop[key] as (...args: unknown[]) => unknown;
		const timed = (TIMED as readonly string[]).includes(key);
		(tabletop[key] as (...args: unknown[]) => unknown) = (...args) => {
			onChange();
			return timed ? perf.time(key, () => update(...args)) : update(...args);
		};
	}
}

/**
 * GPU time of drawing the current view by the backend's timestamp queries
 * (WebGPU timestamps, or WebGL2's timer queries): the median ms of `frames`
 * frames, or null where the renderer was made without timestamps or the
 * driver has none (software GL). Results arrive later, so this is async.
 */
export async function timeGpuFrames(
	renderer: THREE.WebGPURenderer,
	draw: () => void,
	frames: number
): Promise<number | null> {
	if (!(renderer.backend as { trackTimestamp?: boolean }).trackTimestamp) return null;
	const times: number[] = [];
	for (let i = 0; i < frames; i++) {
		draw();
		const ms = await renderer.resolveTimestampsAsync('render');
		if (typeof ms === 'number' && ms > 0) times.push(ms);
	}
	times.sort((a, b) => a - b);
	return times.length ? times[Math.floor(times.length / 2)] : null;
}
