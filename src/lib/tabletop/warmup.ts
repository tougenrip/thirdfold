// Shader warm-up (milestone 62, #149). The node renderer compiles 60-70
// pipelines for a table where the classic one compiled a dozen, so compiling
// them on the first frame a player sees stalls it for hundreds of ms. Instead,
// when a table, an environment's look or a model is new, the frame loop is
// held (the canvas keeps its last frame) while every layer is compiled from a
// camera that sees the whole table, one layer at a time (compiling several at
// once while frames are drawn trips three.js issue 34632). A warm-up never
// holds for longer than WARM_UP_LIMIT_MS: what is left compiles on draw.
//
// Since #180 a warm-up also compiles what only shows later: stand-ins for the
// one-shot marks and effects (the selection ring and turn marker in the
// overlay's pass, a die, the toll's dust and shadow; each layer's `gallery`),
// never the real objects, which a frame drawn after a timed-out warm-up could
// catch shown; the first frame after draws the stand-ins once, out of sight
// (`Gallery`). The lobby does the same for every shader kind before any table
// (lobby.ts).

import * as THREE from 'three/webgpu';
import type { PassTarget } from './passes';

/** Longest a warm-up may hold the frame loop, in ms (slow software GL). */
export const WARM_UP_LIMIT_MS = 1500;

/** Objects compiled with `scene`'s lights, fog and background into a pass's targets. */
export interface WarmBatch {
	scene: THREE.Scene;
	items: readonly THREE.Object3D[];
	/** The passes' targets (post.ts); none compiles for the canvas. */
	targets: readonly PassTarget[];
}

/**
 * Compiles `batches` for `camera`'s view, one item after another, resolving when done or when
 * `limit` ms have passed (then the items not reached compile on draw). With post-processing on, a
 * pipeline is compiled per target and set of outputs, so items are compiled for the passes'
 * targets (post.ts) rather than the canvas.
 */
export async function warmUp(
	renderer: THREE.WebGPURenderer,
	camera: THREE.Camera,
	batches: readonly WarmBatch[],
	limit = WARM_UP_LIMIT_MS
): Promise<void> {
	const expired = new Promise<void>((resolve) => setTimeout(resolve, limit));
	let timedOut = false;
	/** The compile under way for a pass's target, which a frame must not interrupt. */
	let inFlight: Promise<unknown> = Promise.resolve();
	const compile = (async () => {
		for (const { scene, items, targets } of batches) {
			for (const item of items) {
				if (timedOut) return;
				if (targets.length === 0) await renderer.compileAsync(item, camera, scene);
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
					inFlight = renderer.compileAsync(item, camera, scene);
					await inFlight;
					renderer.setRenderTarget(target);
					renderer.setMRT(outputs);
					renderer.toneMapping = toneMapping;
					renderer.outputColorSpace = outputColorSpace;
				}
			}
		}
	})();
	await Promise.race([compile, expired.then(() => void (timedOut = true))]);
	// Frames drawn while a pass's target is set would draw into it (and on WebGPU build pipelines
	// for the wrong targets, aborting the frame): finish that compile first. The compile puts the
	// renderer's state back as it ends, before this resumes (it awaited the same promise first).
	await inFlight.catch(() => {});
}

/** A stand-in for the warm-up's gallery: never culled, since it stands nowhere in particular. */
export function standIn<T extends THREE.Object3D>(object: T): T {
	object.traverse((o) => (o.frustumCulled = false));
	return object;
}

/** A layer with stand-ins for what it shows only later (`TokenLayer.gallery`, …). */
export interface HasGallery {
	gallery(): THREE.Object3D[];
}

/**
 * A tabletop's warm-up (#149, #180): the scene's and the overlay's layers, and the layers'
 * stand-ins (`world` in the scene pass, `marks` in the overlay's). A compile can't make all a draw
 * makes: a stand-in's shadow-pass material, a material in the AO's context (which only the scene
 * pass sets), and r186 declares a shadowed material's uniforms in another order compiled than
 * drawn. So the first frame after a warm-up also draws the stand-ins once, far below the table and
 * a millionth of their size: nothing of them shows.
 */
export class Gallery {
	/** The next frame draws the stand-ins. */
	due = false;
	private readonly held = [new THREE.Group(), new THREE.Group()] as const;
	private readonly world: () => THREE.Object3D[];
	private readonly marks: () => THREE.Object3D[];

	constructor(
		private readonly scene: THREE.Scene,
		private readonly overlay: THREE.Scene,
		/** Layers whose stand-ins draw in the scene pass, and in the overlay's. */
		world: readonly HasGallery[],
		marks: readonly HasGallery[]
	) {
		this.world = () => world.flatMap((l) => l.gallery());
		this.marks = () => marks.flatMap((l) => l.gallery());
		for (const g of this.held) {
			g.position.y = -1000;
			g.scale.setScalar(1e-6);
		}
	}

	/** What to compile: the layers as they stand, and the stand-ins. */
	batches(targets: { scene: readonly PassTarget[]; overlay: readonly PassTarget[] }): WarmBatch[] {
		const { scene, overlay } = this;
		return [
			{ scene, items: [...scene.children, ...this.world()], targets: targets.scene },
			{ scene: overlay, items: [...overlay.children, ...this.marks()], targets: targets.overlay }
		];
	}

	/** Puts the stand-ins in for this frame if one is due; returns what takes them out again. */
	show(): (() => void) | null {
		if (!this.due) return null;
		this.due = false;
		const [world, marks] = this.held;
		world.add(...this.world());
		marks.add(...this.marks());
		this.scene.add(world);
		this.overlay.add(marks);
		return () => {
			world.removeFromParent();
			marks.removeFromParent();
		};
	}
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
