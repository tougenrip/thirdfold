// The table the play area sits on: a slab with a margin and the playing
// surface (the grid lines are in the overlay, overlay.ts). The environment
// dresses the slab and surface; their materials are kept across tables. The
// surface is the terrain kind (#172), so it draws the painted floors from the
// ground map itself; the slab is the surface kind. Both are world-mapped, their
// tile from `repeatFor`, anti-tiled on medium and up (#181).

import * as THREE from 'three/webgpu';
import type { SquareGrid } from '$lib/game/grid';
import { wear, type EnvironmentLook } from './environment';
import { STEP_HEIGHT } from './ground';
import {
	createMaterial,
	disposeTwins,
	repeatFor,
	setParams,
	twinOf,
	type KindMaterial
} from './materials';

export const TABLE_MARGIN = 3;
const TABLE_THICKNESS = 0.6;

const PLAIN = {
	table: { color: 0x5a3b24, roughness: 0.7 },
	surface: { color: 0x2f4a3a, roughness: 1 }
};

export class TableLayer {
	readonly group = new THREE.Group();
	private slabMaterial: KindMaterial = createMaterial('surface', { antiTiled: true });
	private surfaceMaterial: KindMaterial = createMaterial('terrain', { antiTiled: true });
	private slab: THREE.Mesh | null = null;
	private surface: THREE.Mesh | null = null;

	/** Builds the table for a grid. Returns its extent: the size across, margin included. */
	build(g: SquareGrid): number {
		this.clear();
		const w = g.width * g.cellSize;
		const d = g.height * g.cellSize;

		const slab = new THREE.Mesh(
			new THREE.BoxGeometry(w + TABLE_MARGIN * 2, TABLE_THICKNESS, d + TABLE_MARGIN * 2),
			this.slabMaterial
		);
		slab.position.y = -TABLE_THICKNESS / 2 - 0.01;
		slab.receiveShadow = true;

		const surface = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.surfaceMaterial);
		surface.rotation.x = -Math.PI / 2;
		surface.receiveShadow = true;

		this.group.add(slab, surface);
		[this.slab, this.surface] = [slab, surface];
		return Math.max(w, d) + TABLE_MARGIN * 2;
	}

	/** Dresses the slab and surface in the environment's looks, or the plain ones. */
	dress(look: EnvironmentLook | null, grid: SquareGrid | null): void {
		const cellSize = grid?.cellSize ?? 1;
		wear(this.surfaceMaterial, look?.surface ?? null, PLAIN.surface);
		wear(this.slabMaterial, look?.table ?? null, PLAIN.table);
		const tile = (cells: number) => ({ repeat: repeatFor(cells, cellSize, STEP_HEIGHT) });
		setParams(this.surfaceMaterial, tile(look?.surface.cells ?? 1));
		// The rim's look was drawn a repeat per two world units.
		setParams(this.slabMaterial, tile((look?.table.cells ?? 1) * (2 / cellSize)));
	}

	/**
	 * The tier's anti-tiling (#181): the materials made again in that variant, once.
	 * True if remade: the renderer warms the new variant up, not compiling it mid-frame.
	 */
	setAntiTiled(on: boolean): boolean {
		if (!!this.surfaceMaterial.options.antiTiled === on) return false;
		// Their twins, kept (#180): switching back releases nothing and the warm-up compiled them.
		this.slabMaterial = twinOf(this.slabMaterial);
		this.surfaceMaterial = twinOf(this.surfaceMaterial);
		if (this.slab) this.slab.material = this.slabMaterial;
		if (this.surface) this.surface.material = this.surfaceMaterial;
		return true;
	}

	/** Disposes what the last table built, keeping the shared materials. */
	private clear(): void {
		for (const child of [...this.group.children]) {
			if (child instanceof THREE.Mesh) child.geometry.dispose();
			this.group.remove(child);
		}
		this.slab = this.surface = null;
	}

	dispose(): void {
		this.clear();
		disposeTwins(this.slabMaterial);
		disposeTwins(this.surfaceMaterial);
	}
}
