// The walls' BatchedMeshes (#252) and the door leaves' (#253): a batch made with its colours from
// the start, pieces added once per key with space grown as needed, and each instance's colour (a
// slight shade by its seed, alpha 0 when highlighted: the surface kind's `batched` variant).

import * as THREE from 'three/webgpu';
import type { KindMaterial } from './materials';
import type { PieceMesh } from './world/wall-batch';

/** How far a piece's seed darkens it: a slight variation from piece to piece. */
const TINT = 0.06;

/** One batch: its mesh, the geometry id of each piece key, each instance's edge, its space. */
export interface Batch {
	mesh: THREE.BatchedMesh;
	geometries: Map<number, number>;
	ids: number[];
	edges: Int32Array;
	/** Its vertex and index space. */
	space: [number, number];
}

export function newBatch(material: KindMaterial): Batch {
	const mesh = new THREE.BatchedMesh(64, 1024, 2048, material);
	// The colours exist from the start: a batch without them is another program (#252).
	(mesh as unknown as { _initColorsTexture(): void })._initColorsTexture();
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	const edges = new Int32Array(64).fill(-1);
	return { mesh, geometries: new Map(), ids: [], edges, space: [1024, 2048] };
}

/** A piece's geometry in a batch under `key`, its space grown by half again what it needs. */
export function addPiece(b: Batch, key: number, piece: PieceMesh): number {
	const geometry = geometryOf(piece);
	const [v, i] = [piece.positions.length / 3, piece.indices.length];
	const { mesh } = b;
	if (mesh.unusedVertexCount < v || mesh.unusedIndexCount < i) {
		const [vs, is] = b.space;
		b.space = [
			Math.ceil((vs - mesh.unusedVertexCount + v) * 1.5),
			Math.ceil((is - mesh.unusedIndexCount + i) * 1.5)
		];
		mesh.setGeometrySize(...b.space);
	}
	const id = mesh.addGeometry(geometry);
	b.geometries.set(key, id);
	geometry.dispose();
	return id;
}

const tint = new THREE.Vector4();
/** A piece's colour: a slight shade by its seed; alpha 0 when highlighted (`batched`). */
export function colourOf(seed: number, hot: boolean): THREE.Vector4 {
	const shade = 1 - TINT * (seed / 0x100000000);
	return tint.set(shade, shade, shade, hot ? 0 : 1);
}

/** A piece as a geometry a batch takes: positions, normals, triangles and any colours. */
export function geometryOf(piece: PieceMesh): THREE.BufferGeometry {
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(piece.positions, 3));
	g.setAttribute('normal', new THREE.BufferAttribute(piece.normals, 3));
	if (piece.colors) g.setAttribute('color', new THREE.BufferAttribute(piece.colors, 3));
	g.setIndex(new THREE.BufferAttribute(piece.indices, 1));
	return g;
}
