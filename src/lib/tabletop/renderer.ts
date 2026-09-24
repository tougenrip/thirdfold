// three.js view of the tabletop. Pure presentation: it is handed domain data
// (grid, tokens, walls and doors, selection, editor previews) and reports what
// the user pointed at in grid terms: cell, corner, edge, token and object ids. It never owns or mutates game state. Renders on
// demand rather than every frame, so an idle table costs nothing.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
	cornerToWorld,
	gridToWorld,
	worldToCorner,
	worldToEdge,
	worldToGrid,
	type GridEdge,
	type GridPos,
	type SquareGrid
} from '$lib/game/grid';
import type { Cue, Shot } from '$lib/game/chat';
import { shotAt, shotPose, type Pose } from './shots';
import type { Motion } from '$lib/game/motion';
import { lightSources, type Ambient, type Light } from '$lib/game/lights';
import type { SceneObject } from '$lib/game/objects';
import { obstaclesFor, type Prop } from '$lib/game/props';
import type { Token } from '$lib/game/token';
import { decodeMask, type FogView } from '$lib/game/visibility';
import { AmbienceLayer } from './ambience';
import { EffectsLayer } from './effects';
import { dress, loadEnvironment, type EnvironmentLook } from './environment';
import { groundFor, type Ground } from './ground';
import { TerrainLayer } from './terrain';
import { LightingLayer } from './lighting';
import { PropLayer } from './props';
import { playSound } from './sounds';
import { DiceLayer, type DiceThrow } from './dice3d';
import { FloorLayer } from './floor';
import { FogLayer, type FogMode } from './fog';
import { PerfRecorder, type PerfStats } from './perf';
import { TokenLayer } from './tokens';
import { WALL_HEIGHT, WallLayer } from './walls';

export type CameraView = 'tactical' | 'tabletop';
/** How a highlighted cell should read: a valid target, an invalid one, or a placement spot. */
export type HighlightKind = 'move' | 'blocked' | 'place';

/** Everything under the pointer, in grid terms. Fields are null when not applicable. */
export interface Pick {
	cell: GridPos | null;
	corner: GridPos | null;
	edge: GridEdge | null;
	/** Distance from the pointer to `edge`, in cells (0 = on the line). */
	edgeDistance: number;
	tokenId: string | null;
	objectId: string | null;
	/** A light fixture under the pointer. */
	lightId: string | null;
	/** A prop under the pointer. */
	propId: string | null;
}

export interface TabletopEvents {
	onClick(pick: Pick): void;
	onHover(pick: Pick | null): void;
}

/** Editor feedback drawn on the table: a wall/door outline or a corner marker. */
export type PreviewItem =
	| { kind: 'segment'; a: GridPos; b: GridPos; tone: 'valid' | 'invalid' | 'door' }
	| { kind: 'corner'; at: GridPos }
	/** A rectangle of cells, e.g. the area the GM is about to reveal or hide. */
	| { kind: 'area'; from: GridPos; to: GridPos; tone: 'reveal' | 'hide' | 'valid' | 'invalid' }
	/** A soft column of light over a cell: something a new player is shown to walk up to. */
	| { kind: 'beacon'; at: GridPos };

