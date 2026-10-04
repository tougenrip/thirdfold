// The world's ground (#240): the dual-grid meshes of world/ground-mesh.ts in
// 16x16-cell chunks, each a mesh of tops (the terrain kind in the environment's
// surface look, receiving shadows) and a mesh of sheer sides (the terrain kind
// in its ground look, casting and receiving; #241 gives the sides their own
// cliffs and risers, the rock kind's, in their place). It replaces the old
// boxes and the play-area plane, which draw again under `?off=terrain` until
// the milestone closes. Cells are picked by the DDA over the same ground (#246).
//
// It holds the world's shape for what the viewer was sent (levels, floors, the
// explored mask; nothing about unexplored ground is an input), and rebuilds
// only the chunks `dirtyChunks` names, each timed as `world-chunk`. The
// renderer's `Ground` is the shape's, from the continued levels. Floors,
// levels, environments and painting change data and uniforms only: both
// materials are the terrain kind's one graph, warmed with stand-ins, so
// nothing compiles. Fog and darkness are `worldModify`'s, as on every surface.

import * as THREE from 'three/webgpu';
import type { SquareGrid } from '$lib/game/grid';
import type { FogView } from '$lib/game/visibility';
import { wear, type EnvironmentLook } from './environment';
import type { FogMode } from './fog';
import { STEP_HEIGHT, type Ground } from './ground';
import type { WorldGround } from './landscape';
import {
	createMaterial,
	disposeTwins,
	repeatFor,
	setParams,
	twinOf,
	type KindMaterial
} from './materials';
import type { PerfRecorder } from './perf';
import { TerrainLayer } from './terrain';
import { standIn } from './warmup';
import { chunkGround, type GroundMesh } from './world/ground-mesh';
import { chunksAcross, dirtyChunks, knownOf, worldShape, type WorldShape } from './world/shape';

/** The looks without an environment: the play plane's green and the old boxes' stone. */
const PLAIN = {
	top: { color: 0x2f4a3a, roughness: 1 },
	sides: { color: 0x77705f, roughness: 0.9 }
};

/** What `stats()` reports of the world's chunks. */
export interface WorldStats {
	/** Chunks on the table. */
	chunks: number;
	/** Chunks the last update rebuilt. */
	lastRebuilt: number;
}

interface Chunk {
	top: THREE.Mesh;
	sides: THREE.Mesh;
}

const EMPTY = new THREE.BufferGeometry();

export class WorldLayer {
	readonly group = new THREE.Group();
	/** The old boxes: drawn with the layer off (`?off=terrain`). */
	readonly terrain = new TerrainLayer();
	/** The world's shape for what the viewer was sent, and the one the chunks show. */
	shape: WorldShape | null = null;
	private drawn: WorldShape | null = null;
	private readonly chunkGroup = new THREE.Group();
	private chunks: Chunk[] = [];
	private top: KindMaterial = createMaterial('terrain', { antiTiled: true });
	private sides: KindMaterial = createMaterial('terrain', { antiTiled: true });
	private inputs: unknown[] = [];
	private on = true;
	private lastRebuilt = 0;
	private standIns: THREE.Mesh[] | null = null;

	constructor(
		private readonly perf: PerfRecorder,
		private readonly land: WorldGround
	) {
		this.group.add(this.chunkGroup, this.terrain.group);
		this.terrain.group.visible = false;
		land.showPlay(false);
		wear(this.top, null, PLAIN.top);
		wear(this.sides, null, PLAIN.sides);
	}

	/** The ground everything stands on: the continued levels' (identical on known cells). */
	get ground(): Ground | null {
		return this.shape?.ground ?? null;
	}

	/**
	 * The shape for what the viewer was sent, and the chunks it changed rebuilt. Returns whether
	 * the explored mask changed (walls follow it: `wallSpans` with `known`).
	 */
	update(
		grid: SquareGrid,
		levels: Uint8Array | null,
		floor: Uint8Array | null,
		fog: FogView | null,
		mode: FogMode
	): boolean {
		const n = grid.width * grid.height;
		const fit = (a: Uint8Array | null) => (a?.length === n ? a : null);
		const explored = fog?.enabled && mode !== 'gm' ? fog.explored : null;
		const inputs = [grid.width, grid.height, grid.cellSize, fit(levels), fit(floor), explored];
		if (this.shape && inputs.every((v, i) => v === this.inputs[i])) return false;
		const exploredChanged = !this.shape || explored !== this.inputs[5];
		this.inputs = inputs;
		const known = fog ? knownOf(grid, fog, mode === 'gm') : null;
		this.shape = worldShape({ grid, levels: fit(levels), floor: fit(floor), objects: [], known });
		this.terrain.sync(grid, this.shape.ground);
		this.rebuild();
		return exploredChanged;
	}

