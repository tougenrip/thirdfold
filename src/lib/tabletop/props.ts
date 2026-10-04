// Props for the three.js view. Each asset's model (see models.ts: loaded on
// first use) is one InstancedMesh, two if it has swinging parts, so a room
// full of crates costs one draw call. Until the model has loaded, the prop
// shows as a plain box on its footprint. Colours are in the model (vertex
// colours). Props are the prop kind (#172): selection, hover and the GM's
// hidden ghost are an emissive tint per instance (`aTint`), so a textured
// albedo is never multiplied by them, and each instance is lifted a hash of
// its asset and cell off whatever it lies on (`aLift`, #181). Placement comes
// from the Prop data; this only draws it. A model's `flame` mesh (a brazier's coals, #232) is the
// emissive kind, glowing in the colour of a light that is on in the prop's cell, with its flicker
// (`setLights`).
//
// A prop that moves or turns glides to its new place, so a push, a pull or
// a turn reads the same on every client; motions from the server (a shake,
// a swing, a landing) play on top. All of it runs on the wall clock
// (`tick(now)`), only while something is moving; a new prop drops in (#249).

import * as THREE from 'three/webgpu';
import { pickable } from './picking';
import { cornerToWorld, type SquareGrid } from '$lib/game/grid';
import { MOTION_MS, type MotionKind } from '$lib/game/motion';
import {
	ASSET_IDS,
	ASSETS,
	footprintCells,
	footprintSize,
	type AssetId,
	type Prop
} from '$lib/game/props';
import type { Light } from '$lib/game/lights';
import type { CellMask } from '$lib/game/visibility';
import { Drops, DROP_CELLS, PropDrops } from './drop-in';
import type { Ground } from './ground';
import { flameMaterial, flameOf, paintFlame, type FlameLook } from './light-fixtures';
import {
	addInstanceTints,
	createMaterial,
	DROP_ATTRIBUTE,
	dropHeight,
	dropNow,
	LIFT_ATTRIBUTE,
	liftOf,
	PAINT_ATTRIBUTE,
	setParams,
	TINT_ATTRIBUTE,
	withBake,
	type KindMaterial,
	type MaterialOptions
} from './materials';
import { loadModel, modelNow, partsOf, type LoadedModel, type ModelPart } from './models';

/** A placeholder's height and colour, until the model has loaded. */
const PLACEHOLDER_HEIGHT = 0.5;
const PLACEHOLDER = 0x8a7f70;
/** How far a swing throws swinging parts when the model doesn't say. */
const DEFAULT_THROW = 0.4;

/** How long a prop takes to glide to a new place or turn. */
const GLIDE_MS = 450;

/** How a prop is displaced from where it stands, this frame. */
interface Pose {
	dx: number;
	dy: number;
	dz: number;
	/** Extra turn about the vertical (radians). */
	turn: number;
	/** Swing of its swinging parts about their pivot (radians). */
	swing: number;
}

type Anim =
	| { kind: 'glide'; start: number; dx: number; dz: number; turn: number }
	| { kind: MotionKind; start: number; throw: number };

const still = (): Pose => ({ dx: 0, dy: 0, dz: 0, turn: 0, swing: 0 });

/** The emissive tints (colour and strength): selected, hovered, and hidden from the players. */
const SELECTED = { color: new THREE.Color(0xe0a458), strength: 0.4 };
const HOVERED = { color: new THREE.Color(0xe27a6b), strength: 0.4 };
/** Reused by `paint` for each instance's tint (#202). */
const tintColour = new THREE.Color();
/** What the GM sees a prop hidden from the players as: pale, like a ghost of itself. */
const GHOST = { color: new THREE.Color(0xb8c6e0), strength: 0.3 };

interface AssetMeshes {
	parts: { mesh: THREE.InstancedMesh; swings: boolean; flame: boolean }[];
	/** Materials of its own for textured parts (#188): the shared variant, its maps in the slots. */
	materials: KindMaterial[];
	/** Prop id for each instance index. */
	owners: string[];
	capacity: number;
	/** The model these meshes draw, or null for the placeholder. */
	model: LoadedModel | null;
}

