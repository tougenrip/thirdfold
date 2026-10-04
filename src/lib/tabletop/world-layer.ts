// The world's ground (#240): the dual-grid meshes of world/ground-mesh.ts in
// 16x16-cell chunks, each a mesh of tops (the terrain kind in the environment's
// surface look, receiving shadows) and a mesh of cliffs and risers per style
// (#241, world/cliffs.ts: the rock kind with vertex colours, casting and
// receiving; earth in the environment's ground look, masonry in its walls',
// both in cave rock, the ground look, in the cave environments). It replaces
// the old boxes and the play-area plane, which draw again under `?off=terrain`
// until the milestone closes. Cells are picked by the DDA over the same ground (#246).
//
// It holds the world's shape for what the viewer was sent (levels, floors, the
// explored mask; nothing about unexplored ground is an input), and rebuilds
// only the chunks `dirtyChunks` names, each timed as `world-chunk`. The
// renderer's `Ground` is the shape's, from the continued levels. Floors,
// levels, environments and painting change data and uniforms only: the tops
// are the terrain kind's one graph and every face the rock kind's, each warmed
// with a stand-in, so nothing compiles. Fog and darkness are `worldModify`'s,
// as on every surface (the faces' read the cell behind them).

import * as THREE from 'three/webgpu';
import type { SquareGrid } from '$lib/game/grid';
import type { FogView } from '$lib/game/visibility';
import { wear, type EnvironmentLook } from './environment';
import type { FogMode } from './fog';
import { GridOverlay } from './grid-overlay';
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
import type { CliffMesh } from './world/cliffs';
import type { GroundMesh } from './world/ground-mesh';
import type { WorldShape } from './world/shape';

/** The world's builders: their own chunk (world/build.ts), never imported statically here. */
export type WorldBuilders = typeof import('./world/build');

let builders: Promise<WorldBuilders> | null = null;

/** Fetches the world's builders once (again after a failed download). */
export function loadWorld(): Promise<WorldBuilders> {
	builders ??= import('./world/build').catch((err) => {
		builders = null;
		throw err;
	});
	return builders;
}

/** The looks without an environment: the play plane's green, the old boxes' stone, a greyer masonry. */
const PLAIN = {
	top: { color: 0x2f4a3a, roughness: 1 },
	earth: { color: 0x77705f, roughness: 0.9 },
	masonry: { color: 0x8a867c, roughness: 0.85 }
};

/** The environments whose every face is cave rock (their ground look), masonry or not. */
const CAVES = new Set(['cavern', 'living-cave']);

/** What `stats()` reports of the world's chunks. */
export interface WorldStats {
	/** Chunks on the table. */
	chunks: number;
	/** Chunks the last update rebuilt. */
	lastRebuilt: number;
}

interface Chunk {
	top: THREE.Mesh;
	/** The faces by style (`CLIFF_STYLES`). */
	sides: THREE.Mesh[];
	/** The top's twin in the overlay's scene, for the shader grid (#245). */
	grid: THREE.Mesh;
}

const EMPTY = new THREE.BufferGeometry();

export class WorldLayer {
	readonly group = new THREE.Group();
	/** The old boxes: drawn with the layer off (`?off=terrain`). */
	readonly terrain = new TerrainLayer();
	/** The grid and the hover highlight on the chunks' tops (#245): its group goes in the overlay. */
	readonly grid = new GridOverlay();
	/** The world's shape for what the viewer was sent, and the one the chunks show. */
	shape: WorldShape | null = null;
	private drawn: WorldShape | null = null;
	private readonly chunkGroup = new THREE.Group();
	private chunks: Chunk[] = [];
	private top: KindMaterial = createMaterial('terrain', { antiTiled: true });
	/** The faces' materials by style: one graph (rock, vertex colours), each its own look. */
	private sides: KindMaterial[];
	private inputs: unknown[] = [];
	private on = true;
	private lastRebuilt = 0;
	private standIns: THREE.Mesh[] | null = null;

	constructor(
		private readonly perf: PerfRecorder,
		private readonly land: WorldGround,
		private readonly build: WorldBuilders
	) {
		this.group.add(this.chunkGroup, this.terrain.group);
		this.terrain.group.visible = false;
		land.showPlay(false);
		this.sides = build.CLIFF_STYLES.map((style) => {
			const material = createMaterial('rock', { antiTiled: true, vertexColors: true });
			wear(material, null, PLAIN[style]);
			return material;
		});
		wear(this.top, null, PLAIN.top);
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
		const known = fog ? this.build.knownOf(grid, fog, mode === 'gm') : null;
		this.shape = this.build.worldShape({
			grid,
			levels: fit(levels),
			floor: fit(floor),
			objects: [],
			known
		});
		this.terrain.sync(grid, this.shape.ground);
		this.rebuild();
		return exploredChanged;
	}