	/** The environment's looks (or the plain ones): tops wear its surface, sides its ground. */
	setLook(look: EnvironmentLook | null, grid: SquareGrid | null): void {
		const cellSize = grid?.cellSize ?? 1;
		for (const [material, own, plain] of [
			[this.top, look?.surface ?? null, PLAIN.top],
			[this.sides, look?.ground ?? null, PLAIN.sides]
		] as const) {
			wear(material, own, plain);
			setParams(material, { repeat: repeatFor(own?.cells ?? 1, cellSize, STEP_HEIGHT) });
		}
		this.terrain.setLook(look?.ground ?? null);
	}

	/** The chunks (on) or the old boxes and play plane (off, `?off=terrain`). True if it changed. */
	setOn(on: boolean): boolean {
		if (on === this.on) return false;
		this.on = on;
		this.chunkGroup.visible = on;
		this.terrain.group.visible = !on;
		this.land.showPlay(!on);
		this.drawn = null; // back on, every chunk is built again
		this.rebuild();
		return true;
	}

	/** The tier's anti-tiling (#181), as the other layers: true if the materials were remade. */
	setAntiTiled(on: boolean): boolean {
		const boxes = this.terrain.setAntiTiled(on);
		if (!!this.top.options.antiTiled === on) return boxes;
		this.top = twinOf(this.top);
		this.sides = twinOf(this.sides);
		for (const c of this.chunks) [c.top.material, c.sides.material] = [this.top, this.sides];
		if (this.standIns)
			[this.standIns[0].material, this.standIns[1].material] = [this.top, this.sides];
		return true;
	}

	stats(): WorldStats {
		return { chunks: this.chunks.length, lastRebuilt: this.lastRebuilt };
	}

	/** Stand-ins for the warm-up (#180): a side casting its shadow may not be on the table yet. */
	gallery(): THREE.Object3D[] {
		if (!this.standIns) {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute(
				'position',
				new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)
			);
			geometry.setAttribute(
				'normal',
				new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3)
			);
			this.standIns = [this.top, this.sides].map((m) => standIn(this.mesh(m, m === this.sides)));
			for (const s of this.standIns) s.geometry = geometry;
		}
		return this.standIns;
	}

	dispose(): void {
		this.resize(0);
		this.standIns?.[0].geometry.dispose();
		this.terrain.dispose();
		disposeTwins(this.top);
		disposeTwins(this.sides);
	}

	/** Builds the chunks the shape changed since the drawn one (all of them on a new grid). */
	private rebuild(): void {
		const shape = this.shape;
		if (!this.on || !shape) return;
		const drawn = this.drawn?.grid.cellSize === shape.grid.cellSize ? this.drawn : null;
		const dirty = dirtyChunks(drawn, shape);
		const { x, y } = chunksAcross(shape.grid);
		this.resize(x * y);
		for (const c of dirty) this.perf.time('world-chunk', () => this.build(shape, c));
		this.drawn = shape;
		this.lastRebuilt = dirty.length;
	}

	private build(shape: WorldShape, c: number): void {
		const { top, sides } = chunkGround(shape, c);
		fill(this.chunks[c].top, top);
		fill(this.chunks[c].sides, sides);
	}

	/** A chunk's mesh: never picked (#246 picks cells by maths), culled by its own bounds. */
	private mesh(material: KindMaterial, casts: boolean): THREE.Mesh {
		const mesh = new THREE.Mesh(EMPTY, material);
		mesh.castShadow = casts;
		mesh.receiveShadow = true;
		mesh.raycast = () => {};
		return mesh;
	}

	private resize(count: number): void {
		while (this.chunks.length > count) {
			const c = this.chunks.pop()!;
			for (const m of [c.top, c.sides]) {
				if (m.geometry !== EMPTY) m.geometry.dispose();
				this.chunkGroup.remove(m);
			}
		}
		while (this.chunks.length < count) {
			const c = { top: this.mesh(this.top, false), sides: this.mesh(this.sides, true) };
			this.chunkGroup.add(c.top, c.sides);
			this.chunks.push(c);
		}
	}
}

/** Puts a built mesh in a chunk's geometry: positions, normals and triangles; hidden when empty. */
function fill(mesh: THREE.Mesh, data: GroundMesh): void {
	if (mesh.geometry !== EMPTY) mesh.geometry.dispose();
	mesh.visible = data.indices.length > 0;
	if (!mesh.visible) {
		mesh.geometry = EMPTY;
		return;
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
	g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
	g.setIndex(new THREE.BufferAttribute(data.indices, 1));
	g.computeBoundingSphere();
	mesh.geometry = g;
}
