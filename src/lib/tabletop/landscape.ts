// The ground and what lies beyond it (#220, #244): the play plane under the grid (drawn only with
// `?off=terrain`, the chunks draw the ground otherwise), and beyond the grid the skirt out to the
// horizon and the environment's silhouettes, fogged into the sky (world/beyond.ts has the shapes,
// built in the lazy world chunk). The play plane is the terrain kind (#172), so it draws the
// painted floors from the ground map itself. Everything beyond is the surface kind, wholly off the
// grid, where `worldModify` is neutral: it is built from the environment's id, the world look's
// backdrop and the grid's size only, never from a cell, so the GM, players and spectators see the
// same and it tells nobody about unexplored ground; it is never picked and casts no shadow. The
// skirt wears the environment's ground look (water for the sea), the silhouettes the look each
// recipe names, tinted. Backdrop kinds and environments change geometry, params and slots only:
// one graph, so nothing compiles. Under the night train (prairie-scroll) the skirt is the moving
// ground (#243): its slots slide along the grid's long axis on the world's clock (`worldTime`, which
// the world layer holds still under reduced motion), and the void's floors wear the same look
// (`wearSkirt`), so the ground beyond and under the gaps runs on as one.

import * as THREE from 'three/webgpu';
import type { SquareGrid } from '$lib/game/grid';
import { DEFAULT_WORLD, type WorldLook } from '$lib/game/world';
import { wear, type EnvironmentLook } from './environment';
import { STEP_HEIGHT } from './ground';
import { wearFloors } from './materials/floors';
import {
	createMaterial,
	disposeTwins,
	repeatFor,
	setParams,
	setSlot,
	SLOT_NAMES,
	twinOf,
	type KindMaterial,
	type ParamsInput
} from './materials';
import type { Tier } from './quality';
import type { Beyond, BeyondMesh } from './world/beyond';
import { spanOf, type Extents } from './world-ground';
import type { WorldBuilders } from './world-layer';

const PLAIN = {
	/** The skirt without an environment: plain earth, never wood. */
	ground: { color: 0x4d4a42, roughness: 1 },
	surface: { color: 0x2f4a3a, roughness: 1 },
	/** The sea (#120 gives it swell and a water kind): flat, dark and glossy. */
	water: { color: 0x1d3640, roughness: 0.25 }
};

/**
 * The skirt's land look over the environment's ground (#377): darker than the map, so the map reads
 * as the lit stage, with broad macro patches (about 30 m across) so it reads as land rather than a
 * flat field from the overview. Silhouettes take the same patches. Params only: nothing compiles.
 */
const LAND = { macroScale: 0.035, macroTint: 0.3, macroRoughness: 0.15 };
const SHADE = 0.62;
/**
 * How fast the moving ground slides under the night train, in repeats a second: 0.5, so its slots
 * come round whole every time `worldTime` wraps (an hour, world-layer.ts).
 */
export const SCROLL_SPEED = 0.5;
/** At most this many silhouettes (draws); recipes have one or two. */
const RIDGES = 3;

export class WorldGround {
	readonly group = new THREE.Group();
	private skirtMaterial: KindMaterial = createMaterial('surface', { antiTiled: true });
	private ridgeMaterials: KindMaterial[] = Array.from({ length: RIDGES }, () =>
		createMaterial('surface', { antiTiled: true })
	);
	private surfaceMaterial: KindMaterial = createMaterial('terrain', { antiTiled: true });
	private surface: THREE.Mesh | null = null;
	private beyondMeshes: THREE.Mesh[] = [];
	private extents: Extents | null = null;
	private beyond: Beyond | null = null;
	private scene: { environment: string | null; backdrop: WorldLook['backdrop'] } = {
		environment: null,
		backdrop: DEFAULT_WORLD.backdrop
	};
	private look: EnvironmentLook | null = null;
	private cellSize = 1;
	private low = false;
	private playShown = true;
	/** Told the backdrop once its skirt is built and painted (world-layer.ts: the void follows it). */
	onBackdrop: ((backdrop: WorldLook['backdrop']) => void) | null = null;

	constructor(
		parent: THREE.Object3D,
		private readonly builders: WorldBuilders
	) {
		parent.add(this.group);
	}

	/** The skirt's height at (x, z), null over the grid: the camera keeps above it (#280). */
	readonly heightAt = (x: number, z: number): number | null =>
		this.beyond && this.builders.beyondHeightAt(this.beyond, x, z);

	/** The play plane: hidden while the world's chunks (#240) draw the ground, shown with `?off=terrain`. */
	showPlay(shown: boolean): void {
		this.playShown = shown;
		if (this.surface) this.surface.visible = shown;
	}

