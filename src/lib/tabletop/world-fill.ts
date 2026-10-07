// A chunk's built mesh into its geometry (world-layer.ts): the world layer's one upload path.

import * as THREE from 'three/webgpu';
import { NO_DROP } from './drop-in';
import { withDrops } from './materials';
import type { CliffMesh } from './world/cliffs';
import type { GroundMesh } from './world/ground-mesh';

/** The geometry a mesh with nothing to draw holds (shared, never disposed). */
export const EMPTY = new THREE.BufferGeometry();

/**
 * Puts a built mesh in a chunk's geometry: positions, normals, a face's shades (vertex colours),
 * each vertex's drop start (its owner cell's, #249, `starts`; none for the void's floor) and
 * triangles, and for the void's floor the world uv the backdrop's skirt has (`uv`: the same
 * attributes, so the same program); hidden when empty.
 */
export function fill(
	mesh: THREE.Mesh,
	data: GroundMesh | CliffMesh,
	starts: Float32Array | null,
	uv = false,
	beds?: Float32Array
): void {
	if (mesh.geometry !== EMPTY) mesh.geometry.dispose();
	mesh.visible = data.indices.length > 0;
	if (!mesh.visible) {
		mesh.geometry = EMPTY;
		return;
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
	g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
	if ('colors' in data) g.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
	if (uv) {
		const p = data.positions;
		const uvs = new Float32Array((p.length / 3) * 2);
		for (let v = 0; v < uvs.length / 2; v++) uvs.set([p[v * 3], -p[v * 3 + 2]], v * 2);
		g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
	}
	if (starts)
		withDrops(
			g,
			Float32Array.from(data.owners, (o) => starts[o] ?? NO_DROP),
			beds
		);
	g.setIndex(new THREE.BufferAttribute(data.indices, 1));
	g.computeBoundingSphere();
	mesh.geometry = g;
}
