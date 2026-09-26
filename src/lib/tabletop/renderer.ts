// three.js view of the tabletop. Pure presentation: it is handed domain data
// (grid, tokens, walls and doors, selection, editor previews) and reports what
// the user pointed at in grid terms: cell, corner, edge, token and object ids.
// It never owns or mutates game state. Renders on demand rather than every
// frame, so an idle table costs nothing.
//
// Every animation runs on one clock (`TabletopOptions.now`, performance.now()
// by default). Tests and golden images pass a clock they hold still, a fixed
// pixel ratio and reduced motion, and pose the camera with `setPose`, so the
// same table always draws the same pixels. Only perf.ts timings keep
// performance.now(): they measure cost, not animation.
//
// The pieces live beside it (see docs/RENDERING.md, Modules): types, camera,
// picking, loop (frames, the renderer's setup), table, scene-lights, previews,
// and one layer module per kind of thing on the table.

import * as THREE from 'three/webgpu';
import type { SquareGrid } from '$lib/game/grid';
import { lightSources, type Ambient, type Light } from '$lib/game/lights';
import type { SceneObject } from '$lib/game/objects';
import { obstaclesFor, type Prop } from '$lib/game/props';
import type { Token } from '$lib/game/token';
import type { FogView } from '$lib/game/visibility';
import { AmbienceLayer } from './ambience';
import { CameraRig, watchCanvasSize } from './camera';
import { DiceLayer, throwFromView } from './dice3d';
import { EffectsLayer } from './effects';
import { loadEnvironment, type EnvironmentLook } from './environment';
import { FloorLayer } from './floor';
import { FogLayer, playerVisible, type FogMode } from './fog';
import { groundFor, type Ground } from './ground';
import { labelFontReady } from './label-font';
import { LightingLayer, lightSeats } from './lighting';
import { frameOverview, warmUp } from './warmup';
import { advanceNodeFrame, createNodeRenderer, FrameLoop, watchReducedMotion } from './loop';
import { benchmark, instrument, PerfRecorder, rendererStats, sampleGpu } from './perf';
import { poseFor } from './poses';
import { listenForPicks, Picker } from './picking';
import { PreviewLayer } from './previews';
import { PropLayer } from './props';
import { createScene, createSceneLights, FAR, fitToTable } from './scene-lights';
import { playSound } from './sounds';
import { TableLayer } from './table';
import { TerrainLayer, terrainShade } from './terrain';
import { TokenLayer } from './tokens';
import type { CameraView, Tabletop, TabletopEvents, TabletopOptions } from './types';
import { WallLayer } from './walls';

export type {
	CameraView,
	HighlightKind,
	Pick,
	PreviewItem,
	Tabletop,
	TabletopEvents,
	TabletopOptions
} from './types';

const BACKGROUND = 0x292421; // the day preset's (lighting.ts)

