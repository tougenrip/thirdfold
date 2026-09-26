// What the renderer costs, measured as it runs: how many frames it drew and
// how long each took, and how long each kind of update (a new table, tokens
// moving, light) took on the main thread. Cheap enough to leave on: a few
// performance.now() calls per frame or update. Read by the perf overlay
// (`?perf` in the URL) and by the measurements in docs/PERFORMANCE.md. GPU
// time comes from timestamp queries, which the renderer records only under
// `?perf` (`trackTimestamp`), sampled every 500 ms by the overlay.

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
	/**
	 * From three.js: what the last frame drew (shadow passes included: they are drawn inside the
	 * frame's render), and what lives on the GPU. `programs` counts the node renderer's shader
	 * stages and pipelines, not linked GL programs, so it only compares with itself.
	 */
	drawCalls: number;
	triangles: number;
	geometries: number;
	textures: number;
	programs: number;
	/** Bytes of textures, and of everything three.js tracks on the GPU. */
	texturesBytes: number;
	memoryBytes: number;
	renderTargets: number;
	/** WebGPU, or WebGPURenderer's WebGL2 backend. */
	backend: 'webgpu' | 'webgl2';
	/** WebGPU in compatibility mode (the adapter lacks core features). */
	compat: boolean;
	/** The GPU, as the browser names it; null where it won't say. */
	adapter: string | null;
	/** The quality tier (#147) and the render scheduler's mode (#148); null until they exist. */
	tier: string | null;
	mode: string | null;
	/** GPU ms per frame by timestamp queries, at the last sample; null without them. */
	gpuMs: number | null;
	/** Frames are held while shaders warm up (warmup.ts): the picture is about to change. */
	holding: boolean;
}

export class PerfRecorder {
	frames = 0;
	/** GPU ms per frame at the last `sampleGpu`, and the frame count it was taken at. */
	gpuMs: number | null = null;
	sampledAt = 0;
	/** A benchmark, or a sample, is reading the timestamps: sampling waits. */
	benchmarking = false;
	sampling = false;
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
		this.frames = this.sampledAt = 0;
		this.gpuMs = null;
		this.timings.clear();
		this.recent.length = 0;
	}
}

/** What three.js's backend object carries, as far as measuring goes. */
interface Backend {
	isWebGPUBackend?: boolean;
	compatibilityMode?: boolean | null;
	trackTimestamp?: boolean;
	/** WebGL2's timer query extension, when the driver has it. */
	disjoint?: unknown;
	gl?: WebGL2RenderingContext;
	device?: GPUDevice & { adapterInfo?: GPUAdapterInfo };
}

const backendOf = (renderer: THREE.WebGPURenderer) => renderer.backend as Backend;

/** Software GPUs, whose timestamps mean nothing (SwiftShader reports 0, or its latency). */
const SOFTWARE = /swiftshader|llvmpipe|software/i;

/**
 * Whether frames are timed by timestamp queries: asked for (`?perf`), the GPU
 * has them, and it is a real GPU.
 */
function timestamps(renderer: THREE.WebGPURenderer): boolean {
	const b = backendOf(renderer);
	if (b.trackTimestamp !== true || (b.isWebGPUBackend !== true && b.disjoint == null)) return false;
	return !SOFTWARE.test(gpuInfo(renderer).adapter ?? '');
}

/** The backend and the GPU it runs on. */
function gpuInfo(
	renderer: THREE.WebGPURenderer
): Pick<PerfStats, 'backend' | 'compat' | 'adapter'> {
	const b = backendOf(renderer);
	if (b.isWebGPUBackend) {
		const info = b.device?.adapterInfo;
		const name = [info?.vendor, info?.architecture].filter(Boolean).join(' ');
		return {
			backend: 'webgpu',
			compat: b.compatibilityMode === true,
			adapter: name || info?.description || null
		};
	}
	const gl = b.gl;
	const debug = gl?.getExtension('WEBGL_debug_renderer_info');
	const adapter = gl ? gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : null;
	return {
		backend: 'webgl2',
		compat: false,
		adapter: typeof adapter === 'string' ? adapter : null
	};
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
		texturesBytes: memory.texturesSize,
		memoryBytes: memory.total,
		renderTargets: memory.renderTargets,
		...gpuInfo(renderer),
		tier: null,
		mode: null,
		gpuMs: perf.gpuMs,
		holding
	};
}

/**
 * Reads the timestamps of the frames drawn since the last sample: `gpuMs` is
 * their GPU time per frame. Also keeps the query pool from filling up while
 * `?perf` records a timestamp for every frame. Nothing without timestamps.
 */
export async function sampleGpu(renderer: THREE.WebGPURenderer, perf: PerfRecorder): Promise<void> {
	if (!timestamps(renderer) || perf.benchmarking || perf.sampling) return;
	const frames = perf.frames - perf.sampledAt;
	perf.sampledAt = perf.frames;
	perf.sampling = true;
	try {
		// WebGL2's results arrive as frames are presented: on an idle table this can take a while.
		const ms = await renderer.resolveTimestampsAsync('render');
		if (frames > 0 && typeof ms === 'number') perf.gpuMs = ms / frames;
	} finally {
		perf.sampling = false;
	}
}

/** How a benchmark timed the GPU: its timestamp queries, waiting for it to finish, or not at all. */
export type GpuTimer = 'timestamp' | 'sync' | 'none';

export interface Benchmark {
	/** Main-thread ms per frame. */
	cpu: number;
	/** GPU ms per frame (`timestamp`), or ms until the frame was drawn (`sync`); NaN with `none`. */
	gpu: number;
	gpuTimer: GpuTimer;
	drawCalls: number;
}

/**
 * Draws the current view `frames` times, timing each: the main thread's ms
 * (`cpu`) and the GPU's, by timestamp queries where the renderer has them,
 * else by waiting until the frame is drawn (reading a pixel back on WebGL2,
 * `onSubmittedWorkDone` on WebGPU). `draw` draws one frame as the tabletop does.
 */
export async function benchmark(
	renderer: THREE.WebGPURenderer,
	perf: PerfRecorder,
	draw: () => void,
	frames: number
): Promise<Benchmark> {
	const { gl, device } = backendOf(renderer);
	const timer: GpuTimer = timestamps(renderer) ? 'timestamp' : gl || device ? 'sync' : 'none';
	const pixel = new Uint8Array(4);
	let cpu = 0;
	let gpu = 0;
	perf.benchmarking = true;
	try {
		// Earlier frames' timestamps would count toward the first frame.
		if (timer === 'timestamp') await renderer.resolveTimestampsAsync('render');
		for (let i = 0; i < frames; i++) {
			const start = performance.now();
			draw();
			cpu += performance.now() - start;
			if (timer === 'timestamp') {
				gpu += (await renderer.resolveTimestampsAsync('render')) ?? 0;
				continue;
			}
			if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
			else if (device) await device.queue.onSubmittedWorkDone();
			gpu += performance.now() - start;
		}
	} finally {
		perf.benchmarking = false;
		perf.sampledAt = perf.frames;
	}
	return {
		cpu: cpu / frames,
		gpu: timer === 'none' ? NaN : gpu / frames,
		gpuTimer: timer,
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