export class PropLayer {
	readonly group = new THREE.Group();
	private placeholder = withBake(new THREE.BoxGeometry(1, 1, 1));
	/**
	 * Models: their colours are vertex colours. One material for every asset (#172), and one per
	 * textured part in the same variant, so a textured model compiles nothing new.
	 */
	private static readonly MODEL: MaterialOptions = { instanced: true, vertexColors: true };
	private material = createMaterial('prop', PropLayer.MODEL);
	private placeholderMaterial = createMaterial('prop', {
		instanced: true,
		params: { color: PLACEHOLDER, roughness: 0.9 }
	});
	private flameMaterial = flameMaterial();
	/** The renderer's drops and which props drop (#249). */
	readonly drops: Drops;
	private dropping: PropDrops;
	/** The flame of the light in each cell (`x,y`), which a prop's flame there glows as. */
	private flames = new Map<string, FlameLook | null>();
	/** Assets whose model has been asked for. */
	private requested = new Set<AssetId>();

	/** `onModel` is told when a model has arrived and the props have been drawn again. */
	constructor(
		private readonly onModel: () => void = () => {},
		/** The renderer's clock (ms); glides start from it. */
		private readonly clock: () => number = () => performance.now()
	) {
		this.dropping = new PropDrops((this.drops = new Drops(clock, dropNow)));
	}
	private meshes = new Map<AssetId, AssetMeshes>();
	private props: readonly Prop[] = [];
	private selectedId: string | null = null;
	private hoveredId: string | null = null;
	/** Swing angles (radians) set from outside (the toll), by id. */
	private swings = new Map<string, number>();
	/** Animations playing, by prop id. */
	private anims = new Map<string, Anim[]>();
	/** This frame's displacement of each animating prop. */
	private poses = new Map<string, Pose>();
	private reducedMotion = false;
	private last: { grid: SquareGrid; ground: Ground | null } | null = null;

	setReducedMotion(reduced: boolean): void {
		this.reducedMotion = this.drops.reduced = reduced;
	}

	/** `known`: the cells the viewer has explored (null: all); only props placed there drop. */
	sync(
		props: readonly Prop[],
		grid: SquareGrid,
		ground: Ground | null = null,
		known?: CellMask | null
	) {
		const sameTable = this.last?.grid === grid;
		this.dropping.update(props, grid.width, known ?? null, !sameTable);
		if (!sameTable) this.anims.clear();
		// Whatever moved or turned since last time glides there from where it was.
		if (sameTable && !this.reducedMotion) {
			const was = new Map(this.props.map((p) => [p.id, p]));
			const now = this.clock();
			for (const p of props) {
				const old = was.get(p.id);
				if (!old || (old.pos.x === p.pos.x && old.pos.y === p.pos.y && old.rotation === p.rotation))
					continue;
				const from = this.centre(old, grid);
				const to = this.centre(p, grid);
				// The short way round.
				const quarters = ((((old.rotation - p.rotation) % 4) + 6) % 4) - 2;
				this.start(p.id, {
					kind: 'glide',
					start: now,
					dx: (from.x - to.x) / grid.cellSize,
					dz: (from.z - to.z) / grid.cellSize,
					turn: -quarters * (Math.PI / 2)
				});
			}
		}
		this.layout(props, grid, ground);
	}

	/** Whether any prop is animating (render again). */
	get animating(): boolean {
		return this.anims.size > 0;
	}

	/** Plays a motion on a prop: a shake, a swing, a landing. */
	animate(id: string, kind: MotionKind, now: number): void {
		const prop = this.props.find((p) => p.id === id);
		if (!prop || this.reducedMotion) return;
		const swing = modelNow(prop.assetId)?.entry.swing;
		this.start(id, { kind, start: now, throw: swing?.throw ?? DEFAULT_THROW });
		this.tick(now);
	}

	/** Advances the animations to `now`. Returns true while any is still playing. */
	tick(now: number): boolean {
		this.drops.tick(now); // the drops' clock, and whether one plays (`drops.active`)
		if (this.anims.size === 0 && this.poses.size === 0) return false;
		this.poses.clear();
		for (const [id, list] of this.anims) {
			const pose = still();
			const playing = list.filter((a) => {
				const ms = a.kind === 'glide' ? GLIDE_MS : MOTION_MS[a.kind];
				const t = Math.min(Math.max((now - a.start) / ms, 0), 1);
				apply(pose, a, t);
				return t < 1;
			});
			if (playing.length) {
				this.anims.set(id, playing);
				this.poses.set(id, pose);
			} else this.anims.delete(id);
		}
		if (this.last) this.layout(this.props, this.last.grid, this.last.ground);
		return this.anims.size > 0;
	}

