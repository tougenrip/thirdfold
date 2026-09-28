// The table the play area sits on: a slab with a margin and the playing
// surface (the grid lines are in the overlay, overlay.ts). The environment
// dresses the slab and surface; their materials are kept across tables.

import * as THREE from 'three/webgpu';
import type { SquareGrid } from '$lib/game/grid';
import { dress, undress, type EnvironmentLook } from './environment';

export const TABLE_MARGIN = 3;
const TABLE_THICKNESS = 0.6;

const COLORS = { table: 0x5a3b24, surface: 0x2f4a3a };

export class TableLayer {
	readonly group = new THREE.Group();
	private slabMaterial = new THREE.MeshStandardMaterial({ roughness: 0.7 });
	private surfaceMaterial = new THREE.MeshStandardMaterial({ roughness: 1 });

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
		return Math.max(w, d) + TABLE_MARGIN * 2;
	}

	/** Dresses the slab and surface in the environment's looks, or the plain ones. */
	dress(look: EnvironmentLook | null, grid: SquareGrid | null, extent: number): void {
		const across = grid ? grid.width : 1;
		const down = grid ? grid.height : 1;
		dress(this.surfaceMaterial, look?.surface ?? null, COLORS.surface, across, down);
		dress(this.slabMaterial, look?.table ?? null, COLORS.table, extent / 2, 1);
	}

	/** Disposes what the last table built, keeping the shared materials. */
	private clear(): void {
		const kept = new Set<THREE.Material>([this.slabMaterial, this.surfaceMaterial]);
		for (const child of [...this.group.children]) {
			child.traverse((o) => {
				if (o instanceof THREE.Mesh) {
					o.geometry.dispose();
					(Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
						if (!kept.has(m)) m.dispose();
					});
				}
			});
			this.group.remove(child);
		}
	}

	dispose(): void {
		this.clear();
		undress(this.slabMaterial);
		undress(this.surfaceMaterial);
	}
}
