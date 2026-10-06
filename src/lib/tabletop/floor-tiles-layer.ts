// Kit floor tiles drawn (#254): one InstancedMesh per variant geometry of the
// kit (never BatchedMesh: WebGPU would draw each tile on its own), on the
// instanced prop kind (vertex colours and the bake, as props are), so they take
// `worldModify`'s fog and dark and receive the sun's shadow without casting one.
// Pieces come from world/floor-tiles.ts (the lazy `world` chunk) per 16x16
// chunk; this layer packs those near the camera into the meshes and sets the
// ring's uniforms (materials/ring.ts), so a camera move rebuilds nothing.
//
// r186 gives every new InstancedMesh a vertex stage of its own, so the meshes
// are a pool made only with a new kit, table or ring size (each a warm-up,
// `onPool`), sized for the ring and never grown: painting floors, exploring and
// moving the camera only rewrite instance matrices and counts. A mesh with no
// tiles keeps one instance at zero scale, so every mesh is drawn (and compiled)
// from the first frame. The tiles are the environment's kit's (`KitDef.floors`),
// loaded as models; a table whose kit has none keeps the blended ground.

import * as THREE from 'three/webgpu';
import { loadManifest } from '$lib/assets/load';
import type { KitPiece } from '$lib/assets/kit';
import { FLOOR_IDS } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import {
	addInstanceTints,
	createMaterial,
	ringUniforms,
	withBake,
	type KindMaterial
} from './materials';
import { loadModel, partsOf } from './models';
import { sheetOf, wear, type Look } from './environment';
import { BED_DEPTH, rectInRing, ringCells, TILE_SINK } from './tile-ring';
import type { Tier } from './quality';
import type { TileFloor, TileKit, TilePiece } from './world/floor-tiles';

/** A tiled floor's spec and its variants' geometries (a piece's `body` at its full level). */
export interface TileSetFloor {
	spec: TileFloor;
	tiles: THREE.BufferGeometry[];
	broken: THREE.BufferGeometry[];
	/** The trim sheet every piece of the floor wears by its UVs (M70), else none: vertex colours. */
	sheet?: Look | null;
}

/** The tiles of a kit, by floor byte. */
export type TileSet = ReadonlyMap<number, TileSetFloor>;

/** The joint between tiles, in world units: the lattice's pitch is a piece's footprint and this. */
export const JOINT = 0.025;

/**
 * Tiles every table draws whatever its environment's kit says: for the render specs, until #261's
 * greybox kits give environments tiles of their own. Null (the default) reads the kit.
 */
let standing: TileSet | null = null;
export function useTileSet(set: TileSet | null): void {
	standing = set;
}

/** How far, in cells, the camera's target moves before the tiles round it are packed again. */
const REPACK = 2;
const turned = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const at = new THREE.Vector3();
const scale = new THREE.Vector3();
const matrix = new THREE.Matrix4();

/** The tiles of an environment's kit, or none: every floor's pieces loaded, a failed one left out. */
export async function kitTiles(environment: string | null): Promise<TileSet | null> {
	if (!environment) return null;
	const manifest = await loadManifest();
	const id = manifest.environments[environment]?.kit;
	const kit = id ? manifest.kits[id] : undefined;
	if (!kit) return null;
	const out = new Map<number, TileSetFloor>();
	const load = async (pieces: readonly KitPiece[]) => {
		const models = await Promise.all(pieces.map((p) => loadModel(p.model, undefined, 'low')));
		return Promise.all(
			models.map(async (m) => {
				const part = m && partsOf(m, 'body')[0];
				return part ? { geometry: part.geometry, entry: m.entry, sheet: await sheetOf(m) } : null;
			})
		);
	};
	for (const [floor, def] of Object.entries(kit.floors)) {
		if (!def?.tiles.length) continue;
		const [tiles, broken] = await Promise.all([load(def.tiles), load(def.broken)]);
		if (tiles.some((t) => !t) || broken.some((b) => !b)) continue;
		const { min, max } = tiles[0]!.entry.bounds;
		const sheets = new Set([...tiles, ...broken].map((t) => t!.sheet));
		out.set(FLOOR_IDS.indexOf(floor as (typeof FLOOR_IDS)[number]), {
			spec: {
				pitch: { x: max[0] - min[0] + JOINT, z: max[2] - min[2] + JOINT },
				tiles: def.tiles.map((p) => p.weight ?? 1),
				broken: def.broken.map((p) => p.weight ?? 1)
			},
			tiles: tiles.map((t) => t!.geometry),
			broken: broken.map((b) => b!.geometry),
			// One sheet for the whole floor, or its pieces keep their colours (ponytail: mixed sheets
			// within a floor would need a material per piece).
			sheet: sheets.size === 1 ? [...sheets][0] : null
		});
	}
	return out.size ? out : null;
}

