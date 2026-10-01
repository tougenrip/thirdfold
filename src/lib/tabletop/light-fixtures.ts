// Light fixtures (#232, docs/ASSETS.md "Light fixtures"): each light drawn with the model that fits
// its kind and mount (`fixtureFor`, `sideOf` in light-model.ts), one InstancedMesh per model mesh:
// its body the prop kind (vertex colours and the bake, casting shadows), its `flame` the emissive
// kind, white, tinted per instance by the light's colour above 1 in HDR so it blooms, and dark
// (the wick) when the light is off, and breathing with its light's flicker in the shader (#231:
// the profile and phase in the instance's paint, materials/kinds.ts). A wall fixture is modelled on its cell's north wall and turned
// a quarter per side; a floor one stands at the cell centre, and a neon bar or a panel (#236) is
// turned by its look's `facing`, its glow an emissive bar or quad in the light's colour. Picking maps an instance to its light.
// A token carrying light shows a small flame at its hand (`carriedAt`), following its gliding
// mini. Built only from what the viewer was sent: its lights, and the tokens in its view, so a
// hidden carrier never shows a flame. A prop with a `flame` mesh (a brazier's coals, a torch
// stand's head) draws it itself (props.ts), lit by a light on its cell, and seats that light's
// GridLight entry on it (`flameSeats`). Every material here is a variant the warm-up gallery
// compiles (prop instanced with vertex colours, emissive instanced). r186 gives every
// InstancedMesh a vertex stage of its own, so each loaded fixture model's meshes are made once, at
// full room capacity, and kept (drawing no instances, never culled) for the table's warm-up to
// compile: fixtures coming and going or a kind changing then compiles nothing. Only a model's
// arrival makes meshes, and that goes through the warm-up hold like any model (renderer `onModel`).

import * as THREE from 'three/webgpu';
import { gridToWorld, type SquareGrid } from '$lib/game/grid';
import {
	CARRIED_LIGHT_COLOR,
	lightLook,
	MAX_LIGHTS_PER_ROOM,
	type Light,
	type LightLook
} from '$lib/game/lights';
import type { Prop } from '$lib/game/props';
import { MAX_TOKENS_PER_ROOM, type Token } from '$lib/game/token';
import type { Ground } from './ground';
import { carriedAt, HAND } from './grid-light-layer';
import {
	FIXTURES,
	fixtureFor,
	flickerPhase,
	flickerProfile,
	sideOf,
	STRIP_KINDS
} from './light-model';
import {
	addInstanceTints,
	createMaterial,
	PAINT_ATTRIBUTE,
	setParams,
	TINT_ATTRIBUTE,
	type KindMaterial,
	type MaterialOptions
} from './materials';
import { loadModel, modelNow, partsOf, type LoadedModel, type ModelPart } from './models';

/** A flame's glow over its light's colour: above 1 in HDR, so the core blooms (#160). */
export const FLAME_GLOW = 4;
/** What a flame shows as when its light is off: the wick's dark, lit by the room. */
const WICK = 0x3a3530;
/** A carried flame's size in its mini's: a small teardrop at the hand. */
const CARRIED = { radius: 0.06, stretch: 1.6 };

/** The material every flame is drawn with: the wick's colour, its glow per instance (`aTint`). */
export const flameMaterial = (): KindMaterial =>
	createMaterial('emissive', { instanced: true, params: { color: WICK } });

/** What a flame glows as: its light's colour, flicker and id (its phase), or null when unlit. */
export interface FlameLook {
	color: string;
	flicker: LightLook['flicker'];
	/** The light's id, or a carried light's token's: the same phase as its GridLight. */
	id: string;
}

const glowColour = new THREE.Color();
/**
 * Writes instance `i` of a flame mesh (`mesh`'s tints and paints): the colour at FLAME_GLOW and its
 * light's flicker, or no glow for an unlit flame.
 */
