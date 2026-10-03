// The ground (#220): the play plane under the grid and a ring of ground from its edge out to the
// horizon, where the haze takes it (world-ground.ts has the maths). The grid lines are in the
// overlay (overlay.ts). The play plane is the terrain kind (#172), so it draws the painted floors
// from the ground map itself; the ring is the surface kind in the environment's ground look, and
// lies wholly off the grid, where `worldModify` is neutral: it is built from the grid's size and
// the environment's look only, never from a cell, so it tells nobody about unexplored ground, and
// it is never picked. Both are world-mapped, their tile from `repeatFor`, anti-tiled on medium
// and up (#181); their materials are kept across tables.

import * as THREE from 'three/webgpu';
import type { SquareGrid } from '$lib/game/grid';
import { wear, type EnvironmentLook } from './environment';
import { STEP_HEIGHT } from './ground';
import { wearFloors } from './materials/floors';
import {
	createMaterial,
	disposeTwins,
	repeatFor,
	setParams,
	twinOf,
	type KindMaterial
} from './materials';
import type { Tier } from './quality';
import { ringVertices, type Extents } from './world-ground';

const PLAIN = {
	/** The ring without an environment: plain earth, never wood. */
	ground: { color: 0x4d4a42, roughness: 1 },
	surface: { color: 0x2f4a3a, roughness: 1 }
};

/**
 * The ring's land look over the environment's ground (#377): darker than the map, so the map reads
 * as the lit stage, with broad macro patches (about 30 m across) so it reads as land rather than a
 * flat field from the overview. Params only: nothing compiles.
 */
const RING = { shade: 0.62, macroScale: 0.035, macroTint: 0.3, macroRoughness: 0.15 };

/** Directions round the ring: fewer on the low tier. */
const SEGMENTS = { low: 24, other: 96 };

export class WorldGround {
	readonly group = new THREE.Group();
	private ringMaterial: KindMaterial = createMaterial('surface', { antiTiled: true });
	private surfaceMaterial: KindMaterial = createMaterial('terrain', { antiTiled: true });
	private ring: THREE.Mesh | null = null;
	private surface: THREE.Mesh | null = null;
	private extents: Extents | null = null;
	private segments = SEGMENTS.other;

	/** Lays the ground for a table's extents. */
	build(extents: Extents): void {
		this.clear();
		this.extents = extents;
		const { width, depth } = extents.play;
		const surface = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), this.surfaceMaterial);
		surface.rotation.x = -Math.PI / 2;
		surface.receiveShadow = true;
		this.surface = surface;
		this.group.add(surface);
		this.buildRing();
	}

	/** The ring for a quality tier: rebuilt only when its segments change. */
	setTier(tier: Tier): void {
		const segments = tier === 'low' ? SEGMENTS.low : SEGMENTS.other;
		if (segments === this.segments) return;
		this.segments = segments;
		if (this.extents) this.buildRing();
	}

	private buildRing(): void {
		if (this.ring) {
			this.ring.geometry.dispose();
			this.group.remove(this.ring);
		}
		const { positions, uvs, indices } = ringVertices(this.extents!, this.segments);
		const normals = new Float32Array(positions.length);
		for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
		geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
		geometry.setIndex(new THREE.BufferAttribute(indices, 1));
		const ring = new THREE.Mesh(geometry, this.ringMaterial);
		ring.receiveShadow = true;
		ring.raycast = () => {}; // off the grid there is nothing to point at
		this.ring = ring;
		this.group.add(ring);
	}

	/** Dresses the play plane and the ring in the environment's looks, or the plain ones. */
	dress(look: EnvironmentLook | null, grid: SquareGrid | null): void {
		const cellSize = grid?.cellSize ?? 1;
		wear(this.surfaceMaterial, look?.surface ?? null, PLAIN.surface);
		wear(this.ringMaterial, look?.ground ?? null, PLAIN.ground);
		wearFloors(look?.floors ?? null, cellSize); // the floors' surfaces (#187), the terrain kind's
		const tile = (cells: number) => ({ repeat: repeatFor(cells, cellSize, STEP_HEIGHT) });
		setParams(this.surfaceMaterial, tile(look?.surface.cells ?? 1));
		setParams(this.ringMaterial, tile(look?.ground.cells ?? 1));
		const { shade, ...land } = RING;
		this.ringMaterial.params.color.multiplyScalar(shade);
		setParams(this.ringMaterial, land);
	}

	/**
	 * The tier's anti-tiling (#181): the materials made again in that variant, once.
	 * True if remade: the renderer warms the new variant up, not compiling it mid-frame.
	 */
	setAntiTiled(on: boolean): boolean {
		if (!!this.surfaceMaterial.options.antiTiled === on) return false;
		// Their twins, kept (#180): switching back and again releases and compiles nothing.
		this.ringMaterial = twinOf(this.ringMaterial);
		this.surfaceMaterial = twinOf(this.surfaceMaterial);
		if (this.ring) this.ring.material = this.ringMaterial;
		if (this.surface) this.surface.material = this.surfaceMaterial;
		return true;
	}

	/** Disposes what the last table built, keeping the shared materials. */
	private clear(): void {
		for (const child of [...this.group.children]) {
			if (child instanceof THREE.Mesh) child.geometry.dispose();
			this.group.remove(child);
		}
		this.ring = this.surface = null;
	}

	dispose(): void {
		this.clear();
		disposeTwins(this.ringMaterial);
		disposeTwins(this.surfaceMaterial);
	}
}
