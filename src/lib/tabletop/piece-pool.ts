// Kit pieces drawn (M70, #264): a table-wide InstancedMesh per piece key of the kit, so a frame
// draws each piece once a pass whatever the table's size (on WebGPU a BatchedMesh drew every
// instance on its own: 608 to 1,896 draws). The walls (walls.ts), the door leaves (door-leaves.ts)
// and the window panes (window-glass.ts) fill their pools; a key's mesh is made the first time it
// has instances and kept (hidden when it has none) until another kit. Every mesh is pool-shaped
// (materials/piece.ts), so making one, or one larger when a key outgrows it, compiles nothing. Each instance's shade is its seed's, and its tint's w
// the hatched highlight (the `piece` variant).

import * as THREE from 'three/webgpu';
import { pieceMesh, TINT_ATTRIBUTE, type KindMaterial } from './materials';
import type { PieceMesh } from './world/wall-batch';

/** How far a piece's seed darkens it: a slight variation from piece to piece. */
const TINT = 0.06;

/** A piece of the pool: its geometry and material. */
export interface PoolPiece {
	mesh: PieceMesh;
	material: KindMaterial;
}

export class PiecePool {
	readonly meshes = new Map<number, THREE.InstancedMesh>();
	/** What each key draws, its mesh made the first time it has instances. */
	private pieces: ReadonlyMap<number, PoolPiece> = new Map();

	/** `prepare` dresses each mesh made (a perf tag, the pick layer). */
	constructor(
		private readonly group: THREE.Object3D,
		private readonly prepare: (mesh: THREE.InstancedMesh) => void = () => {}
	) {}

	/** The pieces of a kit, by key: every earlier mesh gone. */
	make(pieces: ReadonlyMap<number, PoolPiece>): void {
		this.clear();
		this.pieces = new Map(pieces);
	}

	/**
	 * Key's mesh holding at least `n`: made when first needed, or again larger (both compile
	 * nothing, piece.ts); none for a key with no instances yet or no piece.
	 */
	reserve(key: number, n: number): THREE.InstancedMesh | undefined {
		const m = this.meshes.get(key);
		const p = this.pieces.get(key);
		if (!m) return n > 0 && p ? this.add(key, geometryOf(p.mesh), p.material, n) : undefined;
		if (n <= m.instanceMatrix.count) return m;
		this.free(m);
		return this.add(key, m.geometry.clone(), m.material as KindMaterial, n);
	}

	/** Every mesh's material by its key (an anti-tiling twin). */
	setMaterial(of: (key: number) => KindMaterial): void {
		const pieces = [...this.pieces].map(([key, p]) => [key, { ...p, material: of(key) }] as const);
		this.pieces = new Map(pieces);
		for (const [key, m] of this.meshes) m.material = of(key);
	}

	dispose(): void {
		this.clear();
	}

	private add(key: number, geometry: THREE.BufferGeometry, material: KindMaterial, n: number) {
		const mesh = pieceMesh(geometry, material, Math.ceil(n * 1.5));
		mesh.visible = false;
		mesh.userData.edges = new Int32Array(mesh.instanceMatrix.count).fill(-1);
		this.prepare(mesh);
		this.meshes.set(key, mesh);
		this.group.add(mesh);
		return mesh;
	}

	private clear(): void {
		for (const m of this.meshes.values()) this.free(m);
		this.meshes.clear();
	}

	private free(m: THREE.InstancedMesh): void {
		this.group.remove(m);
		m.geometry.dispose();
		m.dispose();
	}
}

/** Instance `i`: its matrix (column-major, at `offset` of `matrices`), its seed's shade, lit or not. */
export function putPiece(
	mesh: THREE.InstancedMesh,
	i: number,
	matrices: ArrayLike<number>,
	offset: number,
	seed: number,
	hot: boolean
): void {
	const m = mesh.instanceMatrix.array as Float32Array;
	for (let k = 0; k < 16; k++) m[i * 16 + k] = matrices[offset + k];
	const shade = 1 - TINT * (seed / 0x100000000);
	mesh.instanceColor!.setXYZ(i, shade, shade, shade);
	setHot(mesh, i, hot);
}

/** Lights instance `i` with the hatched glow, or not. */
export function setHot(mesh: THREE.InstancedMesh, i: number, hot: boolean): void {
	const tint = mesh.geometry.getAttribute(TINT_ATTRIBUTE) as THREE.InstancedBufferAttribute;
	tint.setW(i, hot ? 1 : 0);
	tint.needsUpdate = true;
}

/** Draws the first `n` instances (none: hidden), uploading what was written. */
export function showPieces(mesh: THREE.InstancedMesh, n: number): void {
	mesh.count = n;
	mesh.visible = n > 0;
	mesh.instanceMatrix.needsUpdate = true;
	mesh.instanceColor!.needsUpdate = true;
	(mesh.geometry.getAttribute(TINT_ATTRIBUTE) as THREE.InstancedBufferAttribute).needsUpdate = true;
	if (n) mesh.computeBoundingSphere();
}

/** A piece as a geometry: positions, normals, triangles and any colours and UVs. */
export function geometryOf(piece: PieceMesh): THREE.BufferGeometry {
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(piece.positions, 3));
	g.setAttribute('normal', new THREE.BufferAttribute(piece.normals, 3));
	if (piece.colors) g.setAttribute('color', new THREE.BufferAttribute(piece.colors, 3));
	if (piece.uvs) g.setAttribute('uv', new THREE.BufferAttribute(piece.uvs, 2)); // a sheet's (M70)
	g.setIndex(new THREE.BufferAttribute(piece.indices, 1));
	return g;
}
