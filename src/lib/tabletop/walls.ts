// Walls and doors for the three.js view. Every unit of wall is one instance of
// a single InstancedMesh (one draw call however much wall there is); doors
// are individual hinged meshes that swing open. Presentation only: open/closed
// comes from the Door objects handed in.

import * as THREE from 'three';
import { cornerToWorld, type SquareGrid } from '$lib/game/grid';
import { edgeKey, unitEdges, type Door, type SceneObject } from '$lib/game/objects';

export const WALL_HEIGHT = 1.1;
const WALL_THICKNESS = 0.14;
const DOOR_THICKNESS = 0.08;
const DOOR_SWING_MS = 260;

const WALL_COLOR = new THREE.Color(0x8d8578);
const WALL_HOVER_COLOR = new THREE.Color(0xe27a6b);
const DOOR_COLOR = 0x7a4a26;

interface DoorEntry {
	pivot: THREE.Group;
	material: THREE.MeshStandardMaterial;
	angle: number;
	target: number;
	key: string;
}

export class WallLayer {
	readonly group = new THREE.Group();
	private grid: SquareGrid | null = null;
	private wallGeometry = new THREE.BoxGeometry(1, WALL_HEIGHT, WALL_THICKNESS);
	private wallMaterial = new THREE.MeshStandardMaterial({ roughness: 0.85 });
	private walls: THREE.InstancedMesh | null = null;
	/** Object id for each wall instance, so picking can map back to the wall. */
	private instanceOwner: string[] = [];
	private doorGeometry = new THREE.BoxGeometry(1, WALL_HEIGHT * 0.92, DOOR_THICKNESS);
	private doors = new Map<string, DoorEntry>();
	private hoveredId: string | null = null;
	private objects: readonly SceneObject[] = [];

	/** Rebuilds wall instances and diffs doors. Walls change rarely, so a full instance refresh is fine. */
	sync(objects: readonly SceneObject[], grid: SquareGrid): void {
		const gridChanged =
			!this.grid ||
			this.grid.width !== grid.width ||
			this.grid.height !== grid.height ||
			this.grid.cellSize !== grid.cellSize;
		this.grid = { ...grid };
		this.objects = objects;
		this.rebuildWalls(objects, grid);

		const seen = new Set<string>();
		for (const o of objects) {
			if (o.kind !== 'door') continue;
			seen.add(o.id);
			const key = edgeKey(o);
			let entry = this.doors.get(o.id);
			if (entry && (entry.key !== key || gridChanged)) {
				this.removeDoor(o.id);
				entry = undefined;
			}
			if (!entry) entry = this.createDoor(o, grid);
			entry.target = o.open ? Math.PI / 2 : 0;
		}
		for (const id of [...this.doors.keys()]) if (!seen.has(id)) this.removeDoor(id);
		this.applyHover();
	}

	/** Advances door swings by `dt` ms. Returns true while any door is still moving. */
	tick(dt: number): boolean {
		let moving = false;
		const step = (Math.PI / 2) * (dt / DOOR_SWING_MS);
		for (const entry of this.doors.values()) {
			if (entry.angle === entry.target) continue;
			const delta = entry.target - entry.angle;
			entry.angle = Math.abs(delta) <= step ? entry.target : entry.angle + Math.sign(delta) * step;
			entry.pivot.rotation.y = -entry.angle;
			if (entry.angle !== entry.target) moving = true;
		}
		return moving;
	}