export function paintFlame(mesh: THREE.InstancedMesh, i: number, look: FlameLook | null): void {
	const tints = mesh.geometry.getAttribute(TINT_ATTRIBUTE) as THREE.BufferAttribute;
	const paints = mesh.geometry.getAttribute(PAINT_ATTRIBUTE) as THREE.BufferAttribute;
	tints.needsUpdate = paints.needsUpdate = true;
	if (!look) return void tints.setXYZW(i, 0, 0, 0, 0);
	glowColour.set(look.color); // linear, as three's colours are
	tints.setXYZW(i, glowColour.r, glowColour.g, glowColour.b, FLAME_GLOW);
	paints.setXYZ(i, flickerProfile(look.flicker), flickerPhase(look.id), 0);
}

/** A placed light's flame, lit or not. */
export const flameOf = (light: Light): FlameLook | null =>
	light.on ? { color: light.color, flicker: lightLook(light).flicker, id: light.id } : null;

/** The middle of a model's `flame` meshes (model units), or null for a model with none. */
function flameMiddle(model: LoadedModel): THREE.Vector3 | null {
	const box = new THREE.Box3();
	for (const { geometry } of partsOf(model, 'flame')) {
		if (!geometry.boundingBox) geometry.computeBoundingBox();
		box.union(geometry.boundingBox!);
	}
	return box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
}

/**
 * Where a light sits on a prop that is its fixture (#367's seats, now any prop whose model has a
 * `flame` mesh), by cell index: the middle of the prop's flame, in world units over its floor.
 * Known once the prop's model has loaded (the renderer relights then).
 */
export function flameSeats(grid: SquareGrid, props: readonly Prop[]): Map<number, number> {
	const seats = new Map<number, number>();
	for (const p of props) {
		const model = modelNow(p.assetId);
		const middle = model ? flameMiddle(model) : null;
		if (middle) seats.set(p.pos.y * grid.width + p.pos.x, middle.y * p.scale);
	}
	return seats;
}

/** A fixture model's meshes, with an instance per light drawn with it. */
interface Batch {
	model: LoadedModel;
	bodies: THREE.InstancedMesh[];
	flames: THREE.InstancedMesh[];
	/** Materials of its own for textured parts (cooked or commissioned art). */
	materials: KindMaterial[];
	/** The light id of each instance. */
	ids: string[];
}

const BODY: MaterialOptions = { instanced: true, vertexColors: true };
const UP = new THREE.Vector3(0, 1, 0);
/** Every fixture model id. */
const FIXTURE_IDS = [...new Set(Object.values(FIXTURES).flatMap((f) => [f.wall, f.floor]))].filter(
	(id): id is string => !!id
);

export class LightFixtures {
	readonly group = new THREE.Group();
	private body = createMaterial('prop', BODY);
	private flame = flameMaterial();
	private batches = new Map<string, Batch>();
	private requested = new Set<string>();
	/** Carried flames: one instance per carrying token in view, by `carriers`. */
	private carried: THREE.InstancedMesh;
	private carriers: string[] = [];
	/** Where each carried flame is drawn. */
	private carriedAt: THREE.Matrix4[] = [];

	/** `onModel` is told when a fixture's model has arrived (the renderer relights, and so redraws). */
	constructor(private readonly onModel: () => void = () => {}) {
		const geometry = new THREE.SphereGeometry(CARRIED.radius, 12, 8).scale(1, CARRIED.stretch, 1);
		this.carried = this.instanced(geometry, this.flame, MAX_TOKENS_PER_ROOM, false);
	}

