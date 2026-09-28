// Painted floors' per-cell texture: one texel per cell (like the fog overlay),
// which the grid lines read (overlay.ts) to leave the void unlined. Since #172
// the table's surface draws the floors itself from the ground map (the terrain
// kind, materials/hooks.ts `groundColour`), so the plane that drew them here is
// never shown; #173 deletes it with the fog and darkness overlays.

import * as THREE from 'three/webgpu';
import { FLOOR_IDS, type FloorMap } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import { FLOOR_LOOKS } from './floor-looks';

const BYTES = FLOOR_IDS.map((id) => {
	const { color, alpha } = FLOOR_LOOKS[id];
	return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff, alpha];
});

export class FloorLayer {
	readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
	private texture: THREE.DataTexture | null = null;
	private size = { width: 0, height: 0 };

	constructor() {
		this.mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(1, 1),
			new THREE.MeshStandardMaterial({
				transparent: true,
				depthWrite: false,
				roughness: 1,
				polygonOffset: true,
				polygonOffsetFactor: -1,
				polygonOffsetUnits: -1
			})
		);
		// On the table, under the grid lines and every overlay.
		this.mesh.rotation.x = -Math.PI / 2;
		this.mesh.position.y = 0.002;
		this.mesh.renderOrder = 0.5;
		this.mesh.receiveShadow = true;
		this.mesh.visible = false;
		this.mesh.raycast = () => {};
	}

	update(grid: SquareGrid, floor: FloorMap | null): void {
		const cells = grid.width * grid.height;
		if (!floor || floor.length !== cells) {
			this.painted = false;
			return;
		}
		if (!this.texture || this.size.width !== grid.width || this.size.height !== grid.height) {
			this.texture?.dispose();
			this.texture = new THREE.DataTexture(
				new Uint8Array(cells * 4),
				grid.width,
				grid.height,
				THREE.RGBAFormat
			);
			this.texture.colorSpace = THREE.SRGBColorSpace;
			this.texture.magFilter = THREE.NearestFilter;
			this.texture.minFilter = THREE.NearestFilter;
			this.mesh.material.map = this.texture;
			this.mesh.material.needsUpdate = true;
			this.size = { width: grid.width, height: grid.height };
		}
		this.mesh.scale.set(grid.width * grid.cellSize, grid.height * grid.cellSize, 1);
		const data = this.texture.image.data as Uint8Array;
		for (let i = 0; i < cells; i++) {
			// Texture rows run bottom-up, grid rows top-down (see fog.ts).
			const x = i % grid.width;
			const y = Math.floor(i / grid.width);
			const o = ((grid.height - 1 - y) * grid.width + x) * 4;
			data.set(BYTES[floor[i]] ?? BYTES[0], o);
		}
		this.texture.needsUpdate = true;
		this.painted = true;
	}

	/** Whether a floor is painted: the mask is only handed out then. */
	private painted = false;

	/** The floor's per-cell texture while one is painted (for the grid lines, overlay.ts). */
	get mask(): THREE.DataTexture | null {
		return this.painted ? this.texture : null;
	}

	dispose(): void {
		this.texture?.dispose();
		this.mesh.geometry.dispose();
		this.mesh.material.dispose();
	}
}