export class TileLayer {
	readonly group = new THREE.Group();
	/** One material for every tile: the instanced prop graph, sinking past the ring. */
	private readonly material = createMaterial('prop', {
		instanced: true,
		vertexColors: true,
		params: { sink: 0 }
	});
	/** A trim sheet's tiles (M70): the same graph, the sheet in its slots, white vertex colours. */
	private sheets = new Map<Look, KindMaterial>();
	private set: TileSet | null = null;
	/**
	 * The pool: a mesh per variant geometry, kept across tables (r186 compiles each new one) and made
	 * again only to hold more.
	 */
	private pool = new Map<THREE.BufferGeometry, THREE.InstancedMesh>();
	/** The tile set the pool was made for. */
	private pooled: TileSet | null = null;
	/** Each chunk's pieces and box (world x and z). */
	private pieces: (readonly TilePiece[])[] = [];
	private boxes: { x0: number; z0: number; x1: number; z1: number }[] = [];
	private grid: SquareGrid | null = null;
	private tier: Tier = 'medium';
	/** Where the pool was last packed round, or null to pack again. */
	private packedAt: { x: number; z: number } | null = null;
	private wanted: string | null | undefined = undefined;

	constructor(private readonly onPool: () => void) {}

	/** The specs of the tiles drawn now, for the builders (empty without tiles). */
	get kit(): TileKit {
		return new Map([...(standing ?? this.set ?? [])].map(([f, s]) => [f, s.spec]));
	}

	/** Loads the environment's kit tiles; `onChange` when what is drawn changes. */
	setEnvironment(environment: string | null, onChange: () => void): void {
		if (environment === this.wanted) return;
		this.wanted = environment;
		void kitTiles(environment).then((set) => {
			if (this.wanted !== environment || set === this.set) return;
			this.set = set;
			this.repool();
			onChange();
		});
	}

	/** The tier's ring (none on low). */
	setTier(tier: Tier): void {
		this.tier = tier;
		this.packedAt = null;
		this.repool();
	}

	/** Chunks of `chunk` cells laid out for a grid, `across` a row: each starts empty. */
	layout(grid: SquareGrid, count: number, across: number, chunk: number): void {
		const cs = grid.cellSize;
		this.grid = grid;
		this.pieces.length = count;
		for (let c = 0; c < count; c++) this.pieces[c] ??= [];
		for (const m of [this.material, ...this.sheets.values()]) m.params.sink = TILE_SINK * cs;
		this.boxes = Array.from({ length: count }, (_, c) => {
			const x0 = ((c % across) * chunk - grid.width / 2) * cs;
			const z0 = (Math.floor(c / across) * chunk - grid.height / 2) * cs;
			return { x0, z0, x1: x0 + chunk * cs, z1: z0 + chunk * cs };
		});
		this.repool();
	}

	/** A chunk's tiles, packed on the next frame. */
	fill(c: number, pieces: readonly TilePiece[]): void {
		this.pieces[c] = pieces;
		this.packedAt = null;
	}

	/**
	 * Follows the camera's target: the ring's uniforms, and the pool packed again with the tiles
	 * round it once the target has moved `REPACK` cells (tiles past the ring are sunk out of sight
	 * by then, so nothing pops).
	 */
	follow(target: THREE.Vector3): void {
		const g = this.grid;
		const cs = g?.cellSize ?? 1;
		const ring = g ? ringCells(this.tier, g) : 0;
		const tiles = ring > 0 && this.pool.size > 0;
		ringUniforms.centre.value.set(target.x, target.z);
		ringUniforms.radius.value = tiles ? ring * cs : 0;
		ringUniforms.bed.value = tiles ? BED_DEPTH * cs : 0;
		const at = this.packedAt;
		if (at && Math.hypot(at.x - target.x, at.z - target.z) < REPACK * cs) return;
		this.packedAt = { x: target.x, z: target.z };
		this.pack(target, tiles ? (ring + REPACK + 1) * cs : 0);
	}

	stats(): { meshes: number; instances: number } {
		let instances = 0;
		for (const m of this.pool.values()) instances += m.userData.tiles as number;
		return { meshes: this.pool.size, instances };
	}

	dispose(): void {
		this.drain();
		for (const m of [this.material, ...this.sheets.values()]) m.dispose();
	}

