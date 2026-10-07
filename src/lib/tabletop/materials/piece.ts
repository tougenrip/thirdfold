// A kit piece's InstancedMesh (M70): the walls', the door leaves' and the window panes' pools
// (piece-pool.ts) and their stand-ins in the warm-up gallery are all made here, so they are one
// program per material. WebGPU draws a BatchedMesh one call per instance, an InstancedMesh one per
// mesh (#264). Each instance has three's instance colour (its shade) and a tint whose w is its
// highlight (the `piece` variant, kinds.ts).

import * as THREE from 'three/webgpu';
import { TINT_ATTRIBUTE } from './kinds';

/**
 * The fewest instances a piece mesh holds. r186 reads up to 64 KiB of instance matrices (1,024)
 * as a uniform array whose length is in the shader; past that, as a vertex attribute. Every piece
 * mesh holds more, so all of a material's are one program at any size: a pool may be made, or
 * made again larger, compiling nothing.
 */
export const PIECE_MIN = 1025;

/** A piece mesh of `geometry` (taken, its tint added) holding `capacity` instances, none drawn. */
export function pieceMesh(
	geometry: THREE.BufferGeometry,
	material: THREE.Material,
	capacity = PIECE_MIN
): THREE.InstancedMesh {
	const n = Math.max(capacity, PIECE_MIN);
	geometry.setAttribute(
		TINT_ATTRIBUTE,
		new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4)
	);
	const mesh = new THREE.InstancedMesh(geometry, material, n);
	mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
	mesh.castShadow = mesh.receiveShadow = true;
	mesh.count = 0;
	return mesh;
}
