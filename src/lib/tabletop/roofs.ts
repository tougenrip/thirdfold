// Roofs over roofed rooms (#257): the walls' layer keeps one (walls.ts), since roofs and walls
// read the same things (the objects, the world's shape, the interior mask, the kit). The cells
// roofed, their regions and gables are the world chunk's (world/roofs.ts, pure); here they are one
// mesh per 16x16 chunk in the surface kind's `roof` variant, which reads the fog and the sky at
// each region's known outside cell (`aRoofCell`), so a roof over unexplored ground is drawn, never
// black. A region fades (#259, world/roof-fade.ts decides) while the viewer sees into it, one of
// its own or the selected token stands in it or the camera's pivot is on it, over `ROOF_FADE_MS`
// on the wall clock (at once under reduced motion), by texels of `ROOF_FADES` at its key cell; a
// fade rebuilds nothing. A chunk is rebuilt only when what it draws changed (`roofKey`). Casting
// and receiving, never picked. Nothing here compiles: the material is the lobby's (`kindGallery`).

import * as THREE from 'three/webgpu';
import { tagged } from './perf';
import type { KitRoof } from '$lib/assets/kit';
import type { SceneObject } from '$lib/game/objects';
import { worldToGrid } from '$lib/game/grid';
import type { Token } from '$lib/game/token';
import { decodeMask, type FogView } from '$lib/game/visibility';
import type { FogMode } from './fog';
import { wear, type Look } from './environment';
import { createMaterial } from './materials';
import { ROOF_FADE_SIDE, ROOF_FADES, ROOF_KEY_ATTRIBUTE } from './materials/roof-fade';
import { ROOF_CELL_ATTRIBUTE } from './materials/world-modify';
import { standIn } from './warmup';
import type { RoofPieces } from './world/roof-mesh';
import type { RoofRegion } from './world/roofs';
import type { WorldShape } from './world/shape';
import type { WorldBuilders } from './world-layer';

/** A kit's roofs as the layer draws them: its settings and its material's look. */
export interface RoofKit {
	roof: KitRoof;
	/** Roof walled rooms the viewer hasn't explored (`KitDef.presumeRoofs`). */
	presume: boolean;
	look: Look | null;
	/** Its ridge and hip caps, chimneys and dormers (#258), as loaded; none drawn while absent. */
	pieces?: RoofPieces;
}

const PLAIN_ROOF = { color: 0x6f5f4e, roughness: 0.9 };
type Rgb = [number, number, number];

/** How long a roof takes to fade out or back (ms). */
export const ROOF_FADE_MS = 250;

/** A region's fade: from `from` to `to` over `ROOF_FADE_MS` from `start` (NaN: the next tick). */
interface Fade {
	from: number;
	to: number;
	start: number;
}

export interface RoofStats {
	chunks: number;
	regions: number;
	triangles: number;
	/** Chunks built since the layer was made (a chunk is built only when its roofs change). */
	built: number;
}

export class RoofLayer {
	readonly group = tagged(new THREE.Group(), 'roofs');
	private readonly material = createMaterial('surface', { roof: true, vertexColors: true });
	private kit: RoofKit | null = null;
	private build: WorldBuilders | null = null;
	private shape: WorldShape | null = null;
	private footprint: Uint8Array | null = null;
	private regions: RoofRegion[] = [];
	private visible: Uint8Array | null = null;
	private sight: FogView | null = null;
	private gm = false;
	/** Fades by region key (its smallest cell), kept across rebuilds. */
	private fades = new Map<number, Fade>();
	private tokens: readonly Token[] = [];
	private own: ReadonlySet<string> = new Set();
	private selected: string | null = null;
	private building = false;
	private pivot = -1;
	private stale = true;
	private now = 0;
	private reduced = false;
	private meshes = new Map<number, { mesh: THREE.Mesh; key: string }>();
	private built = 0;
	private standIns: THREE.Object3D[] | null = null;

	constructor() {
		wear(this.material, null, PLAIN_ROOF);
	}

	/** The kit's roofs, or null for none (caves, `plain`). True if changed: the walls retile. */
	setKit(kit: RoofKit | null): boolean {
		if (kit === this.kit) return false;
		this.kit = kit;
		wear(this.material, kit?.look ?? null, PLAIN_ROOF);
		this.clear();
		return true;
	}

	/** What the viewer sees now (a region it sees into fades) and whether it is the GM. */
	setSight(fog: FogView | null, mode: FogMode = 'player'): void {
		[this.sight, this.gm, this.stale] = [fog, mode === 'gm', true];
		this.visible = null; // decoded against the grid at the next retarget
	}

