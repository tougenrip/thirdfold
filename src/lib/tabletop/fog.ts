// Fog of war overlay: one plane over the grid, coloured by a texture with one
// texel per cell. Updating visibility rewrites a few hundred bytes of texture;
// nothing is rebuilt. Presentation only: the server already withholds hidden
// tokens and walls from players, this just darkens the floor to match.

import * as THREE from 'three';
import type { SquareGrid } from '$lib/game/grid';
import { decodeMask, type FogView } from '$lib/game/visibility';

/** Players see darkness; the GM sees a light tint marking what the party cannot see. */
export type FogMode = 'player' | 'gm';

const ALPHA = {
	player: { hidden: 255, explored: 150 },
	gm: { hidden: 110, explored: 55 }
} as const;
const SHADE = [11, 9, 8];

export class FogLayer {
	readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
	private texture: THREE.DataTexture | null = null;
	private grid: SquareGrid | null = null;

	constructor() {
		this.mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(1, 1),
			// Not tone-mapped, so "hidden" stays true black instead of lifting to grey.
			new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false })
		);
		// Drawn after the other transparent floor layers (grid lines), so nothing shows through
		// hidden cells; editor feedback is drawn later still (see renderer).
		this.mesh.renderOrder = 1;
		this.mesh.rotation.x = -Math.PI / 2;
		// Clear of the grid lines by enough that they can't z-fight through at grazing camera
		// angles; below the hover highlight.
		this.mesh.position.y = 0.03;
		this.mesh.visible = false;
		this.mesh.raycast = () => {};
	}

	update(grid: SquareGrid, fog: FogView | null, mode: FogMode): void {
		if (!fog?.enabled) {
			this.mesh.visible = false;
			return;
		}
		const size = grid.width * grid.height;
		if (
			!this.texture ||
			!this.grid ||
			this.grid.width !== grid.width ||
			this.grid.height !== grid.height
		) {
			this.texture?.dispose();
			this.texture = new THREE.DataTexture(
				new Uint8Array(size * 4),
				grid.width,
				grid.height,
				THREE.RGBAFormat
			);
			// The shade bytes are sRGB; without this they are read as linear and lift to grey.
			this.texture.colorSpace = THREE.SRGBColorSpace;
			this.texture.magFilter = THREE.NearestFilter;
			this.texture.minFilter = THREE.NearestFilter;
			this.mesh.material.map = this.texture;
			this.mesh.material.needsUpdate = true;
		}
		this.grid = { ...grid };
		this.mesh.scale.set(grid.width * grid.cellSize, grid.height * grid.cellSize, 1);

		const visible = decodeMask(fog.visible, size);
		const explored = decodeMask(fog.explored, size);
		const alpha = ALPHA[mode];
		const data = this.texture.image.data as Uint8Array;
		for (let i = 0; i < size; i++) {
			// DataTexture row 0 is at the bottom (v = 0) of the plane, which after rotating
			// the plane flat is its +z edge; grid row 0 is at −z, so flip rows.
			const x = i % grid.width;
			const y = Math.floor(i / grid.width);
			const o = ((grid.height - 1 - y) * grid.width + x) * 4;
			data[o] = SHADE[0];
			data[o + 1] = SHADE[1];
			data[o + 2] = SHADE[2];
			data[o + 3] = visible[i] ? 0 : explored[i] ? alpha.explored : alpha.hidden;
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
