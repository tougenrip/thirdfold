// Token figures as instanced batches (#266): one InstancedMesh per figure part (a model's body or
// accent, or the plain miniature's torso and head), so figure draw calls follow how many distinct
// figures are on the table, not how many tokens. Each instance has its matrix, and in the paint
// (`PAINT_ATTRIBUTE`, vec4) its tint (white on a vertex-coloured body, the token's colour on an
// accent, the plain miniature and a textured part) and how much of it shows (w: a GM-hidden token's hashed
// see-through, so hiding compiles nothing); the tint (`TINT_ATTRIBUTE`, vec4) is a glow, 0 here,
// for #267's rim and hover. Every batch is pool-sized (piece.ts, `PIECE_MIN`), so a new batch, or
// one made again larger, compiles nothing: one program per mini variant (part lists, textured).
//
// Slots are a swap-remove allocator (`Slots`): a removal moves the last instance into the freed
// slot, so a batch's instances are always its first `count`. A model change, or a placeholder or
// preview giving way when the model arrives, is a removal and an add; a batch left empty is freed
// with its geometry copy and, for a textured part, its material.
//
// Poses (#273): a model's `body_pose<n>` parts are parts like any other, so a figure in a pose is
// an instance in that part's batch; a pose change is a removal and an add, never a geometry swap
// inside a draw, and compiles nothing (the same materials).
//
// A model with levels (#274) draws each figure at the level `chooseLods` picks from the camera
// (lod.ts): a switch is a removal from one part's batch and an add to another's, by the same
// allocator. Its shadow never switches: the visible batches cast none, and a proxy batch per part
// at the cheapest level (in the figure's pose), on the `SHADOW_PROXY` layer only the shadow cameras
// see, holds every figure of the model, so a cached shadow map stays good. A part list (one level)
// casts itself.

import * as THREE from 'three/webgpu';
import { createMaterial, PAINT_ATTRIBUTE, PIECE_MIN, TINT_ATTRIBUTE, withBake } from './materials';
import type { KindMaterial } from './materials';
import {
	drawnLevel,
	levelsOf,
	loadModel,
	mergeParts,
	modelNow,
	modelRadius,
	partsOf,
	type LoadedModel,
	type ModelPart
} from './models';
import { pickable } from './picking';
import { poseOf, type PoseState } from './mini-poses';
import { FIGURE_LODS, lodFor, SHADOW_PROXY } from './lod';

/** Swap-remove slots: ids packed in `owners[0..size)`. */
export class Slots {
	readonly owners: string[] = [];
	private readonly at = new Map<string, number>();

	get size(): number {
		return this.owners.length;
	}

	slotOf(id: string): number | undefined {
		return this.at.get(id);
	}

	/** Puts `id` in the next slot and returns it. */
	add(id: string): number {
		const slot = this.owners.length;
		this.owners.push(id);
		this.at.set(id, slot);
		return slot;
	}

	/** Frees `id`'s slot: the last moved into it (`from`, equal to `slot` when it was the last). */
	remove(id: string): { slot: number; from: number } | null {
		const slot = this.at.get(id);
		if (slot === undefined) return null;
		const from = this.owners.length - 1;
		const last = this.owners.pop()!;
		this.at.delete(id);
		if (slot !== from) {
			this.owners[slot] = last;
			this.at.set(last, slot);
		}
		return { slot, from };
	}
}

/** The plain miniature: torso and head as one geometry, the attribute set of a model part. */
let plain: THREE.BufferGeometry | null = null;
function plainGeometry(): THREE.BufferGeometry {
	if (plain) return plain;
	const piece = (g: THREE.BufferGeometry, y: number) => {
		const out = g.toNonIndexed().translate(0, y, 0);
		g.dispose();
		const n = out.getAttribute('position').count;
		out.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
		out.setIndex([...Array(n).keys()]);
		return withBake(out);
	};
	plain = mergeParts([
		piece(new THREE.CylinderGeometry(0.2, 0.3, 0.62, 24), 0.31),
		piece(new THREE.SphereGeometry(0.19, 24, 16), 0.62 + 0.14)
	]);
	plain.computeBoundingSphere();
	return plain;
}

/** One figure part's instances. */
export class Batch {
	mesh: THREE.InstancedMesh;
	readonly slots = new Slots();

	constructor(
		/** The part's own geometry, copied: the model keeps its own (props draw it too). */
		readonly source: THREE.BufferGeometry,
		readonly material: KindMaterial,
		/**
		 * A vertex-coloured body takes no tint; an accent, the plain miniature and a textured part
		 * the token's colour (#267 lays it where a textured part's ORM alpha masks it).
		 */
		readonly role: 'body' | 'tinted',
		/** Whether the material is the batch's own (a textured part's), freed with it. */
		readonly owned: boolean,
		private readonly parent: THREE.Object3D,
		/** Casts its own shadow (a part list), none (a level of a model with levels), or is a proxy. */
		readonly shadow: 'cast' | 'none' | 'proxy' = 'cast'
	) {
		this.mesh = this.make(source.clone(), PIECE_MIN);
	}