	/**
	 * The environment's looks (or the plain ones): tops wear its surface; earth faces its ground,
	 * masonry its walls, and in a cave environment (`environment`, its id) every face its ground.
	 */
	setLook(
		look: EnvironmentLook | null,
		grid: SquareGrid | null,
		environment?: string | null
	): void {
		const cellSize = grid?.cellSize ?? 1;
		const cave = CAVES.has(environment ?? '');
		wear(this.top, look?.surface ?? null, PLAIN.top);
		setParams(this.top, { repeat: repeatFor(look?.surface.cells ?? 1, cellSize, STEP_HEIGHT) });
		this.build.CLIFF_STYLES.forEach((style, i) => {
			const own = (style === 'masonry' && !cave ? look?.walls : look?.ground) ?? null;
			wear(this.sides[i], own, PLAIN[style]);
			// Triplanar (or biplanar) mapping: repeats per world unit, both ways.
			const per = 1 / ((own?.cells ?? 1) * cellSize);
			setParams(this.sides[i], { repeat: { x: per, y: per } });
		});
		this.terrain.setLook(look?.ground ?? null);
	}

	/** The chunks (on) or the old boxes and play plane (off, `?off=terrain`). True if it changed. */
	setOn(on: boolean): boolean {
		if (on === this.on) return false;
		this.on = on;
		this.chunkGroup.visible = on;
		this.terrain.group.visible = !on;
		this.grid.setOn(on);
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
		this.sides = this.sides.map(twinOf);
		for (const c of this.chunks) {
			c.top.material = this.top;
			c.sides.forEach((m, i) => (m.material = this.sides[i]));
		}
		if (this.standIns)
			[this.standIns[0].material, this.standIns[1].material] = [this.top, this.sides[0]];
		return true;
	}

	stats(): WorldStats {
		return { chunks: this.chunks.length, lastRebuilt: this.lastRebuilt };
	}

	/**
	 * Stand-ins for the warm-up (#180): a face casting its shadow may not be on the table yet. One
	 * face stands in for every style: they share the rock kind's graph.
	 */
	gallery(): THREE.Object3D[] {
		if (!this.standIns) {
			const geometry = new THREE.BufferGeometry();
			const triangle = (v: number[]) => new THREE.Float32BufferAttribute([...v, ...v, ...v], 3);
			geometry.setAttribute(
				'position',
				new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)
			);
			geometry.setAttribute('normal', triangle([0, 0, 1]));
			geometry.setAttribute('color', triangle([1, 1, 1]));
			const [top, face] = [this.top, this.sides[0]];
			this.standIns = [standIn(this.mesh(top, false)), standIn(this.mesh(face, true))];
			for (const s of this.standIns) s.geometry = geometry;
		}
		return this.standIns;
	}

	dispose(): void {
		this.resize(0);
		this.standIns?.[0].geometry.dispose();
		this.terrain.dispose();
		this.grid.dispose();
		disposeTwins(this.top);
		this.sides.forEach(disposeTwins);
	}

	/** Builds the chunks the shape changed since the drawn one (all of them on a new grid). */
	private rebuild(): void {
		const shape = this.shape;
		if (!this.on || !shape) return;
		const drawn = this.drawn?.grid.cellSize === shape.grid.cellSize ? this.drawn : null;
		const dirty = this.build.dirtyChunks(drawn, shape);
		const { x, y } = this.build.chunksAcross(shape.grid);
		this.resize(x * y);
		for (const c of dirty) this.perf.time('world-chunk', () => this.buildChunk(shape, c));
		this.drawn = shape;
		this.lastRebuilt = dirty.length;
	}

	private buildChunk(shape: WorldShape, c: number): void {
		const { top, sides } = this.build.chunkWorld(shape, c);
		const chunk = this.chunks[c];
		fill(chunk.top, top);
		sides.forEach((faces, i) => fill(chunk.sides[i], faces));
		this.grid.follow(chunk.grid, chunk.top);
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
			for (const m of [c.top, ...c.sides]) {
				if (m.geometry !== EMPTY) m.geometry.dispose();
				this.chunkGroup.remove(m);
			}
			c.grid.removeFromParent();
		}
		while (this.chunks.length < count) {
			const c = {
				top: this.mesh(this.top, false),
				sides: this.sides.map((m) => this.mesh(m, true)),
				grid: this.grid.twin()
			};
			this.chunkGroup.add(c.top, ...c.sides);
			this.chunks.push(c);
		}
	}
}

/**
 * Puts a built mesh in a chunk's geometry: positions, normals, a face's shades (vertex colours)
 * and triangles; hidden when empty.
 */
function fill(mesh: THREE.Mesh, data: GroundMesh | CliffMesh): void {
	if (mesh.geometry !== EMPTY) mesh.geometry.dispose();
	mesh.visible = data.indices.length > 0;
	if (!mesh.visible) {
		mesh.geometry = EMPTY;
		return;
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
	g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
	if ('colors' in data) g.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
	g.setIndex(new THREE.BufferAttribute(data.indices, 1));
	g.computeBoundingSphere();
	mesh.geometry = g;
}