export interface Tabletop {
	setGrid(grid: SquareGrid): void;
	setTokens(tokens: readonly Token[]): void;
	setObjects(objects: readonly SceneObject[]): void;
	setHoveredObject(objectId: string | null): void;
	setPreview(items: readonly PreviewItem[]): void;
	setFog(fog: FogView | null, mode: FogMode): void;
	setLighting(ambient: Ambient, lights: readonly Light[]): void;
	setProps(props: readonly Prop[]): void;
	/** Throws 3D dice for a roll. Returns ms until they have landed. */
	throwDice(t: DiceThrow): number;
	setSelectedProp(propId: string | null): void;
	setHoveredProp(propId: string | null): void;
	setSelected(tokenId: string | null): void;
	/** Lays these tokens down (fallen characters); stands the others up. */
	setFallen(tokenIds: readonly string[]): void;
	/** Marks the token whose turn it is in a fight (an enemy's in red), or none. */
	setActive(tokenId: string | null, enemy: boolean): void;
	/** Floats combat text (damage, healing, a status) up from a token. */
	showFloat(tokenId: string, text: string, color: string): void;
	setHighlight(cell: GridPos | null, kind: HighlightKind): void;
	/** Each cell's level (elevation), or null for a flat table. */
	setTerrain(levels: Uint8Array | null): void;
	/** What each cell is made of (see floor.ts), or null when nothing is painted. */
	setFloor(floor: Uint8Array | null): void;
	/** How the table looks (an environment asset's id), or null for the plain table. */
	setEnvironment(id: string | null): void;
	/** The table's dark areas (one byte per cell), or null for none. */
	setDarkness(mask: Uint8Array | null): void;
	/** Plays a cinematic moment; `swingPropId` is the bell to swing, if it is on the table. */
	playCue(cue: Cue, swingPropId: string | null): void;
	/** Points the camera at something for a moment (see shots.ts), then gives it back. */
	playShot(shot: Shot): void;
	/** Plays motions on props (a lever swinging, a chain shaking) and their sounds. */
	playMotions(motions: readonly Motion[]): void;
	setView(view: CameraView): void;
	/** What rendering has cost so far (see perf.ts). */
	stats(): PerfStats;
	/**
	 * Draws the current view `frames` times, waiting for the GPU each time: the
	 * main thread's ms per frame (`cpu`) and the whole frame's until drawn (`gpu`).
	 */
	benchmark(frames: number): { cpu: number; gpu: number; drawCalls: number };
	resetStats(): void;
	dispose(): void;
}

const TABLE_MARGIN = 3;
/** The distance haze, as tuned for tables up to `extent` across (the Hollow's). */
const FOG = { near: 40, far: 90, extent: 54 };
/** The camera's far plane for such a table. */
const FAR = 200;
const TABLE_THICKNESS = 0.6;
const VIEW_TRANSITION_MS = 450;
/** Pointer travel (px) below which a press-release counts as a click rather than a camera drag. */
const CLICK_SLOP_PX = 6;

const COLORS = {
	background: 0x16120f,
	table: 0x5a3b24,
	surface: 0x2f4a3a,
	gridLine: 0xd8cfb4,
	highlight: { move: 0xe0a458, blocked: 0xe27a6b, place: 0x7fc47a } satisfies Record<
		HighlightKind,
		number
	>
};

/** Camera offset from the table centre for each view, scaled by the grid's size. */
function viewPose(
	view: CameraView,
	extent: number
): { position: THREE.Vector3; target: THREE.Vector3 } {
	const target = new THREE.Vector3(0, 0, 0);
	if (view === 'tactical') {
		// High and nearly overhead: easy to read positions and distances.
		return { position: new THREE.Vector3(0, extent * 1.15, extent * 0.35), target };
	}
	// Low and close, like leaning over miniatures.
	return { position: new THREE.Vector3(extent * 0.42, extent * 0.34, extent * 0.78), target };
}

