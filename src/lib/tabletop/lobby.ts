// The lobby's warm-up (#180). The first sight of a shader kind costs its code generation and a
// driver compile, 180-400 ms for one complex pipeline on some drivers, and pipelines belong to a
// renderer and its device, so the landing page and the join form make the table's renderer early,
// on a canvas of its own, and compile the kinds' gallery (materials/warmup.ts) and the tabletop's
// one-shot marks through the same pipeline a table draws with (its MSAA, half-float target and
// outputs, for the tier the table will start on), then draws it twice on its unseen canvas (what
// only a draw makes: the sun's shadow pass), while the visitor reads the page. The table then
// adopts the renderer and its canvas (`TabletopOptions.warm`, Tabletop.svelte), so entering it
// compiles less: the pipeline's passes, the overlay and what is unlit or unshadowed are made (r186
// orders a shadowed lit material's uniforms by what was built before, so those the table builds).
// Nothing draws while the compiles run, one item at a time (three.js issue 34632). Only public
// data goes in: the kinds' blanks, no model, environment or adventure, so nothing fetched or
// compiled here tells where a story goes (#111 G3).

import * as THREE from 'three/webgpu';
import { probeCapabilities } from './capabilities';
import { DiceLayer } from './dice3d';
import { EffectsLayer } from './effects';
import { CellMaps } from './cell-maps';
import { LightingLayer } from './lighting';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import { kindGallery } from './materials/warmup';
import { OverlayLayer } from './overlay';
import { Post } from './post';
import { createScene, createSceneLights } from './scene-lights';
import { SkyLayer } from './sky';
import { initialShape, sameShape, shapeOf, startingSettings, type Shape } from './shape';
import { TokenLayer } from './tokens';
import { settingsFor, type Tier } from './quality';
import { frameOverview, warmUp } from './warmup';

/** Longest the lobby's warm-up runs, in ms: a table joined sooner waits for it (then adopts it). */
export const LOBBY_LIMIT_MS = 4000;

/** A renderer warmed in the lobby, for the first table to adopt. */
export interface WarmRenderer {
	canvas: HTMLCanvasElement;
	renderer: THREE.WebGPURenderer;
	/** The pipeline it was warmed for: a table of another shape makes its own renderer. */
	shape: Shape;
	warmupMs: number;
	/** The gallery and the passes it compiled with, kept: disposing them would release programs. */
	keep: unknown[];
}

/**
 * Makes the renderer and warms it up; null where it would not help: a software rasteriser
 * (unless `force`d, for tests), where the lobby would only slow the page, or a device whose
 * starting tier builds another pipeline than the one the table expects before its device is known.
 * Tests set the `tier` and `backend` a test table draws with.
 */
export async function warmLobby(
	options: { force?: boolean; limit?: number; tier?: Tier; backend?: 'webgpu' | 'webgl' } = {}
): Promise<WarmRenderer | null> {
	const { tier, backend } = options;
	const shape = tier ? shapeOf(settingsFor(tier, 'webgpu')) : initialShape();
	const canvas = document.createElement('canvas');
	const renderer = await createNodeRenderer(canvas, { antialias: shape.antialias, backend });
	const caps = probeCapabilities(renderer);
	const settings = tier ? settingsFor(tier, caps.backend) : startingSettings(caps);
	if ((caps.software && !options.force) || !sameShape(shapeOf(settings), shape)) {
		renderer.dispose();
		return null;
	}
	const t0 = performance.now();
	// The table's scene as far as shaders see it: the sky's fog and environment (the same nodes,
	// atmosphere.ts) and lights (the key light casting, the hemisphere and the fixed point lights).
	const scene = createScene();
	const lights = createSceneLights(scene);
	const lighting = new LightingLayer(lights.grid, undefined, lights.heroes);
	lighting.setTier(settings); // the tier's K, or the pool (`?off=manylights`)
	scene.add(lighting.group);
	const camera = new THREE.PerspectiveCamera(60, 1, 0.1);
	frameOverview(camera, 20, 1);
	const overlay = new OverlayLayer();
	// Every kind's fog and dark read the cell maps (#171): maps of their own, as a table's, not
	// whatever a table left behind (after one, its textures are gone).
	const cellMaps = new CellMaps();
	cellMaps.setGrid({ kind: 'square', width: 1, height: 1, cellSize: 1 });
	const post = new Post(renderer, scene, camera, overlay.scene);
	post.set(settings);
	const [dice, effects, tokens] = [new DiceLayer(), new EffectsLayer(), new TokenLayer(overlay)];
	const sky = new SkyLayer(); // the dome and the stars, so a table's sky compiles nothing (#214)
	const gallery = [...kindGallery(), ...dice.gallery(), ...effects.gallery(), ...sky.gallery()];
	const marks = tokens.gallery();
	await warmUp(
		renderer,
		camera,
		[
			{ scene, items: gallery, targets: post.targets() },
			{ scene: overlay.scene, items: marks, targets: post.overlayTargets() }
		],
		options.limit ?? LOBBY_LIMIT_MS
	);
	// A compile can't make what only a draw makes (the shadow pass's materials): draw the gallery
	// twice (effects draw their first two frames), on a canvas nobody sees, the sun's shadow too.
	scene.add(...gallery);
	overlay.scene.add(...marks);
	for (let frame = 0; frame < 2; frame++) {
		lights.sun.shadow.needsUpdate = true;
		renderer.info.reset();
		advanceNodeFrame(renderer);
		post.render(frame);
	}
	const warmupMs = performance.now() - t0;
	const keep = [scene, overlay, post, lighting, dice, effects, tokens, gallery, cellMaps, sky];
	return { canvas, renderer, shape, warmupMs, keep };
}
