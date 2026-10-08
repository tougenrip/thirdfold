// Token bases drawn (#265): every token's base is an instance of one InstancedMesh of the base
// kind (materials/base.ts), so the bases cost one draw a pass however many tokens there are. A
// token holds a slot from when it appears until it goes; a removed token's slot takes the last
// one's (swap-remove), so the drawn instances stay packed. The mesh holds at least `PIECE_MIN`
// (materials/piece.ts: its matrices are then an attribute, not a uniform array sized in the
// shader), so making it, or making it again larger, compiles nothing. Each instance's ring (its
// palette colour, shape twins, glow and see-through) is its `aTint` (base.ts), worked out here
// from the rings (`ringsFor`, from what the viewer was sent), the hover, the selection and whose
// turn it is: the turn's ring pulses on AMBIENT frames (`pulsing`), steady under reduced motion.
//
// Large creatures (#270) stand on larger bases: one InstancedMesh per base size in use (`BASE_SIZES`,
// at most four, a constant), each lathed from the profile at its diameter (`profileFor`) so the
// bevel, lip and ring keep their widths, all on the one material: a base changing size moves to the
// other mesh's slots, a matrix and a tint, and compiles nothing.

import * as THREE from 'three/webgpu';
import { NEUTRAL_RING, profileFor, ringEmission, SMALL_BASE, type Ring } from './bases';
import { createMaterial, PIECE_MIN, setParams, setSlot } from './materials';
import { BASE_ATTRIBUTE } from './materials/base';
import { tagged } from './perf';
import { pickable } from './picking';

/** Segments round a base: enough that its rim reads round at a close pose. */
const SEGMENTS = 48;
/** The disc's colour under the environment's surface, and without one (slate). */
const UNDER_SURFACE = 0xffffff;
const SLATE = 0x6b6e72;

/** The base's geometry `diameter` across (cell units): the profile lathed round y, its bottom at 0. */
export function baseGeometry(diameter = SMALL_BASE): THREE.BufferGeometry {
	const points = profileFor(diameter).map(([r, y]) => new THREE.Vector2(r, y));
	return new THREE.LatheGeometry(points, SEGMENTS);
}

/** The bases of one size: a mesh, and each slot's token. */
interface Batch {
	readonly diameter: number;
	mesh: THREE.InstancedMesh;
	readonly geometry: THREE.BufferGeometry;
	readonly owners: string[];
}

export class BaseLayer {
	private readonly material = createMaterial('base', { instanced: true });
	/** The bases by diameter (cell units): the small ones' from the start, the others when needed. */
	private readonly batches = new Map<number, Batch>();
	/** Each token's batch and slot in it. */
	private readonly slots = new Map<string, { batch: Batch; slot: number }>();
	private readonly matrix = new THREE.Matrix4();
	private readonly scale = new THREE.Vector3();
	private readonly turn = new THREE.Quaternion();
	/** GM-hidden tokens: their bases see-through. */
	private readonly hidden = new Set<string>();
	private rings: ReadonlyMap<string, Ring> = new Map();
	private hovered: string | null = null;
	private selected: string | null = null;
	private active: string | null = null;
	private still = false;
	private now = 0;

	constructor(private readonly group: THREE.Object3D) {
		this.batch(SMALL_BASE);
	}

	/** Every base mesh, one per size in use (#270). */
	get meshes(): THREE.InstancedMesh[] {
		return [...this.batches.values()].map((b) => b.mesh);
	}

	/** The token drawn by instance `index` of `mesh`, if any. */
	owner(mesh: THREE.Object3D, index: number | undefined): string | null {
		if (index === undefined) return null;
		for (const b of this.batches.values()) if (b.mesh === mesh) return b.owners[index] ?? null;
		return null;
	}

	/** `id`'s base diameter in cell units (#270: `baseDiameters`), the small one if it has none. */
	diameter(id: string): number {
		return this.slots.get(id)?.batch.diameter ?? SMALL_BASE;
	}

	/**
	 * Puts `id`'s base at `at` (its floor), `diameter` across in cell units of `cellSize`, see-through
	 * if `hidden`, taking a slot of that size's mesh if it has none (and giving up its old size's).
	 * `commit` once a change of places is done.
	 */
	place(
		id: string,
		at: THREE.Vector3,
		cellSize: number,
		diameter = SMALL_BASE,
		hidden = false
	): void {
		if (hidden) this.hidden.add(id);
		else this.hidden.delete(id);
		const batch = this.batch(diameter);
		let held = this.slots.get(id);
		if (held && held.batch !== batch) {
			this.remove(id);
			held = undefined;
		}
		if (!held) {
			const slot = batch.owners.length;
			if (slot >= batch.mesh.instanceMatrix.count) this.grow(batch, Math.ceil(slot * 1.5));
			batch.owners.push(id);
			held = { batch, slot };
			this.slots.set(id, held);
			batch.mesh.count = batch.owners.length;
			batch.mesh.visible = true;
			this.write(id);
		}
		const { mesh } = batch;
		this.matrix.compose(at, this.turn, this.scale.setScalar(cellSize));
		mesh.setMatrixAt(held.slot, this.matrix);
		mesh.instanceMatrix.addUpdateRange(held.slot * 16, 16);
		mesh.instanceMatrix.needsUpdate = true;
	}

