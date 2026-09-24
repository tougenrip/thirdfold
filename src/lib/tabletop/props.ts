// Props for the three.js view. Every part of every asset is one
// InstancedMesh, so a room full of crates costs a crate's few draw calls.
// Part colours travel as instance colours, which also carry the selection
// and hover tint. Placement comes from the Prop data; this only draws it.

import * as THREE from 'three';
import { cornerToWorld, type SquareGrid } from '$lib/game/grid';
import { ASSET_IDS, footprintSize, type AssetId, type Prop } from '$lib/game/props';
import { PROP_MODELS, type Shape } from './prop-models';

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

	sync(props: readonly Prop[], grid: SquareGrid): void {
		this.props = props;
		const byAsset = new Map<AssetId, Prop[]>(ASSET_IDS.map((id) => [id, []]));
		for (const p of props) byAsset.get(p.assetId)?.push(p);

		const base = new THREE.Matrix4();
		const part = new THREE.Matrix4();
		const out = new THREE.Matrix4();
		const turn = new THREE.Quaternion();
		const up = new THREE.Vector3(0, 1, 0);
		for (const [assetId, list] of byAsset) {
			const meshes = this.ensure(assetId, list.length);
			if (!meshes) continue;
			const model = PROP_MODELS[assetId];
			meshes.owners = list.map((p) => p.id);
			list.forEach((p, i) => {
				const { w, h } = footprintSize(p.assetId, p.rotation);
				const corner = cornerToWorld(grid, p.pos);
				turn.setFromAxisAngle(up, -p.rotation * (Math.PI / 2));
				base.compose(
					new THREE.Vector3(
						corner.x + (w * grid.cellSize) / 2,
						0,
						corner.z + (h * grid.cellSize) / 2
					),
					turn,
					new THREE.Vector3().setScalar(grid.cellSize * p.scale)
				);
				model.forEach((m, j) => {
					part.compose(
						new THREE.Vector3(...m.at),
						new THREE.Quaternion(),
						new THREE.Vector3(...m.size)
					);
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
