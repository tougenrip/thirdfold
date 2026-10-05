// Walls and doors for the three.js view (#252). Walls are built from the pieces
// autotile picks (world/autotile.ts) for what the viewer was sent: straight runs,
// posts at ends, L, T and X joints, caps, retaining pieces and plinths down drops,
// window frames and door lintels. Each 16x16 chunk is one BatchedMesh (every
// piece of the kit's material: one multi-draw on WebGL2), rebuilt only when its
// pieces may have changed (`dirtyPieceChunks`). A role the environment's kit
// fills draws its variants; any other the built-in piece (world/wall-batch.ts),
// so every table draws walls before and without a kit.
//
// Walls are the surface kind's `batched` variant (#172), world-mapped (#177),
// anti-tiled on medium and up (#181). An instance's colour is a slight tint by
// its seed, and its alpha the highlight (the erase tool's target): an emissive
// glow with a hatch. Picking uses an invisible proxy: one box per unit of wall
// (the old walls' boxes, from `wallSpans`) on PICK_LAYER; the pieces are off it.
//
// Doors are individual hinged meshes that swing open (their leaves are #253's):
// a second material of the `local` variant, and its tinted twin for the hovered
// door, so swapping between them compiles nothing.

import * as THREE from 'three/webgpu';
import { pickable } from './picking';
import { cornerToWorld, type SquareGrid } from '$lib/game/grid';
import { edgeKey, unitEdges, type Door, type SceneObject } from '$lib/game/objects';
import { wear, type Look } from './environment';
import { STEP_HEIGHT, WALL_HEIGHT, type Ground } from './ground';
import { standIn } from './warmup';
import { wallSpans } from './world/wall-spans';
import type { TileInput } from './world/autotile';
import type { WorldShape } from './world/shape';
import type { BatchRole, KitWeights, PieceMesh, WallInstances } from './world/wall-batch';
import type { WorldBuilders } from './world-layer';
import {
	createMaterial,
	disposeTwins,
	repeatFor,
	setParams,
	twinOf,
	type KindMaterial
} from './materials';

export { WALL_HEIGHT };
const WALL_THICKNESS = 0.14;
const DOOR_THICKNESS = 0.08;
const DOOR_SWING_MS = 260;

const PLAIN_WALL = { color: 0x8d8578, roughness: 0.85 };
const DOOR = { color: 0x7a4a26, roughness: 0.6 };
const DOOR_HOVER = 0x5a2a10;
/** How far a piece's seed darkens it: a slight variation from piece to piece. */
const TINT = 0.06;

/** A kit's pieces as drawn: each role's variants with their weights (a role it lacks is procedural). */
export type WallKit = Partial<Record<BatchRole, { mesh: PieceMesh; weight: number }[]>>;

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

/** One chunk's pieces: its batch, the geometry id of each piece key, and each instance's edge. */
interface Batch {
	mesh: THREE.BatchedMesh;
	geometries: Map<number, number>;
	ids: number[];
	edges: Int32Array;
	/** Its vertex and index space. */
	space: [number, number];
}

/** What the stats report: chunks with a batch, instances, and how many the last sync rebuilt. */
export interface WallStats {
	chunks: number;
	instances: number;
	lastRebuilt: number;
}

export class WallLayer {
	readonly group = new THREE.Group();
	private grid: SquareGrid | null = null;
	private material: KindMaterial = createMaterial('surface', { batched: true, antiTiled: true });
	private doorMaterial = createMaterial('surface', { local: true, params: DOOR });
	private doorHoverMaterial = createMaterial('surface', {
		local: true,
		params: { ...DOOR, tint: DOOR_HOVER }
	});
	private look: Look | null = null;
	private kit: WallKit | null = null;
	private weights: KitWeights = {};
	private interior: Uint8Array | null = null;
	private batches = new Map<number, Batch>();
	/** The tile input last drawn (null: draw every chunk next). */
	private drawn: TileInput | null = null;
	private state: { objects: readonly SceneObject[]; shape: WorldShape; ground: Ground } | null =
		null;
	private lastRebuilt = 0;
	private standIns: THREE.BatchedMesh[] | null = null;
	/** The invisible boxes picks hit, and the wall each belongs to. */
	private proxy: THREE.InstancedMesh | null = null;
	private proxyGeometry = new THREE.BoxGeometry(1, 1, WALL_THICKNESS);
	private instanceOwner: string[] = [];
	private doorGeometry = new THREE.BoxGeometry(1, WALL_HEIGHT * 0.92, DOOR_THICKNESS);
	private doors = new Map<string, DoorEntry>();
	private hoveredId: string | null = null;
	private hoveredEdges = new Set<number>();