	private start(id: string, anim: Anim): void {
		const list = (this.anims.get(id) ?? []).filter((a) => a.kind !== anim.kind);
		this.anims.set(id, [...list, anim]);
	}

	private centre(p: Prop, grid: SquareGrid): { x: number; z: number } {
		const { w, h } = footprintSize(p.assetId, p.rotation);
		const corner = cornerToWorld(grid, p.pos);
		return { x: corner.x + (w * grid.cellSize) / 2, z: corner.z + (h * grid.cellSize) / 2 };
	}

	private layout(props: readonly Prop[], grid: SquareGrid, ground: Ground | null): void {
		this.props = props;
		this.last = { grid, ground };
		// A thousandth of a cell at an `aLift` of 1 (#181).
		const textured = [...this.meshes.values()].flatMap((m) => m.materials);
		for (const m of [this.material, this.placeholderMaterial, ...textured])
			setParams(m, { lift: 1e-3 * grid.cellSize });
		dropHeight.value = DROP_CELLS * grid.cellSize;
		const byAsset = new Map<AssetId, Prop[]>(ASSET_IDS.map((id) => [id, []]));
		for (const p of props) byAsset.get(p.assetId)?.push(p);

		const base = new THREE.Matrix4();
		const part = new THREE.Matrix4();
		const out = new THREE.Matrix4();
		const turn = new THREE.Quaternion();
		const up = new THREE.Vector3(0, 1, 0);
		const swing = new THREE.Matrix4();
		const tilt = new THREE.Matrix4();
		for (const [assetId, list] of byAsset) {
			const meshes = this.ensure(assetId, list.length);
			if (!meshes) continue;
			// A placeholder is a box on the unrotated footprint; a model is already in place.
			const def = ASSETS[assetId];
			const local = meshes.model
				? new THREE.Matrix4()
				: new THREE.Matrix4().compose(
						new THREE.Vector3(0, PLACEHOLDER_HEIGHT / 2, 0),
						new THREE.Quaternion(),
						new THREE.Vector3(def.w * 0.9, PLACEHOLDER_HEIGHT, def.h * 0.9)
					);
			const pivot = meshes.model?.entry.swing?.pivot ?? 0;
			meshes.owners = list.map((p) => p.id);
			list.forEach((p, i) => {
				const at = this.centre(p, grid);
				const pose = this.poses.get(p.id);
				turn.setFromAxisAngle(up, -p.rotation * (Math.PI / 2) + (pose?.turn ?? 0));
				// On the highest floor under it (a prop on a balcony stands on the balcony).
				const floor = ground ? Math.max(...footprintCells(p).map((c) => ground.floorY(c))) : 0;
				base.compose(
					new THREE.Vector3(
						at.x + (pose?.dx ?? 0) * grid.cellSize,
						floor + (pose?.dy ?? 0) * grid.cellSize,
						at.z + (pose?.dz ?? 0) * grid.cellSize
					),
					turn,
					new THREE.Vector3().setScalar(grid.cellSize * p.scale)
				);
				const angle = (this.swings.get(p.id) ?? 0) + (pose?.swing ?? 0);
				if (angle) {
					// Rotate about the pivot: up to it, tilt, back down.
					swing
						.makeTranslation(0, pivot, 0)
						.multiply(tilt.makeRotationX(angle))
						.multiply(new THREE.Matrix4().makeTranslation(0, -pivot, 0));
				}
				const [lift, drop] = [liftOf(assetId, p.pos), this.dropping.startOf(p.id)];
				for (const { mesh, swings } of meshes.parts) {
					part.copy(local);
					if (angle && swings) part.premultiply(swing);
					mesh.setMatrixAt(i, out.multiplyMatrices(base, part));
					(mesh.geometry.getAttribute(LIFT_ATTRIBUTE) as THREE.BufferAttribute).setX(i, lift);
					(mesh.geometry.getAttribute(DROP_ATTRIBUTE) as THREE.BufferAttribute).setX(i, drop);
				}
			});
			for (const { mesh } of meshes.parts) {
				mesh.count = list.length;
				mesh.instanceMatrix.needsUpdate = true;
				mesh.geometry.getAttribute(LIFT_ATTRIBUTE).needsUpdate = true;
				mesh.geometry.getAttribute(DROP_ATTRIBUTE).needsUpdate = true;
				mesh.computeBoundingSphere();
			}
		}
		this.paint();
	}

