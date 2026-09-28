import * as THREE from 'three/webgpu';
import { loadGraphics } from './quality';
import type { TabletopOptions } from './types';

// The renderer's setup (`createNodeRenderer`), the frame hooks r186's own
// loop used to run (`stopInternalLoop`, `advanceNodeFrame`) and live reduced
// motion. When frames are drawn is the render scheduler's (scheduler.ts).

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
/**
 * Remembers the name of what each render draws (a pass's scene, an effect's quad) by its
 * timestamp id, which perf.ts reads once the timestamps resolve; it forgets them as it does.
 */
class PassNames extends THREE.InspectorBase {
	readonly passNames = new Map<string, string>();

	beginRender(uid: string | undefined, scene: THREE.Object3D): void {
		// A bound: sampling forgets what it read, so this only fills when nothing samples.
		if (this.passNames.size > 50_000) this.passNames.clear();
		// A quad named by its material only (SMAA's) goes by that.
		const material = (scene as THREE.Mesh).material as THREE.Material | undefined;
		if (uid) this.passNames.set(uid, scene.name || material?.name || '');
	}
}

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
		// MSAA is fixed for a renderer's life: a tier that changes it rebuilds the tabletop (#150).
		antialias: options.antialias ?? true,
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
	// A lost WebGL context or WebGPU device: stop drawing (as three's default does, which also
	// logs an error) and say so, so the tabletop can be rebuilt on a fresh canvas (#150).
	renderer.onDeviceLost = (info) => {
		(renderer as unknown as { _isDeviceLost: boolean })._isDeviceLost = true;
		options.onLost?.({ api: info.api, message: info.message });
	};
	renderer.setPixelRatio(options.pixelRatio ?? Math.min(window.devicePixelRatio, 2));
	// Clear to transparent: every scene has a background, and the overlay's pass (post.ts) has none.
	renderer.setClearColor(0x000000, 0);
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap; // soft on the node renderer
	// Unused inside the pipeline, whose passes draw linear: post.ts tone maps once, at the end.
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	// Under `?perf`, each render's name by its timestamp id, for GPU time by pass (perf.ts);
	// three's Inspector (`?perf&inspector`) takes the same hook instead.
	if (options.perf && !options.inspector) renderer.inspector = new PassNames();
	// A separate chunk, fetched only when asked for: never in normal play.
	if (options.inspector)
		void import('three/examples/jsm/inspector/Inspector.js').then(
			({ Inspector }) => (renderer.inspector = new Inspector())
		);
	return renderer;
}