	/** Door swings run on `clock`, the tabletop's (ms), not on frame steps. */
	constructor(
		private readonly build: WorldBuilders,
		private readonly clock: () => number = () => performance.now()
	) {
		wear(this.material, null, PLAIN_WALL);
	}

	/** The environment's walls (null: plain stone) and its kit (null: every piece procedural). */
	setLook(look: Look | null, kit: WallKit | null = null): void {
		this.look = look;
		wear(this.material, look, PLAIN_WALL);
		this.tile();
		if (kit === this.kit) return;
		this.kit = kit;
		this.weights = Object.fromEntries(
			Object.entries(kit ?? {}).map(([role, list]) => [role, list.map((v) => v.weight)])
		);
		// Piece keys name a role's variant, so another kit's pieces need batches of their own.
		this.clear();
		this.retile();
	}

	/** The building context (the interior mask as sent): boundary walls stand outside it. */
	setInterior(mask: Uint8Array | null): void {
		if (mask === this.interior) return;
		this.interior = mask;
		this.retile();
	}

	/**
	 * The tier's anti-tiling (#181): the walls' material made again in that variant, once.
	 * True if remade: the renderer warms the new variant up, not compiling it mid-frame.
	 */
	setAntiTiled(on: boolean): boolean {
		if (!!this.material.options.antiTiled === on) return false;
		// Its twin, kept (#180): switching back and again releases and compiles nothing.
		this.material = twinOf(this.material);
		for (const b of this.batches.values()) b.mesh.material = this.material;
		for (const s of this.standIns ?? []) s.material = this.material;
		if (this.proxy) this.proxy.material = this.material;
		return true;
	}

	/** One repeat of the look across `look.cells` cells, and up in whole steps (#177). */
	private tile(): void {
		const repeat = repeatFor(this.look?.cells ?? 1, this.grid?.cellSize ?? 1, STEP_HEIGHT);
		setParams(this.material, { repeat });
	}

