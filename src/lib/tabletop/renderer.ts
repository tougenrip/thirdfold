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
import type { Ground } from './ground';
import { labelFontReady } from './label-font';
import { LodWatch } from './lod-watch';
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
import { TokenLayer } from './tokens';
import type { CameraView, Tabletop, TabletopEvents, TabletopOptions } from './types';
import { WallLayer } from './walls';
import { loadWorld, WorldLayer } from './world-layer';
export { warmLobby } from './lobby';
export { loadWorld } from './world-layer';

export async function createTabletop(
	canvas: HTMLCanvasElement,
	events: TabletopEvents,
	options: TabletopOptions = {}
): Promise<Tabletop> {
	const clock = options.now ?? (() => performance.now());
	// A renderer the lobby warmed up (lobby.ts, #180) comes with its shaders compiled.
	const made = options.warm?.renderer ?? createNodeRenderer(canvas, options);
	const [renderer, build] = await Promise.all([made, loadWorld()]); // world/build.ts, a lazy chunk
	if (options.warm) setUpRenderer(renderer, options);
	initModels(renderer); // models upload to it; the last table's dispose frees them
	let shadowsDirty = true;
	let shadowMapDrawn = false; // a shadow map never drawn reads as garbage: the first frame draws it
	let [wasMoving, steady] = [false, false]; // moved last frame (shadows); drawn at play, no gallery or loads
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
	const land = new WorldGround(scene, build); // the ground to the horizon and beyond (#220, #244)
	/** A model arrived: warm up its shaders, then draw it (shadows too). */
	const onModel = () => {
		shadowsDirty = warmPending = lods.due = true;
		refreshLighting(); // a fixture to draw, or a prop's flame to seat its light on
	};
	let warmPending = true; // new shaders to compile before the next frame (warmup.ts)
	let warming: Promise<void> = Promise.resolve();
	const warmCamera = new THREE.PerspectiveCamera(60, 1, 0.1);
	const tokenLayer = new TokenLayer(overlay, onModel, clock);
	const wallLayer = new WallLayer(build, clock); // kit pieces by chunk (#252), roofs (#257)
	scene.add(tokenLayer.group, wallLayer.group);
	let floor: Uint8Array | null = null;
	let fogState: { fog: FogView | null; mode: FogMode } = { fog: null, mode: 'player' };
	const cellMaps = new CellMaps(clock); // every material's fog and dark (worldModify, #171, #173)
	const cloud = new FogCloudLayer(); // #174: over a player's hidden cells, with its layer on
	const diceLayer = new DiceLayer();
	scene.add(cloud.group, diceLayer.group);
	const motion = watchReducedMotion(options.reducedMotion, (reduced) => {
		reducedMotion = reduced;
		for (const l of stillable()) l.setReducedMotion(reduced); // instant reveals, a still cloud
		if (reduced) rig.endShot();
		refreshLighting();
	});
	let reducedMotion = motion.reduced; // read live: a change applies at once, without a reload
	const propLayer = new PropLayer(onModel, clock, tokenLayer.contact); // its contact shadows (#271)
	const lods = new LodWatch(camera, canvas, [tokenLayer, propLayer], perf); // levels (#274)
	let props: readonly Prop[] = [];
	const lighting = new LightingLayer(lights.grid, onModel, lights.heroes, requestRender);
	scene.add(propLayer.group, lighting.group);
	const hooks = { post, lighting, walls: wallLayer, renderer, perf, request: requestRender };
	const atmosphere = new AtmosphereLayer({ ...lights, ...hooks }, clock, refreshLighting);
	const { sky } = atmosphere; // the dome, or the horizon's colour on low (#214)
	scene.add(sky.group);
	let lightState: Parameters<Tabletop['setLighting']> = ['day', []]; // band, lights, look
	let darkness: Uint8Array | null = null;
	let freshTable = false; // the table was just replaced: the next tokens snap into place
	const stillable = () => [loop, propLayer, wallLayer, cellMaps, cloud, sky, lighting, tokenLayer];
	for (const l of stillable()) l.setReducedMotion(reducedMotion);
	const worldLayer = new WorldLayer(perf, land, build, propLayer.drops, onModel); // #240, #254, #255
	const effects = new EffectsLayer();
	scene.add(worldLayer.group, effects.group);
	const previews = new PreviewLayer();
	const world = [diceLayer, effects, cloud, sky, worldLayer, wallLayer];
	const gallery = new Gallery(scene, overlay.scene, world, [tokenLayer, worldLayer.grid]);
	overlay.scene.add(previews.group, worldLayer.grid.group); // the grid and highlight (#245)
	let disposed = false;
	// Labels drawn before the label font arrived are drawn again in it.
	void labelFontReady.then(() => {
		if (disposed) return;
		tokenLayer.labels.redraw();
		requestRender();
	});
	let [levels, ground]: [Uint8Array | null, Ground | null] = [null, null];
	let swinging: string | null = null; // the prop the current cue swings (the bell)
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
		land.setBackdrop(world, environment); // what lies beyond the grid (#244)
		const blocked = obstaclesFor(grid, objects, props, levels, floor);
		propLayer.setLights(lights); // the flames on props, lit by a light on their cell (#232)
		lighting.update(grid, ambient, lights, tokens, blocked, ground, darkness, props, floor);
		lighting.showHandles(grid, lights, ground, fogState.mode === 'gm');
		const { floor: floors, levels: heights } = worldLayer.shape!; // the continued maps (#240)
		cellMaps.update(grid, fogState, ambient, lighting.levels, darkness, floors, heights);
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
		const shooting = rig.tick(now); // first, so the pivot's readers below see this frame's camera
		const flickering = lighting.animating(camera, now, controls.target, gallery.due); // #230, #231
		const drifting = [worldLayer.tick(now, reducedMotion, controls.target), cloud.tick(now)]; // #243, #254
		drifting.push(tokenLayer.pulsing); // the turn's ring (#265)
		const turning = atmosphere.tick(now, cellMaps.focusAt(controls.target.x, controls.target.z));
		atmosphere.frame(now); // the sky's clock, and its capture when due (#216)
		const revealing = cellMaps.tick(now) || propLayer.drops.active; // reveals (#174), drops (#249)
		const fading = wallLayer.roofs.tick(now, controls.target); // roofs (#259), never shadows
		const moving = casters || turning || revealing || fading || fx.active || shooting;
		controls.update(); // damped: 'change' while the camera settles, then rendering stops
		rig.keepAbove(grid, ground, land.heightAt); // tilted to the horizon, never under the ground (#220)
		lods.run(quality.current.tier); // levels by the camera, never the shadows (#274)
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
		return { active: moving || post.blending, ambient: flickering || drifting.includes(true) };
	}

	/** The environment asked for, and its looks once loaded. */
	let environment: string | null = null;
	let look: EnvironmentLook | null = null;
	const replan = () =>
		prefetch({ environment, tokens, props }, grid, controls.target, post.toneMapper);

	/** Dresses the table, raised ground and walls in the environment's looks (or the plain ones). */
	function applyLook(): void {
		land.dress(look, grid);
		worldLayer.setLook(look, grid, environment);
		wallLayer.setLook(look?.walls ?? null, look?.kit ?? null, look?.roof ?? null); // roofs: #257
		tokenLayer.bases.setTop(look?.miniBase ?? null); // the bases' discs (#265)
		refreshLighting();
		shadowsDirty = warmPending = true;
		requestRender();
	}

	/** Raised ground, and everything standing on the ground, for a table's ground. */
	function placeOnGround(g: SquareGrid, on: Ground): void {
		tokenLayer.sync(tokens, g, on);
		wallLayer.sync(objects, worldLayer.shape!, on);
		propLayer.sync(props, g, on, worldLayer.shape?.known);
	}

	/** The world's shape from what the viewer was sent (#240), its ground; true if `known` changed. */
	function reshape(): boolean {
		const { fog, mode } = fogState;
		const explored = worldLayer.update(grid!, levels, floor, fog, mode, objects); // walls: #255
		ground = worldLayer.ground;
		return explored;
	}

	function buildTable(g: SquareGrid): void {
		const extents = fitToTable(lights, atmosphere, camera, controls, g, levels, true);
		land.build(extents);
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
	for (const l of [land, worldLayer]) l.setTier(quality.current.tier); // the tile ring (#254)
	tokenLayer.contact.setTier(quality.current.tier, quality.current.layers.contact); // #271
	cloud.setLayer(quality.current.layers.fogcloud, quality.current.tier === 'low');
	controls.addEventListener('change', requestRender);

	const pickable = { tokens: tokenLayer, walls: wallLayer, lighting, props: propLayer };
	const picker = new Picker(canvas, camera, pickable, () => ({ grid, ground }));
	const stopPicking = listenForPicks(canvas, picker, events, perf, () => rig.endShot());
	let view: CameraView = 'tactical';

	const measured = { loop, quality, lighting, world: worldLayer, warming: () => warming };
	const tabletop: Tabletop = {
		setGrid(next) {
			if (grid && sameGrid(grid, next)) return propLayer.drops.hold(); // a load: no drops (#249)
			grid = { ...next };
			freshTable = true;
			if (levels && levels.length !== grid.width * grid.height) levels = null;
			reshape();
			buildTable(grid);
			placeOnGround(grid, ground!);
			tokenLayer.setFallen(fallen);
			refreshLighting();
			// A new table size (first load, a loaded scene, an adventure): frame it. This
			// replaces any view change still in flight, which would aim at the old table.
			rig.frame(view, frame);
			requestRender();
		},
		setTokens(next) {
			tokens = next;
			wallLayer.roofs.setTokens(next); // own and selected ones open their roofs (#259)
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
			if (((objects = next), !grid)) return;
			reshape(); // stairs stop at walls and rail no walled side (#255)
			wallLayer.sync(objects, worldLayer.shape!, ground!);
			refreshLighting();
		},
		setHoveredObject: (objectId) => wallLayer.setHovered(objectId) && requestRender(),
		setPreview: (items) => (previews.set(items, grid, ground), requestRender()),
		setFog(fog, mode) {
			fogState = { fog, mode };
			wallLayer.roofs.setSight(fog, mode); // roofs never hide what the rules show (#257, #259)
			if (!grid) return;
			if (reshape()) wallLayer.sync(objects, worldLayer.shape!, ground!);
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
			propLayer.sync(props, grid, ground, worldLayer.shape?.known);
			refreshLighting();
		},
		setSelectedProp: (propId) => propLayer.setSelected(propId) && requestRender(),
		setHoveredProp: (propId) => propLayer.setHovered(propId) && requestRender(),
		setLighting(...state) {
			if (state[1] !== lightState[1]) shadowsDirty = true;
			lightState = state;
			refreshLighting();
		},
		setSelected: (id) =>
			(wallLayer.roofs.setSelected(id), tokenLayer.setSelected(id)) && requestRender(),
		setOwnTokens: (ids) => wallLayer.roofs.setOwn(ids) && requestRender(),
		setHoveredToken: (id) => tokenLayer.bases.setHovered(id) && requestRender(),
		setRings: (rings) => tokenLayer.bases.setRings(rings) && requestRender(),
		setGridMode: (mode, focus) =>
			(wallLayer.roofs.setBuilding(mode === 'build'), worldLayer.grid.setMode(mode, focus)) &&
			requestRender(),
		setFallen(tokenIds) {
			fallen = new Set(tokenIds);
			if (tokenLayer.setFallen(fallen)) requestRender();
		},
		setActive: (tokenId, enemy) => tokenLayer.setActive(tokenId, enemy) && requestRender(),
		showFloat: (id, text, color) => tokenLayer.float(id, text, color) && requestRender(),
		setLabels: (state) => tokenLayer.labels.set(state) && requestRender(), // names (#268)
		setHighlight: (cell, kind) => (worldLayer.grid.setHighlight(cell, kind), requestRender()),
		setDarkness(next) {
			wallLayer.setDarkness((darkness = next)); // windows into it stay dark (#260)
			refreshLighting();
		},
		setInterior: (next) =>
			// roofs and boundary walls (#251, #257), sky light (#219)
			(wallLayer.setInterior(next), cellMaps.setInterior(next)) && refreshLighting(),
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
			reshape();
			placeOnGround(grid, ground!);
			fitToTable(lights, atmosphere, camera, controls, grid, levels, false); // its top
			refreshLighting();
		},
		setFloor(next) {
			floor = next;
			if (!grid) return;
			if (floor && floor.length !== grid.width * grid.height) floor = null;
			reshape();
			wallLayer.sync(objects, worldLayer.shape!, ground!); // the void's walls are outer (#251)
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
		setPose: (pose) => (rig.setPose(pose), requestRender()),
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
			const more = [overlay, worldLayer, effects, propLayer, diceLayer, previews];
			for (const l of [...layers, ...more, cellMaps]) l.dispose();
			releaseModels();
			// Not while a warm-up is still compiling for it; a lost context may throw.
			return warming.then(() => renderer.dispose()).catch(() => {});
		},
		setQuality(settings, refine) {
			quality.set(settings, refine);
			post.set(settings);
			atmosphere.setTier(settings.tier, settings.layers.sky);
			for (const l of [land, worldLayer, diceLayer]) l.setTier(settings.tier); // dice: #275
			tokenLayer.contact.setTier(settings.tier, settings.layers.contact); // #271
			cloud.setLayer(settings.layers.fogcloud, settings.tier === 'low');
			refreshLighting(); // shows or hides the cloud
			const remade = [land, worldLayer, wallLayer].map((l) => l.setAntiTiled(settings.antiTile));
			if (lighting.setTier(settings) || remade.includes(true)) warmPending = true; // K: #228
		},
		capabilities: () => quality.caps,
		loads: loadProgress,
		setPowerSaver: (on) => (loop.setPowerSaver(on), cloud.setPowerSaver(on)),
		setReduceFlashing: (on) => effects.setReduceFlashing(on),
		...perfMethods(renderer, perf, drawScene, measured)
	};
	// Changes to the table redraw the sun's shadows on the next frame; the hour turns the key light,
	// redrawn by its own rule (AtmosphereLayer.shadowFrame), and lights only when they change.
	instrument(tabletop, perf, (key) => key === 'setLighting' || (shadowsDirty = lods.due = true));
	const unbaked = [tokenLayer, diceLayer, effects, cloud, wallLayer.glass].map((l) => l.group);
	const probeHooks = { renderer, scene, loop, clock, perf, warm: onModel };
	new ProbeLayer({ ...probeHooks, spacing: options.probeSpacing }, unbaked).watch(tabletop);
	return tabletop;
}
