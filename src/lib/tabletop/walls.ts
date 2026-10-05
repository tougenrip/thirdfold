// Walls and doors (#252). Walls are the pieces autotile picks (world/autotile.ts) from what
// the viewer was sent: runs, posts, caps, retaining pieces and plinths, window and door frames.
// Per 16x16 chunk a BatchedMesh per material (the built-in pieces in the wall look; a kit's in
// its baked vertex colours), rebuilt only when `dirtyPieceChunks` says so. The surface kind's
// `batched` variant: an instance's colour is a slight shade by its seed, its alpha the erase
// highlight (a hatched glow). Picks hit an invisible proxy of boxes from `wallSpans` on
// PICK_LAYER. Door leaves (#253, door-leaves.ts) are one more batch in the kit's material, the
// kit's leaf or the built-in one, swung on the hinge; their frames and windows' are pieces here.

import * as THREE from 'three/webgpu';
import { pickable } from './picking';
import { cornerToWorld, type SquareGrid } from '$lib/game/grid';
import { orderCorners, unitEdges, type SceneObject } from '$lib/game/objects';
import { addPiece, colourOf, geometryOf, newBatch, type Batch } from './batch';
import { DoorLeaves, type LeafSpec } from './door-leaves';
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

const PLAIN_WALL = { color: 0x8d8578, roughness: 0.85 };
/** A kit's pieces carry their colours; the material only finishes them. */
const KIT_WALL = { color: 0xffffff, roughness: 0.85 };

/** A kit's pieces as drawn: each role's variants with their weights (a role it lacks is procedural). */
export type WallKit = Partial<Record<BatchRole, { mesh: PieceMesh; weight: number }[]>>;

/** What the stats report: chunks with a batch, instances, and how many the last sync rebuilt. */
export interface WallStats {
	chunks: number;
	instances: number;
	lastRebuilt: number;
}

export class WallLayer {
	readonly group = new THREE.Group();
	private grid: SquareGrid | null = null;
	/** The built-in pieces' material, in the environment's wall look. */
	private material: KindMaterial = createMaterial('surface', { batched: true, antiTiled: true });
	/** A kit's pieces' material: their surfaces are baked into vertex colours (#261). */
	private kitMaterial: KindMaterial = createMaterial('surface', {
		batched: true,
		antiTiled: true,
		vertexColors: true
	});
	private look: Look | null = null;
	private kit: WallKit | null = null;
	private weights: KitWeights = {};
	private interior: Uint8Array | null = null;
	/** By chunk and material: `chunk * 2`, plus 1 for the kit's pieces. */
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
	private leaves: DoorLeaves;
	private hoveredId: string | null = null;
	private hoveredEdges = new Set<number>();

	/** Door swings run on `clock`, the tabletop's (ms), not on frame steps. */
	constructor(
		private readonly build: WorldBuilders,
		clock: () => number = () => performance.now()
	) {
		this.leaves = new DoorLeaves(this.group, this.kitMaterial, clock);
		wear(this.material, null, PLAIN_WALL);
		wear(this.kitMaterial, null, KIT_WALL);
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
		this.leaves.dispose();
		this.retile();
		this.syncLeaves();
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
		this.kitMaterial = twinOf(this.kitMaterial);
		for (const [slot, b] of this.batches) b.mesh.material = this.materialOf(slot);
		this.standIns?.forEach((s, m) => (s.material = this.materialOf(m)));
		this.leaves.setMaterial(this.kitMaterial);
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
		this.syncLeaves();
		this.applyHover();
	}

	/** Swings door leaves to where they are at time `now`. True while any is still moving. */
	tick(now: number): boolean {
		return this.leaves.tick(now);
	}

	/** Door swings snap under reduced motion. */
	setReducedMotion(reduced: boolean): void {
		this.leaves.setReducedMotion(reduced);
	}

	/** Door leaves' angles by door, for tests. */
	doorAngles(): Map<string, number> {
		return this.leaves.angles();
	}

	/** Id of the wall or door under the ray, if any. */
	pick(raycaster: THREE.Raycaster): string | null {
		const hit = raycaster.intersectObject(this.group, true)[0];
		if (!hit) return null;
		if (hit.object === this.proxy && hit.instanceId !== undefined) {
			return this.instanceOwner[hit.instanceId] ?? null;
		}
		return this.leaves.owner(hit.object, hit.batchId);
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
		const chunks = new Set([...this.batches.keys()].map((slot) => slot >> 1)).size;
		return { chunks, instances, lastRebuilt: this.lastRebuilt };
	}

