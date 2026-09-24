// Props for the three.js view. Every part of every asset is one
// InstancedMesh, so a room full of crates costs a crate's few draw calls.
// Part colours travel as instance colours, which also carry the selection
// and hover tint. Placement comes from the Prop data; this only draws it.
//
// A prop that moves or turns glides to its new place, so a push, a pull or
// a turn reads the same on every client; motions from the server (a shake,
// a swing, a landing) play on top. All of it runs on the wall clock
// (`tick(now)`), only while something is moving.

import * as THREE from 'three';
import { cornerToWorld, type SquareGrid } from '$lib/game/grid';
import { MOTION_MS, type MotionKind } from '$lib/game/motion';
import { ASSET_IDS, footprintCells, footprintSize, type AssetId, type Prop } from '$lib/game/props';
import type { Ground } from './ground';
import { PROP_MODELS, SWING_PIVOTS, SWING_THROW, type Shape } from './prop-models';

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

const SELECTED = new THREE.Color(0xe0a458);
const HOVERED = new THREE.Color(0xe27a6b);

interface AssetMeshes {
	parts: THREE.InstancedMesh[];
	/** Prop id for each instance index. */
	owners: string[];
	capacity: number;
}

export class PropLayer {
	readonly group = new THREE.Group();
	private geometries: Record<Shape, THREE.BufferGeometry> = {
		box: new THREE.BoxGeometry(1, 1, 1),
		cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 18),
		sphere: new THREE.SphereGeometry(0.5, 16, 12),
		cone: new THREE.ConeGeometry(0.5, 1, 18)
	};
	// White: the instance colour supplies each part's colour.
	private material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 });
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
		this.reducedMotion = reduced;
	}

	sync(props: readonly Prop[], grid: SquareGrid, ground: Ground | null = null): void {
		const sameTable = this.last?.grid === grid;
		if (!sameTable) this.anims.clear();
		// Whatever moved or turned since last time glides there from where it was.
		if (sameTable && !this.reducedMotion) {
			const was = new Map(this.props.map((p) => [p.id, p]));
			const now = performance.now();
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
		this.start(id, { kind, start: now, throw: SWING_THROW[prop.assetId] ?? 0.4 });
		this.tick(now);
	}

	/** Advances the animations to `now`. Returns true while any is still playing. */
	tick(now: number): boolean {
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
			const model = PROP_MODELS[assetId];
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
					const pivot = SWING_PIVOTS[p.assetId] ?? 0;
					swing
						.makeTranslation(0, pivot, 0)
						.multiply(tilt.makeRotationX(angle))
						.multiply(new THREE.Matrix4().makeTranslation(0, -pivot, 0));
				}
				model.forEach((m, j) => {
					part.compose(
						new THREE.Vector3(...m.at),
						new THREE.Quaternion(),
						new THREE.Vector3(...m.size)
					);
					if (angle && m.swings) part.premultiply(swing);
					meshes.parts[j].setMatrixAt(i, out.multiplyMatrices(base, part));
				});
			});
			for (const mesh of meshes.parts) {
				mesh.count = list.length;
				mesh.instanceMatrix.needsUpdate = true;
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
		for (const m of this.meshes.values()) for (const mesh of m.parts) mesh.dispose();
		Object.values(this.geometries).forEach((g) => g.dispose());
		this.material.dispose();
	}

	/** Meshes for an asset with room for `count` props, growing in chunks; none if never used. */
	private ensure(assetId: AssetId, count: number): AssetMeshes | null {
		let meshes = this.meshes.get(assetId);
		if (!meshes && count === 0) return null;
		if (meshes && meshes.capacity >= count) return meshes;
		if (meshes)
			for (const mesh of meshes.parts) {
				this.group.remove(mesh);
				mesh.dispose();
			}
		const capacity = Math.max(8, Math.ceil(count * 1.5));
		meshes = {
			capacity,
			owners: [],
			parts: PROP_MODELS[assetId].map((m) => {
				const mesh = new THREE.InstancedMesh(this.geometries[m.shape], this.material, capacity);
				mesh.userData.assetId = assetId;
				mesh.castShadow = true;
				mesh.receiveShadow = true;
				mesh.count = 0;
				this.group.add(mesh);
				return mesh;
			})
		};
		this.meshes.set(assetId, meshes);
		return meshes;
	}

	private paint(): void {
		const color = new THREE.Color();
		for (const [assetId, meshes] of this.meshes) {
			const model = PROP_MODELS[assetId];
			meshes.owners.forEach((id, i) => {
				const tint = id === this.selectedId ? SELECTED : id === this.hoveredId ? HOVERED : null;
				model.forEach((m, j) => {
					color.setHex(m.color);
					if (tint) color.lerp(tint, 0.55);
					meshes.parts[j].setColorAt(i, color);
				});
			});
			for (const mesh of meshes.parts)
				if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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
