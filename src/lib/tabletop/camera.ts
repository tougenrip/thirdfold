// The camera: orbit controls, where each view frames the table, and the
// moves that take the camera for a moment (a view change, a cinematic shot)
// on the renderer's clock. Any drag or scroll ends a shot where it is.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { gridToWorld, type SquareGrid } from '$lib/game/grid';
import type { Shot } from '$lib/game/chat';
import type { Ground } from './ground';
import { shotAt, shotPose, type Pose } from './shots';
import type { CameraView } from './types';

export const VIEW_TRANSITION_MS = 450;

/** Camera offset from the table centre for each view, scaled by the grid's size. */
export function viewPose(
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

type Ends = { position: THREE.Vector3; target: THREE.Vector3 };

export class CameraRig {
	readonly camera: THREE.PerspectiveCamera;
	readonly controls: OrbitControls;
	/** A cinematic shot in progress: where the camera was, where it goes, since when. */
	private shot: { home: Pose; to: Pose; start: number } | null = null;
	private transition: { from: Ends; to: Ends; start: number } | null = null;

	constructor(canvas: HTMLCanvasElement, far: number) {
		this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, far);
		this.controls = new OrbitControls(this.camera, canvas);
		this.controls.enableDamping = true;
		this.controls.screenSpacePanning = false;
		this.controls.maxPolarAngle = Math.PI / 2 - 0.08; // never dip below the table top
		this.controls.minDistance = 3;
	}

	/** Ends a cinematic shot where it is (the viewer took hold of the camera). */
	endShot(): void {
		this.shot = null;
	}

	/** Frames a new table at once for the view, replacing any move still aimed at the old one. */
	frame(view: CameraView, extent: number): void {
		const pose = viewPose(view, extent);
		this.transition = null;
		this.shot = null;
		this.camera.position.copy(pose.position);
		this.controls.target.copy(pose.target);
	}

	setView(view: CameraView, extent: number, now: number): void {
		this.shot = null;
		this.transition = {
			from: { position: this.camera.position.clone(), target: this.controls.target.clone() },
			to: viewPose(view, extent),
			start: now
		};
	}

	setPose(pose: Pose): void {
		this.shot = null;
		this.transition = null;
		this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
		this.controls.target.set(pose.target.x, pose.target.y, pose.target.z);
	}

	playShot(next: Shot, grid: SquareGrid, ground: Ground | null, extent: number, now: number): void {
		this.transition = null;
		const { position, target } = { position: this.camera.position, target: this.controls.target };
		const home = {
			position: { x: position.x, y: position.y, z: position.z },
			target: { x: target.x, y: target.y, z: target.z }
		};
		const focus = next.focus && {
			...gridToWorld(grid, next.focus),
			y: ground?.floorY(next.focus) ?? 0
		};
		this.shot = { home, to: shotPose(home, focus, next.frame, extent, grid.cellSize), start: now };
	}

	/** Advances a shot or view change to `now`. Returns true while one is still playing. */
	tick(now: number): boolean {
		let playing = false;
		if (this.shot) {
			const { pose, done } = shotAt(this.shot.home, this.shot.to, now - this.shot.start);
			this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
			this.controls.target.set(pose.target.x, pose.target.y, pose.target.z);
			if (done) this.shot = null;
			else playing = true;
		}
		if (this.transition) {
			const t = Math.min((now - this.transition.start) / VIEW_TRANSITION_MS, 1);
			const k = 1 - (1 - t) ** 3;
			const { from, to } = this.transition;
			this.camera.position.lerpVectors(from.position, to.position, k);
			this.controls.target.lerpVectors(from.target, to.target, k);
			if (t === 1) this.transition = null;
			else playing = true;
		}
		return playing;
	}

	dispose(): void {
		this.controls.dispose();
	}
}

/** Keeps the drawing size and the camera's aspect in step with the canvas. Returns a stop function. */
export function watchCanvasSize(
	canvas: HTMLCanvasElement,
	renderer: THREE.WebGLRenderer,
	camera: THREE.PerspectiveCamera,
	onResize: () => void
): () => void {
	const observer = new ResizeObserver(() => {
		const { clientWidth, clientHeight } = canvas;
		if (!clientWidth || !clientHeight) return;
		renderer.setSize(clientWidth, clientHeight, false);
		camera.aspect = clientWidth / clientHeight;
		camera.updateProjectionMatrix();
		onResize();
	});
	observer.observe(canvas);
	return () => observer.disconnect();
}
