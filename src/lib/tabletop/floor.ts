// Painted floors: one plane over the table, coloured by a texture with one
// texel per cell (like the fog overlay), so painting a floor rewrites a few
// hundred bytes and a large map is still one draw call. Plain cells are
// transparent (the table's own surface shows); cells off the map are a dark
// void. Lit like the table, so light and darkness fall on floors too.

import * as THREE from 'three';
import { FLOOR_IDS, type FloorId, type FloorMap } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';

/** Each floor's colour (sRGB) and how much of the table it covers. */
export const FLOOR_LOOKS: Record<FloorId, { color: number; alpha: number }> = {
	plain: { color: 0x000000, alpha: 0 },
	stone: { color: 0x8a8578, alpha: 235 },
	wood: { color: 0x8b5e34, alpha: 235 },
	grass: { color: 0x5b7f3a, alpha: 230 },
	dirt: { color: 0x6e5238, alpha: 230 },
	sand: { color: 0xc8b07a, alpha: 230 },
	water: { color: 0x2f5f86, alpha: 220 },
	void: { color: 0x07080a, alpha: 255 }
};

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
				roughness: 0.95,
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
			this.mesh.visible = false;
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
		this.mesh.visible = true;
	}

	dispose(): void {
		this.texture?.dispose();
		this.mesh.geometry.dispose();
		this.mesh.material.dispose();
	}
}