	/** The tokens on the table: the viewer's own and the selected one open their roofs. */
	setTokens(tokens: readonly Token[]): void {
		[this.tokens, this.stale] = [tokens, true];
	}

	/** The viewer's own tokens' ids. True if changed: a frame is due. */
	setOwn(ids: readonly string[]): boolean {
		if (ids.length === this.own.size && ids.every((id) => this.own.has(id))) return false;
		[this.own, this.stale] = [new Set(ids), true];
		return true;
	}

	/** The selected token, which opens its roof as an own token does. */
	setSelected(id: string | null): void {
		if (id !== this.selected) [this.selected, this.stale] = [id, true];
	}

	/** A build tool is out: the GM's roofs stand half faded. */
	setBuilding(on: boolean): void {
		if (on !== this.building) [this.building, this.stale] = [on, true];
	}

	/** Fades jump under reduced motion. */
	setReducedMotion(reduced: boolean): void {
		[this.reduced, this.stale] = [reduced, true];
	}

	/**
	 * Eases each region toward its fade at time `now`, the camera's pivot at `pivot` (a world
	 * point; its cell is a rule). True while any region is still fading: an ACTIVE frame.
	 */
	tick(now: number, pivot: { x: number; z: number }): boolean {
		this.now = now;
		const grid = this.shape?.grid;
		const at = grid ? worldToGrid(grid, pivot) : null;
		const cell = at && grid ? at.y * grid.width + at.x : -1;
		if (cell !== this.pivot) [this.pivot, this.stale] = [cell, true];
		if (this.stale) this.retarget();
		let fading = false;
		const data = ROOF_FADES.image.data as Uint8Array;
		for (const [key, f] of this.fades) {
			if (Number.isNaN(f.start)) f.start = now;
			const v = this.fadeAt(f, now);
			fading ||= v !== f.to;
			const texel = this.texelOf(key);
			const byte = Math.round(v * 255);
			if (data[texel] !== byte) [data[texel], ROOF_FADES.needsUpdate] = [byte, true];
		}
		return fading;
	}

	/** Each region's fade now, by key (for tests). */
	fadeLevels(): Map<number, number> {
		return new Map([...this.fades].map(([k, f]) => [k, this.fadeAt(f, this.now)]));
	}

	/**
	 * Redraws the chunks whose roofs changed and returns the walls' building context (#251): the
	 * roofed cells this viewer sees, wherever the kit presumes roofs (a kit of the open air, from
	 * the first frame) or once the viewer knows a roofed cell (stone halls, whose dungeons have
	 * none); null otherwise (no roofs in the kit, or none known), when no wall is a boundary.
	 */
	update(
		build: WorldBuilders,
		objects: readonly SceneObject[],
		shape: WorldShape,
		interior: Uint8Array | null
	): Uint8Array | null {
		this.build = build;
		this.shape = shape;
		if (!this.kit) {
			this.regions = [];
			this.footprint = null;
			this.stale = true;
			this.draw();
			return null;
		}
		this.footprint = build.roofFootprint(shape, objects, interior, this.kit.presume);
		this.regions = build.roofRegions(shape, this.footprint);
		this.stale = true;
		this.draw();
		return this.kit.presume || this.footprint.includes(1) ? this.footprint : null;
	}

	stats(): RoofStats {
		let triangles = 0;
		for (const { mesh } of this.meshes.values()) triangles += (mesh.geometry.index?.count ?? 0) / 3;
		const regions = this.regions.length;
		return { chunks: this.meshes.size, regions, triangles, built: this.built };
	}