	/**
	 * Draws a fixture for every light that has one (`walled`: the blocking edges, as `lightMount`
	 * reads them) and a flame at the hand of every token in `tokens` that carries light.
	 */
	update(
		grid: SquareGrid,
		lights: readonly Light[],
		tokens: readonly Token[],
		walled: ReadonlySet<string>,
		ground: Ground | null
	): void {
		const byModel = new Map<string, { light: Light; side: number }[]>();
		for (const light of lights) {
			const side = sideOf(light, walled);
			const id = fixtureFor(light, side < 0 ? 'floor' : 'wall');
			// A strip's bar or panel (#236) stands turned to its facing, as a wall fixture to its side.
			const look = lightLook(light);
			const turn = STRIP_KINDS.has(look.kind) ? look.facing : side;
			if (id) byModel.set(id, [...(byModel.get(id) ?? []), { light, side: turn }]);
		}
		for (const id of byModel.keys()) this.request(id);
		setParams(this.body, { lift: 1e-3 * grid.cellSize });
		const turn = new THREE.Quaternion();
		const scale = new THREE.Vector3().setScalar(grid.cellSize);
		for (const id of FIXTURE_IDS) {
			const batch = this.ensure(id);
			if (!batch) continue;
			const list = (byModel.get(id) ?? []).slice(0, MAX_LIGHTS_PER_ROOM);
			batch.ids = list.map((l) => l.light.id);
			list.forEach(({ light, side }, i) => {
				const w = gridToWorld(grid, light.pos);
				turn.setFromAxisAngle(UP, side < 0 ? 0 : -side * (Math.PI / 2));
				const at = new THREE.Vector3(w.x, ground?.floorY(light.pos) ?? 0, w.z);
				const base = new THREE.Matrix4().compose(at, turn, scale);
				for (const mesh of [...batch.bodies, ...batch.flames]) mesh.setMatrixAt(i, base);
				for (const mesh of batch.flames) paintFlame(mesh, i, flameOf(light));
			});
			for (const mesh of [...batch.bodies, ...batch.flames]) this.settle(mesh, list.length);
		}
		this.updateCarried(grid, tokens, ground);
	}

	/** Carried flames follow their minis (`rootOf`: a mini's root, tweened), as their light does. */
	carry(tokens: { rootOf(id: string): THREE.Object3D | null }): void {
		let moved = false;
		this.carriers.forEach((id, i) => {
			const root = tokens.rootOf(id);
			if (!root) return;
			const size = root.scale.x;
			const { x, y, z } = root.position;
			const base = this.carriedAt[i];
			const was = new THREE.Vector3().setFromMatrixPosition(base);
			if (was.x === x + HAND.x * size && was.y === y + HAND.y * size && was.z === z) return;
			base.makeScale(size, size, size).setPosition(x + HAND.x * size, y + HAND.y * size, z);
			this.carried.setMatrixAt(i, base);
			moved = true;
		});
		if (moved) this.settle(this.carried, this.carriers.length);
	}

	/** The light whose fixture a ray hits first, and how far, if any. */
	pick(raycaster: THREE.Raycaster): { id: string; distance: number } | null {
		let best: { id: string; distance: number } | null = null;
		for (const batch of this.batches.values()) {
			const hit = raycaster.intersectObjects([...batch.bodies, ...batch.flames], false)[0];
			if (hit?.instanceId !== undefined && !(best && best.distance <= hit.distance))
				best = { id: batch.ids[hit.instanceId], distance: hit.distance };
		}
		return best;
	}

	dispose(): void {
		for (const id of [...this.batches.keys()]) this.drop(id);
		this.group.remove(this.carried);
		this.carried.geometry.dispose();
		this.carried.dispose();
		this.body.dispose();
		this.flame.dispose();
	}

	private updateCarried(grid: SquareGrid, tokens: readonly Token[], ground: Ground | null): void {
		const carrying = tokens.filter((t) => t.light > 0).slice(0, MAX_TOKENS_PER_ROOM);
		this.carriers = carrying.map((t) => t.id);
		this.carriedAt = carrying.map((t, i) => {
			const size = grid.cellSize * (t.scale ?? 1);
			const { x, y, z } = carriedAt(grid, t, ground);
			const base = new THREE.Matrix4().makeScale(size, size, size).setPosition(x, y, z);
			this.carried.setMatrixAt(i, base);
			// A carried light's look is a torch's (lightSources), its phase its token's.
			const color = t.lightColor ?? CARRIED_LIGHT_COLOR;
			paintFlame(this.carried, i, { color, flicker: lightLook({}).flicker, id: t.id });
			return base;
		});
		this.settle(this.carried, carrying.length);
	}

