// Door leaves (#253): every door's leaf, the kit's `door.leaf` or the built-in brown one, in one
// BatchedMesh in the kit pieces' material (vertex colours), so a table's doors cost one batch and
// no material of their own. Each leaf turns about its own end at the door's first corner: its
// matrix is the edge's frame (#250's pivot, as the walls') times the hinge's turn. A swing takes
// DOOR_SWING_MS a quarter turn on the layer's clock and snaps under reduced motion; only swinging
// leaves are rewritten. Picks hit the batch itself (on PICK_LAYER) and map its instance to the
// door; hover is the batch colour's alpha, the walls' hatched glow.

import * as THREE from 'three/webgpu';
import { tagged } from './perf';
import { cornerToWorld, type GridPos, type SquareGrid } from '$lib/game/grid';
import { addPiece, colourOf, newBatch, type Batch } from './batch';
import type { KindMaterial } from './materials';
import { pickable } from './picking';
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
	instance: number;
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
	private batch: Batch | null = null;
	private leaves = new Map<string, Leaf>();
	private owners: string[] = [];
	private reduced = false;
	private hovered: string | null = null;

	constructor(
		private readonly group: THREE.Group,
		private material: KindMaterial,
		private readonly clock: () => number
	) {}

	/** The kit pieces' material (a twin after an anti-tiling switch). */
	setMaterial(material: KindMaterial): void {
		this.material = material;
		if (this.batch) this.batch.mesh.material = material;
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
			if (leaf && leaf.sig !== sig) {
				this.remove(s.id);
				leaf = undefined;
			}
			if (!leaf) leaf = this.place(s, sig, grid);
			const target = s.open ? OPEN : 0;
			if (target === leaf.target) continue;
			leaf.from = leaf.angle;
			leaf.start = this.clock();
			leaf.target = target;
			if (this.reduced) this.tick(leaf.start);
		}
		for (const id of [...this.leaves.keys()]) if (!seen.has(id)) this.remove(id);
		this.setHovered(this.hovered);
		this.batch?.mesh.computeBoundingSphere();
	}

	/** Swings leaves to where they are at `now`. True while any still moves. */
	tick(now: number): boolean {
		let moving = false;
		for (const leaf of this.leaves.values()) {
			if (leaf.angle === leaf.target) continue;
			// A quarter turn takes DOOR_SWING_MS; a swing reversed halfway takes what is left.
			const span = leaf.target - leaf.from;
			const k = this.reduced
				? 1
				: Math.min((now - leaf.start) / ((DOOR_SWING_MS * Math.abs(span)) / OPEN), 1);
			leaf.angle = k >= 1 ? leaf.target : leaf.from + span * k;
			this.pose(leaf);
			if (leaf.angle !== leaf.target) moving = true;
		}
		return moving;
	}

	/** The door a pick on the batch hit. */
	owner(object: THREE.Object3D, batchId: number | undefined): string | null {
		if (!this.batch || object !== this.batch.mesh || batchId === undefined) return null;
		return this.owners[batchId] ?? null;
	}

	/** Lights one door's leaf (null: none). */
	setHovered(id: string | null): void {
		this.hovered = id;
		const b = this.batch;
		if (!b) return;
		for (const [door, leaf] of this.leaves)
			b.mesh.setColorAt(leaf.instance, colourOf(leaf.seed, door === id));
	}

	/** Its leaves' angles, for tests. */
	angles(): Map<string, number> {
		return new Map([...this.leaves].map(([id, l]) => [id, l.angle]));
	}

	dispose(): void {
		if (!this.batch) return;
		this.group.remove(this.batch.mesh);
		this.batch.mesh.dispose();
		this.batch = null;
		this.leaves.clear();
		this.owners = [];
	}

	private place(s: LeafSpec, sig: string, grid: SquareGrid): Leaf {
		if (!this.batch) {
			this.batch = newBatch(this.material);
			tagged(this.batch.mesh, 'doors');
			pickable(this.batch.mesh);
			this.group.add(this.batch.mesh);
		}
		const b = this.batch;
		const geometry = b.geometries.get(s.key) ?? addPiece(b, s.key, s.mesh);
		if (b.mesh.instanceCount >= b.mesh.maxInstanceCount)
			b.mesh.setInstanceCount(Math.ceil(b.mesh.maxInstanceCount * 1.5));
		const instance = b.mesh.addInstance(geometry);
		this.owners[instance] = s.id;
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
			instance,
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
		this.pose(leaf);
		return leaf;
	}

	/** The leaf's matrix: its frame, turned about the hinge by its angle (open toward +z). */
	private pose(leaf: Leaf): void {
		turn.makeRotationY(-leaf.angle);
		this.batch!.mesh.setMatrixAt(
			leaf.instance,
			m.copy(leaf.frame).multiply(turn).multiply(leaf.back)
		);
	}

	private remove(id: string): void {
		const leaf = this.leaves.get(id);
		if (!leaf || !this.batch) return;
		this.batch.mesh.deleteInstance(leaf.instance);
		delete this.owners[leaf.instance];
		this.leaves.delete(id);
	}
}

/** Where a leaf turns: its end toward -x, in kit units (it is drawn shut, #250). */
export function hingeOf(leaf: PieceMesh): number {
	let min = Infinity;
	for (let i = 0; i < leaf.positions.length; i += 3) min = Math.min(min, leaf.positions[i]);
	return min;
}
