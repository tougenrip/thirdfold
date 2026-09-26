import * as THREE from 'three/webgpu';
import type { TabletopOptions } from './types';

// Frames on demand: nothing is drawn until something asks for a frame, and
// at most one is ever waiting. Flickering flames and drifting mist ask on a
// slow timer instead (AMBIENT_FRAME_MS), never every frame.

/** How often ambient animation redraws, in ms. */
export const AMBIENT_FRAME_MS = 80;

export class FrameLoop {
	private frame = 0;
	private ambientTimer: ReturnType<typeof setTimeout> | 0 = 0;

	constructor(private readonly draw: () => void) {}

	/** Draws on the next animation frame (once, however often it is asked). */
	request = (): void => {
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
		const saved = JSON.parse(localStorage.getItem('thirdfold:graphics') ?? 'null');
		if (saved && typeof saved === 'object' && saved.compatibility === true) return 'webgl';
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
	await renderer.init();
	stopInternalLoop(renderer);
	return renderer;
}
