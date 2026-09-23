// three.js view of the tabletop. Pure presentation: it is handed domain data
// (the grid) and never owns or mutates game state. Renders on demand rather
// than every frame, so an idle table costs nothing.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SquareGrid } from '$lib/game/grid';

export type CameraView = 'tactical' | 'tabletop';

export interface Tabletop {
	setGrid(grid: SquareGrid): void;
	setView(view: CameraView): void;
	dispose(): void;
}

const TABLE_MARGIN = 3;
const TABLE_THICKNESS = 0.6;
const VIEW_TRANSITION_MS = 450;

const COLORS = {
	background: 0x16120f,
	table: 0x5a3b24,
	surface: 0x2f4a3a,
	gridLine: 0xd8cfb4
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

export function createTabletop(canvas: HTMLCanvasElement): Tabletop {
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

	scene.add(new THREE.HemisphereLight(0xfff1dc, 0x1c140e, 0.9));
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

	let grid: SquareGrid | null = null;
	let extent = 20;
	let frame = 0;
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
			if (first) {
				const pose = viewPose(view, extent);
				camera.position.copy(pose.position);
				controls.target.copy(pose.target);
			}
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
			controls.dispose();
			disposeGroup(table);
			renderer.dispose();
		}
	};
}