	/** Swings a hanging prop to `angle` radians (0 is at rest). Returns true if anything moved. */
	setSwing(id: string, angle: number): boolean {
		if ((this.swings.get(id) ?? 0) === angle || !this.last) return false;
		if (angle) this.swings.set(id, angle);
		else this.swings.delete(id);
		this.layout(this.props, this.last.grid, this.last.ground);
		return true;
	}

	/** The lights, which light the flames of the props on their cells. */
	setLights(lights: readonly Light[]): void {
		this.flames = new Map(lights.map((l) => [`${l.pos.x},${l.pos.y}`, flameOf(l)]));
		this.paint();
	}

	/** Returns true if the tint changed. */
	setSelected(id: string | null): boolean {
		if (id === this.selectedId) return false;
		this.selectedId = id;
		this.paint();
		return true;
	}

	setHovered(id: string | null): boolean {
		if (id === this.hoveredId) return false;
		this.hoveredId = id;
		this.paint();
		return true;
	}

	pick(raycaster: THREE.Raycaster): string | null {
		const hit = raycaster.intersectObject(this.group, true)[0];
		if (!hit || hit.instanceId === undefined) return null;
		const assetId = hit.object.userData.assetId as AssetId | undefined;
		return (assetId && this.meshes.get(assetId)?.owners[hit.instanceId]) ?? null;
	}

	dispose(): void {
		for (const id of [...this.meshes.keys()]) this.drop(id);
		this.placeholder.dispose();
		this.material.dispose();
		this.placeholderMaterial.dispose();
		this.flameMaterial.dispose();
	}

	/**
	 * Meshes for an asset with room for `count` props, growing in chunks; none if never
	 * used. Asks for the asset's model the first time; they are made again when it arrives.
	 */
	private ensure(assetId: AssetId, count: number): AssetMeshes | null {
		let meshes = this.meshes.get(assetId);
		if (!meshes && count === 0) return null;
		if (!this.requested.has(assetId)) {
			this.requested.add(assetId);
			// Drawn again with its preview, if it has one, then with the model (or the box again).
			const redraw = () => {
				this.drop(assetId);
				if (this.last) this.layout(this.props, this.last.grid, this.last.ground);
				this.onModel();
			};
			void loadModel(assetId, redraw).then(redraw);
		}
		const model = modelNow(assetId) ?? null;
		if (meshes && meshes.capacity >= count && meshes.model === model) return meshes;
		this.drop(assetId);
		const capacity = Math.max(8, Math.ceil(count * 1.5));
		const materials: KindMaterial[] = [];
		// A translucent model (#237) draws with materials of its own, in the same variant.
		const translucency = model?.entry.translucency ?? 0;
		let plain: KindMaterial | null = null;
		const materialOf = (part: ModelPart) => {
			if (!part.maps && !translucency) return this.material;
			if (!part.maps && plain) return plain;
			const lift = this.material.params.lift;
			const params = part.maps ? { ...part.params, lift, translucency } : { lift, translucency };
			const own = createMaterial('prop', { ...PropLayer.MODEL, params, slots: part.maps ?? {} });
			materials.push(own);
			if (!part.maps) plain = own;
			return own;
		};
		const make = (shared: THREE.BufferGeometry, material: THREE.Material, shadows = true) => {
			// A copy of its own, to carry this mesh's tints and lifts (#172, #181).
			const geometry = shared.clone();
			addInstanceTints(geometry, capacity);
			const mesh = pickable(new THREE.InstancedMesh(geometry, material, capacity));
			mesh.userData.assetId = assetId;
			mesh.castShadow = mesh.receiveShadow = shadows;
			mesh.count = 0;
			this.group.add(mesh);
			return mesh;
		};
		const parts: AssetMeshes['parts'] = [];
		if (model) {
			// Drawn at its full level; choosing a coarser one by distance is #274's.
			for (const role of ['body', 'swing'] as const)
				for (const part of partsOf(model, role))
					parts.push({
						mesh: make(part.geometry, materialOf(part)),
						swings: role === 'swing',
						flame: false
					});
			for (const part of partsOf(model, 'flame'))
				parts.push({
					mesh: make(part.geometry, this.flameMaterial, false),
					swings: false,
					flame: true
				});
		} else
			parts.push({
				mesh: make(this.placeholder, this.placeholderMaterial),
				swings: false,
				flame: false
			});
		meshes = { capacity, owners: [], parts, materials, model };
		this.meshes.set(assetId, meshes);
		return meshes;
	}