export function createTabletop(canvas: HTMLCanvasElement, events: TabletopEvents): Tabletop {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.shadowMap.enabled = true;
	// Only the ambient mist clips (to the table).
	renderer.localClippingEnabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;
	// The sun's shadows are drawn again only when something on the table changed (see
	// shadowsDirty), not when just the camera moves or flames flicker: that pass draws the
	// whole scene a second time.
	renderer.shadowMap.autoUpdate = false;
	let shadowsDirty = true;
	/** Things moved in the last frame: their final step changes shadows too. */
	let wasMoving = false;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;

	const perf = new PerfRecorder();
	const scene = new THREE.Scene();
	scene.background = new THREE.Color(COLORS.background);
	const fog = new THREE.Fog(COLORS.background, FOG.near, FOG.far);
	scene.fog = fog;

	const camera = new THREE.PerspectiveCamera(45, 1, 0.1, FAR);
	const controls = new OrbitControls(camera, canvas);
	controls.enableDamping = true;
	controls.screenSpacePanning = false;
	controls.maxPolarAngle = Math.PI / 2 - 0.08; // never dip below the table top
	controls.minDistance = 3;

	const hemisphere = new THREE.HemisphereLight(0xfff1dc, 0x1c140e, 0.9);
	scene.add(hemisphere);
	const sun = new THREE.DirectionalLight(0xffe2b8, 1.6);
	sun.castShadow = true;
	sun.shadow.mapSize.set(2048, 2048);
	sun.shadow.bias = -0.0005;
	scene.add(sun, sun.target);
	// A warm low light off to one side so the table reads as lit by a lamp, not a studio.
	const lamp = new THREE.PointLight(0xffa04d, 30, 0, 2);
	scene.add(lamp);

	const table = new THREE.Group();
	scene.add(table);
	// A figure's model arriving draws it again, shadows too.
	const tokenLayer = new TokenLayer(() => {
		shadowsDirty = true;
		requestRender();
	});
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
	const reducedMotion =
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	// A model arriving draws its props again, shadows too.
	const propLayer = new PropLayer(() => {
		shadowsDirty = true;
		requestRender();
	});
	propLayer.setReducedMotion(reducedMotion);
	scene.add(propLayer.group);
	let props: readonly Prop[] = [];
	const lighting = new LightingLayer({ hemisphere, sun, lamp, scene });
	scene.add(lighting.group);
	let lightState: { ambient: Ambient; lights: readonly Light[] } = { ambient: 'day', lights: [] };
	let darkness: Uint8Array | null = null;
	/** The table was just replaced: the next tokens snap into place. */
	let freshTable = false;
	const ambience = new AmbienceLayer();
	scene.add(ambience.group);
	const terrainLayer = new TerrainLayer();
	scene.add(terrainLayer.group);
	const effects = new EffectsLayer();
	scene.add(effects.group);
	let levels: Uint8Array | null = null;
	let ground: Ground | null = null;
	/** The prop the current cue swings (the bell). */
	let swinging: string | null = null;
	const shakeOffset = new THREE.Vector3();
	/** Flickering flames and drifting mist redraw at a slow, fixed rate, never per frame. */
	const AMBIENT_FRAME_MS = 80;
	let ambientTimer: ReturnType<typeof setTimeout> | 0 = 0;
	function scheduleAmbient(): void {
		if (ambientTimer) return;
		ambientTimer = setTimeout(() => {
			ambientTimer = 0;
			requestRender();
		}, AMBIENT_FRAME_MS);
	}

	/** Light depends on tokens (carried light), walls (blocking), fog (player visibility) and lights. */
	/**
	 * Light has to be worked out again. Several updates often come together (a new
	 * table brings grid, tokens, walls, props, fog and lights), so it is worked out
	 * once, just before the next frame.
	 */
	let lightingStale = false;
	function refreshLighting(): void {
		lightingStale = true;
		requestRender();
	}

	function relight(): void {
		if (!grid) return;
		const fog = fogState.fog;
		const visible =
			fog?.enabled && fogState.mode === 'player'
				? decodeMask(fog.visible, grid.width * grid.height)
				: null;
		ambience.update(grid, lightState.ambient);
		lighting.update(
			grid,
			lightState.ambient,
			lightState.lights,
			lightSources(lightState.lights, tokens),
			obstaclesFor(grid, objects, props, levels, floor),
			visible,
			ground,
			darkness
		);
		shadeTerrain();
	}

	/** Raised ground under fog and darkness, by the same rules as the flat overlays. */
	function shadeTerrain(): void {
		if (!grid || !levels) return;
		const size = grid.width * grid.height;
		const light = lighting.cellBrightness;
		const fog = fogState.fog;
		const visible = fog?.enabled ? decodeMask(fog.visible, size) : null;
		const explored = fog?.enabled ? decodeMask(fog.explored, size) : null;
		const shade = new Float32Array(size);
		for (let i = 0; i < size; i++) {
			let b = light ? light[i] : 1;
			if (visible && explored) {
				if (fogState.mode === 'gm') b *= visible[i] ? 1 : 0.8;
				else b *= visible[i] ? 1 : explored[i] ? 0.45 : 0.04;
			}
			shade[i] = b;
		}
		terrainLayer.shade(shade, levels);
	}

	// Editor previews reuse one geometry and three materials; only transforms change.
	const previewGroup = new THREE.Group();
	previewGroup.renderOrder = 2;
	scene.add(previewGroup);
	const previewBox = new THREE.BoxGeometry(1, 1, 1);
	const previewCorner = new THREE.CylinderGeometry(0.12, 0.12, 0.3, 16);
	const beaconColumn = new THREE.CylinderGeometry(0.32, 0.42, 1, 24, 1, true);
	const beaconRing = new THREE.RingGeometry(0.36, 0.48, 32);
	const previewMaterials = {
		valid: new THREE.MeshBasicMaterial({ color: 0x7fc47a, transparent: true, opacity: 0.55 }),
		invalid: new THREE.MeshBasicMaterial({ color: 0xe27a6b, transparent: true, opacity: 0.55 }),
		door: new THREE.MeshBasicMaterial({ color: 0xe0a458, transparent: true, opacity: 0.7 }),
		reveal: new THREE.MeshBasicMaterial({ color: 0xf2e6d0, transparent: true, opacity: 0.25 }),
		hide: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }),
		beacon: new THREE.MeshBasicMaterial({
			color: 0x9fd7ff,
			transparent: true,
			opacity: 0.22,
			side: THREE.DoubleSide,
			depthWrite: false
		}),
		beaconRing: new THREE.MeshBasicMaterial({
			color: 0xbfe6ff,
			transparent: true,
			opacity: 0.8,
			side: THREE.DoubleSide,
			depthWrite: false
		})
	};

	const highlight = new THREE.Mesh(
		new THREE.PlaneGeometry(0.94, 0.94),
		new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false })
	);
	highlight.rotation.x = -Math.PI / 2;
	highlight.visible = false;
	highlight.renderOrder = 2; // above the fog overlay
	scene.add(highlight);

	let tokens: readonly Token[] = [];
	/** Tokens drawn lying down; kept here so newly synced minis pick it up. */
	let fallen: ReadonlySet<string> = new Set();
	let objects: readonly SceneObject[] = [];

	let grid: SquareGrid | null = null;
	let extent = 20;
	let frame = 0;
	let lastFrameTime = 0;
	/** A cinematic shot in progress: where the camera was, where it goes, since when. */
	let shot: { home: Pose; to: Pose; start: number } | null = null;
	const endShot = () => {
		shot = null;
	};
	let transition: {
		from: { position: THREE.Vector3; target: THREE.Vector3 };
		to: { position: THREE.Vector3; target: THREE.Vector3 };
		start: number;
	} | null = null;

	function requestRender(): void {
		if (!frame) frame = requestAnimationFrame(render);
	}

	function render(now: number): void {
		frame = 0;
		perf.frame(now);
		const start = performance.now();
		drawFrame(now);
		perf.add('frame', performance.now() - start);
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
			if (flickering || drifting) scheduleAmbient();
		}
		if (shot) {
			const { pose, done } = shotAt(shot.home, shot.to, now - shot.start);
			camera.position.set(pose.position.x, pose.position.y, pose.position.z);
			controls.target.set(pose.target.x, pose.target.y, pose.target.z);
			if (done) shot = null;
			else requestRender();
		}
		if (transition) {
			const t = Math.min((now - transition.start) / VIEW_TRANSITION_MS, 1);
			const k = 1 - (1 - t) ** 3;
			camera.position.lerpVectors(transition.from.position, transition.to.position, k);
			controls.target.lerpVectors(transition.from.target, transition.to.target, k);
			if (t === 1) transition = null;
			else requestRender();
		}
		// With damping enabled, update() emits 'change' while the camera is still settling,
		// which schedules the next frame; once still, rendering stops.
		controls.update();
		// A shudder from a cue: offset the camera for this frame only.
		shakeOffset.copy(fx.shake);
		camera.position.add(shakeOffset);
		// With the sun out (after dark) its shadows show nowhere: leave them until it is back.
		const sunShines = sun.intensity > 0;
		renderer.shadowMap.needsUpdate = shadowsDirty && sunShines;
		if (renderer.shadowMap.needsUpdate) perf.add('shadows', 0);
		if (sunShines) shadowsDirty = false;
		const draw = performance.now();
		renderer.render(scene, camera);
		perf.add('draw', performance.now() - draw);
		camera.position.sub(shakeOffset);
	}

	/** The table's own surfaces, kept across tables; the environment dresses them. */
	const slabMaterial = new THREE.MeshStandardMaterial({ roughness: 0.7 });
	const surfaceMaterial = new THREE.MeshStandardMaterial({ roughness: 0.95 });
	/** The environment asked for, and its looks once loaded. */
	let environment: string | null = null;
	let look: EnvironmentLook | null = null;

	/** Dresses the table, raised ground and walls in the environment's looks (or the plain ones). */
	function applyLook(): void {
		const across = grid ? grid.width : 1;
		const down = grid ? grid.height : 1;
		dress(surfaceMaterial, look?.surface ?? null, COLORS.surface, across, down);
		dress(slabMaterial, look?.table ?? null, COLORS.table, extent / 2, 1);
		terrainLayer.setLook(look?.ground ?? null);
		wallLayer.setLook(look?.walls ?? null);
		refreshLighting();
		shadowsDirty = true;
		requestRender();
	}

	function disposeGroup(group: THREE.Group): void {
		const kept = new Set<THREE.Material>([slabMaterial, surfaceMaterial]);
		for (const child of [...group.children]) {
			child.traverse((o) => {
				if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
					o.geometry.dispose();
					(Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
						if (!kept.has(m)) m.dispose();
					});
				}
			});
			group.remove(child);
		}
	}

	function buildTable(g: SquareGrid): void {
		disposeGroup(table);
		const w = g.width * g.cellSize;
		const d = g.height * g.cellSize;

		const slab = new THREE.Mesh(
			new THREE.BoxGeometry(w + TABLE_MARGIN * 2, TABLE_THICKNESS, d + TABLE_MARGIN * 2),
			slabMaterial
		);
		slab.position.y = -TABLE_THICKNESS / 2 - 0.01;
		slab.receiveShadow = true;

		const surface = new THREE.Mesh(new THREE.PlaneGeometry(w, d), surfaceMaterial);
		surface.rotation.x = -Math.PI / 2;
		surface.receiveShadow = true;

		// All grid lines share one geometry: a single draw call however large the grid.
		const points: number[] = [];
		for (let i = 0; i <= g.width; i++) {
			const x = -w / 2 + i * g.cellSize;
			points.push(x, 0, -d / 2, x, 0, d / 2);
		}
		for (let j = 0; j <= g.height; j++) {
			const z = -d / 2 + j * g.cellSize;
			points.push(-w / 2, 0, z, w / 2, 0, z);
		}
		const lineGeometry = new THREE.BufferGeometry();
		lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
		const lines = new THREE.LineSegments(
			lineGeometry,
			new THREE.LineBasicMaterial({ color: COLORS.gridLine, transparent: true, opacity: 0.35 })
		);
		lines.position.y = 0.005;

		table.add(slab, surface, lines);
		applyLook();

		extent = Math.max(w, d) + TABLE_MARGIN * 2;
		// Distance haze and the far plane grow with a table wider than the Hollow, so a long
		// table (a train) is not lost in the haze from where the camera frames it.
		const reach = Math.max(1, extent / FOG.extent);
		fog.near = FOG.near * reach;
		fog.far = FOG.far * reach;
		camera.far = FAR * reach;
		camera.updateProjectionMatrix();
		effects.setBounds(w, d, Math.max(4, extent * 0.2));
		const half = extent / 2;
		Object.assign(sun.shadow.camera, {
			left: -half,
			right: half,
			top: half,
			bottom: -half,
			far: extent * 3
		});
		sun.shadow.camera.updateProjectionMatrix();
		sun.position.set(extent * 0.4, extent, extent * 0.25);
		lamp.position.set(-half * 0.8, extent * 0.25, -half * 0.5);
		controls.maxDistance = extent * 2;
	}

	function resize(): void {
		const { clientWidth, clientHeight } = canvas;
		if (!clientWidth || !clientHeight) return;
		renderer.setSize(clientWidth, clientHeight, false);
		camera.aspect = clientWidth / clientHeight;
		camera.updateProjectionMatrix();
		requestRender();
	}

	const observer = new ResizeObserver(resize);
	observer.observe(canvas);
	controls.addEventListener('change', requestRender);

	// Picking: translate pointer positions into a token id or a logical grid cell.
	const raycaster = new THREE.Raycaster();
	const pointer = new THREE.Vector2();
	const tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
	const hitPoint = new THREE.Vector3();

	function pickAt(event: PointerEvent): Pick {
		const rect = canvas.getBoundingClientRect();
		pointer.set(
			((event.clientX - rect.left) / rect.width) * 2 - 1,
			-((event.clientY - rect.top) / rect.height) * 2 + 1
		);
		raycaster.setFromCamera(pointer, camera);
		const tokenId = tokenLayer.pick(raycaster);
		const objectId = tokenId ? null : wallLayer.pick(raycaster);
		const lightId = tokenId || objectId ? null : lighting.pick(raycaster);
		const propId = tokenId || objectId || lightId ? null : propLayer.pick(raycaster);
		const pick: Pick = {
			cell: null,
			corner: null,
			edge: null,
			edgeDistance: Infinity,
			tokenId,
			objectId,
			lightId,
			propId
		};
		if (!grid) return pick;
		// Raised ground first: pointing at a balcony picks the balcony, not the floor under it.
		const raised = terrainLayer.pick(raycaster);
		const onPlane = raycaster.ray.intersectPlane(tablePlane, hitPoint);
		if (
			raised &&
			(!onPlane ||
				raised.point.distanceTo(raycaster.ray.origin) <= onPlane.distanceTo(raycaster.ray.origin))
		) {
			hitPoint.copy(raised.point);
			pick.cell = { x: raised.cell % grid.width, y: Math.floor(raised.cell / grid.width) };
		} else if (onPlane) {
			pick.cell = worldToGrid(grid, hitPoint);
		} else {
			return pick;
		}
		pick.corner = worldToCorner(grid, hitPoint);
		pick.edge = worldToEdge(grid, hitPoint);
		if (pick.edge) {
			const a = cornerToWorld(grid, pick.edge.a);
			const vertical = pick.edge.a.x === pick.edge.b.x;
			pick.edgeDistance = Math.abs(vertical ? hitPoint.x - a.x : hitPoint.z - a.z) / grid.cellSize;
		}
		return pick;
	}

	function pickKey(p: Pick): string {
		const e = p.edge ? `${p.edge.a.x},${p.edge.a.y},${p.edge.b.x},${p.edge.b.y}` : '';
		return [
			p.cell?.x,
			p.cell?.y,
			p.corner?.x,
			p.corner?.y,
			e,
			p.edgeDistance < 0.2,
			p.tokenId,
			p.objectId,
			p.lightId,
			p.propId
		].join('|');
	}

	let press: { x: number; y: number } | null = null;
	let hoverKey = '';

	function onPointerDown(event: PointerEvent): void {
		// Taking hold of the camera ends a cinematic shot where it is.
		endShot();
		press = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
	}

	function onPointerUp(event: PointerEvent): void {
		if (!press || event.button !== 0) return;
		const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
		press = null;
		if (moved > CLICK_SLOP_PX) return;
		events.onClick(pickAt(event));
	}

	function onPointerMove(event: PointerEvent): void {
		if (event.buttons !== 0) return; // dragging the camera
		const pick = perf.time('pick', () => pickAt(event));
		canvas.style.cursor = pick.tokenId || pick.objectId ? 'pointer' : '';
		const key = pickKey(pick);
		if (key === hoverKey) return;
		hoverKey = key;
		events.onHover(pick);
	}

	function onPointerLeave(): void {
		if (hoverKey === '') return;
		hoverKey = '';
		events.onHover(null);
	}

	canvas.addEventListener('pointerdown', onPointerDown);
	canvas.addEventListener('wheel', endShot, { passive: true });
	canvas.addEventListener('pointerup', onPointerUp);
	canvas.addEventListener('pointermove', onPointerMove);
	canvas.addEventListener('pointerleave', onPointerLeave);

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
			terrainLayer.sync(grid, ground);
			tokenLayer.sync(tokens, grid, ground);
			tokenLayer.setFallen(fallen);
			wallLayer.sync(objects, grid, ground);
			propLayer.sync(props, grid, ground);
			fogLayer.update(grid, fogState.fog, fogState.mode);
			floorLayer.update(grid, floor);
			terrainLayer.setFloor(floor);
			refreshLighting();
			// A new table size (first load, a loaded scene, an adventure): frame it. This
			// replaces any view change still in flight, which would aim at the old table.
			const pose = viewPose(view, extent);
			transition = null;
			shot = null;
			camera.position.copy(pose.position);
			controls.target.copy(pose.target);
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
			previewGroup.clear();
			if (grid) {
				const size = grid.cellSize;
				for (const item of items) {
					if (item.kind === 'area') {
						const a = gridToWorld(grid, item.from);
						const b = gridToWorld(grid, item.to);
						const area = new THREE.Mesh(previewBox, previewMaterials[item.tone]);
						area.position.set((a.x + b.x) / 2, 0.02 * size, (a.z + b.z) / 2);
						area.scale.set(Math.abs(b.x - a.x) + size, 0.04 * size, Math.abs(b.z - a.z) + size);
						previewGroup.add(area);
						continue;
					}
					if (item.kind === 'beacon') {
						const w = gridToWorld(grid, item.at);
						const floor = ground?.floorY(item.at) ?? 0;
						const column = new THREE.Mesh(beaconColumn, previewMaterials.beacon);
						column.position.set(w.x, floor + 1.1 * size, w.z);
						column.scale.set(size, 2.2 * size, size);
						const ring = new THREE.Mesh(beaconRing, previewMaterials.beaconRing);
						ring.rotation.x = -Math.PI / 2;
						ring.position.set(w.x, floor + 0.03 * size, w.z);
						ring.scale.setScalar(size);
						previewGroup.add(column, ring);
						continue;
					}
					if (item.kind === 'corner') {
						const w = cornerToWorld(grid, item.at);
						const marker = new THREE.Mesh(previewCorner, previewMaterials.valid);
						marker.position.set(w.x, 0.15 * size, w.z);
						marker.scale.setScalar(size);
						previewGroup.add(marker);
						continue;
					}
					const p = cornerToWorld(grid, item.a);
					const q = cornerToWorld(grid, item.b);
					const length = Math.hypot(q.x - p.x, q.z - p.z);
					const height = WALL_HEIGHT * size * (item.tone === 'door' ? 0.9 : 0.5);
					const box = new THREE.Mesh(previewBox, previewMaterials[item.tone]);
					box.position.set((p.x + q.x) / 2, height / 2, (p.z + q.z) / 2);
					box.rotation.y = Math.atan2(-(q.z - p.z), q.x - p.x);
					box.scale.set(length + 0.12 * size, height, 0.18 * size);
					previewGroup.add(box);
				}
			}
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
			// Land around what the camera is looking at; throw from the viewer's side.
			const center = new THREE.Vector3(controls.target.x, 0, controls.target.z);
			const toward = new THREE.Vector3(
				camera.position.x - center.x,
				0,
				camera.position.z - center.z
			);
			if (toward.lengthSq() < 1e-6) toward.set(0, 0, 1);
			toward.normalize().multiplyScalar(grid.cellSize * 5);
			const from = center
				.clone()
				.add(toward)
				.setY(grid.cellSize * 2.5);
			const ms = diceLayer.throw(t, center, from, grid.cellSize, reducedMotion);
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
			const visible = !!(cell && grid);
			if (cell && grid) {
				const w = gridToWorld(grid, cell);
				highlight.position.set(w.x, (ground?.floorY(cell) ?? 0) + 0.04, w.z);
				highlight.scale.setScalar(grid.cellSize);
				highlight.material.color.setHex(COLORS.highlight[kind]);
			}
			highlight.visible = visible;
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
			terrainLayer.sync(grid, ground);
			tokenLayer.sync(tokens, grid, ground);
			wallLayer.sync(objects, grid, ground);
			propLayer.sync(props, grid, ground);
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
			const now = performance.now();
			for (const m of motions) {
				if (m.propId && m.kind) propLayer.animate(m.propId, m.kind, now);
				if (m.sound) playSound(m.sound);
			}
			requestRender();
		},
		playCue(cue, swingPropId) {
			swinging = swingPropId;
			effects.play(cue, performance.now(), reducedMotion);
			requestRender();
		},
		playShot(next) {
			if (reducedMotion || !grid) return;
			transition = null;
			const home = {
				position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
				target: { x: controls.target.x, y: controls.target.y, z: controls.target.z }
			};
			const focus = next.focus && {
				...gridToWorld(grid, next.focus),
				y: ground?.floorY(next.focus) ?? 0
			};
			const to = shotPose(home, focus, next.frame, extent, grid.cellSize);
			shot = { home, to, start: performance.now() };
			requestRender();
		},
		setView(next) {
			view = next;
			shot = null;
			transition = {
				from: { position: camera.position.clone(), target: controls.target.clone() },
				to: viewPose(next, extent),
				start: performance.now()
			};
			requestRender();
		},
		dispose() {
			cancelAnimationFrame(frame);
			observer.disconnect();
			canvas.removeEventListener('pointerdown', onPointerDown);
			canvas.removeEventListener('pointerup', onPointerUp);
			canvas.removeEventListener('pointermove', onPointerMove);
			canvas.removeEventListener('wheel', endShot);
			canvas.removeEventListener('pointerleave', onPointerLeave);
			controls.dispose();
			disposeGroup(table);
			slabMaterial.map?.dispose();
			surfaceMaterial.map?.dispose();
			slabMaterial.dispose();
			surfaceMaterial.dispose();
			tokenLayer.dispose();
			wallLayer.dispose();
			fogLayer.dispose();
			floorLayer.dispose();
			lighting.dispose();
			if (ambientTimer) clearTimeout(ambientTimer);
			ambience.dispose();
			terrainLayer.dispose();
			effects.dispose();
			propLayer.dispose();
			diceLayer.dispose();
			previewGroup.clear();
			previewBox.dispose();
			previewCorner.dispose();
			beaconColumn.dispose();
			beaconRing.dispose();
			Object.values(previewMaterials).forEach((m) => m.dispose());
			highlight.geometry.dispose();
			highlight.material.dispose();
			renderer.dispose();
		},
		stats() {
			const { render, memory, programs } = renderer.info;
			return {
				...perf.snapshot(performance.now()),
				drawCalls: render.calls,
				triangles: render.triangles,
				geometries: memory.geometries,
				textures: memory.textures,
				programs: programs?.length ?? 0
			};
		},
		resetStats() {
			perf.reset();
		},
		benchmark(frames) {
			const gl = renderer.getContext();
			const pixel = new Uint8Array(4);
			let cpu = 0;
			let gpu = 0;
			for (let i = 0; i < frames; i++) {
				const start = performance.now();
				renderer.render(scene, camera);
				cpu += performance.now() - start;
				// Reading a pixel back waits until the frame has been drawn.
				gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
				gpu += performance.now() - start;
			}
			return { cpu: cpu / frames, gpu: gpu / frames, drawCalls: renderer.info.render.calls };
		}
	};
	// Changes to the table redraw the sun's shadows on the next frame; updates from the room
	// are also timed (what each costs on the main thread).
	for (const key of [...TIMED, ...RESHADOWS]) {
		const update = tabletop[key] as (...args: unknown[]) => unknown;
		const timed = (TIMED as readonly string[]).includes(key);
		(tabletop[key] as (...args: unknown[]) => unknown) = (...args) => {
			shadowsDirty = true;
			return timed ? perf.time(key, () => update(...args)) : update(...args);
		};
	}
	return tabletop;
}

/** Other changes that can move what casts a shadow (the camera, hover and highlights don't). */
const RESHADOWS = [
	'setFallen',
	'setActive',
	'showFloat',
	'throwDice',
	'playMotions',
	'playCue'
] as const satisfies readonly (keyof Tabletop)[];

/** The updates whose cost is measured. */
const TIMED = [
	'setGrid',
	'setTokens',
	'setObjects',
	'setProps',
	'setFog',
	'setLighting',
	'setDarkness',
	'setTerrain',
	'setFloor',
	'setEnvironment'
] as const satisfies readonly (keyof Tabletop)[];
