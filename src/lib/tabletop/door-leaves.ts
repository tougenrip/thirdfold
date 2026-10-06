// Door leaves (#253): every door's leaf, the kit's `door.leaf` or the built-in brown one, in a pool
// of their own (piece-pool.ts, M70: an InstancedMesh per leaf variant, made with the kit) in the
// kit pieces' material (vertex colours, or the leaf's sheet), so a table's doors cost a draw per
// variant and no material of their own. Each leaf turns about its own end at the door's first
// corner: its matrix is the edge's frame (#250's pivot, as the walls') times the hinge's turn. A
// swing takes DOOR_SWING_MS a quarter turn on the layer's clock and snaps under reduced motion;
// only swinging leaves are rewritten. Picks hit the leaves themselves (on PICK_LAYER) and map an
// instance to its door; hover is the walls' hatched glow.

import * as THREE from 'three/webgpu';
import { tagged } from './perf';
import { cornerToWorld, type GridPos, type SquareGrid } from '$lib/game/grid';
import type { KindMaterial } from './materials';
import { pickable } from './picking';
import { PiecePool, putPiece, setHot, showPieces } from './piece-pool';
import type { PieceMesh } from './world/wall-batch';

const DOOR_SWING_MS = 260;
const OPEN = Math.PI / 2;

/** One door's leaf as the walls resolve it from the kit. */
export interface LeafSpec {
	id: string;
	/** `pieceKey` of the leaf drawn, and its mesh. */
	key: number;
	mesh: PieceMesh;
	/** The door's first corner (its hinge) and whether it runs south (else east) from there. */
	at: GridPos;
	vertical: boolean;
	/** The higher floor beside it (world height). */
	floor: number;
	open: boolean;
	seed: number;
}

interface Leaf {
	key: number;
	/** Its instance in its key's mesh. */
	slot: number;
	/** What it was placed from: a change places it again. */
	sig: string;
	seed: number;
	/** The edge's frame times the move to its hinge, and the move back (kit units). */
	frame: THREE.Matrix4;
	back: THREE.Matrix4;
	angle: number;
	target: number;
	from: number;
	start: number;
}

const turn = new THREE.Matrix4();
const m = new THREE.Matrix4();
const up = new THREE.Vector3(0, 1, 0);

export class DoorLeaves {
	private readonly pool: PiecePool;
	private leaves = new Map<string, Leaf>();
	private reduced = false;
	private hovered: string | null = null;

	constructor(
		group: THREE.Group,
		private readonly clock: () => number
	) {
		const leaves = tagged(new THREE.Group(), 'doors');
		group.add(leaves);
		this.pool = new PiecePool(leaves, (mesh) => void pickable(mesh));
	}

	/** The kit's leaves (or the built-in one), by piece key: a mesh each, every leaf placed again. */
	make(pieces: ReadonlyMap<number, PieceMesh>, material: KindMaterial): void {
		const list = [...pieces].map(([key, mesh]) => [key, { mesh, material }] as const);
		this.pool.make(new Map(list));
		this.leaves.clear();
	}

	/** The kit pieces' material (a twin after an anti-tiling switch). */
	setMaterial(material: KindMaterial): void {
		this.pool.setMaterial(() => material);
	}

	setReducedMotion(reduced: boolean): void {
		this.reduced = reduced;
	}

	/** Places every door's leaf, swinging those whose state changed. */
	sync(specs: readonly LeafSpec[], grid: SquareGrid): void {
		const seen = new Set<string>();
		for (const s of specs) {
			seen.add(s.id);
			const sig = `${s.key}:${+s.vertical}:${s.at.x}:${s.at.y}:${s.floor}:${grid.cellSize}`;
			let leaf = this.leaves.get(s.id);
			if (!leaf || leaf.sig !== sig) leaf = this.place(s, sig, grid);
			const target = s.open ? OPEN : 0;
			if (target === leaf.target) continue;
			leaf.from = leaf.angle;
			leaf.start = this.clock();
			leaf.target = target;
		}
		for (const id of [...this.leaves.keys()]) if (!seen.has(id)) this.leaves.delete(id);
		this.pack();
		if (this.reduced) this.tick(this.clock());
	}

