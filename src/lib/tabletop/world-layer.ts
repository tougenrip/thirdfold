// The world's ground (#240): the dual-grid meshes of world/ground-mesh.ts in
// 16x16-cell chunks, each a mesh of tops (the terrain kind in the environment's
// surface look, receiving shadows) and a mesh of cliffs and risers per style
// (#241, world/cliffs.ts: the rock kind with vertex colours, casting and
// receiving; earth in the environment's ground look, masonry in its walls',
// both in cave rock, the ground look, in the cave environments). Cells are
// picked by the DDA over the same ground (#246).
//
// It holds the world's shape for what the viewer was sent (levels, floors, the
// explored mask; nothing about unexplored ground is an input), and rebuilds
// only the chunks `dirtyChunks` names, each timed as `world-chunk`. The
// renderer's `Ground` is the shape's, from the continued levels. Floors,
// levels, environments and painting change data and uniforms only: the tops
// are the terrain kind's one graph and every face the rock kind's, each warmed
// with a stand-in, so nothing compiles. Fog and darkness are `worldModify`'s,
// as on every surface (the faces' read the cell behind them).
//
// The void (#243, world/chasm.ts) drops to the chasm's floor, by the world look's backdrop (the
// landscape tells it, `onBackdrop`): each chunk's third mesh, the surface kind as the backdrop's
// skirt is (one program), is drifting mist in the dark, or wears the skirt's own look, the sea or
// the moving ground, whose slots slide on `worldTime`. `tick` moves that clock on AMBIENT frames,
// never under reduced motion, and the mist only on medium and up (the anti-tiled tier).
//
// A cell whose level or floor changes where the viewer knew it drops in (#249): its vertices
// carry the drop's start (the tops and faces; the void's floor stays where it is).
//
// Stairs (#255, world/stairs.ts) are part of the chunks: the shape is built with the walls (a
// run stops at one, a walled side gets no rail) and `withStairs`, its steps and stringers go in the
// faces, and its rails and kerbs (`stairTrim`) in the faces' meshes too, so they cost no draw call
// and no program. A wall's change rebuilds only the chunks whose stairs it changed (`stairDirty`),
// and so does a new environment whose default ground is built (or not): rails or kerbs. The
// environment's kit (#261) puts its stair pieces in instead once their models have loaded
// (stair-kit.ts `StairKit`, baked into the faces' meshes too), and the ground leaves those edges.

import * as THREE from 'three/webgpu';
import type { SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import type { FogView } from '$lib/game/visibility';
import { cellsDropped, DROP_CELLS, NO_DROP, type Drops } from './drop-in';
import { wear, type EnvironmentLook } from './environment';
import type { FogMode } from './fog';
import { GridOverlay } from './grid-overlay';
import { STEP_HEIGHT, type Ground } from './ground';
import type { WorldGround } from './landscape';
import {
	createMaterial,
	disposeTwins,
	dropHeight,
	prepareSlotTexture,
	repeatFor,
	setParams,
	setSlot,
	SLOTS,
	twinOf,
	withDrops,
	worldTime,
	type KindMaterial
} from './materials';
import type { PerfRecorder } from './perf';
import { StairKit } from './stair-kit';
import { standIn } from './warmup';
import type { Chasm } from './world/chasm';
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

/** The looks without an environment: a green ground, stone earth, a greyer masonry. */
const PLAIN = {
	top: { color: 0x2f4a3a, roughness: 1 },
	earth: { color: 0x77705f, roughness: 0.9 },
	masonry: { color: 0x8a867c, roughness: 0.85 }
};

/** The chasm's mist: a cold grey over the dark, a tile every `MIST_CELLS`, drifting (repeats a second). */
const MIST = { color: 0x2c333c, roughness: 1 };
const MIST_CELLS = 6;
const MIST_FLOW = { x: 0.025, y: 0.0125 };
const STILL = { x: 0, y: 0 };
/** `worldTime` wraps every hour: every flow comes round to whole repeats by then. */
const WRAP_S = 3600;
let mistTexture: THREE.DataTexture | null = null;
/** The void's floor meshes' name (the render specs find them by it). */
export const VOID_FLOOR = 'void-floor';

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
	/** The void's floor (#243): mist, the sea or the moving ground. */
	bottom: THREE.Mesh;
}