	/** Id of the wall or door under the ray, if any. */
	pick(raycaster: THREE.Raycaster): string | null {
		const hit = raycaster.intersectObject(this.group, true)[0];
		if (!hit) return null;
		if (hit.object === this.walls && hit.instanceId !== undefined) {
			return this.instanceOwner[hit.instanceId] ?? null;
		}
		for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
			if (typeof o.userData.objectId === 'string') return o.userData.objectId;
		}
		return null;
	}

	/** Tints one object, e.g. the target of the erase tool. Returns true if anything changed. */
	setHovered(id: string | null): boolean {
		if (id === this.hoveredId) return false;
		this.hoveredId = id;
		this.applyHover();
		return true;
	}

	dispose(): void {
		for (const id of [...this.doors.keys()]) this.removeDoor(id);
		if (this.walls) this.walls.dispose();
		this.wallGeometry.dispose();
		this.wallMaterial.dispose();
		this.doorGeometry.dispose();
	}

	private rebuildWalls(objects: readonly SceneObject[], grid: SquareGrid): void {
		// Each unit edge once, even if two walls overlap there.
		const units = new Map<string, { owner: string; matrix: THREE.Matrix4 }>();
		for (const o of objects) {
			if (o.kind !== 'wall') continue;
			for (const e of unitEdges(o.a, o.b)) {
				const key = edgeKey(e);
				if (units.has(key)) continue;
				const p = cornerToWorld(grid, e.a);
				const q = cornerToWorld(grid, e.b);
				const vertical = e.a.x === e.b.x;
				const matrix = new THREE.Matrix4().compose(
					new THREE.Vector3((p.x + q.x) / 2, (WALL_HEIGHT * grid.cellSize) / 2, (p.z + q.z) / 2),
					new THREE.Quaternion().setFromAxisAngle(
						new THREE.Vector3(0, 1, 0),
						vertical ? Math.PI / 2 : 0
					),
					// Slightly longer than a cell so corners close up without gaps.
					new THREE.Vector3(grid.cellSize * (1 + WALL_THICKNESS), grid.cellSize, grid.cellSize)
				);
				units.set(key, { owner: o.id, matrix });
			}
		}

		const count = units.size;
		if (!this.walls || this.walls.instanceMatrix.count < count) {
			if (this.walls) {
				this.group.remove(this.walls);
				this.walls.dispose();
			}
			// Grow in chunks so building a wall edge by edge does not reallocate every time.
			const capacity = Math.max(64, Math.ceil(count * 1.5));
			this.walls = new THREE.InstancedMesh(this.wallGeometry, this.wallMaterial, capacity);
			this.walls.castShadow = true;
			this.walls.receiveShadow = true;
			this.group.add(this.walls);
		}
		this.instanceOwner = [];
		let i = 0;
		for (const { owner, matrix } of units.values()) {
			this.walls.setMatrixAt(i, matrix);
			this.walls.setColorAt(i, WALL_COLOR);
			this.instanceOwner.push(owner);
			i++;
		}
		this.walls.count = count;
		this.walls.instanceMatrix.needsUpdate = true;
		if (this.walls.instanceColor) this.walls.instanceColor.needsUpdate = true;
		this.walls.computeBoundingSphere();
	}

	private createDoor(door: Door, grid: SquareGrid): DoorEntry {
		const hinge = cornerToWorld(grid, door.a);
		const vertical = door.a.x === door.b.x;
		const material = new THREE.MeshStandardMaterial({ color: DOOR_COLOR, roughness: 0.6 });
		const panel = new THREE.Mesh(this.doorGeometry, material);
		panel.castShadow = true;
		panel.receiveShadow = true;
		// The panel extends from the hinge along the edge; rotating the pivot swings it open.
		panel.position.set(0.5, (WALL_HEIGHT * 0.92) / 2, 0);
		panel.scale.set(0.96, 1, 1);
		const pivot = new THREE.Group();
		pivot.add(panel);
		pivot.userData.objectId = door.id;
		pivot.position.set(hinge.x, 0, hinge.z);
		pivot.scale.setScalar(grid.cellSize);
		// Frame: the edge direction becomes the pivot's +x.
		const frame = new THREE.Group();
		frame.rotation.y = vertical ? -Math.PI / 2 : 0;
		frame.position.copy(pivot.position);
		pivot.position.set(0, 0, 0);
		frame.add(pivot);
		frame.userData.objectId = door.id;
		this.group.add(frame);
		const angle = door.open ? Math.PI / 2 : 0;
		pivot.rotation.y = -angle;
		const entry: DoorEntry = { pivot, material, angle, target: angle, key: edgeKey(door) };
		this.doors.set(door.id, entry);
		return entry;
	}

	private removeDoor(id: string): void {
		const entry = this.doors.get(id);
		if (!entry) return;
		const frame = entry.pivot.parent!;
		this.group.remove(frame);
		entry.material.dispose();
		this.doors.delete(id);
	}

	private applyHover(): void {
		for (const [id, entry] of this.doors) {
			entry.material.emissive.setHex(id === this.hoveredId ? 0x5a2a10 : 0x000000);
		}
		if (!this.walls) return;
		const hoveredWall = this.objects.some((o) => o.id === this.hoveredId && o.kind === 'wall');
		for (let i = 0; i < this.walls.count; i++) {
			const hot = hoveredWall && this.instanceOwner[i] === this.hoveredId;
			this.walls.setColorAt(i, hot ? WALL_HOVER_COLOR : WALL_COLOR);
		}
		if (this.walls.instanceColor) this.walls.instanceColor.needsUpdate = true;
	}
}