	/** Swings leaves to where they are at `now`. True while any still moves. */
	tick(now: number): boolean {
		let moving = false;
		const moved = new Set<THREE.InstancedMesh>();
		for (const leaf of this.leaves.values()) {
			if (leaf.angle === leaf.target) continue;
			// A quarter turn takes DOOR_SWING_MS; a swing reversed halfway takes what is left.
			const span = leaf.target - leaf.from;
			const k = this.reduced
				? 1
				: Math.min((now - leaf.start) / ((DOOR_SWING_MS * Math.abs(span)) / OPEN), 1);
			leaf.angle = k >= 1 ? leaf.target : leaf.from + span * k;
			const mesh = this.pose(leaf);
			if (mesh) moved.add(mesh);
			if (leaf.angle !== leaf.target) moving = true;
		}
		for (const mesh of moved) {
			mesh.instanceMatrix.needsUpdate = true;
			mesh.computeBoundingSphere();
		}
		return moving;
	}

	/** The door a pick on a leaf hit. */
	owner(object: THREE.Object3D, instanceId: number | undefined): string | null {
		const owners = (object as THREE.InstancedMesh).userData.owners as string[] | undefined;
		return instanceId === undefined ? null : (owners?.[instanceId] ?? null);
	}

	/** Lights one door's leaf (null: none). */
	setHovered(id: string | null): void {
		this.hovered = id;
		for (const [door, leaf] of this.leaves) {
			const mesh = this.pool.meshes.get(leaf.key);
			if (mesh) setHot(mesh, leaf.slot, door === id);
		}
	}

	/** Its leaves' angles, for tests. */
	angles(): Map<string, number> {
		return new Map([...this.leaves].map(([id, l]) => [id, l.angle]));
	}

	dispose(): void {
		this.pool.dispose();
		this.leaves.clear();
	}

	/** Every leaf in a slot of its key's mesh, in place; the meshes drawing just those. */
	private pack(): void {
		const counts = new Map<number, number>();
		for (const leaf of this.leaves.values()) counts.set(leaf.key, (counts.get(leaf.key) ?? 0) + 1);
		const filled = new Map<number, number>();
		for (const [id, leaf] of this.leaves) {
			const mesh = this.pool.reserve(leaf.key, counts.get(leaf.key)!);
			if (!mesh) continue;
			leaf.slot = filled.get(leaf.key) ?? 0;
			filled.set(leaf.key, leaf.slot + 1);
			((mesh.userData.owners ??= []) as string[])[leaf.slot] = id;
			putPiece(mesh, leaf.slot, this.matrixOf(leaf).elements, 0, leaf.seed, id === this.hovered);
		}
		for (const [key, mesh] of this.pool.meshes) showPieces(mesh, filled.get(key) ?? 0);
	}

	private place(s: LeafSpec, sig: string, grid: SquareGrid): Leaf {
		// The edge's frame: its midpoint on the floor, turned so +x runs from the hinge (east: 0,
		// south: 3 quarter turns), scaled by the cell; then the leaf's own end to the origin.
		const cs = grid.cellSize;
		const c = cornerToWorld(grid, s.at);
		const mid = new THREE.Vector3(
			c.x + (s.vertical ? 0 : cs / 2),
			s.floor,
			c.z + (s.vertical ? cs / 2 : 0)
		);
		const q = new THREE.Quaternion().setFromAxisAngle(up, s.vertical ? (3 * Math.PI) / 2 : 0);
		const hinge = hingeOf(s.mesh);
		const frame = new THREE.Matrix4()
			.compose(mid, q, new THREE.Vector3(cs, cs, cs))
			.multiply(new THREE.Matrix4().makeTranslation(hinge, 0, 0));
		const back = new THREE.Matrix4().makeTranslation(-hinge, 0, 0);
		const angle = s.open ? OPEN : 0;
		const leaf: Leaf = {
			key: s.key,
			slot: 0,
			sig,
			seed: s.seed,
			frame,
			back,
			angle,
			target: angle,
			from: angle,
			start: 0
		};
		this.leaves.set(s.id, leaf);
		return leaf;
	}

	/** The leaf's matrix: its frame, turned about the hinge by its angle (open toward +z). */
	private matrixOf(leaf: Leaf): THREE.Matrix4 {
		turn.makeRotationY(-leaf.angle);
		return m.copy(leaf.frame).multiply(turn).multiply(leaf.back);
	}

	/** Writes a leaf's matrix into its slot; its mesh. */
	private pose(leaf: Leaf): THREE.InstancedMesh | undefined {
		const mesh = this.pool.meshes.get(leaf.key);
		mesh?.setMatrixAt(leaf.slot, this.matrixOf(leaf));
		return mesh;
	}
}

/** Where a leaf turns: its end toward -x, in kit units (it is drawn shut, #250). */
export function hingeOf(leaf: PieceMesh): number {
	let min = Infinity;
	for (let i = 0; i < leaf.positions.length; i += 3) min = Math.min(min, leaf.positions[i]);
	return min;
}