const EMPTY = new THREE.BufferGeometry();

export class WorldLayer {
	readonly group = new THREE.Group();
	/** The grid and the hover highlight on the chunks' tops (#245): its group goes in the overlay. */
	readonly grid = new GridOverlay();
	/** The world's shape for what the viewer was sent, and the one the chunks show. */
	shape: WorldShape | null = null;
	private drawn: WorldShape | null = null;
	private readonly chunkGroup = new THREE.Group();
	private chunks: Chunk[] = [];
	private top: KindMaterial = createMaterial('terrain', { antiTiled: true, dropped: true });
	/** The faces' materials by style: one graph (rock, vertex colours), each its own look. */
	private sides: KindMaterial[];
	/** The void's floor: the surface kind, as the backdrop's skirt (one program). */
	private bottom: KindMaterial = createMaterial('surface', { antiTiled: true });
	private chasm: Chasm;
	private picks: Ground | null = null;
	private cellSize = 1;
	private inputs: unknown[] = [];
	/** Whether the environment's default ground is built (`builtGround`): its stairs get rails. */
	private built = false;
	/** The environment's kit's stair pieces (#255, #261). */
	private stairKit = new StairKit(() => this.restair());
	private lastRebuilt = 0;
	private standIns: THREE.Mesh[] | null = null;
	/** Each cell's drop start (#249), and the shape the last drawn frame showed. */
	private starts = new Float32Array(0);
	private seen: { frame: number; shape: WorldShape | null } = { frame: -1, shape: null };

	constructor(
		private readonly perf: PerfRecorder,
		private readonly land: WorldGround,
		private readonly build: WorldBuilders,
		private readonly drops: Drops,
		/** Told when something arrived that changes the picture (a kit's stair pieces). */
		private readonly onChange: () => void = () => {}
	) {
		this.group.add(this.chunkGroup);
		this.sides = build.CLIFF_STYLES.map((style) => {
			const material = createMaterial('rock', {
				antiTiled: true,
				vertexColors: true,
				dropped: true
			});
			wear(material, null, PLAIN[style]);
			return material;
		});
		wear(this.top, null, PLAIN.top);
		this.chasm = build.DEFAULT_CHASM;
		land.onBackdrop = (backdrop) => this.setChasm(build.chasmOf(backdrop));
		this.paintVoid();
	}

	/**
	 * The ground everything stands on: the continued levels' (identical on known cells), picked
	 * into the void at the chasm's floor (#243).
	 */
	get ground(): Ground | null {
		return this.picks;
	}

	/**
	 * Moves the clock the void's floor slides on: true while it does (the moving ground, or the
	 * chasm's mist on medium and up, with void on the table), for AMBIENT frames; still under
	 * reduced motion.
	 */
	tick(now: number, reducedMotion: boolean): boolean {
		const { style } = this.chasm;
		const mist = style === 'chasm' && !!this.top.options.antiTiled;
		const moving =
			!reducedMotion && (style === 'scroll' || (mist && this.chunks.some((c) => c.bottom.visible)));
		if (moving) worldTime.value = (now / 1000) % WRAP_S;
		return moving;
	}