	/**
	 * An instanced mesh of a fresh geometry (its own tints) in the group, drawing nothing yet. Never
	 * culled, so the warm-up compiles it with no instances (which draw nothing).
	 */
	private instanced(
		geometry: THREE.BufferGeometry,
		material: THREE.Material,
		capacity: number,
		shadows: boolean
	): THREE.InstancedMesh {
		addInstanceTints(geometry, capacity);
		const mesh = new THREE.InstancedMesh(geometry, material, capacity);
		mesh.castShadow = mesh.receiveShadow = shadows;
		mesh.count = 0;
		mesh.frustumCulled = false;
		this.group.add(mesh);
		return mesh;
	}

	/** After its instances changed: how many draw, and their bounds for picking. */
	private settle(mesh: THREE.InstancedMesh, count: number): void {
		mesh.count = count;
		mesh.instanceMatrix.needsUpdate = true;
		mesh.computeBoundingSphere();
	}

	/**
	 * Asks for a fixture model a light needs, the first time. Its arrival relights and warms up, but
	 * not a model already here whose meshes were made (and warmed) before: a warm-up then would
	 * compile mid-game for nothing (r186 orders a shadowed material's uniforms otherwise compiled).
	 */
	private request(id: string): void {
		if (this.requested.has(id)) return;
		this.requested.add(id);
		const arrived = (model: LoadedModel | null) => {
			if (!model || this.batches.get(id)?.model !== model) this.onModel();
		};
		void loadModel(id, this.onModel).then(arrived);
	}

	/**
	 * A fixture model's meshes, made with room for every light of a room once the model has
	 * arrived (anywhere: models are shared across tables), and kept; null until then (the light's
	 * cells and GridLight show it meanwhile).
	 */
	private ensure(id: string): Batch | null {
		const model = modelNow(id);
		let batch = this.batches.get(id);
		if (batch && batch.model === model) return batch;
		this.drop(id);
		if (!model) return null;
		const capacity = MAX_LIGHTS_PER_ROOM;
		const materials: KindMaterial[] = [];
		// A translucent fixture (#237: candles, crystals) draws with materials of its own.
		const translucency = model.entry.translucency ?? 0;
		let plain: KindMaterial | null = null;
		const bodyOf = (part: ModelPart) => {
			if (!part.maps && !translucency) return this.body;
			if (!part.maps && plain) return plain;
			const lift = this.body.params.lift;
			const params = part.maps ? { ...part.params, lift, translucency } : { lift, translucency };
			const own = createMaterial('prop', { ...BODY, params, slots: part.maps ?? {} });
			materials.push(own);
			if (!part.maps) plain = own;
			return own;
		};
		const bodies = [...partsOf(model, 'body'), ...partsOf(model, 'swing')].map((p) =>
			this.instanced(p.geometry.clone(), bodyOf(p), capacity, true)
		);
		const flames = partsOf(model, 'flame').map((p) =>
			this.instanced(p.geometry.clone(), this.flame, capacity, false)
		);
		batch = { model, bodies, flames, materials, ids: [] };
		this.batches.set(id, batch);
		return batch;
	}

	/** Takes a model's meshes off the table (the model's own geometry is kept, models.ts). */
	private drop(id: string): void {
		const batch = this.batches.get(id);
		if (!batch) return;
		for (const mesh of [...batch.bodies, ...batch.flames]) {
			this.group.remove(mesh);
			mesh.geometry.dispose(); // its own copy
			mesh.dispose();
		}
		for (const m of batch.materials) m.dispose();
		this.batches.delete(id);
	}
}
