import * as THREE from 'three/webgpu';
import { loadGraphics } from './quality';
import type { TabletopOptions } from './types';

// Frames on demand: nothing is drawn until something asks for a frame, and
// at most one is ever waiting. Flickering flames and drifting mist ask on a
// slow timer instead (AMBIENT_FRAME_MS), never every frame.

/** How often ambient animation redraws, in ms. */
export const AMBIENT_FRAME_MS = 80;

export class FrameLoop {
	private frame = 0;
	private ambientTimer: ReturnType<typeof setTimeout> | 0 = 0;
	/** A warm-up is compiling: frames wait (the canvas keeps its last one). */
	private held = false;
	private wanted = false;

	constructor(private readonly draw: () => void) {}

	/** Holds frames until `work` settles, then draws once if anything asked meanwhile. */
	hold(work: Promise<unknown>): void {
		this.held = true;
		void work.finally(() => {
			this.held = false;
			if (this.wanted) {
				this.wanted = false;
				this.request();
			}
		});
	}

	get holding(): boolean {
		return this.held;
	}

	/** Draws on the next animation frame (once, however often it is asked). */
	request = (): void => {
		if (this.held) {
			this.wanted = true;
			return;
		}
		if (!this.frame) {
			this.frame = requestAnimationFrame(() => {
				this.frame = 0;
				this.draw();
			});
		}
	};

	/** Draws again after AMBIENT_FRAME_MS, for slow ambient animation. */
	ambient(): void {
		if (this.ambientTimer) return;
		this.ambientTimer = setTimeout(() => {
			this.ambientTimer = 0;
			this.request();
		}, AMBIENT_FRAME_MS);
	}

	dispose(): void {
		cancelAnimationFrame(this.frame);
		if (this.ambientTimer) clearTimeout(this.ambientTimer);
	}
}

/**
 * Follows `prefers-reduced-motion` live, so turning it on or off applies at
 * once; `override` (tests) wins when set. Returns the current value and a
 * function that stops listening.
 */
export function watchReducedMotion(
	override: boolean | undefined,
	onChange: (reduced: boolean) => void
): { reduced: boolean; stop: () => void } {
	const query =
		typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
	const listener = (e: MediaQueryListEvent) => {
		if (override === undefined) onChange(e.matches);
	};
	query?.addEventListener('change', listener);
	return {
		reduced: override ?? query?.matches ?? false,
		stop: () => query?.removeEventListener('change', listener)
	};
}

/** The parts of r186's renderer that its own animation loop drives (not in the public types). */
interface NodeRendererInternals {
	_animation: { stop(): void };
	_nodes: { nodeFrame: { update(): void } };
	info: { autoReset: boolean };
}

/**
 * r186's `init()` starts a loop that requests a frame on every vsync, forever,
 * which would end render on demand. Stop it: each frame we draw resets the
 * counters and advances the node frame itself (`advanceNodeFrame`), so time
 * nodes and each shadow's once-per-frame guard still work.
 */
export function stopInternalLoop(renderer: object): void {
	const r = renderer as NodeRendererInternals;
	r._animation.stop();
	r.info.autoReset = false;
}

/** What r186's internal loop did on each frame: move the node frame on. */
export function advanceNodeFrame(renderer: object): void {
	(renderer as NodeRendererInternals)._nodes.nodeFrame.update();
}

/**
 * The backend the viewer asked for: `?backend=webgl` in the URL, or the
 * compatibility setting in `thirdfold:graphics`, forces WebGL2; else WebGPU
 * where the browser has it. Changing it takes a reload: a canvas keeps its
 * kind of context.
 */
export function wantedBackend(): 'webgpu' | 'webgl' {
	try {
		if (new URLSearchParams(location.search).get('backend') === 'webgl') return 'webgl';
		if (loadGraphics(localStorage).compatibility) return 'webgl';
	} catch {
		// no URL or storage (tests, private windows): the default
	}
	return 'webgpu';
}

/**
 * The renderer: WebGPU where the browser has it, else WebGPURenderer's WebGL2
 * backend by itself. The kill switch forces WebGL2 (`wantedBackend`); so do
 * tests that read pixels back, which need preserveDrawingBuffer, a WebGL
 * context attribute the backend only takes from a context made here.
 */
export async function createNodeRenderer(
	canvas: HTMLCanvasElement,
	options: TabletopOptions
): Promise<THREE.WebGPURenderer> {
	const forceWebGL =
		options.preserveDrawingBuffer || (options.backend ?? wantedBackend()) === 'webgl';
	const context = options.preserveDrawingBuffer
		? (canvas.getContext('webgl2', { antialias: true, alpha: true, preserveDrawingBuffer: true }) ??
			undefined)
		: undefined;
	const renderer = new THREE.WebGPURenderer({
		canvas,
		antialias: true,
		forceWebGL,
		context,
		trackTimestamp: options.perf ?? false
	});
	try {
		await renderer.init();
	} catch (err) {
		// With neither backend the failure is deep in three.js (a null context); say what it is.
		const webgl2 = !!document.createElement('canvas').getContext('webgl2');
		throw webgl2 ? err : new Error('WebGL2 unavailable', { cause: err });
	}
	stopInternalLoop(renderer);
	renderer.setPixelRatio(options.pixelRatio ?? Math.min(window.devicePixelRatio, 2));
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap; // soft on the node renderer
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	// A separate chunk, fetched only when asked for: never in normal play.
	if (options.inspector)
		void import('three/examples/jsm/inspector/Inspector.js').then(
			({ Inspector }) => (renderer.inspector = new Inspector())
		);
	return renderer;
}