	/**
	 * The shape for what the viewer was sent, and the chunks it changed rebuilt. Returns whether
	 * the explored mask changed (walls follow it: `wallSpans` with `known`). Of the objects only the
	 * walls and windows count (stairs stop at them); a door opening rebuilds nothing.
	 */
	update(
		grid: SquareGrid,
		levels: Uint8Array | null,
		floor: Uint8Array | null,
		fog: FogView | null,
		mode: FogMode,
		objects: readonly SceneObject[] = []
	): boolean {
		const n = grid.width * grid.height;
		const fit = (a: Uint8Array | null) => (a?.length === n ? a : null);
		const explored = fog?.enabled && mode !== 'gm' ? fog.explored : null;
		const walls = objects.filter((o) => o.kind === 'wall');
		const wallKey = walls.map((o) => `${o.a.x},${o.a.y},${o.b.x},${o.b.y},${+!!o.window}`).join();
		const inputs = [grid.width, grid.height, grid.cellSize, fit(levels), fit(floor), explored];
		inputs.push(wallKey);
		if (this.shape && inputs.every((v, i) => v === this.inputs[i])) return false;
		const exploredChanged = !this.shape || explored !== this.inputs[5];
		this.inputs = inputs;
		const known = fog ? this.build.knownOf(grid, fog, mode === 'gm') : null;
		const previous = this.shape;
		this.shape = this.build.withStairs(
			this.build.worldShape({
				grid,
				levels: fit(levels),
				floor: fit(floor),
				objects: walls,
				known
			}),
			this.stairOptions()
		);
		const { shape } = this;
		this.picks = this.build.chasmGround(grid, shape.ground, shape.floor, () => this.chasm);
		this.dropIn(previous, shape);
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
		this.cellSize = cellSize;
		const cave = CAVES.has(environment ?? '');
		const built = this.build.builtGround(environment);
		if (built !== this.built) {
			this.built = built;
			this.restair();
		}
		this.stairKit.setEnvironment(environment ?? null);
		wear(this.top, look?.surface ?? null, PLAIN.top);
		setParams(this.top, { repeat: repeatFor(look?.surface.cells ?? 1, cellSize, STEP_HEIGHT) });
		this.build.CLIFF_STYLES.forEach((style, i) => {
			const own = (style === 'masonry' && !cave ? look?.walls : look?.ground) ?? null;
			wear(this.sides[i], own, PLAIN[style]);
			// Triplanar (or biplanar) mapping: repeats per world unit, both ways.
			const per = 1 / ((own?.cells ?? 1) * cellSize);
			setParams(this.sides[i], { repeat: { x: per, y: per } });
		});
		this.paintVoid(); // the skirt's new look, under the sea and the moving ground
	}