	add(id: string, matrix: THREE.Matrix4, paint: readonly number[]): void {
		if (this.slots.size >= this.mesh.instanceMatrix.count) this.grow();
		const i = this.slots.add(id);
		this.mesh.count = this.slots.size;
		this.setMatrix(id, matrix);
		this.setPaint(id, paint);
		this.tints.array.fill(0, i * 4, i * 4 + 4);
		touch(this.tints, i * 4, 4);
	}

	remove(id: string): void {
		const freed = this.slots.remove(id);
		if (!freed) return;
		const { slot, from } = freed;
		if (slot !== from) {
			for (const [a, size] of [
				[this.mesh.instanceMatrix, 16],
				[this.paints, 4],
				[this.tints, 4]
			] as const) {
				a.array.copyWithin(slot * size, from * size, from * size + size);
				touch(a, slot * size, size);
			}
		}
		this.mesh.count = this.slots.size;
		this.mesh.boundingSphere = null;
	}

	setMatrix(id: string, matrix: THREE.Matrix4): void {
		const i = this.slots.slotOf(id);
		if (i === undefined) return;
		matrix.toArray(this.mesh.instanceMatrix.array, i * 16);
		touch(this.mesh.instanceMatrix, i * 16, 16);
		// Culling and raycasts use it: recomputed when next asked for.
		this.mesh.boundingSphere = null;
	}

	setPaint(id: string, paint: readonly number[]): void {
		const i = this.slots.slotOf(id);
		if (i === undefined) return;
		this.paints.array.set(paint, i * 4);
		touch(this.paints, i * 4, 4);
	}

	dispose(): void {
		this.mesh.removeFromParent();
		this.mesh.geometry.dispose();
		this.mesh.dispose();
		if (this.owned) this.material.dispose();
	}

	get paints(): THREE.InstancedBufferAttribute {
		return this.mesh.geometry.getAttribute(PAINT_ATTRIBUTE) as THREE.InstancedBufferAttribute;
	}

	get tints(): THREE.InstancedBufferAttribute {
		return this.mesh.geometry.getAttribute(TINT_ATTRIBUTE) as THREE.InstancedBufferAttribute;
	}

	private make(geometry: THREE.BufferGeometry, n: number): THREE.InstancedMesh {
		const at = (size: number, old?: THREE.BufferAttribute) => {
			const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size);
			if (old) a.array.set(old.array.subarray(0, Math.min(old.array.length, n * size)));
			return a;
		};
		const was = this.mesh as THREE.InstancedMesh | undefined;
		geometry.setAttribute(PAINT_ATTRIBUTE, at(4, was && this.paints));
		geometry.setAttribute(TINT_ATTRIBUTE, at(4, was && this.tints));
		const mesh = pickable(new THREE.InstancedMesh(geometry, this.material, n));
		if (was) mesh.instanceMatrix.array.set(was.instanceMatrix.array);
		mesh.count = this.slots.size;
		mesh.castShadow = this.shadow !== 'none';
		mesh.receiveShadow = this.shadow !== 'proxy';
		// Seen only by the shadow cameras: never drawn, never picked.
		if (this.shadow === 'proxy') mesh.layers.set(SHADOW_PROXY);
		mesh.userData.figures = this;
		mesh.userData.perfLayer = 'figures'; // perf-layers.ts
		mesh.userData.source = this.source;
		this.parent.add(mesh);
		return mesh;
	}

	/** Made again half as large again: same program (pool-sized either way). */
	private grow(): void {
		const was = this.mesh;
		this.mesh = this.make(was.geometry.clone(), Math.ceil(this.slots.size * 1.5));
		was.removeFromParent();
		was.geometry.dispose();
		was.dispose();
	}
}

function touch(a: THREE.BufferAttribute, start: number, count: number): void {
	a.addUpdateRange(start, count);
	a.needsUpdate = true;
}

/** What a token's figure is drawn as. */
interface Figure {
	model: string | null;
	/** The model drawn: null for the plain miniature, undefined while it hasn't loaded. */
	shows: LoadedModel | null | undefined;
	color: THREE.Color;
	opacity: number;
	matrix: THREE.Matrix4;
	/** What poses it (#273), and the pose drawn (0: the body). */
	state: PoseState;
	pose: number;
	/** The level asked for (lod.ts), and the one drawn: the finest the model has at or above it. */
	lod: number;
	drawn: number;
	/** The batches it has an instance in: drawn, and its shadow proxies. */
	batches: Batch[];
	proxies: Batch[];
}