	/** Gives `id`'s slot up: the last slot's token of its size moves into it. */
	remove(id: string): void {
		const held = this.slots.get(id);
		if (!held) return;
		const { batch, slot } = held;
		const { mesh, owners } = batch;
		const last = owners.length - 1;
		if (slot !== last) {
			const moved = owners[last];
			mesh.getMatrixAt(last, this.matrix);
			mesh.setMatrixAt(slot, this.matrix);
			const tint = tints(batch);
			tint.copyAt(slot, tint, last);
			owners[slot] = moved;
			this.slots.set(moved, { batch, slot });
			mesh.instanceMatrix.addUpdateRange(slot * 16, 16);
			tint.addUpdateRange(slot * 4, 4);
			mesh.instanceMatrix.needsUpdate = tint.needsUpdate = true;
		}
		owners.pop();
		this.slots.delete(id);
		this.hidden.delete(id);
		mesh.count = owners.length;
		mesh.visible = shown(batch);
	}

	/** Every token's ring, by id (`ringsFor`); a token without one is neutral. */
	setRings(rings: ReadonlyMap<string, Ring>): boolean {
		this.rings = rings;
		return this.paint();
	}

	setHovered(id: string | null): boolean {
		return this.hovered !== id && ((this.hovered = id), this.paint());
	}

	setSelected(id: string | null): boolean {
		return this.selected !== id && ((this.selected = id), this.paint());
	}

	/** Whose turn it is: that ring pulses. */
	setActive(id: string | null): boolean {
		return this.active !== id && ((this.active = id), this.paint());
	}

	/** Reduced motion: the turn's ring holds steady. */
	setReducedMotion(still: boolean): void {
		this.still = still;
		this.paint();
	}

	/** Whether the turn's ring is pulsing: it asks for AMBIENT frames. */
	get pulsing(): boolean {
		return !this.still && this.active !== null && this.slots.has(this.active);
	}

	/** The pulse at `now` (ms, the tabletop's clock). */
	tick(now: number): void {
		this.now = now;
		if (this.pulsing) this.write(this.active!);
	}

	/** Bounds for culling and the raycaster, and every ring, once a change of places is done. */
	commit(): void {
		for (const b of this.batches.values()) if (b.owners.length) b.mesh.computeBoundingSphere();
		this.paint();
	}

	/** Writes every ring; true if any changed. */
	private paint(): boolean {
		let changed = false;
		for (const id of this.slots.keys()) changed = this.write(id) || changed;
		return changed;
	}

	/** Writes `id`'s ring. Returns true if it changed. */
	private write(id: string): boolean {
		const held = this.slots.get(id);
		if (!held) return false;
		const ring = this.rings.get(id) ?? NEUTRAL_RING;
		const state = { hovered: id === this.hovered, selected: id === this.selected };
		const emission = ringEmission({ ...state, active: id === this.active }, this.now, this.still);
		const values = [
			ring.colour,
			emission,
			(ring.notched ? 1 : 0) + (ring.double ? 2 : 0),
			this.hidden.has(id) ? 1 : 0
		];
		const tint = tints(held.batch);
		const i = held.slot * 4;
		if (values.every((v, k) => Math.fround(v) === tint.array[i + k])) return false;
		tint.array.set(values, i);
		tint.addUpdateRange(i, 4);
		tint.needsUpdate = true;
		return true;
	}

	/** The environment's surface on the discs (#265: `EnvironmentDef.miniBase`), or slate. */
	setTop(map: THREE.Texture | null): void {
		setSlot(this.material, 'albedo', map);
		setParams(this.material, { color: map ? UNDER_SURFACE : SLATE });
	}

	dispose(): void {
		for (const { mesh, geometry } of this.batches.values()) {
			mesh.removeFromParent();
			mesh.dispose();
			geometry.dispose();
		}
		this.batches.clear();
		this.slots.clear();
		this.material.dispose();
	}

	/** The batch of bases `diameter` across, made on first use. */
	private batch(diameter: number): Batch {
		let batch = this.batches.get(diameter);
		if (!batch) {
			const geometry = baseGeometry(diameter);
			batch = { diameter, geometry, owners: [], mesh: null as unknown as THREE.InstancedMesh };
			batch.mesh = this.make(batch, PIECE_MIN);
			this.batches.set(diameter, batch);
		}
		return batch;
	}

	private make(batch: Batch, capacity: number): THREE.InstancedMesh {
		const data = new Float32Array(capacity * 4);
		const was = batch.geometry.getAttribute(BASE_ATTRIBUTE);
		if (was) data.set(was.array as Float32Array);
		batch.geometry.setAttribute(BASE_ATTRIBUTE, new THREE.InstancedBufferAttribute(data, 4));
		const mesh = pickable(new THREE.InstancedMesh(batch.geometry, this.material, capacity));
		mesh.castShadow = mesh.receiveShadow = true;
		mesh.count = batch.owners.length;
		mesh.visible = shown(batch);
		this.group.add(tagged(mesh, 'bases'));
		return mesh;
	}

	/** The same mesh, larger: past `PIECE_MIN` either way, so it is the same program. */
	private grow(batch: Batch, capacity: number): void {
		const old = batch.mesh;
		batch.mesh = this.make(batch, capacity);
		for (let i = 0; i < batch.owners.length; i++) {
			old.getMatrixAt(i, this.matrix);
			batch.mesh.setMatrixAt(i, this.matrix);
		}
		old.removeFromParent();
		old.dispose(); // its instance buffers; the geometry and material go on
	}
}

/**
 * Whether a batch's mesh is drawn: the small bases' always (as since #265, so the warm-up meets
 * it), a larger size's only while a token stands on one, so an empty size costs no draw.
 */
function shown(batch: Batch): boolean {
	return batch.diameter === SMALL_BASE || batch.owners.length > 0;
}

function tints(batch: Batch): THREE.InstancedBufferAttribute {
	return batch.geometry.getAttribute(BASE_ATTRIBUTE) as THREE.InstancedBufferAttribute;
}