	/** Rebuilds the pieces that may have changed, the picking proxy and the doors. */
	sync(objects: readonly SceneObject[], shape: WorldShape, ground: Ground): void {
		const grid = shape.grid;
		const gridChanged =
			!this.grid ||
			this.grid.width !== grid.width ||
			this.grid.height !== grid.height ||
			this.grid.cellSize !== grid.cellSize;
		this.grid = { ...grid };
		if (gridChanged) this.clear();
		this.tile();
		this.state = { objects, shape, ground };
		this.retile();
		this.rebuildProxy(objects, grid, ground, shape.known);

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
		if (hit.object === this.proxy && hit.instanceId !== undefined) {
			return this.instanceOwner[hit.instanceId] ?? null;
		}
		for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
			if (typeof o.userData.objectId === 'string') return o.userData.objectId;
		}
		return null;
	}

	/** Highlights one object, e.g. the target of the erase tool. Returns true if anything changed. */
	setHovered(id: string | null): boolean {
		if (id === this.hoveredId) return false;
		this.hoveredId = id;
		this.applyHover();
		return true;
	}

	stats(): WallStats {
		let instances = 0;
		for (const b of this.batches.values()) instances += b.ids.length;
		return { chunks: this.batches.size, instances, lastRebuilt: this.lastRebuilt };
	}

	/** A stand-in for the warm-up (#180): a casting batch, so the first wall drawn compiles nothing. */
	gallery(): THREE.Object3D[] {
		if (!this.standIns) {
			const b = this.makeBatch();
			const id = b.mesh.addGeometry(geometryOf(this.build.proceduralPiece('wall.straight')));
			b.mesh.setColorAt(b.mesh.addInstance(id), new THREE.Vector4(1, 1, 1, 1));
			this.standIns = [standIn(b.mesh)];
		}
		for (const s of this.standIns) s.material = this.material;
		return this.standIns;
	}

	dispose(): void {
		for (const id of [...this.doors.keys()]) this.removeDoor(id);
		this.clear();
		this.proxy?.dispose();
		for (const s of this.standIns ?? []) s.dispose();
		this.proxyGeometry.dispose();
		disposeTwins(this.material);
		for (const m of [this.doorMaterial, this.doorHoverMaterial]) m.dispose();
		this.doorGeometry.dispose();
	}

	/** Every batch gone: the next tiling draws every chunk. */
	private clear(): void {
		for (const b of this.batches.values()) {
			this.group.remove(b.mesh);
			b.mesh.dispose();
		}
		this.batches.clear();
		this.drawn = null;
	}

	/** Draws the chunks whose pieces may have changed since the input last drawn. */
	private retile(): void {
		if (!this.state) return;
		const { objects, shape } = this.state;
		const input = this.build.tileInput(shape, objects, this.interior);
		const dirty = this.build.dirtyPieceChunks(this.drawn, input);
		for (const [c, pieces] of this.build.autotile(input, dirty))
			this.fill(c, this.build.wallInstances(pieces, shape.grid, this.weights));
		this.drawn = input;
		this.lastRebuilt = dirty.length;
	}

	private makeBatch(): Batch {
		const mesh = new THREE.BatchedMesh(64, 1024, 2048, this.material);
		// The colours exist from the start: a batch without them is another program (#252).
		(mesh as unknown as { _initColorsTexture(): void })._initColorsTexture();
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		const edges = new Int32Array(64).fill(-1);
		return { mesh, geometries: new Map(), ids: [], edges, space: [1024, 2048] };
	}

	/** A chunk's instances, reusing its batch's ids; a chunk with none has no batch. */
	private fill(c: number, inst: WallInstances): void {
		let b = this.batches.get(c);
		if (!inst.count) {
			if (b) {
				this.group.remove(b.mesh);
				b.mesh.dispose();
				this.batches.delete(c);
			}
			return;
		}
		if (!b) {
			b = this.makeBatch();
			this.batches.set(c, b);
			this.group.add(b.mesh);
		}
		const { mesh } = b;
		for (const key of new Set(inst.key)) if (!b.geometries.has(key)) this.addPiece(b, key);
		while (b.ids.length > inst.count) mesh.deleteInstance(b.ids.pop()!);
		if (inst.count > mesh.maxInstanceCount) {
			const size = Math.ceil(inst.count * 1.5);
			mesh.setInstanceCount(size);
			const edges = new Int32Array(size).fill(-1);
			edges.set(b.edges);
			b.edges = edges;
		}
		const first = b.geometries.get(inst.key[0])!;
		while (b.ids.length < inst.count) b.ids.push(mesh.addInstance(first));
		const m = new THREE.Matrix4();
		for (let i = 0; i < inst.count; i++) {
			const id = b.ids[i];
			mesh.setGeometryIdAt(id, b.geometries.get(inst.key[i])!);
			mesh.setMatrixAt(id, m.fromArray(inst.matrices, i * 16));
			b.edges[id] = inst.edge[i];
			mesh.setColorAt(id, colourOf(inst.seed[i], this.hoveredEdges.has(inst.edge[i])));
		}
		mesh.computeBoundingBox();
		mesh.computeBoundingSphere();
	}

	/** A piece's geometry in a batch: the kit's variant, or the built-in piece (`pieceKey`). */
	private addPiece(b: Batch, key: number): void {
		const { VARIANTS, roleOfKey } = this.build;
		const role = roleOfKey(key);
		const variant = (key % VARIANTS) - 1;
		const piece = variant < 0 ? this.build.proceduralPiece(role) : this.kit![role]![variant].mesh;
		const geometry = geometryOf(piece);
		const [v, i] = [piece.positions.length / 3, piece.indices.length];
		const { mesh } = b;
		if (mesh.unusedVertexCount < v || mesh.unusedIndexCount < i) {
			// Grown by half again what it needs (the space used, and this piece).
			const [vs, is] = b.space;
			b.space = [
				Math.ceil((vs - mesh.unusedVertexCount + v) * 1.5),
				Math.ceil((is - mesh.unusedIndexCount + i) * 1.5)
			];
			mesh.setGeometrySize(...b.space);
		}
		b.geometries.set(key, mesh.addGeometry(geometry));
		geometry.dispose();
	}

	/** The invisible boxes a pick hits: a unit of wall each (two for a window between equal floors). */
	private rebuildProxy(
		objects: readonly SceneObject[],
		grid: SquareGrid,
		ground: Ground,
		known: Uint8Array | null
	): void {
		const spans = wallSpans(grid, objects, ground.levels, known);
		if (!this.proxy || this.proxy.instanceMatrix.count < spans.length) {
			this.proxy?.removeFromParent();
			this.proxy?.dispose();
			const capacity = Math.max(64, Math.ceil(spans.length * 1.5));
			this.proxy = pickable(new THREE.InstancedMesh(this.proxyGeometry, this.material, capacity));
			this.proxy.visible = false; // raycasts test layers, not visibility
			this.group.add(this.proxy);
		}
		this.instanceOwner = spans.map((s) => s.owner);
		const m = new THREE.Matrix4();
		const [up, turn] = [new THREE.Vector3(0, 1, 0), new THREE.Quaternion()];
		spans.forEach(({ edge: e, bottom, top }, i) => {
			const p = cornerToWorld(grid, e.a);
			const q = cornerToWorld(grid, e.b);
			turn.setFromAxisAngle(up, e.a.x === e.b.x ? Math.PI / 2 : 0);
			// Slightly longer than a cell, so a pick at a corner finds a wall.
			const size = new THREE.Vector3(
				grid.cellSize * (1 + WALL_THICKNESS),
				top - bottom,
				grid.cellSize
			);
			const at = new THREE.Vector3((p.x + q.x) / 2, (bottom + top) / 2, (p.z + q.z) / 2);
			this.proxy!.setMatrixAt(i, m.compose(at, turn, size));
		});
		this.proxy.count = spans.length;
		this.proxy.instanceMatrix.needsUpdate = true;
		this.proxy.computeBoundingSphere();
	}

	private createDoor(door: Door, grid: SquareGrid, key: string, floor: number): DoorEntry {
		const hinge = cornerToWorld(grid, door.a);
		const vertical = door.a.x === door.b.x;
		const panel = pickable(new THREE.Mesh(this.doorGeometry, this.doorMaterial));
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

	/** The hovered door's material, and the hovered wall's edges' pieces lit. */
	private applyHover(): void {
		for (const [id, entry] of this.doors)
			entry.panel.material = id === this.hoveredId ? this.doorHoverMaterial : this.doorMaterial;
		const grid = this.grid;
		const wall = this.state?.objects.find((o) => o.id === this.hoveredId && o.kind === 'wall');
		const edges = new Set<number>();
		if (wall && grid)
			for (const e of unitEdges(wall.a, wall.b)) {
				const vertical = e.a.x === e.b.x;
				edges.add(this.build.edgeIndex(grid, vertical ? 'v' : 'h', e.a.x, e.a.y));
			}
		const changed = new Set([...edges, ...this.hoveredEdges]);
		this.hoveredEdges = edges;
		if (!changed.size) return;
		const colour = new THREE.Vector4();
		for (const b of this.batches.values())
			for (const id of b.ids) {
				if (!changed.has(b.edges[id])) continue;
				b.mesh.getColorAt(id, colour);
				b.mesh.setColorAt(id, colour.setW(edges.has(b.edges[id]) ? 0 : 1));
			}
	}
}

const tint = new THREE.Vector4();
/** A piece's colour: a slight shade by its seed; alpha 0 when highlighted (`batched`). */
function colourOf(seed: number, hot: boolean): THREE.Vector4 {
	const shade = 1 - TINT * (seed / 0x100000000);
	return tint.set(shade, shade, shade, hot ? 0 : 1);
}

/** A piece as a geometry a batch takes: positions, normals and triangles. */
function geometryOf(piece: PieceMesh): THREE.BufferGeometry {
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(piece.positions, 3));
	g.setAttribute('normal', new THREE.BufferAttribute(piece.normals, 3));
	g.setIndex(new THREE.BufferAttribute(piece.indices, 1));
	return g;
}
