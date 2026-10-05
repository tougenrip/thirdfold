// Roofs over roofed rooms (#257): the walls' layer keeps one (walls.ts), since roofs and walls
// read the same things (the objects, the world's shape, the interior mask, the kit). The cells
// roofed, their regions and gables are the world chunk's (world/roofs.ts, pure); here they are one
// mesh per 16x16 chunk in the surface kind's `roof` variant, which reads the fog and the sky at
// each region's known outside cell (`aRoofCell`), so a roof over unexplored ground is drawn, never
// black. A region is left out while the viewer sees into it (the rules show its cells; #259 fades
// instead). A chunk is rebuilt only when what it draws changed (`roofKey`). Casting and receiving,
// never picked. Nothing here compiles: the material is the lobby's (`kindGallery`).

import * as THREE from 'three/webgpu';
import type { KitRoof } from '$lib/assets/kit';
import type { SceneObject } from '$lib/game/objects';
import { decodeMask, type FogView } from '$lib/game/visibility';
import { wear, type Look } from './environment';
import { createMaterial } from './materials';
import { ROOF_CELL_ATTRIBUTE } from './materials/world-modify';
import { standIn } from './warmup';
import type { RoofRegion } from './world/roofs';
import type { WorldShape } from './world/shape';
import type { WorldBuilders } from './world-layer';

/** A kit's roofs as the layer draws them: its settings and its material's look. */
export interface RoofKit {
	roof: KitRoof;
	/** Roof walled rooms the viewer hasn't explored (`KitDef.presumeRoofs`). */
	presume: boolean;
	look: Look | null;
}

const PLAIN_ROOF = { color: 0x6f5f4e, roughness: 0.9 };

export interface RoofStats {
	chunks: number;
	regions: number;
	triangles: number;
	/** Chunks built since the layer was made (a chunk is built only when its roofs change). */
	built: number;
}

export class RoofLayer {
	readonly group = new THREE.Group();
	private readonly material = createMaterial('surface', { roof: true });
	private kit: RoofKit | null = null;
	private build: WorldBuilders | null = null;
	private shape: WorldShape | null = null;
	private footprint: Uint8Array | null = null;
	private regions: RoofRegion[] = [];
	private visible: Uint8Array | null = null;
	private sight: FogView | null = null;
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

	/** What the viewer sees now: a region it sees into is left out. */
	setSight(fog: FogView | null): void {
		this.sight = fog;
		this.visible = null; // decoded against the grid at the next draw
		this.draw();
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
			this.draw();
			return null;
		}
		this.footprint = build.roofFootprint(shape, objects, interior, this.kit.presume);
		this.regions = build.roofRegions(shape, this.footprint);
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

	/** Redraws the chunks whose shown regions changed; drops chunks with none. */
	private draw(): void {
		const { build, shape, kit } = this;
		if (!build || !shape) return;
		const { grid } = shape;
		const n = grid.width * grid.height;
		if (this.visible?.length !== n)
			this.visible = this.sight?.enabled ? decodeMask(this.sight.visible, n) : null;
		const shown = this.regions.filter((r) => !build.seenInto(r, this.visible));
		const chunks = kit ? build.roofsByChunk(shown) : new Map<number, RoofRegion[]>();
		for (const [c, entry] of this.meshes)
			if (!chunks.has(c)) {
				this.group.remove(entry.mesh);
				entry.mesh.geometry.dispose();
				this.meshes.delete(c);
			}
		for (const [c, regions] of chunks) {
			const key = build.roofKey(shape, regions);
			const entry = this.meshes.get(c);
			if (entry?.key === key) continue;
			const m = build.roofMesh(shape, regions, kit!.roof, this.footprint!);
			const g = new THREE.BufferGeometry();
			g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
			g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
			g.setAttribute(ROOF_CELL_ATTRIBUTE, new THREE.BufferAttribute(m.fogCells, 2));
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
