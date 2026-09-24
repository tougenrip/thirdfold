// Props for the three.js view. Every part of every asset is one
// InstancedMesh, so a room full of crates costs a crate's few draw calls.
// Part colours travel as instance colours, which also carry the selection
// and hover tint. Placement comes from the Prop data; this only draws it.

import * as THREE from 'three';
import { cornerToWorld, type SquareGrid } from '$lib/game/grid';
import { ASSET_IDS, footprintCells, footprintSize, type AssetId, type Prop } from '$lib/game/props';
import type { Ground } from './ground';
import { PROP_MODELS, SWING_PIVOT, type Shape } from './prop-models';

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
	/** Swing angles (radians) of props that are swinging, by id. */
	private swings = new Map<string, number>();
	private last: { grid: SquareGrid; ground: Ground | null } | null = null;

	sync(props: readonly Prop[], grid: SquareGrid, ground: Ground | null = null): void {
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
				const { w, h } = footprintSize(p.assetId, p.rotation);
				const corner = cornerToWorld(grid, p.pos);
				turn.setFromAxisAngle(up, -p.rotation * (Math.PI / 2));
				// On the highest floor under it (a prop on a balcony stands on the balcony).
				const floor = ground ? Math.max(...footprintCells(p).map((c) => ground.floorY(c))) : 0;
				base.compose(
					new THREE.Vector3(
						corner.x + (w * grid.cellSize) / 2,
						floor,
						corner.z + (h * grid.cellSize) / 2
					),
					turn,
					new THREE.Vector3().setScalar(grid.cellSize * p.scale)
				);
				const angle = this.swings.get(p.id) ?? 0;
				if (angle) {
					// Rotate about the beam: up to the pivot, tilt, back down.
					swing
						.makeTranslation(0, SWING_PIVOT, 0)
						.multiply(tilt.makeRotationX(angle))
						.multiply(new THREE.Matrix4().makeTranslation(0, -SWING_PIVOT, 0));
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
		this.sync(this.props, this.last.grid, this.last.ground);
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