	/** A stand-in for the warm-up (#180): a casting batch, so the first wall drawn compiles nothing. */
	gallery(): THREE.Object3D[] {
		if (!this.standIns) {
			const piece = this.build.proceduralPiece('wall.straight');
			this.standIns = [0, 1].map((m) => {
				const b = newBatch(this.materialOf(m));
				const colors = m ? new Float32Array(piece.positions.length).fill(1) : undefined;
				const id = b.mesh.addGeometry(geometryOf({ ...piece, colors }));
				b.mesh.setColorAt(b.mesh.addInstance(id), new THREE.Vector4(1, 1, 1, 1));
				return standIn(b.mesh);
			});
		}
		this.standIns.forEach((s, m) => (s.material = this.materialOf(m)));
		return this.standIns;
	}

	dispose(): void {
		this.leaves.dispose();
		this.clear();
		this.proxy?.dispose();
		for (const s of this.standIns ?? []) s.dispose();
		this.proxyGeometry.dispose();
		disposeTwins(this.material);
		disposeTwins(this.kitMaterial);
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
		const { VARIANTS } = this.build;
		for (const [c, pieces] of this.build.autotile(input, dirty)) {
			const inst = this.build.wallInstances(pieces, shape.grid, this.weights);
			// The built-in pieces and the kit's, each in a batch of their own material.
			const byMaterial: number[][] = [[], []];
			for (let i = 0; i < inst.count; i++) byMaterial[+(inst.key[i] % VARIANTS !== 0)].push(i);
			byMaterial.forEach((list, m) => this.fill(c * 2 + m, inst, list));
		}
		this.drawn = input;
		this.lastRebuilt = dirty.length;
	}

	/** Slot or material index 0: the built-in pieces' material; odd: the kit's. */
	private materialOf(slot: number): KindMaterial {
		return slot & 1 ? this.kitMaterial : this.material;
	}

	/** A batch's instances (`list`, of `inst`), reusing its ids; a batch with none goes. */
	private fill(slot: number, inst: WallInstances, list: number[]): void {
		let b = this.batches.get(slot);
		if (!list.length) {
			if (b) {
				this.group.remove(b.mesh);
				b.mesh.dispose();
				this.batches.delete(slot);
			}
			return;
		}
		if (!b) {
			b = newBatch(this.materialOf(slot));
			this.batches.set(slot, b);
			this.group.add(b.mesh);
		}
		const { mesh } = b;
		for (const i of list) if (!b.geometries.has(inst.key[i])) this.addPiece(b, inst.key[i]);
		while (b.ids.length > list.length) mesh.deleteInstance(b.ids.pop()!);
		if (list.length > mesh.maxInstanceCount) {
			const size = Math.ceil(list.length * 1.5);
			mesh.setInstanceCount(size);
			const edges = new Int32Array(size).fill(-1);
			edges.set(b.edges);
			b.edges = edges;
		}
		const first = b.geometries.get(inst.key[list[0]])!;
		while (b.ids.length < list.length) b.ids.push(mesh.addInstance(first));
		const m = new THREE.Matrix4();
		for (let n = 0; n < list.length; n++) {
			const [id, i] = [b.ids[n], list[n]];
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
		addPiece(
			b,
			key,
			variant < 0 ? this.build.proceduralPiece(role) : this.kit![role]![variant].mesh
		);
	}

	/**
	 * Each door's leaf (#253), the kit's variant by the edge's seed or the built-in one, where its
	 * edge is drawn as a door: a door under a wall or window shows that, and one with no known side
	 * nothing (autotile's views).
	 */
	private syncLeaves(): void {
		const input = this.drawn;
		if (!input || !this.state) return;
		const { EDGE_BUILT, VARIANTS, BATCH_ROLES, keySeed, proceduralPiece, variantOf } = this.build;
		const role = BATCH_ROLES.indexOf('door.leaf');
		const weights = this.weights['door.leaf'];
		const w = input.shape.grid.width;
		const out: LeafSpec[] = [];
		for (const o of this.state.objects) {
			if (o.kind !== 'door') continue;
			const { a, b } = orderCorners(o.a, o.b);
			const vertical = a.x === b.x;
			const axis = vertical ? 'v' : 'h';
			const view = input.views[axis][vertical ? a.y * (w + 1) + a.x : a.y * w + a.x];
			if (view?.kind !== EDGE_BUILT.door) continue;
			const seed = keySeed(axis, a.x, a.y);
			const variant = weights ? variantOf(seed, weights) : -1;
			const mesh =
				variant < 0 ? proceduralPiece('door.leaf') : this.kit!['door.leaf']![variant].mesh;
			const key = role * VARIANTS + variant + 1;
			out.push({ id: o.id, key, mesh, at: a, vertical, floor: view.high, open: o.open, seed });
		}
		this.leaves.sync(out, input.shape.grid);
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

	/** The hovered door's leaf, and the hovered wall's edges' pieces, lit. */
	private applyHover(): void {
		this.leaves.setHovered(this.hoveredId);
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
