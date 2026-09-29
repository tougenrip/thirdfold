// The overlay (milestone 63, #157): everything that shows game state rather
// than scenery (token labels and floats, the selection ring, the turn marker,
// highlights, editor previews, the beacon and grid lines) lives in its own
// scene, drawn by its own pass after the world and laid over the tone-mapped
// image (post.ts). So it is never darkened, bloomed, graded, blurred or smeared,
// and its colours are the ones on screen. It is depth-tested against the world,
// so walls and raised ground still hide labels and rings behind them.
//
// Labels and floats ride on a mini that moves, turns and falls: `follow` gives
// a group that copies an anchor's world transform and visibility just before
// the overlay draws.

import * as THREE from 'three/webgpu';
import { float, uniform } from 'three/tsl';
import type { SquareGrid } from '$lib/game/grid';
import { groundFlat } from './cell-maps';
import { floorPalette } from './materials/hooks';
import { worldShade } from './materials/world-modify';

const GRID_COLOR = 0xd8cfb4;
const GRID_OPACITY = 0.35;
/** How long the grid lines take to fade in or out (#167): aiming shows and hides them often. */
export const GRID_FADE_MS = 150;

export class OverlayLayer {
	/** No background and no fog: it clears to transparent, over the world. */
	readonly scene = new THREE.Scene();
	private follows = new Map<THREE.Object3D, THREE.Group>();
	private grid: THREE.LineSegments | null = null;
	/** Hidden at rest (#167): `setGridShown`. */
	private gridShown = false;
	/** The lines' opacity on the way to shown (1) or hidden (0): a uniform, so fading compiles nothing. */
	private readonly fade = uniform(0);
	private fadeFrom = 0;
	private fadeAt = -Infinity;
	private readonly gridMaterial = new THREE.LineBasicNodeMaterial({
		color: GRID_COLOR,
		transparent: true,
		depthWrite: false
	});

	constructor() {
		this.scene.onBeforeRender = () => this.sync();
		// Faded as the world is in their cell (fog and dark, `worldShade`), and by a painted
		// floor's cover (none over the void), as when the floor, fog and darkness planes lay
		// over them (#173 deleted those).
		const entry = floorPalette.element(groundFlat.x.mul(255).add(0.5).toInt());
		const floor = (entry as unknown as THREE.Node<'vec4'>).w;
		this.gridMaterial.opacityNode = float(GRID_OPACITY)
			.mul(this.fade)
			.mul(float(1).sub(floor))
			.mul(worldShade() as unknown as THREE.Node<'float'>);
	}

	/** A group that follows `anchor` (moves, turns and hides with it) until `unfollow`. */
	follow(anchor: THREE.Object3D): THREE.Group {
		const group = new THREE.Group();
		group.matrixAutoUpdate = false;
		this.follows.set(anchor, group);
		this.scene.add(group);
		return group;
	}

	unfollow(anchor: THREE.Object3D): void {
		this.follows.get(anchor)?.removeFromParent();
		this.follows.delete(anchor);
	}

	/**
	 * The grid lines for a table: one draw call however large. They fade by the cell maps under
	 * painted floors, in the fog and in the dark: never over an unexplored cell, dimmer at night.
	 */
	setGrid(g: SquareGrid): void {
		this.removeGrid();
		const w = g.width * g.cellSize;
		const d = g.height * g.cellSize;
		const points: number[] = [];
		for (let i = 0; i <= g.width; i++) {
			const x = -w / 2 + i * g.cellSize;
			points.push(x, 0.005, -d / 2, x, 0.005, d / 2);
		}
		for (let j = 0; j <= g.height; j++) {
			const z = -d / 2 + j * g.cellSize;
			points.push(-w / 2, 0.005, z, w / 2, 0.005, z);
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
		this.grid = new THREE.LineSegments(geometry, this.gridMaterial);
		this.grid.visible = this.fade.value > 0;
		this.scene.add(this.grid);
	}

	/**
	 * Shows or hides the grid lines, now and for tables to come, fading from where they are over
	 * `GRID_FADE_MS` from `now` (at once when `snap`: reduced motion). True when that changed
	 * anything, and `tick` then has frames to draw.
	 */
	setGridShown(shown: boolean, now: number, snap: boolean): boolean {
		if (shown === this.gridShown) return false;
		this.gridShown = shown;
		this.fadeFrom = this.fade.value;
		this.fadeAt = snap ? -Infinity : now;
		return true;
	}

	/** Sets the lines' opacity for time `now`; true while they are still fading. */
	tick(now: number): boolean {
		const to = this.gridShown ? 1 : 0;
		const t = Math.max(0, (now - this.fadeAt) / GRID_FADE_MS);
		const v = t >= 1 ? to : this.fadeFrom + (to - this.fadeFrom) * t;
		this.fade.value = v;
		// Faded out, they are not drawn at all.
		if (this.grid) this.grid.visible = v > 0;
		return v !== to;
	}

	/** Copies each followed anchor's world transform and visibility (before every overlay draw). */
	sync(): void {
		for (const [anchor, group] of this.follows) {
			anchor.updateWorldMatrix(true, false);
			group.matrix.copy(anchor.matrixWorld);
			group.visible = shown(anchor);
			group.updateMatrixWorld(true);
		}
	}

	dispose(): void {
		this.removeGrid();
		this.gridMaterial.dispose();
		this.follows.clear();
	}

	private removeGrid(): void {
		if (!this.grid) return;
		this.grid.removeFromParent();
		this.grid.geometry.dispose();
		this.grid = null;
	}
}

/** Whether `object` and everything above it is visible. */
function shown(object: THREE.Object3D): boolean {
	for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
	return true;
}
