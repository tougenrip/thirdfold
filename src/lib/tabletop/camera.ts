// The camera: orbit controls, where each view frames the table, and the
// moves that take the camera for a moment (a view change, a cinematic shot)
// on the renderer's clock. Any drag or scroll ends a shot where it is.

import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { gridToWorld, worldToGrid, type SquareGrid } from '$lib/game/grid';
import type { Shot } from '$lib/game/chat';
import type { Ground } from './ground';
import { shotAt, shotFocus, shotPose, viewPose, type Pose } from './shots';
import type { CameraView } from './types';
import { aboveGround, MAX_POLAR_ANGLE } from './world-ground';

export const VIEW_TRANSITION_MS = 450;

/** The camera for a view, as three vectors (the numbers are shots.ts's `viewPose`). */
export function viewEnds(view: CameraView, extent: number): Ends {
	const { position: p, target: t } = viewPose(view, extent);
	return { position: new THREE.Vector3(p.x, p.y, p.z), target: new THREE.Vector3(t.x, t.y, t.z) };
}

type Ends = { position: THREE.Vector3; target: THREE.Vector3 };

export class CameraRig {
	readonly camera: THREE.PerspectiveCamera;
	readonly controls: OrbitControls;
	/** A cinematic shot in progress: where the camera was, where it goes, since when. */
	private shot: { home: Pose; to: Pose; start: number } | null = null;
	private transition: { from: Ends; to: Ends; start: number } | null = null;

	/** The far plane is the table's (`fitToTable`). */
	constructor(canvas: HTMLCanvasElement) {
		this.camera = new THREE.PerspectiveCamera(45, 1, 0.1);
		this.controls = new OrbitControls(this.camera, canvas);
		this.controls.enableDamping = true;
		this.controls.screenSpacePanning = false;
		// Down to the horizon (#220); `keepAbove` keeps it off the ground.
		this.controls.maxPolarAngle = MAX_POLAR_ANGLE;
		this.controls.minDistance = 3;
	}

	/** Ends a cinematic shot where it is (the viewer took hold of the camera). */
	endShot(): void {
		this.shot = null;
	}

	/** Frames a new table at once for the view, replacing any move still aimed at the old one. */
	frame(view: CameraView, extent: number): void {
		const pose = viewEnds(view, extent);
		this.transition = null;
		this.shot = null;
		this.camera.position.copy(pose.position);
		this.controls.target.copy(pose.target);
	}

	setView(view: CameraView, extent: number, now: number): void {
		this.shot = null;
		this.transition = {
			from: { position: this.camera.position.clone(), target: this.controls.target.clone() },
			to: viewEnds(view, extent),
			start: now
		};
	}

	pose(): Pose {
		const { position: p } = this.camera;
		const { target: t } = this.controls;
		return { position: { x: p.x, y: p.y, z: p.z }, target: { x: t.x, y: t.y, z: t.z } };
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

	/**
	 * Keeps the camera a clearance above the ground under it (a raised cell's floor over the grid,
	 * the land beyond it off it, `beyond`'s height there, #244), after the controls have moved it.
	 */
	keepAbove(
		grid: SquareGrid | null,
		ground: Ground | null,
		beyond?: (x: number, z: number) => number | null
	): void {
		const p = this.camera.position;
		const cell = grid && ground ? worldToGrid(grid, { x: p.x, z: p.z }) : null;
		p.y = aboveGround(p, cell ? ground!.floorY(cell) : (beyond?.(p.x, p.z) ?? 0));
	}

	/** How much of the shot's depth of field shows at `now` (0 with no shot, or one cut short). */
	focusAt(now: number): number {
		return this.shot ? shotFocus(now - this.shot.start) : 0;
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
