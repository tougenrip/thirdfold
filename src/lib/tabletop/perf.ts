// What the renderer costs, measured as it runs: how many frames it drew and
// how long each took, and how long each kind of update (a new table, tokens
// moving, light) took on the main thread. Cheap enough to leave on: a few
// performance.now() calls per frame or update. Read by the perf overlay
// (`?perf` in the URL) and by the measurements in docs/PERFORMANCE.md. GPU
// time comes from timestamp queries, which the renderer records only under
// `?perf` (`trackTimestamp`), sampled every 500 ms by the overlay, whole and
// by pass (#166): each render three draws (a pass's scene or an effect's quad)
// has a timestamp id, which `PassNames` (loop.ts) ties to the name three gives
// what it draws; `passOf` groups the names into the pipeline's passes.

import type * as THREE from 'three/webgpu';
import type { HeroStats } from './hero-shadows';
import { isSoftware, type Tier } from './quality';
import type { Mode } from './scheduler';
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
	 * stages, not linked GL programs, so it only compares with itself; `pipelines` and
	 * `nodeStates` are the rest of `shaderCounts` (#170).
	 */
	drawCalls: number;
	triangles: number;
	geometries: number;
	textures: number;
	programs: number;
	pipelines: number;
	nodeStates: number;
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
	/** The quality tier (#147) and the render scheduler's mode (#148). */
	tier: string | null;
	mode: string | null;
	/** GPU ms per frame by timestamp queries, at the last sample; null without them. */
	gpuMs: number | null;
	/** The same by pass (`passOf`), at the last sample; null without timestamps, and on WebGL2. */
	gpu: Record<string, number> | null;
	/** Frames are held while shaders warm up (warmup.ts): the picture is about to change. */
	holding: boolean;
	/** The hero shadow slots (#230): holders, cubes redrawn (in all, last frame), cube bytes. */
	heroes: HeroStats | null;
}

export class PerfRecorder {
	frames = 0;
	/** GPU ms per frame at the last `sampleGpu`, and the frame count it was taken at. */
	gpuMs: number | null = null;
	gpu: Record<string, number> | null = null;
	sampledAt = 0;
	/** Told each drawn frame's main-thread ms (quality refinement, capabilities.ts). */
	onFrame: ((ms: number) => void) | null = null;
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
		if (label === 'frame') this.onFrame?.(ms);
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
		this.gpuMs = this.gpu = null;
		this.timings.clear();
		this.recent.length = 0;
	}
}

/** What three.js's backend object carries, as far as measuring goes. */
export interface Backend {
	isWebGPUBackend?: boolean;
	compatibilityMode?: boolean | null;
	trackTimestamp?: boolean;
	/** WebGL2's timer query extension, when the driver has it. */
	disjoint?: unknown;
	gl?: WebGL2RenderingContext;
	device?: GPUDevice & { adapterInfo?: GPUAdapterInfo };
}

export const backendOf = (renderer: THREE.WebGPURenderer) => renderer.backend as Backend;

/**
 * Whether frames are timed by timestamp queries: asked for (`?perf`), the GPU
 * has them, and it is a real GPU.
 */
function timestamps(renderer: THREE.WebGPURenderer): boolean {
	const b = backendOf(renderer);
	if (b.trackTimestamp !== true || (b.isWebGPUBackend !== true && b.disjoint == null)) return false;
	// A software GPU's timestamps mean nothing (SwiftShader reports 0, or its latency).
	return !isSoftware(gpuInfo(renderer).adapter);
}

