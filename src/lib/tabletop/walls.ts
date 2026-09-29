// Walls and doors for the three.js view. Every unit of wall is one instance of
// a single InstancedMesh (one draw call however much wall there is); doors
// are individual hinged meshes that swing open. Presentation only: open/closed
// comes from the Door objects handed in. With elevation, a wall stands on the
// higher floor beside it and reaches down to the lower one (a balcony's edge
// is one face); a window is a low sill and, between equal floors, a lintel,
// with the gap between them to see through.
//
// Walls are the surface kind (#172), world-mapped so the texture runs on across
// units and heights (#177), anti-tiled on medium and up (#181); their colour is
// the material's and the hover an emissive tint per instance (`aTint`), so a
// textured wall is never multiplied by it. Door panels share one material of
// the `local` variant (their texture swings with them), and a second, the same
// but tinted, for the hovered door: swapping between them compiles nothing.

import * as THREE from 'three/webgpu';
import { cornerToWorld, type SquareGrid } from '$lib/game/grid';
import { edgeKey, unitEdges, type Door, type SceneObject } from '$lib/game/objects';
import { wear, type Look } from './environment';
import { STEP_HEIGHT, WALL_HEIGHT, type Ground } from './ground';
import {
	addInstanceTints,
	createMaterial,
	disposeTwins,
	repeatFor,
	setParams,
	TINT_ATTRIBUTE,
	twinOf,
	type KindMaterial
} from './materials';

export { WALL_HEIGHT };
/** A window's sill and lintel, as fractions of a wall above the floor. */
const SILL = 0.35;
const LINTEL = 0.8;
const WALL_THICKNESS = 0.14;
const DOOR_THICKNESS = 0.08;
const DOOR_SWING_MS = 260;

const PLAIN_WALL = { color: 0x8d8578, roughness: 0.85 };
/** The erase tool's target: an emissive tint (rgb and strength) on the wall's instances. */
const WALL_HOVER = { color: new THREE.Color(0xe27a6b), strength: 0.45 };
const DOOR = { color: 0x7a4a26, roughness: 0.6 };
const DOOR_HOVER = 0x5a2a10;

interface DoorEntry {
	pivot: THREE.Group;
	panel: THREE.Mesh;
	angle: number;
	target: number;
	/** The swing under way: the angle it left and when (the layer's clock). */
	from: number;
	start: number;
	key: string;
}

export class WallLayer {
	readonly group = new THREE.Group();
	private grid: SquareGrid | null = null;
	/** The walls' geometry, made again with the mesh as it grows (it carries the tints). */
	private wallGeometry: THREE.BoxGeometry | null = null;
	private wallMaterial: KindMaterial = createMaterial('surface', {
		instanced: true,
		antiTiled: true
	});
	private doorMaterial = createMaterial('surface', { local: true, params: DOOR });
	private doorHoverMaterial = createMaterial('surface', {
		local: true,
		params: { ...DOOR, tint: DOOR_HOVER }
	});
	private look: Look | null = null;

	/** Door swings run on `clock`, the tabletop's (ms), not on frame steps. */
	constructor(private readonly clock: () => number = () => performance.now()) {
		wear(this.wallMaterial, null, PLAIN_WALL);
	}

	/** The environment's walls (null: plain stone). */
	setLook(look: Look | null): void {
		this.look = look;
		wear(this.wallMaterial, look, PLAIN_WALL);
		this.tile();
	}

	/**
	 * The tier's anti-tiling (#181): the walls' material made again in that variant, once.
	 * True if remade: the renderer warms the new variant up, not compiling it mid-frame.
	 */
	setAntiTiled(on: boolean): boolean {
		if (!!this.wallMaterial.options.antiTiled === on) return false;
		// Its twin, kept (#180): switching back releases nothing and the warm-up compiled it.
		this.wallMaterial = twinOf(this.wallMaterial);
		if (this.walls) this.walls.material = this.wallMaterial;
		return true;
	}

	/** One repeat of the look across `look.cells` cells, and up in whole steps (#177). */
	private tile(): void {
		const repeat = repeatFor(this.look?.cells ?? 1, this.grid?.cellSize ?? 1, STEP_HEIGHT);
		setParams(this.wallMaterial, { repeat });
	}
	private walls: THREE.InstancedMesh | null = null;
	/** Object id for each wall instance, so picking can map back to the wall. */
	private instanceOwner: string[] = [];
	private doorGeometry = new THREE.BoxGeometry(1, WALL_HEIGHT * 0.92, DOOR_THICKNESS);
	private doors = new Map<string, DoorEntry>();
	private hoveredId: string | null = null;
	private objects: readonly SceneObject[] = [];

	/** Rebuilds wall instances and diffs doors. Walls change rarely, so a full instance refresh is fine. */
	sync(objects: readonly SceneObject[], grid: SquareGrid, ground: Ground): void {
		const gridChanged =
			!this.grid ||
			this.grid.width !== grid.width ||
			this.grid.height !== grid.height ||
			this.grid.cellSize !== grid.cellSize;
		this.grid = { ...grid };
		this.tile();
		this.objects = objects;
		this.rebuildWalls(objects, grid, ground);

		const seen = new Set<string>();
		for (const o of objects) {
			if (o.kind !== 'door') continue;
			seen.add(o.id);
			const key = `${edgeKey(o)}@${ground.edgeFloors(o).high}`;
			let entry = this.doors.get(o.id);
			if (entry && (entry.key !== key || gridChanged)) {
				this.removeDoor(o.id);
				entry = undefined;
			}
			if (!entry) entry = this.createDoor(o, grid, key, ground.edgeFloors(o).high);
			const target = o.open ? Math.PI / 2 : 0;
			if (target !== entry.target) {
				entry.from = entry.angle;
				entry.start = this.clock();
				entry.target = target;
			}
		}
		for (const id of [...this.doors.keys()]) if (!seen.has(id)) this.removeDoor(id);
		this.applyHover();
	}

