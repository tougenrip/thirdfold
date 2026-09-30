// The GM's handles on lights that draw no fixture (a glow, a fire): a small flat disc in the
// light's colour on its cell, so the GM can find and pick it (#209). One InstancedMesh of the
// overlay kind's instanced variant (the warm-up compiles it), one draw call, made only when a
// GM's table first needs it (lighting.ts `showHandles`), so players never build or draw it.

import * as THREE from 'three/webgpu';
import { gridToWorld, type SquareGrid } from '$lib/game/grid';
import { lightLook, MAX_LIGHTS_PER_ROOM, type Light } from '$lib/game/lights';
import type { Ground } from './ground';
import { addInstanceTints, createMaterial, TINT_ATTRIBUTE } from './materials';

/** A handle's lift over its floor, in cells: above the floor and its decals. */
const LIFT = 0.05;

export class LightHandles {
	readonly mesh: THREE.InstancedMesh;
	/** The light id of each instance, by instance index. */
	private ids: string[] = [];
	private matrix = new THREE.Matrix4();

	constructor() {
		const geometry = new THREE.CircleGeometry(0.3, 24).rotateX(-Math.PI / 2);
		addInstanceTints(geometry, MAX_LIGHTS_PER_ROOM);
		const material = createMaterial('overlay', {
			instanced: true,
			params: { color: 0x000000, opacity: 0.9 }
		});
		this.mesh = new THREE.InstancedMesh(geometry, material, MAX_LIGHTS_PER_ROOM);
		this.mesh.count = 0;
		this.mesh.renderOrder = 2;
	}

	/** Puts a handle on every light without a fixture; none for an empty list. */
	update(grid: SquareGrid, lights: readonly Light[], ground: Ground | null): void {
		const tints = this.mesh.geometry.getAttribute(TINT_ATTRIBUTE) as THREE.BufferAttribute;
		const colour = new THREE.Color();
		this.ids = [];
		for (const l of lights) {
			if (lightLook(l).fixture || this.ids.length >= MAX_LIGHTS_PER_ROOM) continue;
			const i = this.ids.push(l.id) - 1;
			const w = gridToWorld(grid, l.pos);
			const s = grid.cellSize;
			this.matrix.makeScale(s, s, s).setPosition(w.x, (ground?.floorY(l.pos) ?? 0) + LIFT * s, w.z);
			this.mesh.setMatrixAt(i, this.matrix);
			colour.set(l.on ? l.color : '#6b645c');
			tints.setXYZW(i, colour.r, colour.g, colour.b, 1);
		}
		this.mesh.count = this.ids.length;
		this.mesh.instanceMatrix.needsUpdate = true;
		tints.needsUpdate = true;
		this.mesh.boundingSphere = null; // picking and culling measure the instances afresh
	}

	/** The light id a ray hits a handle of, if any. */
	pick(raycaster: THREE.Raycaster): { id: string; distance: number } | null {
		if (this.mesh.count === 0) return null;
		const hit = raycaster.intersectObject(this.mesh, false)[0];
		return hit?.instanceId === undefined
			? null
			: { id: this.ids[hit.instanceId], distance: hit.distance };
	}

	dispose(): void {
		this.mesh.geometry.dispose();
		(this.mesh.material as THREE.Material).dispose();
	}
}