/** The backend and the GPU it runs on. */
export function gpuInfo(
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

/** What the renderer is doing, for `stats()`. */
export interface RendererState {
	holding: boolean;
	tier: Tier | null;
	mode: Mode | null;
	heroes?: HeroStats | null;
}

/** What the renderer has cost so far, with what three.js reports the last frame drew and what it holds. */
export function rendererStats(
	renderer: THREE.WebGPURenderer,
	perf: PerfRecorder,
	{ holding, tier, mode, heroes = null }: RendererState
): PerfStats {
	const { render, memory } = renderer.info;
	return {
		...perf.snapshot(performance.now()),
		drawCalls: render.drawCalls,
		triangles: render.triangles,
		geometries: memory.geometries,
		textures: memory.textures,
		...shaderCounts(renderer),
		texturesBytes: memory.texturesSize,
		memoryBytes: memory.total,
		renderTargets: memory.renderTargets,
		...gpuInfo(renderer),
		tier,
		mode,
		gpuMs: perf.gpuMs,
		gpu: perf.gpu,
		holding,
		heroes
	};
}

/** Where r186 keeps its shader stages, pipelines and node states (private fields). */
interface ShaderCaches {
	_pipelines?: {
		caches: Map<string, unknown>;
		programs: Record<'vertex' | 'fragment', Map<string, { name: string; stage: string }>>;
	};
	_nodes?: { nodeBuilderCache: Map<string, unknown> };
}

/** What runtime state must never change (#170): each new one is a driver compile or a new graph. */
export interface ShaderCounts {
	/** Shader stages, vertex and fragment, deduplicated by code (`info.memory.programs`). */
	programs: number;
	/** Render pipelines: a pair of stages with the render state they are drawn with. */
	pipelines: number;
	/** Node-builder states: code generated, which may still end in a program already made. */
	nodeStates: number;
}

/** Reads the counts; the one place a three upgrade that moves these fields breaks. */
export function shaderCounts(renderer: THREE.WebGPURenderer): ShaderCounts {
	const { _pipelines, _nodes } = renderer as unknown as ShaderCaches;
	return {
		programs: (renderer.info.memory as { programs?: number }).programs ?? 0,
		pipelines: _pipelines?.caches.size ?? 0,
		nodeStates: _nodes?.nodeBuilderCache.size ?? 0
	};
}

/**
 * The shader stages alive, by their code, labelled `<material name> <stage>` (three names a stage
 * after the material it was made for; the material module names its materials by kind).
 */
export function shaderStages(renderer: THREE.WebGPURenderer): Map<string, string> {
	const programs = (renderer as unknown as ShaderCaches)._pipelines?.programs;
	const stages = new Map<string, string>();
	for (const map of programs ? [programs.vertex, programs.fragment] : [])
		for (const [code, s] of map) stages.set(code, `${s.name || '(unnamed)'} ${s.stage}`);
	return stages;
}

/**
 * The passes a frame's GPU time is reported by, from the name three gives each render: our
 * passes' names (post.ts), and the quads of three's effects. `output` is the pipeline's last pass
 * (with FXAA, the render to its input too); `blur` is tilt-shift's, and depth of field's own CoC
 * blur when both run. Shadow maps draw inside the pass that draws the scene.
 */
const PASSES: readonly (readonly [RegExp, string])[] = [
	[/^prepass$/, 'prepass'],
	[/^scene$/, 'scene'],
	[/^overlay$/, 'overlay'],
	// The sky's capture into the environment (sky.ts `envScene`) and PMREM's filter quads.
	[/^pmrem$|^PMREM_/, 'pmrem'],
	[/^SSAO\b|^AO$/, 'ao'],
	[/^TRAA$|^Sharpen\b/, 'traa'],
	[/^SMAANode\b/, 'smaa'],
	[/^DoF\b/, 'dof'],
	[/^Gaussian Blur\b/, 'blur'],
	[/^Bloom\b/, 'bloom'],
	[/^Render Pipeline$|\bRTT\b/, 'output']
];

/** The pass a render named `name` belongs to; `other` for anything else. */
export function passOf(name: string): string {
	return PASSES.find(([re]) => re.test(name))?.[1] ?? 'other';
}

/**
 * GPU ms per frame, whole and by pass, from resolved durations by timestamp id (`…:f<frame>`)
 * and the names seen for those ids. Null when no frame was timed.
 */
export function byPass(
	durations: Iterable<[string, number]>,
	names: ReadonlyMap<string, string>
): { total: number; passes: Record<string, number> } | null {
	const frames = new Set<string>();
	const passes: Record<string, number> = {};
	let total = 0;
	for (const [uid, ms] of durations) {
		frames.add(uid.slice(uid.lastIndexOf(':f')));
		const pass = passOf(names.get(uid) ?? '');
		passes[pass] = (passes[pass] ?? 0) + ms;
		total += ms;
	}
	if (!frames.size) return null;
	for (const pass in passes) passes[pass] /= frames.size;
	return { total: total / frames.size, passes };
}

/** The durations the last resolve read, by timestamp id; empty where there are none. */
function resolved(renderer: THREE.WebGPURenderer): Map<string, number> {
	const pools = (
		renderer.backend as unknown as {
			timestampQueryPool?: { render?: { timestamps: Map<string, number> } };
		}
	).timestampQueryPool;
	return pools?.render?.timestamps ?? new Map();
}

/** The names `PassNames` saw by timestamp id, when it is the renderer's inspector. */
function namesOf(renderer: THREE.WebGPURenderer): Map<string, string> | null {
	return (renderer.inspector as unknown as { passNames?: Map<string, string> }).passNames ?? null;
}

/**
 * Reads the last resolve by pass, then forgets it and those ids' names. On WebGL2 only the
 * frame's total is real: every pass draws inside the pipeline's last render, and WebGL's timer
 * queries do not nest, so that one render is all it times. Its passes are then null.
 */
function readPasses(renderer: THREE.WebGPURenderer) {
	const durations = resolved(renderer);
	const names = namesOf(renderer) ?? new Map<string, string>();
	const read = byPass(durations, names);
	const result = read && (backendOf(renderer).isWebGPUBackend ? read : { ...read, passes: null });
	// A resolve with nothing new leaves the last one's durations: read each only once.
	for (const uid of durations.keys()) names.delete(uid);
	durations.clear();
	return result;
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
		// (The resolve returns only the last frame's total: the durations give every frame's.)
		await renderer.resolveTimestampsAsync('render');
		const read = readPasses(renderer);
		if (frames > 0 && read) {
			perf.gpuMs = read.total;
			perf.gpu = read.passes;
		}
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
	/** GPU ms per frame by pass (`passOf`), with WebGPU's timestamps only. */
	passes: Record<string, number> | null;
	gpuTimer: GpuTimer;
	drawCalls: number;
}

/**
 * Draws the current view `frames` times, timing each: the main thread's ms
 * (`cpu`) and the GPU's, by timestamp queries where the renderer has them,
 * else by waiting until the frame is drawn (reading a pixel back on WebGL2,
 * `onSubmittedWorkDone` on WebGPU). `draw` draws one frame as the tabletop does, once `warming`
 * (the warm-up under way, warmup.ts) has settled: a warm-up keeps the scene pass's target and
 * outputs set while it compiles, and a frame drawn then builds WebGPU pipelines for them (the
 * output stage's quad with the scene pass's three colour targets, #379).
 */
export async function benchmark(
	renderer: THREE.WebGPURenderer,
	perf: PerfRecorder,
	draw: () => void,
	frames: number,
	warming: () => Promise<void> = () => Promise.resolve()
): Promise<Benchmark> {
	const { gl, device } = backendOf(renderer);
	const timer: GpuTimer = timestamps(renderer) ? 'timestamp' : gl || device ? 'sync' : 'none';
	const pixel = new Uint8Array(4);
	let cpu = 0;
	let gpu = 0;
	const passes: Record<string, number> = {};
	perf.benchmarking = true;
	try {
		// Earlier frames' timestamps would count toward the first frame.
		if (timer === 'timestamp') {
			await renderer.resolveTimestampsAsync('render');
			readPasses(renderer);
		}
		for (let i = 0; i < frames; i++) {
			await warming().catch(() => {});
			const start = performance.now();
			draw();
			cpu += performance.now() - start;
			if (timer === 'timestamp') {
				gpu += (await renderer.resolveTimestampsAsync('render')) ?? 0;
				for (const [pass, ms] of Object.entries(readPasses(renderer)?.passes ?? {}))
					passes[pass] = (passes[pass] ?? 0) + ms / frames;
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
		passes: timer === 'timestamp' && backendOf(renderer).isWebGPUBackend ? passes : null,
		gpuTimer: timer,
		drawCalls: renderer.info.render.drawCalls
	};
}

/**
 * Wraps the tabletop's updates: each marks the table changed (`onChange`, so
 * the sun's shadows are drawn again), and those from the room are timed under
 * their own names (what each costs on the main thread).
 */
export function instrument(
	tabletop: Tabletop,
	perf: PerfRecorder,
	onChange: (key: string) => void
): void {
	for (const key of [...TIMED, ...RESHADOWS]) {
		const update = tabletop[key] as (...args: unknown[]) => unknown;
		const timed = (TIMED as readonly string[]).includes(key);
		(tabletop[key] as (...args: unknown[]) => unknown) = (...args) => {
			onChange(key);
			return timed ? perf.time(key, () => update(...args)) : update(...args);
		};
	}
}

/** The tabletop's measuring methods (see `Tabletop`); the scheduler and tier are read at each call. */
export function perfMethods(
	renderer: THREE.WebGPURenderer,
	perf: PerfRecorder,
	draw: () => void,
	{
		loop,
		quality,
		warming,
		lighting
	}: {
		loop: { holding: boolean; mode: Mode };
		quality: { tier: Tier };
		/** The hero shadow slots' stats (lighting.ts). */
		lighting?: { heroStats(): HeroStats };
		/** The warm-up under way, if any (renderer.ts): no benchmark frame draws during it. */
		warming: () => Promise<void>;
	}
): Pick<Tabletop, 'stats' | 'resetStats' | 'benchmark' | 'sampleGpu'> {
	return {
		stats: () =>
			rendererStats(renderer, perf, {
				holding: loop.holding,
				tier: quality.tier,
				mode: loop.mode,
				heroes: lighting?.heroStats()
			}),
		resetStats: () => perf.reset(),
		benchmark: (frames) => benchmark(renderer, perf, draw, frames, warming),
		sampleGpu: () => sampleGpu(renderer, perf)
	};
}
