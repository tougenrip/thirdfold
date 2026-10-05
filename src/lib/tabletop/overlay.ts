// The overlay (milestone 63, #157): everything that shows game state rather
// than scenery (token labels and floats, the selection ring, the turn marker,
// editor previews, the beacon, and the grid and highlight on twins of the
// ground, grid-overlay.ts) lives in its own scene, drawn by its own pass after
// the world and laid over the tone-mapped image (post.ts). So it is never darkened, bloomed, graded, blurred or smeared,
// and its colours are the ones on screen. It is depth-tested against the world,
// so walls and raised ground still hide labels and rings behind them.
//
// Labels and floats ride on a mini that moves, turns and falls: `follow` gives
// a group that copies an anchor's world transform and visibility just before
// the overlay draws.

import * as THREE from 'three/webgpu';

export class OverlayLayer {
	/** No background and no fog: it clears to transparent, over the world. */
	readonly scene = new THREE.Scene();
	private follows = new Map<THREE.Object3D, THREE.Group>();

	constructor() {
		this.scene.onBeforeRender = () => this.sync();
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
		this.follows.clear();
	}
}

/** Whether `object` and everything above it is visible. */
function shown(object: THREE.Object3D): boolean {
	for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
	return true;
}
