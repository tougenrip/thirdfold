// Shader warm-up (milestone 62, #149). The node renderer compiles 60-70
// pipelines for a table where the classic one compiled a dozen, so compiling
// them on the first frame a player sees stalls it for hundreds of ms. Instead,
// when a table, an environment's look or a model is new, the frame loop is
// held (the canvas keeps its last frame) while every layer is compiled from a
// camera that sees the whole table, a chunk of objects at once (`CHUNK`; no
// frame draws meanwhile, which is what trips three.js issue 34632), in each
// pass's context (the scene pass's AO, so its lit materials compile as drawn).
// A warm-up never holds for longer than WARM_UP_LIMIT_MS (and the chunk under
// way): what is left compiles on draw.
//
// Since #180 a warm-up also compiles what only shows later: stand-ins for the
// one-shot marks and effects (the selection ring and turn marker in the
// overlay's pass, a die, the toll's dust and shadow; each layer's `gallery`),
// never the real objects, which a frame drawn after a timed-out warm-up could
// catch shown; the first frame after draws the stand-ins once, out of sight
// (`Gallery`). The lobby does the same for every shader kind before any table
// (lobby.ts).

import * as THREE from 'three/webgpu';
import { drawnFirst, passContext, type PassTarget } from './passes';
import { gpuInfo } from './perf';
import { isSoftware } from './quality';

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
 * Items compiled at once: three's `compileAsync` links one program after another, each waiting for
 * a frame to see it done, so one item at a time took a frame or more per program and a gallery
 * of a few hundred missed its limit. Several at once let the driver link them in parallel
 * (KHR_parallel_shader_compile on WebGL2, async pipelines on WebGPU); frames are held meanwhile, so
 * three.js issue 34632 (compiling while frames draw) can't happen. A chunk bounds how long a
 * timed-out warm-up still waits for the compile under way. A software rasteriser links one
 * program at a time anyway, so it compiles one item at a time, as before (a chunk there could hold
 * frames for seconds past the limit).
 */
const CHUNK = 16;

/**
 * Compiles `batches` for `camera`'s view, a chunk of items at a time, resolving when done (true)
 * or when `limit` ms have passed (false; the items not reached compile on draw). With
 * post-processing on, a pipeline is compiled per target and set of outputs, so items are compiled
 * for the passes' targets (post.ts) rather than the canvas.
 */
export async function warmUp(
	renderer: THREE.WebGPURenderer,
	camera: THREE.Camera,
	batches: readonly WarmBatch[],
	limit = WARM_UP_LIMIT_MS
): Promise<boolean> {
	const expired = new Promise<void>((resolve) => setTimeout(resolve, limit));
	let timedOut = false;
	/** The compile under way for a pass's target, which a frame must not interrupt. */
	let inFlight: Promise<unknown> = Promise.resolve();
	const all = (items: readonly THREE.Object3D[], scene: THREE.Scene) =>
		Promise.all(items.map((item) => renderer.compileAsync(item, camera, scene)));
	const size = isSoftware(gpuInfo(renderer).adapter) ? 1 : CHUNK;
	const depths = drawDepths(renderer);
	depths.warming = true;
	const compile = (async () => {
		for (const { scene, items: given, targets } of batches) {
			const items = unlit(given);
			for (let i = 0; i < items.length; i += size) {
				const chunk = items.slice(i, i + size);
				if (timedOut) return;
				if (targets.length === 0) await all(chunk, scene);
				for (const { renderTarget, mrt, pass } of targets) {
					if (timedOut) return;
					const [target, outputs] = [renderer.getRenderTarget(), renderer.getMRT()];
					const { toneMapping, outputColorSpace, contextNode } = renderer;
					const before = pass ? drawnFirst(pass) : [];
					const updates = before.map((node) => node.updateBeforeType);
					for (const node of before) node.updateBeforeType = 'none';
					// As PassNode.updateBefore sets its context, the same node.
					const context = pass && passContext(renderer, pass);
					if (context) renderer.contextNode = context;
					// As RenderPipeline.render draws its passes: linear, no tone mapping.
					renderer.toneMapping = THREE.NoToneMapping;
					renderer.outputColorSpace = THREE.ColorManagement.workingColorSpace;
					renderer.setRenderTarget(renderTarget);
					renderer.setMRT(mrt);
					// The target and outputs stay set until the compile is done (it reads them while it
					// waits), so a timed-out warm-up still waits for this one before frames resume.
					inFlight = all(chunk, scene);
					await inFlight;
					renderer.setRenderTarget(target);
					renderer.setMRT(outputs);
					renderer.toneMapping = toneMapping;
					renderer.outputColorSpace = outputColorSpace;
					renderer.contextNode = contextNode;
					before.forEach((node, k) => (node.updateBeforeType = updates[k]));
				}
			}
		}
	})();
	const done = await Promise.race([
		compile.then(() => !timedOut),
		expired.then(() => ((timedOut = true), false))
	]);
	// Frames drawn while a pass's target is set would draw into it (and on WebGPU build pipelines
	// for the wrong targets, aborting the frame): finish that compile first. The compile puts the
	// renderer's state back as it ends, before this resumes (it awaited the same promise first).
	await inFlight.catch(() => {});
	depths.warming = false;
	return done;
}

/** Three's render contexts (r186, a private field): one per target, outputs and call depth. */
export interface RenderContexts {
	get(target?: object | null, mrt?: object | null, depth?: number): unknown;
}

/**
 * Compiles in the render contexts frames draw in. Three keys a render context, and with it every
 * graph built in it (each InstancedMesh's its own, by uuid), by the depth of the render call as
 * well as the target and outputs: the passes draw nested in the pipeline's render (the scene pass
 * at depth 2), while `compileAsync` asks at depth 0, so every graph a warm-up built was built
 * again on the first frame. This records the depth each target and outputs were last drawn at and,
 * while `warming`, hands compiles that context.
 */
export class DrawDepths {
	warming = false;
	private readonly depths = new WeakMap<object, Map<object | null, number>>();

	constructor(contexts: RenderContexts) {
		const get = contexts.get.bind(contexts);
		contexts.get = (target = null, mrt = null, depth) => {
			const drawn = target ? this.depths.get(target) : undefined;
			if (depth === undefined) depth = (this.warming && drawn?.get(mrt)) || 0;
			else if (target && depth >= 0)
				(drawn ?? this.depths.set(target, new Map()).get(target)!).set(mrt, depth);
			return get(target, mrt, depth);
		};
	}
}

const installed = new WeakMap<object, DrawDepths>();

/** `renderer`'s draw depths, recorded from the first call on. */
export function drawDepths(renderer: THREE.WebGPURenderer): DrawDepths {
	let d = installed.get(renderer);
	if (!d) {
		const { _renderContexts } = renderer as unknown as { _renderContexts: RenderContexts };
		installed.set(renderer, (d = new DrawDepths(_renderContexts)));
	}
	return d;
}

/**
 * `items` without their lights: a light compiled as an item is listed twice in the lights the
 * scene's draws share (as an item, then from the target scene), and three keeps the lights' key
 * for the rest of the warm-up, so every graph built meanwhile keys on lights no frame draws with
 * and is built again on the next draw. A group holding a light gives its other children instead.
 */
export function unlit(items: readonly THREE.Object3D[]): THREE.Object3D[] {
	const lit = (o: THREE.Object3D) => {
		let found = false;
		o.traverse((c) => (found ||= (c as THREE.Light).isLight === true));
		return found;
	};
	return items.flatMap((o) => ((o as THREE.Light).isLight ? [] : lit(o) ? unlit(o.children) : [o]));
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