	/** A stand-in for the warm-up: a casting roof, so the first roof drawn compiles nothing. */
	gallery(): THREE.Object3D[] {
		if (!this.standIns) {
			const g = new THREE.BoxGeometry(0.01, 0.01, 0.01).deleteAttribute('uv');
			const cells = new Float32Array(g.getAttribute('position').count * 2);
			g.setAttribute(ROOF_CELL_ATTRIBUTE, new THREE.BufferAttribute(cells, 2));
			g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cells.length * 1.5), 3));
			g.setAttribute(ROOF_KEY_ATTRIBUTE, new THREE.BufferAttribute(cells, 2));
			const mesh = new THREE.Mesh(g, this.material);
			mesh.castShadow = mesh.receiveShadow = true;
			this.standIns = [standIn(mesh)];
		}
		return this.standIns;
	}

	dispose(): void {
		this.clear();
		for (const s of this.standIns ?? []) (s as THREE.Mesh).geometry.dispose();
		this.material.dispose();
	}

	private clear(): void {
		for (const { mesh } of this.meshes.values()) {
			this.group.remove(mesh);
			mesh.geometry.dispose();
		}
		this.meshes.clear();
	}

	/** Each region's fade target from what the viewer has (world/roof-fade.ts); new ones start there. */
	private retarget(): void {
		this.stale = false;
		const { build, shape } = this;
		if (!build || !shape) return;
		const n = shape.grid.width * shape.grid.height;
		if (this.visible?.length !== n)
			this.visible = this.sight?.enabled ? decodeMask(this.sight.visible, n) : null;
		const open = this.tokens.filter((t) => this.own.has(t.id) || t.id === this.selected);
		const targets = build.roofFade(this.regions, {
			tokens: open.map((t) => t.pos.y * shape.grid.width + t.pos.x),
			pivot: this.pivot,
			visible: this.visible,
			known: shape.known,
			building: this.building && this.gm
		});
		const kept = new Map<number, Fade>();
		this.regions.forEach((r, i) => {
			const [key, to] = [r.cells[0], targets[i]];
			const f = this.fades.get(key);
			if (!f || this.reduced) kept.set(key, { from: to, to, start: this.now });
			else if (f.to === to) kept.set(key, f);
			else kept.set(key, { from: this.fadeAt(f, this.now), to, start: NaN });
		});
		this.fades = kept;
	}

	private fadeAt(f: Fade, now: number): number {
		const t = this.reduced ? 1 : Math.min(1, Math.max(0, (now - f.start) / ROOF_FADE_MS));
		return Number.isNaN(t) ? f.from : f.from + (f.to - f.from) * t;
	}

	/** A key cell's texel in `ROOF_FADES`. */
	private texelOf(key: number): number {
		const w = this.shape!.grid.width;
		return Math.floor(key / w) * ROOF_FADE_SIDE + (key % w);
	}

	/** Redraws the chunks whose regions changed; drops chunks with none. */
	private draw(): void {
		const { build, shape, kit } = this;
		if (!build || !shape) return;
		const chunks = kit ? build.roofsByChunk(this.regions) : new Map<number, RoofRegion[]>();
		for (const [c, entry] of this.meshes)
			if (!chunks.has(c)) {
				this.group.remove(entry.mesh);
				entry.mesh.geometry.dispose();
				this.meshes.delete(c);
			}
		const w = shape.grid.width;
		for (const [c, regions] of chunks) {
			const key = build.roofKey(shape, regions);
			const entry = this.meshes.get(c);
			if (entry?.key === key) continue;
			const tint = new THREE.Color(kit!.look?.color ?? PLAIN_ROOF.color).toArray() as Rgb;
			const m = build.roofMesh(shape, regions, kit!.roof, this.footprint!, kit!.pieces, tint);
			const g = new THREE.BufferGeometry();
			g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
			g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
			g.setAttribute('color', new THREE.BufferAttribute(m.colors, 3));
			g.setAttribute(ROOF_CELL_ATTRIBUTE, new THREE.BufferAttribute(m.fogCells, 2));
			g.setAttribute(
				ROOF_KEY_ATTRIBUTE,
				new THREE.BufferAttribute(keysOf(m.region, regions, w), 2)
			);
			g.setIndex(new THREE.BufferAttribute(m.indices, 1));
			g.computeBoundingSphere();
			if (entry) {
				entry.mesh.geometry.dispose();
				entry.mesh.geometry = g;
				entry.key = key;
			} else {
				const mesh = new THREE.Mesh(g, this.material);
				mesh.castShadow = mesh.receiveShadow = true;
				this.group.add(mesh);
				this.meshes.set(c, { mesh, key });
			}
			this.built++;
		}
	}
}

/**
 * Per vertex, its region's key cell (x, y): the texel its fade is read at. At the texel's middle:
 * interpolated, a whole number can arrive a hair under it and truncate to the texel before
 * (SwiftShader striped a faded roof so).
 */
function keysOf(region: Uint16Array, regions: readonly RoofRegion[], w: number): Float32Array {
	const out = new Float32Array(region.length * 2);
	region.forEach((r, v) => {
		const key = regions[r].cells[0];
		[out[v * 2], out[v * 2 + 1]] = [(key % w) + 0.5, Math.floor(key / w) + 0.5];
	});
	return out;
}