	/** The pool for the kit, table and ring now: made again only when one of them changed. */
	private repool(): void {
		const set = standing ?? this.set;
		const g = this.grid;
		if (set !== this.pooled) this.drain(); // a new kit: its own geometries
		this.pooled = set;
		this.packedAt = null;
		if (!g || !set) return;
		// The cells a pack can hold: the ring and its margin, or the table if that is smaller.
		const ring = Math.max(ringCells(this.tier, g), ringCells('high', g));
		const cells = Math.min(Math.PI * (ring + REPACK + 2) ** 2, g.width * g.height);
		let grown = false;
		for (const { spec, tiles, broken, sheet } of set.values()) {
			const perCell = (g.cellSize * g.cellSize) / (spec.pitch.x * spec.pitch.z);
			const n = cells * perCell * 1.25;
			for (const [list, weights] of [
				[tiles, spec.tiles],
				[broken, spec.broken]
			] as const) {
				const total = weights.reduce((a, b) => a + b, 0);
				list.forEach((shared, v) => {
					const share = Math.min(1, (weights[v] / total) * 1.5 + 0.1);
					const capacity = Math.ceil(n * share) + 32;
					const was = this.pool.get(shared);
					if (was && was.instanceMatrix.count >= capacity) return;
					if (was) this.free(was);
					this.pool.set(shared, this.mesh(shared, capacity, sheet ?? null));
					grown = true;
				});
			}
		}
		if (grown) this.onPool();
	}

	private mesh(
		shared: THREE.BufferGeometry,
		capacity: number,
		sheet: Look | null
	): THREE.InstancedMesh {
		const geometry = withBake(shared.clone());
		addInstanceTints(geometry, capacity);
		// On its sheet the piece's baked colours (the sheet's mean, #263) would darken it twice.
		if (sheet) (geometry.getAttribute('color').array as Float32Array).fill(1);
		const mesh = new THREE.InstancedMesh(geometry, this.materialFor(sheet), capacity);
		mesh.castShadow = false;
		mesh.receiveShadow = true;
		mesh.frustumCulled = false; // its tiles move with the ring
		mesh.raycast = () => {};
		mesh.setMatrixAt(0, matrix.makeScale(0, 0, 0));
		mesh.count = 1;
		mesh.userData.tiles = 0;
		this.group.add(mesh);
		return mesh;
	}

	/** The tiles' material, or a sheet's: the same program, the sheet in its slots. */
	private materialFor(sheet: Look | null): KindMaterial {
		if (!sheet) return this.material;
		let m = this.sheets.get(sheet);
		if (!m) {
			m = createMaterial('prop', { instanced: true, vertexColors: true, params: { sink: 0 } });
			m.params.sink = this.material.params.sink;
			wear(m, sheet, { color: 0xffffff, roughness: 0.75 });
			this.sheets.set(sheet, m);
		}
		return m;
	}

	/** Packs the tiles within `reach` of the target, nearest chunks first, into the pool. */
	private pack(target: THREE.Vector3, reach: number): void {
		const set = standing ?? this.set;
		for (const m of this.pool.values()) m.userData.tiles = 0;
		const near = this.boxes
			.map((box, c) => ({
				c,
				d: rectInRing(box, target.x, target.z, reach) ? distance(box, target) : -1
			}))
			.filter((n) => n.d >= 0)
			.sort((a, b) => a.d - b.d);
		for (const { c } of near)
			for (const p of this.pieces[c] ?? []) {
				if (Math.hypot(p.x - target.x, p.z - target.z) > reach) continue;
				const floor = set?.get(p.floor);
				const shared = floor && (p.broken ? floor.broken : floor.tiles)[p.variant];
				const mesh = shared && this.pool.get(shared);
				const n = mesh?.userData.tiles as number;
				if (!mesh || n >= mesh.instanceMatrix.count) continue;
				turned.setFromAxisAngle(UP, (p.turn * Math.PI) / 2);
				mesh.setMatrixAt(
					n,
					matrix.compose(at.set(p.x, p.y, p.z), turned, scale.set(p.sx, 1, p.sz))
				);
				mesh.userData.tiles = n + 1;
			}
		for (const m of this.pool.values()) {
			const n = m.userData.tiles as number;
			if (!n) m.setMatrixAt(0, matrix.makeScale(0, 0, 0));
			m.count = Math.max(n, 1);
			m.instanceMatrix.needsUpdate = true;
		}
	}

	private drain(): void {
		for (const m of this.pool.values()) this.free(m);
		this.pool.clear();
	}

	private free(m: THREE.InstancedMesh): void {
		m.geometry.dispose();
		m.dispose();
		this.group.remove(m);
	}
}

/** How far from a point a box's nearest edge is. */
function distance(box: { x0: number; z0: number; x1: number; z1: number }, p: THREE.Vector3) {
	return Math.hypot(
		Math.max(box.x0 - p.x, 0, p.x - box.x1),
		Math.max(box.z0 - p.z, 0, p.z - box.z1)
	);
}
