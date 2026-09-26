// The table the play area sits on: a slab with a margin, the playing surface
// and the grid lines (one draw call however large the grid). The environment
// dresses the slab and surface; their materials are kept across tables.

import * as THREE from 'three';
import type { SquareGrid } from '$lib/game/grid';
import { dress, type EnvironmentLook } from './environment';

export const TABLE_MARGIN = 3;
const TABLE_THICKNESS = 0.6;

const COLORS = { table: 0x5a3b24, surface: 0x2f4a3a, gridLine: 0xd8cfb4 };

export class TableLayer {
	readonly group = new THREE.Group();
	private slabMaterial = new THREE.MeshStandardMaterial({ roughness: 0.7 });
	private surfaceMaterial = new THREE.MeshStandardMaterial({ roughness: 0.95 });

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

		// All grid lines share one geometry: a single draw call however large the grid.
		const points: number[] = [];
		for (let i = 0; i <= g.width; i++) {
			const x = -w / 2 + i * g.cellSize;
			points.push(x, 0, -d / 2, x, 0, d / 2);
		}
		for (let j = 0; j <= g.height; j++) {
			const z = -d / 2 + j * g.cellSize;
			points.push(-w / 2, 0, z, w / 2, 0, z);
		}
		const lineGeometry = new THREE.BufferGeometry();
		lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
		const lines = new THREE.LineSegments(
			lineGeometry,
			new THREE.LineBasicMaterial({ color: COLORS.gridLine, transparent: true, opacity: 0.35 })
		);
		lines.position.y = 0.005;

		this.group.add(slab, surface, lines);
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
				if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
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
		this.slabMaterial.map?.dispose();
		this.surfaceMaterial.map?.dispose();
		this.slabMaterial.dispose();
		this.surfaceMaterial.dispose();
	}
}
