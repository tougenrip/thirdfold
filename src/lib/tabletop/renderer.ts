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
import { lightSources, type Ambient, type Light } from '$lib/game/lights';
import type { SceneObject } from '$lib/game/objects';
import { obstaclesFor, type Prop } from '$lib/game/props';
import type { Token } from '$lib/game/token';
import { decodeMask, type FogView } from '$lib/game/visibility';
import { LightingLayer } from './lighting';
import { PropLayer } from './props';
import { DiceLayer, type DiceThrow } from './dice3d';
import { FogLayer, type FogMode } from './fog';
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
	| { kind: 'area'; from: GridPos; to: GridPos; tone: 'reveal' | 'hide' | 'valid' | 'invalid' };

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
	setHighlight(cell: GridPos | null, kind: HighlightKind): void;
	setView(view: CameraView): void;
	dispose(): void;
}

const TABLE_MARGIN = 3;
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
	renderer.shadowMap.type = THREE.PCFShadowMap;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(COLORS.background);
	scene.fog = new THREE.Fog(COLORS.background, 40, 90);

	const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
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
	const tokenLayer = new TokenLayer();
	scene.add(tokenLayer.group);
	const wallLayer = new WallLayer();
	scene.add(wallLayer.group);
	const fogLayer = new FogLayer();
	scene.add(fogLayer.mesh);
	let fogState: { fog: FogView | null; mode: FogMode } = { fog: null, mode: 'player' };
	const diceLayer = new DiceLayer();
	scene.add(diceLayer.group);
	const reducedMotion =
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const propLayer = new PropLayer();
	scene.add(propLayer.group);
	let props: readonly Prop[] = [];
	const lighting = new LightingLayer({ hemisphere, sun, lamp, scene });
	scene.add(lighting.group);
	let lightState: { ambient: Ambient; lights: readonly Light[] } = { ambient: 'day', lights: [] };

	/** Light depends on tokens (carried light), walls (blocking), fog (player visibility) and lights. */
	function refreshLighting(): void {
		if (!grid) return;
		const fog = fogState.fog;
		const visible =
			fog?.enabled && fogState.mode === 'player'
				? decodeMask(fog.visible, grid.width * grid.height)
				: null;
		lighting.update(
			grid,
			lightState.ambient,
			lightState.lights,
			lightSources(lightState.lights, tokens),
			obstaclesFor(grid, objects, props),
			visible
		);
	}

	// Editor previews reuse one geometry and three materials; only transforms change.
	const previewGroup = new THREE.Group();
	previewGroup.renderOrder = 2;
	scene.add(previewGroup);
	const previewBox = new THREE.BoxGeometry(1, 1, 1);
	const previewCorner = new THREE.CylinderGeometry(0.12, 0.12, 0.3, 16);
	const previewMaterials = {
		valid: new THREE.MeshBasicMaterial({ color: 0x7fc47a, transparent: true, opacity: 0.55 }),
		invalid: new THREE.MeshBasicMaterial({ color: 0xe27a6b, transparent: true, opacity: 0.55 }),
		door: new THREE.MeshBasicMaterial({ color: 0xe0a458, transparent: true, opacity: 0.7 }),
		reveal: new THREE.MeshBasicMaterial({ color: 0xf2e6d0, transparent: true, opacity: 0.25 }),
		hide: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 })
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
	let objects: readonly SceneObject[] = [];

	let grid: SquareGrid | null = null;
	let extent = 20;
	let frame = 0;
	let lastFrameTime = 0;
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
		// Clamp so the first frame after an idle period does not jump animations to the end.
		const dt = Math.min(now - lastFrameTime, 50);
		lastFrameTime = now;
		const tokensMoving = tokenLayer.tick(dt);
		const doorsMoving = wallLayer.tick(dt);
		const diceRolling = diceLayer.tick(now);
		if (tokensMoving || doorsMoving || diceRolling) requestRender();
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
		renderer.render(scene, camera);
	}

	function disposeGroup(group: THREE.Group): void {
		for (const child of [...group.children]) {
			child.traverse((o) => {
				if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
					o.geometry.dispose();
					(Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
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
			new THREE.MeshStandardMaterial({ color: COLORS.table, roughness: 0.7 })
		);
		slab.position.y = -TABLE_THICKNESS / 2 - 0.01;
		slab.receiveShadow = true;

		const surface = new THREE.Mesh(
			new THREE.PlaneGeometry(w, d),
			new THREE.MeshStandardMaterial({ color: COLORS.surface, roughness: 0.95 })
		);
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

		extent = Math.max(w, d) + TABLE_MARGIN * 2;
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
		if (!grid || !raycaster.ray.intersectPlane(tablePlane, hitPoint)) return pick;
		pick.cell = worldToGrid(grid, hitPoint);
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
		const pick = pickAt(event);
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
	canvas.addEventListener('pointerup', onPointerUp);
	canvas.addEventListener('pointermove', onPointerMove);
	canvas.addEventListener('pointerleave', onPointerLeave);

	let view: CameraView = 'tactical';

	return {
		setGrid(next) {
			const first = grid === null;
			if (
				grid &&
				grid.width === next.width &&
				grid.height === next.height &&
				grid.cellSize === next.cellSize
			) {
				return;
			}
			grid = { ...next };
			buildTable(grid);
			tokenLayer.sync(tokens, grid);
			wallLayer.sync(objects, grid);
			propLayer.sync(props, grid);
			fogLayer.update(grid, fogState.fog, fogState.mode);
			refreshLighting();
			if (first) {
				const pose = viewPose(view, extent);
				camera.position.copy(pose.position);
				controls.target.copy(pose.target);
			}
			requestRender();
		},
		setTokens(next) {
			tokens = next;
			if (!grid) return;
			tokenLayer.sync(tokens, grid);
			refreshLighting();
			requestRender();
		},
		setObjects(next) {
			objects = next;
			if (!grid) return;
			wallLayer.sync(objects, grid);
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
			propLayer.sync(props, grid);
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
		setHighlight(cell, kind) {
			const visible = !!(cell && grid);
			if (cell && grid) {
				const w = gridToWorld(grid, cell);
				highlight.position.set(w.x, 0.04, w.z);
				highlight.scale.setScalar(grid.cellSize);
				highlight.material.color.setHex(COLORS.highlight[kind]);
			}
			highlight.visible = visible;
			requestRender();
		},
		setView(next) {
			view = next;
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
			canvas.removeEventListener('pointerleave', onPointerLeave);
			controls.dispose();
			disposeGroup(table);
			tokenLayer.dispose();
			wallLayer.dispose();
			fogLayer.dispose();
			lighting.dispose();
			propLayer.dispose();
			diceLayer.dispose();
			previewGroup.clear();
			previewBox.dispose();
			previewCorner.dispose();
			Object.values(previewMaterials).forEach((m) => m.dispose());
			highlight.geometry.dispose();
			highlight.material.dispose();
			renderer.dispose();
		}
	};
}