/** Where models come from: the asset loader, or a test's own. */
export interface ModelSource {
	now: (id: string) => LoadedModel | null | undefined;
	load: (id: string, onStage: () => void) => Promise<unknown>;
}

const LOADER: ModelSource = { now: modelNow, load: loadModel };
const PLAIN = 'plain';

export class FigureBatches {
	/** Batches by part (the plain miniature under `PLAIN`). */
	readonly batches = new Map<ModelPart | typeof PLAIN, Batch>();
	/** Shadow proxies by part: a model with levels, at its cheapest. */
	readonly proxies = new Map<ModelPart, Batch>();
	private readonly figures = new Map<string, Figure>();
	/** Part lists, accents and the plain miniature: one material for all (vertex colours). */
	private readonly painted = createMaterial('mini', { instanced: true, vertexColors: true });

	constructor(
		readonly group: THREE.Object3D,
		/** Told when a model arrived and its figures were drawn again. */
		private readonly onModel: () => void = () => {},
		private readonly models: ModelSource = LOADER
	) {}

	/**
	 * Shows `id` as `model` (null: the plain miniature) in `color`, `opacity` of it showing.
	 * Returns true if anything changed.
	 */
	set(id: string, model: string | null, color: string, opacity: number): boolean {
		let figure = this.figures.get(id);
		if (!figure) {
			const matrix = new THREE.Matrix4();
			const state = { downed: false, active: false };
			figure = {
				model,
				shows: null,
				color: new THREE.Color(color),
				opacity,
				matrix,
				state,
				pose: 0,
				lod: 0,
				drawn: 0,
				batches: [],
				proxies: []
			};
			this.figures.set(id, figure);
			this.dress(id, figure);
			return true;
		}
		const recolour = !figure.color.equals(new THREE.Color(color)) || figure.opacity !== opacity;
		figure.color.set(color);
		figure.opacity = opacity;
		if (figure.model !== model) {
			figure.model = model;
			this.dress(id, figure);
			return true;
		}
		if (recolour)
			for (const b of [...figure.batches, ...figure.proxies]) b.setPaint(id, paintOf(b, figure));
		return recolour;
	}

	/**
	 * Picks each figure's level for `camera` on a view `viewportPx` high, one level coarser per
	 * `bias` (lod.ts). Returns true if any figure changed level. Run on camera and table changes.
	 */
	chooseLods(camera: THREE.PerspectiveCamera, viewportPx: number, bias: number): boolean {
		const fovY = THREE.MathUtils.degToRad(camera.fov);
		this.group.updateWorldMatrix(true, false);
		let changed = false;
		for (const [id, f] of this.figures) {
			const model = f.shows;
			if (!model || !levelsOf(model)) continue;
			world.multiplyMatrices(this.group.matrixWorld, f.matrix);
			const radius = modelRadius(model) * world.getMaxScaleOnAxis();
			const distance = at.setFromMatrixPosition(world).distanceTo(camera.position);
			f.lod = lodFor(radius, distance, fovY, viewportPx, FIGURE_LODS, f.lod, bias);
			const drawn = drawnLevel(model, f.lod, f.pose);
			if (drawn === f.drawn) continue;
			// Out of the old level's batches and into the new one's; the proxies stay.
			this.leave(id, f.batches);
			f.batches = this.wear(id, f, model, drawn);
			f.drawn = drawn;
			changed = true;
		}
		return changed;
	}

	/** What `id` is doing, for its model's poses (#273). Returns true if its pose changed. */
	setState(id: string, state: PoseState): boolean {
		const figure = this.figures.get(id);
		if (!figure) return false;
		figure.state = { ...state };
		if (this.poseFor(figure) === figure.pose) return false;
		this.dress(id, figure);
		return true;
	}

	/** Whether `id` shows its model's downed pose, which stands in for tipping it over. */
	showsDowned(id: string): boolean {
		const figure = this.figures.get(id);
		return !!figure?.pose && figure.pose === figure.shows?.entry.poses?.downed;
	}

	/** Puts `id`'s figure at `matrix` (in the group's space). */
	place(id: string, matrix: THREE.Matrix4): void {
		const figure = this.figures.get(id);
		if (!figure) return;
		figure.matrix.copy(matrix);
		for (const b of [...figure.batches, ...figure.proxies]) b.setMatrix(id, matrix);
	}

	remove(id: string): void {
		const figure = this.figures.get(id);
		if (!figure) return;
		this.undress(id, figure);
		this.figures.delete(id);
	}

