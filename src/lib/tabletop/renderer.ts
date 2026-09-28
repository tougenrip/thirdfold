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
import type { SquareGrid } from '$lib/game/grid';
import { lightSources, type Ambient, type Light } from '$lib/game/lights';
import type { SceneObject } from '$lib/game/objects';
import { obstaclesFor, type Prop } from '$lib/game/props';
import type { Token } from '$lib/game/token';
import type { FogView } from '$lib/game/visibility';
import { AmbienceLayer } from './ambience';
import { CameraRig } from './camera';
import { QualityControl } from './capabilities';
import { CellMaps } from './cell-maps';
import { DiceLayer, throwFromView } from './dice3d';
import { EffectsLayer } from './effects';
import { loadEnvironment, type EnvironmentLook } from './environment';
import type { FogMode } from './fog';
import { groundFor, type Ground } from './ground';
import { labelFontReady } from './label-font';
import { LightingLayer, lightSeats } from './lighting';
import { frameOverview, warmUp } from './warmup';
import { advanceNodeFrame, createNodeRenderer, watchReducedMotion } from './loop';
import { RenderScheduler, type FrameReport } from './scheduler';
import { instrument, PerfRecorder, perfMethods } from './perf';
import { poseFor } from './poses';
import { OverlayLayer } from './overlay';
import { Post } from './post';
import { listenForPicks, Picker } from './picking';
import { PreviewLayer } from './previews';
import { PropLayer } from './props';
import { createScene, createSceneLights, FAR, fitToTable } from './scene-lights';
import { playSound } from './sounds';
import { TableLayer } from './table';
import { TerrainLayer } from './terrain';
import { TokenLayer } from './tokens';
import type { CameraView, Tabletop, TabletopEvents, TabletopOptions } from './types';
import { WallLayer } from './walls';

