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
import { float, positionWorld, texture, uniform, vec2 } from 'three/tsl';
import type { SquareGrid } from '$lib/game/grid';

const GRID_COLOR = 0xd8cfb4;
const GRID_OPACITY = 0.35;

/**
 * A 1×1 transparent texture, for no floor, fog or darkness over the grid lines. It is sampled
 * like the texture it stands in for: WebGPU fixes a sampler's filtering when the material
 * compiles, so a slot must keep one filter (nearest for the floor and fog, linear for darkness).
 */
function clear(filter: THREE.MagnificationTextureFilter): THREE.DataTexture {
	const t = new THREE.DataTexture(new Uint8Array(4), 1, 1);
	t.colorSpace = THREE.SRGBColorSpace;
	t.magFilter = filter;
	t.minFilter = filter;
	t.needsUpdate = true;
	return t;
}
const CLEAR = [
	clear(THREE.NearestFilter),
	clear(THREE.NearestFilter),
	clear(THREE.LinearFilter)
] as const;

export class OverlayLayer {
	/** No background and no fog: it clears to transparent, over the world. */
	readonly scene = new THREE.Scene();
	private follows = new Map<THREE.Object3D, THREE.Group>();
	private grid: THREE.LineSegments | null = null;
	/** What lies over the grid lines: painted floors, the fog and the darkness. */
	private readonly masks = CLEAR.map((c) => texture(c));
	private readonly size = uniform(new THREE.Vector2(1, 1));
	private readonly gridMaterial = new THREE.LineBasicNodeMaterial({
		color: GRID_COLOR,
		transparent: true,
		depthWrite: false
	});

	constructor() {
		this.scene.onBeforeRender = () => this.sync();
		// The overlays' planes are centred on the table; texture row 0 is their +z edge.
		const uv = vec2(
			positionWorld.x.div(this.size.x).add(0.5),
			float(0.5).sub(positionWorld.z.div(this.size.y))
		);
		const [floor, fog, dark] = this.masks.map((m) => float(1).sub(m.sample(uv).a));
		this.gridMaterial.opacityNode = float(GRID_OPACITY).mul(floor).mul(fog).mul(dark);
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
	 * The grid lines for a table: one draw call however large. They fade where painted floors,
	 * the fog and the darkness overlays lie (their textures, one texel per cell), as when those
	 * planes were drawn over them: never over an unexplored cell, and dimmer at night.
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
		this.size.value.set(w, d);
		this.grid = new THREE.LineSegments(geometry, this.gridMaterial);
		this.scene.add(this.grid);
	}

	/** The floor's, the fog's and the darkness's textures (null where there is none). */
	setMasks(...masks: (THREE.Texture | null)[]): void {
		masks.forEach((m, i) => (this.masks[i].value = m ?? CLEAR[i]));
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
