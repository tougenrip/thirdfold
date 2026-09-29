// Raised ground in the three.js view: every cell above level 0 is one
// instance of a single box InstancedMesh (one draw call for all of it),
// standing from the table up to the cell's floor, so stairs read as steps and
// balconies as sheer drops. It is the terrain kind (#172): the painted floor
// and the paleness of height come from the ground map (materials/hooks.ts
// `groundColour`), the texture is world-mapped (#177) and anti-tiled on medium
// and up (#181). Fog and darkness are the kind's `worldModify`, as on every
// surface (#173 deleted the grey instance colours that shaded it here).

import * as THREE from 'three/webgpu';
import { gridToWorld, type SquareGrid } from '$lib/game/grid';
import { wear, type Look } from './environment';
import { STEP_HEIGHT, type Ground } from './ground';
import {
	createMaterial,
	disposeTwins,
	repeatFor,
	setParams,
	twinOf,
	type KindMaterial
} from './materials';

const PLAIN = { color: 0x77705f, roughness: 0.9 };

export class TerrainLayer {
	readonly group = new THREE.Group();
	private geometry = new THREE.BoxGeometry(1, 1, 1);
	private material: KindMaterial = createMaterial('terrain', { antiTiled: true });
	private mesh: THREE.InstancedMesh | null = null;
	/** Cell index (y * width + x) for each instance. */
	private cells: number[] = [];
	private grid: SquareGrid | null = null;
	private look: Look | null = null;

	constructor() {
		wear(this.material, null, PLAIN);
	}

	/** The environment's ground (null: plain stone). */
	setLook(look: Look | null): void {
		this.look = look;
		wear(this.material, look, PLAIN);
		this.tile();
	}

	/**
	 * The tier's anti-tiling (#181): the material made again in that variant, once.
	 * True if remade: the renderer warms the new variant up, not compiling it mid-frame.
	 */
	setAntiTiled(on: boolean): boolean {
		if (!!this.material.options.antiTiled === on) return false;
		// Its twin, kept (#180): switching back and again releases and compiles nothing.
		this.material = twinOf(this.material);
		if (this.mesh) this.mesh.material = this.material;
		return true;
	}

	/** One repeat of the look across `look.cells` cells, and up in whole steps (#177). */
	private tile(): void {
		const repeat = repeatFor(this.look?.cells ?? 1, this.grid?.cellSize ?? 1, STEP_HEIGHT);
		setParams(this.material, { repeat });
	}

	/** Rebuilds the raised cells. The ground changes rarely, so a full rebuild is fine. */
	sync(grid: SquareGrid, ground: Ground): void {
		this.grid = grid;
		this.tile();
		const levels = ground.levels;
		this.cells = [];
		if (levels) for (let i = 0; i < levels.length; i++) if (levels[i] > 0) this.cells.push(i);
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
		disposeTwins(this.material);
	}
}