export async function createTabletop(
	canvas: HTMLCanvasElement,
	events: TabletopEvents,
	options: TabletopOptions = {}
): Promise<Tabletop> {
	const clock = options.now ?? (() => performance.now());
	const renderer = await createNodeRenderer(canvas, options);
	let shadowsDirty = true;
	/** A shadow map never drawn reads as garbage, so the first frame always draws it. */
	let shadowMapDrawn = false;
	/** Things moved in the last frame: their final step changes shadows too. */
	let wasMoving = false;

	const perf = new PerfRecorder();
	const loop = new RenderScheduler(render, canvas);
	const requestRender = loop.request;
	const { scene, fog } = createScene();
	const rig = new CameraRig(canvas, FAR);
	const { camera, controls } = rig;
	const lights = createSceneLights(scene);
	const overlay = new OverlayLayer();
	const post = new Post(renderer, scene, camera, overlay.scene, (now) => ({
		reduced: reducedMotion,
		shot: rig.focusAt(now),
		tactical: view === 'tactical',
		target: controls.target
	}));
	post.grade.onLoad = requestRender; // another tone mapper's grades arrived: blend them in
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
	const tokenLayer = new TokenLayer(overlay, onModel, clock);
	scene.add(tokenLayer.group);
	const wallLayer = new WallLayer(clock);
	scene.add(wallLayer.group);
	let floor: Uint8Array | null = null;
	let fogState: { fog: FogView | null; mode: FogMode } = { fog: null, mode: 'player' };
	const cellMaps = new CellMaps(); // every material's fog and dark (worldModify, #171, #173)
	const diceLayer = new DiceLayer();
	scene.add(diceLayer.group);
	// Read live: turning reduced motion on or off applies at once, without a reload.
	const motion = watchReducedMotion(options.reducedMotion, (reduced) => {
		reducedMotion = reduced;
		loop.setReducedMotion(reduced);
		propLayer.setReducedMotion(reduced);
		ambience.setReducedMotion(reduced);
		if (reduced) rig.endShot();
		refreshLighting();
	});
	let reducedMotion = motion.reduced;
	loop.setReducedMotion(reducedMotion);
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
		ambience.update(grid, lightState.ambient);
		const sources = lightSources(lightState.lights, tokens);
		const blocked = obstaclesFor(grid, objects, props, levels, floor);
		const { ambient, lights } = lightState;
		const seats = lightSeats(grid, props);
		lighting.update(grid, ambient, lights, sources, blocked, ground, darkness, seats);
		cellMaps.update(grid, fogState, ambient, lighting.levels, darkness, floor, levels);
		post.setLook(environment, grid.cellSize, look?.grades ?? null, ambient); // AO, grade
	}

	let tokens: readonly Token[] = [];
	/** Tokens drawn lying down; kept here so newly synced minis pick it up. */
	let fallen: ReadonlySet<string> = new Set();
	let objects: readonly SceneObject[] = [];

	let grid: SquareGrid | null = null;
	let extent = 20;

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
		const t0 = performance.now();
		frameOverview(warmCamera, extent, camera.aspect);
		warming = warmUp(renderer, scene, warmCamera, [...scene.children], post.targets()).then(() => {
			perf.add('warmup', performance.now() - t0);
			shadowsDirty = true;
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
		const tokensMoving = tokenLayer.tick(now);
		const doorsMoving = wallLayer.tick(now);
		const diceRolling = diceLayer.tick(now);
		const fx = effects.tick(now);
		lighting.setFlash(fx.flash);
		cellMaps.setFlash(fx.flash);
		const bellSwinging = !!swinging;
		if (swinging) propLayer.setSwing(swinging, fx.bellAngle);
		if (!fx.active) swinging = null;
		const propsMoving = propLayer.tick(now);
		// Only what casts shadows redraws them: dust, a flash or a shudder move none.
		const casters = tokensMoving || doorsMoving || diceRolling || propsMoving || bellSwinging;
		if (casters || wasMoving) shadowsDirty = true;
		wasMoving = casters;
		const flickering = !reducedMotion && lighting.flicker(now);
		const drifting = !reducedMotion && ambience.tick(now);
		const gridFading = overlay.tick(now);
		const moving = casters || gridFading || fx.active || rig.tick(now) || post.blending;
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
		return { active: moving, ambient: flickering || drifting };
	}

	/** The environment asked for, and its looks once loaded. */
	let environment: string | null = null;
	let look: EnvironmentLook | null = null;

	/** Dresses the table, raised ground and walls in the environment's looks (or the plain ones). */
	function applyLook(): void {
		table.dress(look, grid);
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
		overlay.setGrid(g);
		applyLook();
		extent = across;
		fitToTable(lights, fog, camera, controls, extent);
		effects.setBounds(g.width * g.cellSize, g.height * g.cellSize, Math.max(4, extent * 0.2));
	}

	const quality = new QualityControl({ renderer, canvas, camera, sun, perf, loop }, options);
	post.set(quality.current); // drawn through from the first frame, so nothing compiles twice
	controls.addEventListener('change', requestRender);

	const pickable = { tokens: tokenLayer, walls: wallLayer, lighting, props: propLayer };
	const picker = new Picker(canvas, camera, { ...pickable, terrain: terrainLayer }, () => grid);
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
			refreshLighting();
			requestRender();
		},
		throwDice(t) {
			if (!grid || t.dice.length === 0) return 0;
			const { center, from } = throwFromView(controls.target, camera.position, grid, ground);
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
			refreshLighting();
			requestRender();
		},
		setFloor(next) {
			floor = next;
			if (!grid) return;
			if (floor && floor.length !== grid.width * grid.height) floor = null;
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
			const layers = [rig, table, tokenLayer, wallLayer, lighting, post];
			const more = [overlay, ambience, terrainLayer, effects, propLayer, diceLayer, previews];
			for (const l of [...layers, ...more, cellMaps]) l.dispose();
			// Not while a warm-up is still compiling for it; a lost context may throw.
			return warming.then(() => renderer.dispose()).catch(() => {});
		},
		setQuality(settings, refine) {
			quality.set(settings, refine);
			post.set(settings);
			const remade = [table, terrainLayer, wallLayer].map((l) => l.setAntiTiled(settings.antiTile));
			if (remade.includes(true)) warmPending = true;
		},
		capabilities: () => quality.caps,
		setPowerSaver: (on) => loop.setPowerSaver(on),
		...perfMethods(renderer, perf, drawScene, { loop, quality })
	};
	// Changes to the table redraw the sun's shadows on the next frame.
	instrument(tabletop, perf, () => (shadowsDirty = true));
	return tabletop;
}
