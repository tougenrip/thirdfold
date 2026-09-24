// Raised ground in the three.js view: every cell above level 0 is one
// instance of a single box InstancedMesh (one draw call for all of it),
// standing from the table up to the cell's floor, so stairs read as steps and
// balconies as sheer drops. The fog and darkness overlays lie flat on the
// table, under raised cells, so this layer shades its own tops by the same
// rules: instance colours darken unexplored and unlit cells.

import * as THREE from 'three';
import { gridToWorld, type SquareGrid } from '$lib/game/grid';
import type { Ground } from './ground';

const STONE = new THREE.Color(0x77705f);
const HIGH_STONE = new THREE.Color(0x9a9281);

export class TerrainLayer {
	readonly group = new THREE.Group();
	private geometry = new THREE.BoxGeometry(1, 1, 1);
	private material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
	private mesh: THREE.InstancedMesh | null = null;
	/** Cell index (y * width + x) for each instance. */
	private cells: number[] = [];
	private grid: SquareGrid | null = null;
	private maxLevel = 1;

	/** Rebuilds the raised cells. The ground changes rarely, so a full rebuild is fine. */
	sync(grid: SquareGrid, ground: Ground): void {
		this.grid = grid;
		const levels = ground.levels;
		this.cells = [];
		if (levels) for (let i = 0; i < levels.length; i++) if (levels[i] > 0) this.cells.push(i);
		this.maxLevel = Math.max(1, ...this.cells.map((i) => levels![i]));
		const count = this.cells.length;
		if (!this.mesh || this.mesh.instanceMatrix.count < count) {
			if (this.mesh) {
				this.group.remove(this.mesh);
				this.mesh.dispose();
			}
			this.mesh = new THREE.InstancedMesh(
				this.geometry,
				this.material,
				Math.max(16, Math.ceil(count * 1.25))
			);
			this.mesh.castShadow = true;
			this.mesh.receiveShadow = true;
			this.group.add(this.mesh);
		}
		const matrix = new THREE.Matrix4();
		this.cells.forEach((i, n) => {
			const cell = { x: i % grid.width, y: Math.floor(i / grid.width) };
			const w = gridToWorld(grid, cell);
			const top = ground.floorY(cell);
			matrix.compose(
				new THREE.Vector3(w.x, top / 2, w.z),
				new THREE.Quaternion(),
				new THREE.Vector3(grid.cellSize, top, grid.cellSize)
			);
			this.mesh!.setMatrixAt(n, matrix);
		});
		this.mesh.count = count;
		this.mesh.instanceMatrix.needsUpdate = true;
		this.mesh.computeBoundingSphere();
		this.shade(null, levels);
	}

	/**
	 * Darkens raised cells the viewer can't see: `brightness` is 0-1 per cell
	 * (null: all bright). Higher ground is drawn a little paler.
	 */
	shade(brightness: Float32Array | null, levels: Uint8Array | null): void {
		if (!this.mesh || !levels) return;
		const color = new THREE.Color();
		this.cells.forEach((i, n) => {
			color.copy(STONE).lerp(HIGH_STONE, levels[i] / this.maxLevel);
			if (brightness) color.multiplyScalar(brightness[i]);
			this.mesh!.setColorAt(n, color);
		});
		if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
	}

	/** The cell whose raised top or side is under the ray, and where it was hit. */
	pick(raycaster: THREE.Raycaster): { cell: number; point: THREE.Vector3 } | null {
		if (!this.mesh || !this.grid) return null;
		const hit = raycaster.intersectObject(this.mesh, false)[0];
		if (!hit || hit.instanceId === undefined) return null;
		return { cell: this.cells[hit.instanceId], point: hit.point };
	}

	dispose(): void {
		this.mesh?.dispose();
		this.geometry.dispose();
		this.material.dispose();
	}
}