	/** The tier's anti-tiling (#181), as the other layers: true if the materials were remade. */
	setAntiTiled(on: boolean): boolean {
		if (!!this.top.options.antiTiled === on) return false;
		this.top = twinOf(this.top);
		this.sides = this.sides.map(twinOf);
		this.bottom = twinOf(this.bottom);
		for (const c of this.chunks) {
			c.top.material = this.top;
			c.sides.forEach((m, i) => (m.material = this.sides[i]));
			c.bottom.material = this.bottom;
		}
		this.paintVoid(); // the mist drifts on medium and up
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
			withDrops(geometry);
			const [top, face] = [this.top, this.sides[0]];
			this.standIns = [standIn(this.mesh(top, false)), standIn(this.mesh(face, true))];
			for (const s of this.standIns) s.geometry = geometry;
		}
		return this.standIns;
	}

	dispose(): void {
		this.resize(0);
		this.standIns?.[0].geometry.dispose();
		this.grid.dispose();
		disposeTwins(this.top);
		this.sides.forEach(disposeTwins);
		disposeTwins(this.bottom);
		this.land.onBackdrop = null;
	}

	/** The void for the scene's backdrop: its look, and every chunk again if its floor moved. */
	private setChasm(chasm: Chasm): void {
		const was = this.chasm;
		this.chasm = chasm;
		this.paintVoid();
		if (chasm.depth === was.depth && chasm.open === was.open) return;
		this.drawn = null;
		this.rebuild();
	}

	/** The void's floor: mist over the dark, or the skirt's own look (the sea, the moving ground). */
	private paintVoid(): void {
		const m = this.bottom;
		if (this.chasm.style !== 'chasm') return this.land.wearSkirt(m);
		wear(m, null, MIST);
		mistTexture ??= prepareSlotTexture(
			new THREE.DataTexture(this.build.mistTexels(64), 64, 64),
			SLOTS.albedo
		);
		setSlot(m, 'albedo', mistTexture);
		const per = 1 / (MIST_CELLS * this.cellSize);
		const flow = this.top.options.antiTiled ? MIST_FLOW : STILL;
		setParams(m, { repeat: { x: per, y: per }, flow, macroTint: 0, macroRoughness: 0 });
	}

	/**
	 * Starts the drops of the cells `shape` changed where the viewer knew them (#249), against
	 * what the last drawn frame showed; none on a new table.
	 */
	private dropIn(previous: WorldShape | null, shape: WorldShape): void {
		const n = shape.grid.width * shape.grid.height;
		if (this.seen.frame !== this.drops.frame)
			this.seen = { frame: this.drops.frame, shape: previous };
		const before = this.seen.shape;
		if (before?.grid !== shape.grid || this.starts.length !== n) {
			this.starts = new Float32Array(n).fill(NO_DROP);
			return;
		}
		const state = (s: WorldShape) => ({ ...s, ...s.grid });
		const cells = cellsDropped(state(before), state(shape));
		const start = cells.length ? this.drops.start() : NO_DROP;
		if (start !== NO_DROP) for (const c of cells) this.starts[c] = start;
		dropHeight.value = DROP_CELLS * shape.grid.cellSize;
	}

	/** The stairs' options: the environment's ground and the kit's pieces that have loaded. */
	private stairOptions() {
		return { built: this.built, kit: this.stairKit.ready() };
	}

	/** The stairs again (a new environment, or more of its kit loaded), and the picture. */
	private restair(): void {
		if (!this.shape) return;
		const next = this.build.withStairs(this.shape, this.stairOptions());
		const same = !this.build.stairDirty(this.shape, next).length;
		this.shape = next;
		if (same) return; // a kit model that changed nothing
		this.rebuild();
		this.onChange();
	}

	/** Builds the chunks the shape changed since the drawn one (all of them on a new grid). */
	private rebuild(): void {
		const shape = this.shape;
		if (!shape) return;
		const drawn = this.drawn?.grid.cellSize === shape.grid.cellSize ? this.drawn : null;
		const stairs = this.build.stairDirty(drawn, shape);
		const dirty = [...new Set([...this.build.dirtyChunks(drawn, shape), ...stairs])];
		const { x, y } = this.build.chunksAcross(shape.grid);
		this.resize(x * y);
		for (const c of dirty) this.perf.time('world-chunk', () => this.buildChunk(shape, c));
		this.drawn = shape;
		this.lastRebuilt = dirty.length;
	}

	private buildChunk(shape: WorldShape, c: number): void {
		const { top, sides, bottom } = this.build.chunkWorld(shape, c, this.chasm);
		// Rails and kerbs, and the kit's stair pieces, with the faces (#255).
		const trim = this.build.stairTrim(shape, c);
		const across = this.build.chunksAcross(shape.grid).x;
		const n = this.build.CHUNK;
		const [x0, y0] = [(c % across) * n, Math.floor(c / across) * n];
		const kit = this.stairKit.chunkPieces(shape, [x0, y0, x0 + n, y0 + n], this.build.styleOf);
		const chunk = this.chunks[c];
		fill(chunk.top, top, this.starts);
		sides.forEach((faces, i) =>
			fill(
				chunk.sides[i],
				this.build.withTrim(this.build.withTrim(faces, trim[i]), kit[i]),
				this.starts
			)
		);
		fill(chunk.bottom, bottom, null, true);
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
			for (const m of [c.top, ...c.sides, c.bottom]) {
				if (m.geometry !== EMPTY) m.geometry.dispose();
				this.chunkGroup.remove(m);
			}
			c.grid.removeFromParent();
		}
		while (this.chunks.length < count) {
			const c = {
				top: this.mesh(this.top, false),
				sides: this.sides.map((m) => this.mesh(m, true)),
				grid: this.grid.twin(),
				bottom: this.mesh(this.bottom, false)
			};
			c.bottom.name = VOID_FLOOR;
			this.chunkGroup.add(c.top, ...c.sides, c.bottom);
			this.chunks.push(c);
		}
	}
}

/**
 * Puts a built mesh in a chunk's geometry: positions, normals, a face's shades (vertex colours),
 * each vertex's drop start (its owner cell's, #249, `starts`; none for the void's floor) and
 * triangles, and for the void's floor the world uv the backdrop's skirt has (`uv`: the same
 * attributes, so the same program); hidden when empty.
 */
function fill(
	mesh: THREE.Mesh,
	data: GroundMesh | CliffMesh,
	starts: Float32Array | null,
	uv = false
): void {
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
	if (uv) {
		const p = data.positions;
		const uvs = new Float32Array((p.length / 3) * 2);
		for (let v = 0; v < uvs.length / 2; v++) uvs.set([p[v * 3], -p[v * 3 + 2]], v * 2);
		g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
	}
	if (starts)
		withDrops(
			g,
			Float32Array.from(data.owners, (o) => starts[o] ?? NO_DROP)
		);
	g.setIndex(new THREE.BufferAttribute(data.indices, 1));
	g.computeBoundingSphere();
	mesh.geometry = g;
}