	/** Takes an asset's meshes off the table (the model's own geometry is kept for next time). */
	private drop(assetId: AssetId): void {
		const meshes = this.meshes.get(assetId);
		if (!meshes) return;
		for (const { mesh } of meshes.parts) {
			this.group.remove(mesh);
			mesh.geometry.dispose(); // its own copy
			mesh.dispose();
		}
		for (const m of meshes.materials) m.dispose(); // not its maps: the model's (models.ts)
		this.meshes.delete(assetId);
	}

	/**
	 * Writes each instance's paint (its tint, #202) and tint: the ghost if hidden, plus selected or hovered, added (as the
	 * old instance colours lerped both in), so a selected hidden prop still reads as hidden.
	 */
	private paint(): void {
		const hidden = new Set(this.props.filter((p) => p.hidden).map((p) => p.id));
		const tinted = new Map(this.props.map((p) => [p.id, p.tint]));
		const cells = new Map(this.props.map((p) => [p.id, `${p.pos.x},${p.pos.y}`]));
		for (const meshes of this.meshes.values()) {
			for (const { mesh, flame } of meshes.parts) {
				if (flame) {
					meshes.owners.forEach((id, i) =>
						paintFlame(mesh, i, this.flames.get(cells.get(id) ?? '') ?? null)
					);
					continue;
				}
				const tints = mesh.geometry.getAttribute(TINT_ATTRIBUTE) as THREE.BufferAttribute;
				const paints = mesh.geometry.getAttribute(PAINT_ATTRIBUTE) as THREE.BufferAttribute;
				meshes.owners.forEach((id, i) => {
					const tint = tinted.get(id);
					tintColour.set(tint ?? 0xffffff);
					paints.setXYZ(i, tintColour.r, tintColour.g, tintColour.b);
					const hot = id === this.selectedId ? SELECTED : id === this.hoveredId ? HOVERED : null;
					const sum = [0, 0, 0];
					for (const t of [hidden.has(id) ? GHOST : null, hot]) {
						if (!t) continue;
						sum[0] += t.color.r * t.strength;
						sum[1] += t.color.g * t.strength;
						sum[2] += t.color.b * t.strength;
					}
					tints.setXYZW(i, sum[0], sum[1], sum[2], 1);
				});
				tints.needsUpdate = true;
				paints.needsUpdate = true;
			}
		}
	}
}

/** Adds an animation's displacement at `t` (0 to 1 through it) to a pose. */
function apply(pose: Pose, a: Anim, t: number): void {
	switch (a.kind) {
		case 'glide': {
			// Eases out: quick to start, settling into place.
			const left = (1 - t) ** 3;
			pose.dx += a.dx * left;
			pose.dz += a.dz * left;
			pose.turn += a.turn * left;
			return;
		}
		case 'shake': {
			const fade = 1 - t;
			pose.dx += Math.sin(t * 90) * 0.035 * fade;
			pose.dz += Math.cos(t * 71) * 0.025 * fade;
			return;
		}
		case 'swing':
			// Thrown, then settling back with a couple of dying bounces.
			pose.swing += a.throw * Math.exp(-4 * t) * Math.cos(t * Math.PI * 3) * (1 - t);
			return;
		case 'land': {
			// Falls in from a little above and bounces once.
			const fall = t < 0.6 ? 1 - (t / 0.6) ** 2 : 0;
			const bounce = t >= 0.6 ? Math.sin(((t - 0.6) / 0.4) * Math.PI) * 0.06 : 0;
			pose.dy += 0.7 * fall + bounce;
			return;
		}
	}
}
