// Shader warm-up (milestone 62, #149). The node renderer compiles 60-70
// pipelines for a table where the classic one compiled a dozen, so compiling
// them on the first frame a player sees stalls it for hundreds of ms. Instead,
// when a table, an environment's look or a model is new, the frame loop is
// held (the canvas keeps its last frame) while every layer is compiled from a
// camera that sees the whole table, one layer at a time (compiling several at
// once while frames are drawn trips three.js issue 34632). A warm-up never
// holds for longer than WARM_UP_LIMIT_MS: what is left compiles on draw.

import * as THREE from 'three/webgpu';
import type { PassTarget } from './passes';

/** Longest a warm-up may hold the frame loop, in ms (slow software GL). */
export const WARM_UP_LIMIT_MS = 1500;

/**
 * Compiles the layers of `scene` for `camera`'s view, one after another,
 * resolving when done or when WARM_UP_LIMIT_MS has passed (then the layers
 * not reached compile on draw). Hidden one-shot effects (toll dust, previews)
 * are left to compile when they first play: showing them here could let a
 * frame drawn after a timed-out warm-up catch them visible. With post-processing
 * on, a pipeline is compiled per target and set of outputs, so the layers are
 * compiled for the passes' `targets` (post.ts) rather than the canvas.
 */
export async function warmUp(
	renderer: THREE.WebGPURenderer,
	scene: THREE.Scene,
	camera: THREE.Camera,
	layers: readonly THREE.Object3D[],
	targets: readonly PassTarget[] = []
): Promise<void> {
	const limit = new Promise<void>((resolve) => setTimeout(resolve, WARM_UP_LIMIT_MS));
	let timedOut = false;
	/** The compile under way for a pass's target, which a frame must not interrupt. */
	let inFlight: Promise<unknown> = Promise.resolve();
	const compile = (async () => {
		for (const layer of layers) {
			if (timedOut) return;
			if (targets.length === 0) await renderer.compileAsync(layer, camera, scene);
			for (const { renderTarget, mrt } of targets) {
				if (timedOut) return;
				const [target, outputs] = [renderer.getRenderTarget(), renderer.getMRT()];
				const { toneMapping, outputColorSpace } = renderer;
				// As RenderPipeline.render draws its passes: linear, no tone mapping.
				renderer.toneMapping = THREE.NoToneMapping;
				renderer.outputColorSpace = THREE.ColorManagement.workingColorSpace;
				renderer.setRenderTarget(renderTarget);
				renderer.setMRT(mrt);
				// The target and outputs stay set until the compile is done (it reads them while it
				// waits), so a timed-out warm-up still waits for this one before frames resume.
				inFlight = renderer.compileAsync(layer, camera, scene);
				await inFlight;
				renderer.setRenderTarget(target);
				renderer.setMRT(outputs);
				renderer.toneMapping = toneMapping;
				renderer.outputColorSpace = outputColorSpace;
			}
		}
	})();
	await Promise.race([compile, limit.then(() => void (timedOut = true))]);
	// Frames drawn while a pass's target is set would draw into it (and on WebGPU build pipelines
	// for the wrong targets, aborting the frame): finish that compile first. The compile puts the
	// renderer's state back as it ends, before this resumes (it awaited the same promise first).
	await inFlight.catch(() => {});
}

/**
 * Points `camera` so it sees the whole table, `extent` across, from high
 * above. One camera is kept for every warm-up: the renderer caches what it
 * compiles per camera, so a new camera each time would leave that behind.
 */
export function frameOverview(
	camera: THREE.PerspectiveCamera,
	extent: number,
	aspect: number
): void {
	camera.fov = 60;
	camera.aspect = aspect;
	camera.far = Math.max(camera.far, extent * 4);
	camera.position.set(0, extent * 1.4, extent * 0.4);
	camera.lookAt(0, 0, 0);
	camera.updateProjectionMatrix();
	camera.updateMatrixWorld();
}