	/** Swings doors to where they are at time `now`. Returns true while any is still moving. */
	tick(now: number): boolean {
		let moving = false;
		for (const entry of this.doors.values()) {
			if (entry.angle === entry.target) continue;
			// A quarter turn takes DOOR_SWING_MS; a swing reversed halfway takes what is left.
			const span = entry.target - entry.from;
			const k = Math.min(
				(now - entry.start) / ((DOOR_SWING_MS * Math.abs(span)) / (Math.PI / 2)),
				1
			);
			entry.angle = k >= 1 ? entry.target : entry.from + span * k;
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
		this.wallGeometry?.dispose();
		disposeTwins(this.wallMaterial);
		for (const m of [this.doorMaterial, this.doorHoverMaterial]) m.dispose();
		this.doorGeometry.dispose();
	}

	private rebuildWalls(objects: readonly SceneObject[], grid: SquareGrid, ground: Ground): void {
		// Each unit edge once, even if two walls overlap there; a window is two pieces.
		const units = new Map<string, { owner: string; matrix: THREE.Matrix4 }[]>();
		const height = WALL_HEIGHT * grid.cellSize;
		for (const o of objects) {
			if (o.kind !== 'wall') continue;
			for (const e of unitEdges(o.a, o.b)) {
				const key = edgeKey(e);
				if (units.has(key)) continue;
				const p = cornerToWorld(grid, e.a);
				const q = cornerToWorld(grid, e.b);
				const vertical = e.a.x === e.b.x;
				const { low, high } = ground.edgeFloors(e);
				const spans: [number, number][] = o.window
					? [
							[low, high + height * SILL],
							...(high === low ? [[high + height * LINTEL, high + height] as [number, number]] : [])
						]
					: [[low, high + height]];
				units.set(
					key,
					spans.map(([bottom, top]) => ({
						owner: o.id,
						matrix: new THREE.Matrix4().compose(
							new THREE.Vector3((p.x + q.x) / 2, (bottom + top) / 2, (p.z + q.z) / 2),
							new THREE.Quaternion().setFromAxisAngle(
								new THREE.Vector3(0, 1, 0),
								vertical ? Math.PI / 2 : 0
							),
							// Slightly longer than a cell so corners close up without gaps.
							new THREE.Vector3(grid.cellSize * (1 + WALL_THICKNESS), top - bottom, grid.cellSize)
						)
					}))
				);
			}
		}

		const count = [...units.values()].reduce((n, pieces) => n + pieces.length, 0);
		if (!this.walls || this.walls.instanceMatrix.count < count) {
			if (this.walls) {
				this.group.remove(this.walls);
				this.walls.dispose();
				this.wallGeometry?.dispose();
			}
			// Grow in chunks so building a wall edge by edge does not reallocate every time.
			const capacity = Math.max(64, Math.ceil(count * 1.5));
			this.wallGeometry = new THREE.BoxGeometry(1, 1, WALL_THICKNESS);
			addInstanceTints(this.wallGeometry, capacity);
			this.walls = new THREE.InstancedMesh(this.wallGeometry, this.wallMaterial, capacity);
			this.walls.castShadow = true;
			this.walls.receiveShadow = true;
			this.group.add(this.walls);
		}
		this.instanceOwner = [];
		let i = 0;
		for (const pieces of units.values()) {
			for (const { owner, matrix } of pieces) {
				this.walls.setMatrixAt(i, matrix);
				this.instanceOwner.push(owner);
				i++;
			}
		}
		this.walls.count = count;
		this.walls.instanceMatrix.needsUpdate = true;
		this.walls.computeBoundingSphere();
	}

	private createDoor(door: Door, grid: SquareGrid, key: string, floor: number): DoorEntry {
		const hinge = cornerToWorld(grid, door.a);
		const vertical = door.a.x === door.b.x;
		const panel = new THREE.Mesh(this.doorGeometry, this.doorMaterial);
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
		frame.position.copy(pivot.position).setY(floor);
		pivot.position.set(0, 0, 0);
		frame.add(pivot);
		frame.userData.objectId = door.id;
		this.group.add(frame);
		const angle = door.open ? Math.PI / 2 : 0;
		pivot.rotation.y = -angle;
		const entry: DoorEntry = { pivot, panel, angle, target: angle, from: angle, start: 0, key };
		this.doors.set(door.id, entry);
		return entry;
	}

	private removeDoor(id: string): void {
		const entry = this.doors.get(id);
		if (!entry) return;
		const frame = entry.pivot.parent!;
		this.group.remove(frame);
		this.doors.delete(id);
	}

	private applyHover(): void {
		for (const [id, entry] of this.doors)
			entry.panel.material = id === this.hoveredId ? this.doorHoverMaterial : this.doorMaterial;
		if (!this.walls) return;
		const hoveredWall = this.objects.some((o) => o.id === this.hoveredId && o.kind === 'wall');
		const tints = this.walls.geometry.getAttribute(
			TINT_ATTRIBUTE
		) as THREE.InstancedBufferAttribute;
		const { color, strength } = WALL_HOVER;
		for (let i = 0; i < this.walls.count; i++) {
			const hot = hoveredWall && this.instanceOwner[i] === this.hoveredId;
			tints.setXYZW(i, color.r, color.g, color.b, hot ? strength : 0);
		}
		tints.needsUpdate = true;
	}
}
