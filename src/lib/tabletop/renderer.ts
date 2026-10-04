// three.js view of the tabletop. Pure presentation: it is handed domain data
// (grid, tokens, walls and doors, selection, editor previews) and reports what
// the user pointed at in grid terms: cell, corner, edge, token and object ids.
// It never owns or mutates game state. Renders on demand rather than every
// frame, so an idle table costs nothing.
//
// Every animation runs on one clock (`TabletopOptions.now`); tests hold it
// still, with a fixed pixel ratio, reduced motion and a posed camera, so the
// same table always draws the same pixels. Only perf.ts timings measure cost.
// Its pieces live beside it, one per concern (docs/RENDERING.md, Modules).

import * as THREE from 'three/webgpu';
import { sameGrid, type SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import { obstaclesFor, type Prop } from '$lib/game/props';
import type { Token } from '$lib/game/token';
import type { FogView } from '$lib/game/visibility';
import { AtmosphereLayer } from './atmosphere';
import { CameraRig } from './camera';
import { QualityControl } from './capabilities';
import { CellMaps } from './cell-maps';
import { DiceLayer, throwFromView } from './dice3d';
import { EffectsLayer } from './effects';
import { FogCloudLayer } from './fog-cloud';
import { loadEnvironment, type EnvironmentLook } from './environment';
import type { FogMode } from './fog';
import { groundFor, type Ground } from './ground';
import { labelFontReady } from './label-font';
import { WorldGround } from './landscape';
import { LightingLayer, ProbeLayer } from './lighting';
import { frameOverview, Gallery, warmUp } from './warmup';
import { advanceNodeFrame, createNodeRenderer, setUpRenderer, watchReducedMotion } from './loop';
import { RenderScheduler, type FrameReport } from './scheduler';
import { instrument, PerfRecorder, perfMethods } from './perf';
import { poseFor } from './poses';
import { OverlayLayer } from './overlay';
import { Post } from './post';
import { listenForPicks, Picker } from './picking';
import { PreviewLayer } from './previews';
import { initModels, loadProgress, loadsSettled, prefetch, releaseModels } from './models';
import { PropLayer } from './props';
import { createScene, createSceneLights, fitToTable } from './scene-lights';
import { playSound } from './sounds';
import { TerrainLayer } from './terrain';
import { TokenLayer } from './tokens';
import type { CameraView, Tabletop, TabletopEvents, TabletopOptions } from './types';
import { WallLayer } from './walls';
export { warmLobby } from './lobby';

export async function createTabletop(
	canvas: HTMLCanvasElement,
	events: TabletopEvents,
	options: TabletopOptions = {}
): Promise<Tabletop> {
	const clock = options.now ?? (() => performance.now());
	// A renderer the lobby warmed up (lobby.ts, #180) comes with its shaders compiled.
	const renderer = options.warm?.renderer ?? (await createNodeRenderer(canvas, options));
	if (options.warm) setUpRenderer(renderer, options);
	initModels(renderer); // models upload to it; the last table's dispose frees them
	let shadowsDirty = true;
	let shadowMapDrawn = false; // a shadow map never drawn reads as garbage: the first frame draws it
	/** Things moved last frame (shadows change); it was drawn at play (no gallery or loads). */
	let [wasMoving, steady] = [false, false];
	const perf = new PerfRecorder();
	if (options.warm) perf.add('lobby', options.warm.warmupMs);
	const loop = new RenderScheduler(render, canvas);
	const requestRender = loop.request;
	const scene = createScene();
	const rig = new CameraRig(canvas);
	const { camera, controls } = rig;
	const lights = createSceneLights(scene);
	const overlay = new OverlayLayer();
	const post = new Post(renderer, scene, camera, overlay.scene, (now) => ({
		reduced: reducedMotion,
		shot: rig.focusAt(now),
		tactical: view === 'tactical',
		target: controls.target,
		pull: camera.position.distanceTo(controls.target) / controls.maxDistance
	}));
	post.grade.onLoad = requestRender; // another tone mapper's grades arrived: blend them in
	const { sun } = lights;
	const land = new WorldGround(); // the play plane and the ground to the horizon (#220)
	scene.add(land.group);
	/** A model arrived: warm up its shaders, then draw it (shadows too). */
	const onModel = () => {
		shadowsDirty = warmPending = true;
		refreshLighting(); // a fixture to draw, or a prop's flame to seat its light on
	};
	/** Something new needs its shaders compiled before the next frame (see warmup.ts). */
	let warmPending = true;
	let warming: Promise<void> = Promise.resolve();
	const warmCamera = new THREE.PerspectiveCamera(60, 1, 0.1);
	const tokenLayer = new TokenLayer(overlay, onModel, clock);
	scene.add(tokenLayer.group);
	const wallLayer = new WallLayer(clock);
	scene.add(wallLayer.group);
	let floor: Uint8Array | null = null;
	let fogState: { fog: FogView | null; mode: FogMode } = { fog: null, mode: 'player' };
	const cellMaps = new CellMaps(clock); // every material's fog and dark (worldModify, #171, #173)
	const cloud = new FogCloudLayer(); // #174: over a player's hidden cells, with its layer on
	scene.add(cloud.group);
	const diceLayer = new DiceLayer();
	scene.add(diceLayer.group);
	const motion = watchReducedMotion(options.reducedMotion, (reduced) => {
		reducedMotion = reduced;
		for (const l of stillable()) l.setReducedMotion(reduced); // instant reveals, a still cloud
		if (reduced) rig.endShot();
		refreshLighting();
	});
	let reducedMotion = motion.reduced; // read live: a change applies at once, without a reload
	const propLayer = new PropLayer(onModel, clock);
	scene.add(propLayer.group);
	let props: readonly Prop[] = [];
	const lighting = new LightingLayer(lights.grid, onModel, lights.heroes, requestRender);
	scene.add(lighting.group);
	const hooks = { post, lighting, renderer, perf, request: requestRender };
	const atmosphere = new AtmosphereLayer({ ...lights, ...hooks }, clock, refreshLighting);
	const { sky } = atmosphere; // the dome, or the horizon's colour on low (#214)
	scene.add(sky.group);
	let lightState: Parameters<Tabletop['setLighting']> = ['day', []]; // band, lights, look
	let darkness: Uint8Array | null = null;
	/** The table was just replaced: the next tokens snap into place. */
	let freshTable = false;
	const stillable = () => [loop, propLayer, cellMaps, cloud, sky, lighting];
	for (const l of stillable()) l.setReducedMotion(reducedMotion);
	const terrainLayer = new TerrainLayer();
	const effects = new EffectsLayer();
	scene.add(terrainLayer.group, effects.group);
	const [previews, world] = [new PreviewLayer(), [diceLayer, effects, cloud, sky]];
	const gallery = new Gallery(scene, overlay.scene, world, [tokenLayer, previews]);
	overlay.scene.add(previews.group, previews.highlight);
	let disposed = false;
	// Labels drawn before the label font arrived are drawn again in it.
	void labelFontReady.then(() => {
		if (disposed) return;
		tokenLayer.relabel();
		diceLayer.clearLabels();
		requestRender();
	});
	let [levels, ground]: [Uint8Array | null, Ground | null] = [null, null];
	/** The prop the current cue swings (the bell). */
	let swinging: string | null = null;
	const shakeOffset = new THREE.Vector3();

	/**
	 * Light depends on tokens (carried light), walls, fog and lights: worked out again when they
	 * change, once just before the next frame however many updates came together (a new table).
	 */
	let lightingStale = false;
	function refreshLighting(): void {
		lightingStale = true;
		requestRender();
	}

	function relight(): void {
		if (!grid) return;
		const [ambient, lights, world = null] = lightState;
		atmosphere.setWorld(world, ambient, environment, reducedMotion);
		const blocked = obstaclesFor(grid, objects, props, levels, floor);
		propLayer.setLights(lights); // the flames on props, lit by a light on their cell (#232)
		lighting.update(grid, ambient, lights, tokens, blocked, ground, darkness, props, floor);
		lighting.showHandles(grid, lights, ground, fogState.mode === 'gm');
		cellMaps.update(grid, fogState, ambient, lighting.levels, darkness, floor, levels);
		cloud.update(grid, fogState.fog, fogState.mode);
		post.setLook(environment, grid.cellSize, look?.grades ?? null, ambient); // AO, grade
	}

	let tokens: readonly Token[] = [];
	/** Tokens drawn lying down; kept here so newly synced minis pick it up. */
	let fallen: ReadonlySet<string> = new Set();
	let objects: readonly SceneObject[] = [];
	let grid: SquareGrid | null = null;
	let frame = 20; // what views and shots frame: the play area and a margin (world-ground.ts)
	options.devScene?.(scene, () => ((shadowsDirty = true), requestRender()));
	/** Draws one frame: counters and the node frame are advanced here, since the internal loop is off. */
	function drawScene(): void {
		renderer.info.reset();
		advanceNodeFrame(renderer);
		post.render(clock());
	}

	function render(): FrameReport {
		if (warmPending && grid) return startWarmUp();
		const start = performance.now();
		perf.frame(start);
		const report = drawFrame(clock());
		perf.add('frame', performance.now() - start);
		return report;
	}

	/** Compiles the table's shaders while frames are held, then draws (the sun's shadow too). */
	function startWarmUp(): FrameReport {
		warmPending = false;
		if (lightingStale) {
			lightingStale = false;
			perf.time('lighting', relight);
		}
		atmosphere.frame(clock()); // the first capture: no frame draws with an empty cube
		const t0 = performance.now();
		frameOverview(warmCamera, frame, camera.aspect);
		const targets = { scene: post.targets(), overlay: post.overlayTargets() };
		warming = warmUp(renderer, warmCamera, gallery.batches(targets)).then(() => {
			perf.add('warmup', performance.now() - t0);
			shadowsDirty = gallery.due = true;
		});
		loop.hold(warming);
		loop.request();
		return { active: false, ambient: false };
	}

	/** Draws a frame for time `now` and reports what still moves or animates (scheduler.ts). */
	function drawFrame(now: number): FrameReport {
		if (lightingStale) {
			lightingStale = false;
			perf.time('lighting', relight);
		}
		const tokensMoving = lighting.carry(tokenLayer, tokenLayer.tick(now)); // carried lights too
		const doorsMoving = wallLayer.tick(now);
		const diceRolling = diceLayer.tick(now);
		const fx = effects.tick(now);
		atmosphere.setFlash(fx.flash, fx.policy);
		cellMaps.setFlash(fx.flash);
		const bellSwinging = !!swinging;
		if (swinging) propLayer.setSwing(swinging, fx.bellAngle);
		if (!fx.active) swinging = null;
		const propsMoving = propLayer.tick(now);
		// Only what casts shadows redraws them: dust, a flash or a shudder move none.
		const casters = tokensMoving || doorsMoving || diceRolling || propsMoving || bellSwinging;
		if (casters || wasMoving) shadowsDirty = true;
		wasMoving = casters;
		const flickering = lighting.animating(camera, now, controls.target, gallery.due); // #230, #231
		const drifting = cloud.tick(now);
		const turning = atmosphere.tick(now, cellMaps.focusAt(controls.target.x, controls.target.z));
		atmosphere.frame(now); // the sky's clock, and its capture when due (#216)
		const gridFading = overlay.tick(now);
		const revealing = cellMaps.tick(now); // a reveal's fade (#174): frames until it ends
		const moving =
			casters || turning || gridFading || revealing || fx.active || rig.tick(now) || post.blending;
		// Damped, update() emits 'change' while the camera settles: once still, rendering stops.
		controls.update();
		rig.keepAbove(grid, ground); // tilted to the horizon, never under the ground (#220)
		shakeOffset.copy(fx.shake); // a shudder from a cue: the camera's offset, this frame only
		camera.position.add(shakeOffset);
		const hideGallery = gallery.show(); // drawn once after a warm-up, out of sight (warmup.ts)
		steady = !hideGallery && loadsSettled();
		if (atmosphere.shadowFrame(shadowsDirty, !shadowMapDrawn || !!hideGallery))
			perf.add('shadows', 0);
		if (sun.intensity > 0) shadowsDirty = false; // with the key light out, until it is back
		shadowMapDrawn = true;
		const draw = performance.now();
		drawScene();
		hideGallery?.();
		perf.add('draw', performance.now() - draw);
		camera.position.sub(shakeOffset);
		return { active: moving, ambient: flickering || drifting };
	}

	/** The environment asked for, and its looks once loaded. */
	let environment: string | null = null;
	let look: EnvironmentLook | null = null;
	const replan = () =>
		prefetch({ environment, tokens, props }, grid, controls.target, post.toneMapper);

	/** Dresses the table, raised ground and walls in the environment's looks (or the plain ones). */
	function applyLook(): void {
		land.dress(look, grid);
		terrainLayer.setLook(look?.ground ?? null);
		wallLayer.setLook(look?.walls ?? null);
		refreshLighting();
		shadowsDirty = warmPending = true;
		requestRender();
	}

	/** Raised ground, and everything standing on the ground, for a table's ground. */
	function placeOnGround(g: SquareGrid, on: Ground): void {
		terrainLayer.sync(g, on);
		tokenLayer.sync(tokens, g, on);
		wallLayer.sync(objects, g, on);
		propLayer.sync(props, g, on);
	}

	function buildTable(g: SquareGrid): void {
		const extents = fitToTable(lights, atmosphere, camera, controls, g, levels, true);
		land.build(extents);
		overlay.setGrid(g);
		applyLook();
		frame = extents.play.frame;
		effects.setBounds(extents.play.width, extents.play.depth, Math.max(4, frame * 0.2));
	}

	const quality = new QualityControl(
		{ renderer, canvas, camera, sun, perf, loop, steady: () => steady },
		options
	);
	post.set(quality.current); // drawn through from the first frame, so nothing compiles twice
	atmosphere.setTier(quality.current.tier, quality.current.layers.sky);
	land.setTier(quality.current.tier);
	cloud.setLayer(quality.current.layers.fogcloud, quality.current.tier === 'low');
	controls.addEventListener('change', requestRender);

	const pickable = { tokens: tokenLayer, walls: wallLayer, lighting, props: propLayer };
	const picker = new Picker(canvas, camera, pickable, () => ({ grid, ground }));
	const stopPicking = listenForPicks(canvas, picker, events, perf, () => rig.endShot());
	let view: CameraView = 'tactical';

	const tabletop: Tabletop = {
		setGrid(next) {
			if (grid && sameGrid(grid, next)) return;
			grid = { ...next };
			freshTable = true;
			if (levels && levels.length !== grid.width * grid.height) levels = null;
			ground = groundFor(grid, levels);
			buildTable(grid);
			placeOnGround(grid, ground);
			tokenLayer.setFallen(fallen);
			refreshLighting();
			// A new table size (first load, a loaded scene, an adventure): frame it. This
			// replaces any view change still in flight, which would aim at the old table.
			rig.frame(view, frame);
			requestRender();
		},
		setTokens(next) {
			tokens = next;
			replan(); // their downloads, nearest the camera first (#192), before the layer asks
			if (!grid) return;
			// The first tokens after a new table take their places at once: nobody glides in from
			// where they stood on the last one.
			tokenLayer.sync(tokens, grid, ground, freshTable);
			freshTable = false;
			tokenLayer.setFallen(fallen);
			refreshLighting();
		},
		setObjects(next) {
			objects = next;
			if (!grid) return;
			wallLayer.sync(objects, grid, ground!);
			refreshLighting();
		},
		setHoveredObject(objectId) {
			if (wallLayer.setHovered(objectId)) requestRender();
		},
		setPreview(items) {
			previews.set(items, grid, ground);
			requestRender();
		},
		setFog(fog, mode) {
			fogState = { fog, mode };
			if (!grid) return;
			refreshLighting();
		},
		throwDice(t) {
			if (!grid || t.dice.length === 0) return 0;
			const aim = throwFromView(controls.target, camera.position, grid, ground, floor); // #247
			const ms = diceLayer.throw(t, aim, grid.cellSize, reducedMotion, clock());
			requestRender();
			return ms;
		},
		setProps(next) {
			props = next;
			replan();
			if (!grid) return;
			propLayer.sync(props, grid, ground);
			refreshLighting();
		},
		setSelectedProp(propId) {
			if (propLayer.setSelected(propId)) requestRender();
		},
		setHoveredProp(propId) {
			if (propLayer.setHovered(propId)) requestRender();
		},
		setLighting(...state) {
			if (state[1] !== lightState[1]) shadowsDirty = true;
			lightState = state;
			refreshLighting();
		},
		setSelected(tokenId) {
			if (tokenLayer.setSelected(tokenId)) requestRender();
		},
		setGridShown(shown) {
			if (overlay.setGridShown(shown, clock(), reducedMotion)) requestRender();
		},
		setFallen(tokenIds) {
			fallen = new Set(tokenIds);
			if (tokenLayer.setFallen(fallen)) requestRender();
		},
		setActive(tokenId, enemy) {
			if (tokenLayer.setActive(tokenId, enemy)) requestRender();
		},
		showFloat(tokenId, text, color) {
			if (tokenLayer.float(tokenId, text, color)) requestRender();
		},
		setHighlight(cell, kind) {
			previews.setHighlight(cell, kind, grid, ground);
			requestRender();
		},
		setDarkness(next) {
			darkness = next;
			refreshLighting();
		},
		setInterior: (next) => cellMaps.setInterior(next) && refreshLighting(), // sky light, #219
		setEnvironment(next) {
			if (next === environment) return;
			environment = next;
			if (!next) {
				look = null;
				applyLook();
				return;
			}
			void loadEnvironment(next, post.toneMapper).then((loaded) => {
				// Only if it is still the one wanted (tables can change quickly).
				if (environment !== next) return;
				look = loaded;
				applyLook();
			});
		},
		setTerrain(next) {
			levels = next;
			if (!grid) return;
			if (levels && levels.length !== grid.width * grid.height) levels = null;
			ground = groundFor(grid, levels);
			placeOnGround(grid, ground);
			fitToTable(lights, atmosphere, camera, controls, grid, levels, false); // its top
			refreshLighting();
		},
		setFloor(next) {
			floor = next;
			if (!grid) return;
			if (floor && floor.length !== grid.width * grid.height) floor = null;
			refreshLighting();
		},
		playMotions(motions) {
			const now = clock();
			for (const m of motions) {
				if (m.propId && m.kind) propLayer.animate(m.propId, m.kind, now);
				if (m.sound) playSound(m.sound);
			}
			requestRender();
		},
		playCue(cue, swingPropId) {
			swinging = swingPropId;
			effects.play(cue, clock(), reducedMotion);
			requestRender();
		},
		playShot(next) {
			if (reducedMotion || !grid) return;
			rig.playShot(next, grid, ground, frame, clock());
			requestRender();
		},
		setView(next) {
			view = next;
			rig.setView(next, frame, clock());
			requestRender();
		},
		setPose(pose) {
			rig.setPose(pose);
			requestRender();
		},
		cameraPose: () => (grid ? rig.pose() : null),
		setGridPose(pose) {
			if (grid) rig.setPose(poseFor(grid, ground, pose));
			requestRender();
		},
		dispose() {
			disposed = true;
			loop.dispose();
			motion.stop();
			quality.dispose();
			stopPicking();
			const layers = [rig, land, tokenLayer, wallLayer, lighting, post, cloud, atmosphere];
			const more = [overlay, terrainLayer, effects, propLayer, diceLayer, previews];
			for (const l of [...layers, ...more, cellMaps]) l.dispose();
			releaseModels();
			// Not while a warm-up is still compiling for it; a lost context may throw.
			return warming.then(() => renderer.dispose()).catch(() => {});
		},
		setQuality(settings, refine) {
			quality.set(settings, refine);
			post.set(settings);
			atmosphere.setTier(settings.tier, settings.layers.sky);
			land.setTier(settings.tier);
			cloud.setLayer(settings.layers.fogcloud, settings.tier === 'low');
			refreshLighting(); // shows or hides the cloud
			const remade = [land, terrainLayer, wallLayer].map((l) => l.setAntiTiled(settings.antiTile));
			if (lighting.setTier(settings) || remade.includes(true)) warmPending = true; // K: #228
		},
		capabilities: () => quality.caps,
		loads: loadProgress,
		setPowerSaver: (on) => (loop.setPowerSaver(on), cloud.setPowerSaver(on)),
		setReduceFlashing: (on) => effects.setReduceFlashing(on),
		...perfMethods(renderer, perf, drawScene, { loop, quality, lighting, warming: () => warming })
	};
	// Changes to the table redraw the sun's shadows on the next frame; the hour turns the key light,
	// redrawn by its own rule (AtmosphereLayer.shadowFrame), and lights only when they change.
	instrument(tabletop, perf, (key) => key === 'setLighting' || (shadowsDirty = true));
	const unbaked = [tokenLayer, diceLayer, effects, cloud].map((l) => l.group); // probes (#235)
	const probeHooks = { renderer, scene, loop, clock, perf, warm: onModel };
	new ProbeLayer({ ...probeHooks, spacing: options.probeSpacing }, unbaked).watch(tabletop);
	return tabletop;
}
