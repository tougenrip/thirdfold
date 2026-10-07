// Token bases drawn (#265): every token's base is an instance of one InstancedMesh of the base
// kind (materials/base.ts), so the bases cost one draw a pass however many tokens there are. A
// token holds a slot from when it appears until it goes; a removed token's slot takes the last
// one's (swap-remove), so the drawn instances stay packed. The mesh holds at least `PIECE_MIN`
// (materials/piece.ts: its matrices are then an attribute, not a uniform array sized in the
// shader), so making it, or making it again larger, compiles nothing. Each instance's ring (its
// palette colour, shape twins, glow and see-through) is its `aTint` (base.ts), worked out here
// from the rings (`ringsFor`, from what the viewer was sent), the hover, the selection and whose
// turn it is: the turn's ring pulses on AMBIENT frames (`pulsing`), steady under reduced motion.

import * as THREE from 'three/webgpu';
import { BASE_PROFILE, NEUTRAL_RING, ringEmission, type Ring } from './bases';
import { createMaterial, PIECE_MIN, setParams, setSlot } from './materials';
import { BASE_ATTRIBUTE } from './materials/base';
import { tagged } from './perf';
import { pickable } from './picking';

/** Segments round a base: enough that its rim reads round at a close pose. */
const SEGMENTS = 48;
/** The disc's colour under the environment's surface, and without one (slate). */
const UNDER_SURFACE = 0xffffff;
const SLATE = 0x6b6e72;

/** The base's geometry: the profile lathed round y, its bottom at 0. */
export function baseGeometry(): THREE.BufferGeometry {
	const points = BASE_PROFILE.map(([r, y]) => new THREE.Vector2(r, y));
	return new THREE.LatheGeometry(points, SEGMENTS);
}

export class BaseLayer {
	mesh: THREE.InstancedMesh;
	private readonly material = createMaterial('base', { instanced: true });
	private readonly geometry = baseGeometry();
	/** Each slot's token, and each token's slot. */
	private owners: string[] = [];
	private readonly slots = new Map<string, number>();
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
		this.mesh = this.make(PIECE_MIN);
	}

	/** The token drawn by instance `index`, if any. */
	owner(index: number | undefined): string | null {
		return index === undefined ? null : (this.owners[index] ?? null);
	}

	/**
	 * Puts `id`'s base at `at` (its floor), `size` across a cell, see-through if `hidden`, taking
	 * a slot if it has none. `commit` once a change of places is done.
	 */
	place(id: string, at: THREE.Vector3, size: number, hidden = false): void {
		if (hidden) this.hidden.add(id);
		else this.hidden.delete(id);
		let slot = this.slots.get(id);
		if (slot === undefined) {
			slot = this.owners.length;
			if (slot >= this.mesh.instanceMatrix.count) this.grow(Math.ceil(slot * 1.5));
			this.owners.push(id);
			this.slots.set(id, slot);
			this.mesh.count = this.owners.length;
		}
		this.matrix.compose(at, this.turn, this.scale.setScalar(size));
		this.mesh.setMatrixAt(slot, this.matrix);
		this.mesh.instanceMatrix.addUpdateRange(slot * 16, 16);
		this.mesh.instanceMatrix.needsUpdate = true;
	}

	/** Gives `id`'s slot up: the last slot's token moves into it. */
	remove(id: string): void {
		const slot = this.slots.get(id);
		if (slot === undefined) return;
		const last = this.owners.length - 1;
		if (slot !== last) {
			const moved = this.owners[last];
			this.mesh.getMatrixAt(last, this.matrix);
			this.mesh.setMatrixAt(slot, this.matrix);
			const tint = this.tints();
			tint.copyAt(slot, tint, last);
			this.owners[slot] = moved;
			this.slots.set(moved, slot);
			this.mesh.instanceMatrix.addUpdateRange(slot * 16, 16);
			tint.addUpdateRange(slot * 4, 4);
			this.mesh.instanceMatrix.needsUpdate = tint.needsUpdate = true;
		}
		this.owners.pop();
		this.slots.delete(id);
		this.hidden.delete(id);
		this.mesh.count = this.owners.length;
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
		this.mesh.computeBoundingSphere();
		this.paint();
	}

	/** Writes every ring; true if any changed. */
	private paint(): boolean {
		let changed = false;
		for (const id of this.owners) changed = this.write(id) || changed;
		return changed;
	}

	/** Writes `id`'s ring. Returns true if it changed. */
	private write(id: string): boolean {
		const slot = this.slots.get(id);
		if (slot === undefined) return false;
		const ring = this.rings.get(id) ?? NEUTRAL_RING;
		const state = { hovered: id === this.hovered, selected: id === this.selected };
		const emission = ringEmission({ ...state, active: id === this.active }, this.now, this.still);
		const values = [
			ring.colour,
			emission,
			(ring.notched ? 1 : 0) + (ring.double ? 2 : 0),
			this.hidden.has(id) ? 1 : 0
		];
		const tint = this.tints();
		const i = slot * 4;
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
		this.mesh.removeFromParent();
		this.mesh.dispose();
		this.geometry.dispose();
		this.material.dispose();
	}

	private tints(): THREE.InstancedBufferAttribute {
		return this.geometry.getAttribute(BASE_ATTRIBUTE) as THREE.InstancedBufferAttribute;
	}

	private make(capacity: number): THREE.InstancedMesh {
		const tints = new Float32Array(capacity * 4);
		const was = this.geometry.getAttribute(BASE_ATTRIBUTE);
		if (was) tints.set(was.array as Float32Array);
		this.geometry.setAttribute(BASE_ATTRIBUTE, new THREE.InstancedBufferAttribute(tints, 4));
		const mesh = pickable(new THREE.InstancedMesh(this.geometry, this.material, capacity));
		mesh.castShadow = mesh.receiveShadow = true;
		mesh.count = 0;
		this.group.add(tagged(mesh, 'bases'));
		return mesh;
	}

	/** The same mesh, larger: past `PIECE_MIN` either way, so it is the same program. */
	private grow(capacity: number): void {
		const old = this.mesh;
		this.mesh = this.make(capacity);
		for (let i = 0; i < this.owners.length; i++) {
			old.getMatrixAt(i, this.matrix);
			this.mesh.setMatrixAt(i, this.matrix);
		}
		this.mesh.count = this.owners.length;
		old.removeFromParent();
		old.dispose(); // its instance buffers; the geometry and material go on
	}
}