	/** The token a raycast hit on a figure is, if it is one. */
	tokenOf(hit: THREE.Intersection): string | null {
		const batch = hit.object.userData.figures as Batch | undefined;
		return batch && hit.instanceId !== undefined
			? (batch.slots.owners[hit.instanceId] ?? null)
			: null;
	}

	/** Instances drawn, over every batch (tests). */
	instances(): number {
		let n = 0;
		for (const b of this.batches.values()) n += b.mesh.count;
		return n;
	}

	dispose(): void {
		for (const b of [...this.batches.values(), ...this.proxies.values()]) b.dispose();
		this.batches.clear();
		this.proxies.clear();
		this.figures.clear();
		this.painted.dispose();
	}

	/** Draws the figure as its model if loaded, else as the plain miniature until it arrives. */
	private dress(id: string, figure: Figure): void {
		this.undress(id, figure);
		const { model } = figure;
		const loaded = (figure.shows = model ? this.models.now(model) : null);
		figure.pose = this.poseFor(figure);
		figure.drawn = loaded ? drawnLevel(loaded, figure.lod, figure.pose) : 0;
		figure.batches = this.wear(id, figure, loaded ?? null, figure.drawn);
		// Its levels cast nothing: the proxy does, at the cheapest level of its pose (0 for a pose
		// without levels).
		if (loaded && levelsOf(loaded)) {
			const cheapest = drawnLevel(loaded, Infinity, figure.pose);
			figure.proxies = this.wear(id, figure, loaded, cheapest, true);
		}
		// Still coming (or only its preview is here): drawn again at each stage.
		if (model && (loaded === undefined || loaded?.preview)) {
			const redraw = () => {
				if (this.figures.get(id) !== figure || figure.model !== model) return;
				if (this.models.now(model) === figure.shows) return;
				this.dress(id, figure);
				this.onModel();
			};
			void this.models.load(model, redraw).then(redraw);
		}
	}

	/** The pose to draw: the state's, if the model shown has it (a preview has none). */
	private poseFor(figure: Figure): number {
		const shown = figure.shows;
		const pose = shown ? poseOf(figure.state, shown.entry.poses) : 0;
		return pose && shown && partsOf(shown, 'body', 0, pose).length ? pose : 0;
	}

	/** Adds the figure to the batches of `model`'s parts at `lod` in its pose (or the proxies'). */
	private wear(
		id: string,
		figure: Figure,
		model: LoadedModel | null,
		lod: number,
		proxy = false
	): Batch[] {
		const parts = model
			? [...partsOf(model, 'body', lod, figure.pose), ...partsOf(model, 'accent', lod)]
			: [PLAIN];
		const shadow = proxy ? 'proxy' : model && levelsOf(model) ? 'none' : 'cast';
		return parts.map((part) => {
			const batch = this.batchOf(part as ModelPart | typeof PLAIN, shadow);
			batch.add(id, figure.matrix, paintOf(batch, figure));
			return batch;
		});
	}

	private undress(id: string, figure: Figure): void {
		this.leave(id, figure.batches);
		this.leave(id, figure.proxies);
		figure.batches = [];
		figure.proxies = [];
	}

	/** Takes `id` out of `batches`, freeing any left empty (a preview's part may never come back). */
	private leave(id: string, batches: readonly Batch[]): void {
		for (const b of batches) {
			b.remove(id);
			if (b.slots.size > 0) continue;
			b.dispose();
			const map: Map<unknown, Batch> = b.shadow === 'proxy' ? this.proxies : this.batches;
			for (const [key, other] of map) if (other === b) map.delete(key);
		}
	}

	private batchOf(part: ModelPart | typeof PLAIN, shadow: Batch['shadow']): Batch {
		const map: Map<ModelPart | typeof PLAIN, Batch> =
			shadow === 'proxy' ? this.proxies : this.batches;
		let batch = map.get(part);
		if (batch) return batch;
		const { group } = this;
		if (part === PLAIN) batch = new Batch(plainGeometry(), this.painted, 'tinted', false, group);
		else if (part.maps) {
			const material = createMaterial('mini', {
				instanced: true,
				params: part.params,
				slots: part.maps
			});
			batch = new Batch(part.geometry, material, roleOf(part), true, group, shadow);
		} else batch = new Batch(part.geometry, this.painted, roleOf(part), false, group, shadow);
		map.set(part, batch);
		return batch;
	}
}

/** An instance's paint: white on a vertex-coloured body, else the token's colour. */
function paintOf(batch: Batch, figure: Figure): number[] {
	const c = batch.role === 'body' ? WHITE : figure.color;
	return [c.r, c.g, c.b, figure.opacity];
}

const WHITE = new THREE.Color(1, 1, 1);
const world = new THREE.Matrix4();
const at = new THREE.Vector3();
const roleOf = (part: ModelPart) => (part.role === 'accent' || part.maps ? 'tinted' : 'body');
