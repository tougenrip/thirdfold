// The cell maps' kept textures (#380, cell-maps.ts): made once at the largest grid's size, and
// each table's maps packed at its own size and copied into a corner of them.

import type * as THREE from 'three/webgpu';
import type { SquareGrid } from '$lib/game/grid';

/**
 * The maps' side, in cells (#380): scene-file.ts's `GRID_LIMITS.maxCells`, as GridLights' lists
 * (materials/grid-light-node.ts). The textures are made once at this size and never replaced while
 * their renderer lives: a material without nodes of its own (a `MeshBasicMaterial`, whose graph
 * reads the maps through the scene pass's `hidden` output) never rebinds a swapped texture, so
 * replacing them destroyed a texture its bind group still held ("Destroyed texture used in a
 * submit" on WebGPU).
 */
export const MAP_SIDE = 100;

/**
 * A map's CPU side at the grid's own size: the channels pack into `image.data`, and marking it
 * for update copies its rows into the kept texture's (row y at `y * MAP_SIDE`).
 */
export class Staged {
	readonly image: { data: Uint8Array };

	constructor(
		private readonly grid: SquareGrid,
		private readonly into: THREE.DataTexture,
		fill: number
	) {
		this.image = { data: new Uint8Array(grid.width * grid.height * 4).fill(fill) };
		this.needsUpdate = true;
	}

	set needsUpdate(_: boolean) {
		const [from, out] = [this.image.data, this.into.image.data as Uint8Array];
		const row = this.grid.width * 4;
		for (let y = 0; y < this.grid.height; y++)
			out.set(from.subarray(y * row, y * row + row), y * MAP_SIDE * 4);
		this.into.needsUpdate = true;
	}
}