	/** Lays the ground for a table's extents. */
	build(extents: Extents): void {
		if (this.surface) {
			this.surface.geometry.dispose();
			this.group.remove(this.surface);
		}
		this.extents = extents;
		const { width, depth } = extents.play;
		const surface = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), this.surfaceMaterial);
		surface.rotation.x = -Math.PI / 2;
		surface.receiveShadow = true;
		surface.visible = this.playShown;
		this.surface = surface;
		this.group.add(surface);
		this.rebuild();
	}

	/**
	 * What lies beyond, from the scene's look: rebuilt only when the environment or the backdrop
	 * changed (the grid's size is `build`'s).
	 */
	setBackdrop(world: WorldLook | null, environment: string | null): void {
		const backdrop = world?.backdrop ?? DEFAULT_WORLD.backdrop;
		const { scene } = this;
		if (
			scene.environment === environment &&
			scene.backdrop.kind === backdrop.kind &&
			scene.backdrop.level === backdrop.level
		)
			return;
		this.scene = { environment, backdrop: { ...backdrop } };
		this.rebuild();
		this.onBackdrop?.(this.scene.backdrop);
	}

	/** The skirt's look (params and slots, its slide too) on `material`: the void's floor (#243). */
	wearSkirt(material: KindMaterial): void {
		setParams(material, this.skirtMaterial.params as unknown as ParamsInput);
		for (const slot of SLOT_NAMES) setSlot(material, slot, this.skirtMaterial[`${slot}Slot`]);
	}

	/** Fewer directions and loops on the low tier: rebuilt only when that changes. */
	setTier(tier: Tier): void {
		if ((tier === 'low') === this.low) return;
		this.low = tier === 'low';
		this.rebuild();
	}

	/** Dresses the play plane and what lies beyond in the environment's looks, or the plain ones. */
	dress(look: EnvironmentLook | null, grid: SquareGrid | null): void {
		this.look = look;
		this.cellSize = grid?.cellSize ?? 1;
		wear(this.surfaceMaterial, look?.surface ?? null, PLAIN.surface);
		wearFloors(look?.floors ?? null, this.cellSize); // the floors' surfaces (#187), the terrain kind's
		setParams(this.surfaceMaterial, this.tile(look?.surface.cells ?? 1));
		this.paint();
	}

	/**
	 * The tier's anti-tiling (#181): the materials made again in that variant, once.
	 * True if remade: the renderer warms the new variant up, not compiling it mid-frame.
	 */
	setAntiTiled(on: boolean): boolean {
		if (!!this.surfaceMaterial.options.antiTiled === on) return false;
		// Their twins, kept (#180): switching back and again releases and compiles nothing.
		this.skirtMaterial = twinOf(this.skirtMaterial);
		this.ridgeMaterials = this.ridgeMaterials.map(twinOf);
		this.surfaceMaterial = twinOf(this.surfaceMaterial);
		if (this.surface) this.surface.material = this.surfaceMaterial;
		this.beyondMeshes.forEach((m, i) => (m.material = this.materialOf(i)));
		return true;
	}

	dispose(): void {
		this.clearBeyond();
		this.surface?.geometry.dispose();
		for (const m of [this.skirtMaterial, this.surfaceMaterial, ...this.ridgeMaterials])
			disposeTwins(m);
	}

	private tile(cells: number) {
		return { repeat: repeatFor(cells, this.cellSize, STEP_HEIGHT) };
	}

	/** Mesh 0 is the skirt, the rest the recipe's ridges in order. */
	private materialOf(i: number): KindMaterial {
		return i === 0 ? this.skirtMaterial : this.ridgeMaterials[i - 1];
	}

	/** The skirt and silhouettes for the grid's size and the scene's look. */
	private rebuild(): void {
		if (!this.extents) return;
		this.clearBeyond();
		const b = this.builders.beyondOf({ ...this.scene, span: spanOf(this.extents) });
		this.beyond = b;
		const ridges = b.recipe.ridges
			.slice(0, RIDGES)
			.map((_, i) => this.builders.ridgeMesh(b, i, this.low));
		[this.builders.skirtMesh(b, this.low), ...ridges].forEach((data, i) => {
			const mesh = new THREE.Mesh(geometryOf(data), this.materialOf(i));
			// Received like the old ring, so it shares its program; never cast, never picked.
			mesh.receiveShadow = true;
			mesh.raycast = () => {}; // off the grid there is nothing to point at
			this.beyondMeshes.push(mesh);
			this.group.add(mesh);
		});
		this.paint();
	}

	/** The skirt in the ground look (or water), each silhouette in its look, tinted and darker. */
	private paint(): void {
		const look = this.look;
		const water = this.beyond?.sample === 'water';
		const ground = water ? null : (look?.ground ?? null);
		wear(this.skirtMaterial, ground, water ? PLAIN.water : PLAIN.ground);
		// The moving ground slides along the grid's long axis.
		const play = this.extents?.play;
		const along = !play || play.width >= play.depth;
		const scroll = this.scene.backdrop.kind === 'prairie-scroll' ? SCROLL_SPEED : 0;
		const flow = along ? { x: scroll, y: 0 } : { x: 0, y: scroll };
		setParams(this.skirtMaterial, { ...this.tile(ground?.cells ?? 1), ...LAND, flow });
		this.skirtMaterial.params.color.multiplyScalar(SHADE);
		this.beyond?.recipe.ridges.slice(0, RIDGES).forEach((ridge, i) => {
			const material = this.ridgeMaterials[i];
			const own = ridge.look && look ? look[ridge.look] : null;
			wear(material, own, { color: ridge.color, roughness: 1 });
			setParams(material, { ...this.tile(own?.cells ?? 1), ...LAND, color: ridge.color });
		});
	}

	private clearBeyond(): void {
		for (const m of this.beyondMeshes) {
			m.geometry.dispose();
			this.group.remove(m);
		}
		this.beyondMeshes = [];
	}
}

/** A built shape as geometry: position, smooth normals, world uv (the ring's layout). */
function geometryOf({ positions, uvs, indices }: BeyondMesh): THREE.BufferGeometry {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setIndex(new THREE.BufferAttribute(indices, 1));
	geometry.computeVertexNormals();
	geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
	geometry.computeBoundingSphere();
	return geometry;
}