export async function createTabletop(
	canvas: HTMLCanvasElement,
	events: TabletopEvents,
	options: TabletopOptions = {}
): Promise<Tabletop> {
	const clock = options.now ?? (() => performance.now());
	const renderer = await createNodeRenderer(canvas, options);
	let shadowsDirty = true;
	/** A shadow map never drawn reads as garbage (lit surfaces go black), so the first frame always draws it. */
	let shadowMapDrawn = false;
	/** Things moved in the last frame: their final step changes shadows too. */
	let wasMoving = false;

	const perf = new PerfRecorder();
	const loop = new FrameLoop(render);
	const requestRender = loop.request;
	const { scene, fog } = createScene(BACKGROUND);
	const rig = new CameraRig(canvas, FAR);
	const { camera, controls } = rig;
	const lights = createSceneLights(scene);
	const { sun } = lights;

	const table = new TableLayer();
	scene.add(table.group);
	/** A model arrived: warm up its shaders, then draw it (shadows too). */
	const onModel = () => {
		shadowsDirty = warmPending = true;
		refreshLighting(); // a sconce's or brazier's size seats its light's flame
	};
	/** Something new needs its shaders compiled before the next frame (see warmup.ts). */
	let warmPending = true;
	let warming: Promise<void> = Promise.resolve();
	const warmCamera = new THREE.PerspectiveCamera(60, 1, 0.1, FAR);
	const tokenLayer = new TokenLayer(onModel);
	scene.add(tokenLayer.group);
	const wallLayer = new WallLayer();
	scene.add(wallLayer.group);
	const fogLayer = new FogLayer();
	scene.add(fogLayer.mesh);
	const floorLayer = new FloorLayer();
	scene.add(floorLayer.mesh);
	let floor: Uint8Array | null = null;
	let fogState: { fog: FogView | null; mode: FogMode } = { fog: null, mode: 'player' };
	const diceLayer = new DiceLayer();
	scene.add(diceLayer.group);
	// Read live: turning reduced motion on or off applies at once, without a reload.
	const motion = watchReducedMotion(options.reducedMotion, (reduced) => {
		reducedMotion = reduced;
		propLayer.setReducedMotion(reduced);
		ambience.setReducedMotion(reduced);
		if (reduced) rig.endShot();
		refreshLighting();
	});
	let reducedMotion = motion.reduced;
	const propLayer = new PropLayer(onModel, clock);
	propLayer.setReducedMotion(reducedMotion);
	scene.add(propLayer.group);
	let props: readonly Prop[] = [];
	const lighting = new LightingLayer({ ...lights, scene });
	scene.add(lighting.group);
	let lightState: { ambient: Ambient; lights: readonly Light[] } = { ambient: 'day', lights: [] };
	let darkness: Uint8Array | null = null;
	/** The table was just replaced: the next tokens snap into place. */
	let freshTable = false;
	const ambience = new AmbienceLayer();
	ambience.setReducedMotion(reducedMotion);
	scene.add(ambience.group);
	const terrainLayer = new TerrainLayer();
	scene.add(terrainLayer.group);
	const effects = new EffectsLayer();
	scene.add(effects.group);
	const previews = new PreviewLayer();
	scene.add(previews.group, previews.highlight);
	let disposed = false;
	// Labels drawn before the label font arrived are drawn again in it.
	void labelFontReady.then(() => {
		if (disposed) return;
		tokenLayer.relabel();
		diceLayer.clearLabels();
		requestRender();
	});
	let levels: Uint8Array | null = null;
	let ground: Ground | null = null;
	/** The prop the current cue swings (the bell). */
	let swinging: string | null = null;
	const shakeOffset = new THREE.Vector3();

	/**
	 * Light depends on tokens (carried light), walls (blocking), fog (player visibility) and
	 * lights, and has to be worked out again when they change. Several updates often come
	 * together (a new table brings grid, tokens, walls, props, fog and lights), so it is
	 * worked out once, just before the next frame.
	 */
	let lightingStale = false;
	function refreshLighting(): void {
		lightingStale = true;
		requestRender();
	}

	function relight(): void {
		if (!grid) return;
		const size = grid.width * grid.height;
		const { fog, mode } = fogState;
		ambience.update(grid, lightState.ambient);
		const sources = lightSources(lightState.lights, tokens);
		const blocked = obstaclesFor(grid, objects, props, levels, floor);
		const visible = playerVisible(fog, mode, size);
		const { ambient, lights } = lightState;
		const seats = lightSeats(grid, props);
		lighting.update(grid, ambient, lights, sources, blocked, visible, ground, darkness, seats);
		// Raised ground under fog and darkness, by the same rules as the flat overlays.
		if (levels) terrainLayer.shade(terrainShade(size, lighting.cellBrightness, fog, mode), levels);
	}

	let tokens: readonly Token[] = [];
	/** Tokens drawn lying down; kept here so newly synced minis pick it up. */
	let fallen: ReadonlySet<string> = new Set();
	let objects: readonly SceneObject[] = [];

	let grid: SquareGrid | null = null;
	let extent = 20;
	let lastFrameTime = 0;

	/** Draws one frame: counters and the node frame are advanced here, since the internal loop is off. */
	function drawScene(): void {
		renderer.info.reset();
		advanceNodeFrame(renderer);
		renderer.render(scene, camera);
	}

	function render(): void {
		if (warmPending && grid) return startWarmUp();
		const start = performance.now();
		perf.frame(start);
		drawFrame(clock());
		perf.add('frame', performance.now() - start);
	}

	/** Compiles the table's shaders while frames are held, then draws (the sun's shadow too). */
	function startWarmUp(): void {
		warmPending = false;
		if (lightingStale) {
			lightingStale = false;
			perf.time('lighting', relight);
		}
		const t0 = performance.now();
		frameOverview(warmCamera, extent, camera.aspect);
		warming = warmUp(renderer, scene, warmCamera, [...scene.children]).then(() => {
			perf.add('warmup', performance.now() - t0);
			shadowsDirty = true;
		});
		loop.hold(warming);
		loop.request();
	}

	function drawFrame(now: number): void {
		if (lightingStale) {
			lightingStale = false;
			perf.time('lighting', relight);
		}
		// Clamp so the first frame after an idle period does not jump animations to the end.
		const dt = Math.min(now - lastFrameTime, 50);
		lastFrameTime = now;
		const tokensMoving = tokenLayer.tick(dt);
		const doorsMoving = wallLayer.tick(dt);
		const diceRolling = diceLayer.tick(now);
		const fx = effects.tick(now);
		lighting.setFlash(fx.flash);
		if (swinging) propLayer.setSwing(swinging, fx.bellAngle);
		if (!fx.active) swinging = null;
		const propsMoving = propLayer.tick(now);
		const moving = tokensMoving || doorsMoving || diceRolling || fx.active || propsMoving;
		if (moving) requestRender();
		if (moving || wasMoving) shadowsDirty = true;
		wasMoving = moving;
		if (!reducedMotion) {
			const flickering = lighting.flicker(now);
			const drifting = ambience.tick(now);
			if (flickering || drifting) loop.ambient();
		}
		if (rig.tick(now)) requestRender();
		// With damping enabled, update() emits 'change' while the camera is still settling,
		// which schedules the next frame; once still, rendering stops.
		controls.update();
		// A shudder from a cue: offset the camera for this frame only.
		shakeOffset.copy(fx.shake);
		camera.position.add(shakeOffset);
		// With the sun out (after dark) its shadows show nowhere: leave them until it is back.
		const sunShines = sun.intensity > 0;
		sun.shadow.needsUpdate = (shadowsDirty && sunShines) || !shadowMapDrawn;
		shadowMapDrawn = true;
		if (sun.shadow.needsUpdate) perf.add('shadows', 0);
		if (sunShines) shadowsDirty = false;
		const draw = performance.now();
		drawScene();
		perf.add('draw', performance.now() - draw);
		camera.position.sub(shakeOffset);
	}

	/** The environment asked for, and its looks once loaded. */
	let environment: string | null = null;
	let look: EnvironmentLook | null = null;

	/** Dresses the table, raised ground and walls in the environment's looks (or the plain ones). */
	function applyLook(): void {
		table.dress(look, grid, extent);
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
		const across = table.build(g);
		applyLook();
		extent = across;
		fitToTable(lights, fog, camera, controls, extent);
		effects.setBounds(g.width * g.cellSize, g.height * g.cellSize, Math.max(4, extent * 0.2));
	}

	const stopSizing = watchCanvasSize(canvas, renderer, camera, requestRender);
	controls.addEventListener('change', requestRender);

	const picker = new Picker(
		canvas,
		camera,
		{
			tokens: tokenLayer,
			walls: wallLayer,
			lighting,
			props: propLayer,
			terrain: terrainLayer
		},
		() => grid
	);
	// Taking hold of the camera ends a cinematic shot where it is.
	const stopPicking = listenForPicks(canvas, picker, events, perf, () => rig.endShot());

	let view: CameraView = 'tactical';

	const tabletop: Tabletop = {
		setGrid(next) {
			if (
				grid &&
				grid.width === next.width &&
				grid.height === next.height &&
				grid.cellSize === next.cellSize
			) {
				return;
			}
			grid = { ...next };
			freshTable = true;
			if (levels && levels.length !== grid.width * grid.height) levels = null;
			ground = groundFor(grid, levels);
			buildTable(grid);
			placeOnGround(grid, ground);
			tokenLayer.setFallen(fallen);
			fogLayer.update(grid, fogState.fog, fogState.mode);
			floorLayer.update(grid, floor);
			terrainLayer.setFloor(floor);
			refreshLighting();
			// A new table size (first load, a loaded scene, an adventure): frame it. This
			// replaces any view change still in flight, which would aim at the old table.
			rig.frame(view, extent);
			requestRender();
		},
		setTokens(next) {
			tokens = next;
			if (!grid) return;
			// The first tokens after a new table take their places at once: nobody glides in from
			// where they stood on the last one.
			tokenLayer.sync(tokens, grid, ground, freshTable);
			freshTable = false;
			tokenLayer.setFallen(fallen);
			refreshLighting();
			requestRender();
		},
		setObjects(next) {
			objects = next;
			if (!grid) return;
			wallLayer.sync(objects, grid, ground!);
			refreshLighting();
			requestRender();
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
			fogLayer.update(grid, fog, mode);
			refreshLighting();
			requestRender();
		},
		throwDice(t) {
			if (!grid || t.dice.length === 0) return 0;
			const { center, from } = throwFromView(controls.target, camera.position, grid.cellSize);
			const ms = diceLayer.throw(t, center, from, grid.cellSize, reducedMotion, clock());
			requestRender();
			return ms;
		},
		setProps(next) {
			props = next;
			if (!grid) return;
			propLayer.sync(props, grid, ground);
			refreshLighting();
			requestRender();
		},
		setSelectedProp(propId) {
			if (propLayer.setSelected(propId)) requestRender();
		},
		setHoveredProp(propId) {
			if (propLayer.setHovered(propId)) requestRender();
		},
		setLighting(ambient, lights) {
			lightState = { ambient, lights };
			refreshLighting();
			requestRender();
		},
		setSelected(tokenId) {
			if (tokenLayer.setSelected(tokenId)) requestRender();
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
			requestRender();
		},
		setEnvironment(next) {
			if (next === environment) return;
			environment = next;
			if (!next) {
				look = null;
				applyLook();
				return;
			}
			void loadEnvironment(next).then((loaded) => {
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
			refreshLighting();
			requestRender();
		},
		setFloor(next) {
			floor = next;
			if (!grid) return;
			if (floor && floor.length !== grid.width * grid.height) floor = null;
			floorLayer.update(grid, floor);
			terrainLayer.setFloor(floor);
			refreshLighting();
			requestRender();
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
			rig.playShot(next, grid, ground, extent, clock());
			requestRender();
		},
		setView(next) {
			view = next;
			rig.setView(next, extent, clock());
			requestRender();
		},
		setPose(pose) {
			rig.setPose(pose);
			requestRender();
		},
		setGridPose(pose) {
			if (grid) rig.setPose(poseFor(grid, ground, pose));
			requestRender();
		},
		dispose() {
			disposed = true;
			loop.dispose();
			motion.stop();
			stopSizing();
			stopPicking();
			const layers = [rig, table, tokenLayer, wallLayer, fogLayer, floorLayer, lighting];
			for (const l of [...layers, ambience, terrainLayer, effects, propLayer, diceLayer, previews])
				l.dispose();
			// Not while a warm-up is still compiling for it.
			void warming.then(() => renderer.dispose());
		},
		stats: () => rendererStats(renderer, perf, loop.holding),
		resetStats: () => perf.reset(),
		benchmark: (frames) => benchmark(renderer, perf, drawScene, frames),
		sampleGpu: () => sampleGpu(renderer, perf)
	};
	// Changes to the table redraw the sun's shadows on the next frame.
	instrument(tabletop, perf, () => (shadowsDirty = true));
	return tabletop;
}
