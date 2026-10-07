// Token miniatures for the three.js view: builds one mini per token, diffs incoming token state
// against what is on screen, and animates moves. The logical position always comes from the Token;
// the tween is cosmetic. Minis can also lie down (a fallen character) and show floating combat
// text. A token with a model (a character, a villager, a hound) is drawn as that figure once it has
// loaded (see models.ts); until then, and without one, it is the plain miniature: a torso and a
// head in its colour.
//
// Minis are the mini kind (#172), two materials for every token: figure bodies (vertex colours)
// and the parts in the token's colour (accents and the plain miniature). Each mesh carries its
// token's colour and how much of it shows in `userData` (`miniColor`, `mini`), read per draw by
// the kind's per-object uniforms (materials/hooks.ts), so a new token makes no material and hiding
// one (a screen-door see-through for the GM) compiles nothing. Bases are one instanced mesh of the
// base kind for every token (#265, base-layer.ts), each ring in its owner's colour.

import * as THREE from 'three/webgpu';
import { BaseLayer } from './base-layer';
import { gridToWorld, type SquareGrid } from '$lib/game/grid';
import { STEP_HEIGHT, type Ground } from './ground';
import type { Token } from '$lib/game/token';
import { LabelLayer } from './label-layer';
import { LABEL_HEIGHT } from './labels';
import { createMaterial, withBake, type KindMaterial } from './materials';
import { loadModel, modelNow, partsOf, type LoadedModel, type ModelPart } from './models';
import type { OverlayLayer } from './overlay';
import { pickable } from './picking';
import { standIn } from './warmup';

interface Entry {
	root: THREE.Group;
	/** Torso and head, or the model: tipped over when the character has fallen. */
	figure: THREE.Group;
	/** The model it is drawn as, or null for the plain miniature; and what of it is drawn. */
	model: string | null;
	shows?: LoadedModel | null;
	fallen: boolean;
	/** Hidden from the players: the GM sees it see-through. */
	hidden: boolean;
	/** The token's colour, which its coloured parts read (their `userData.miniColor`). */
	colour: THREE.Color;
	/** How much of the mini shows, which every part reads (its `userData.mini`). */
	look: { opacity: number };
	color: string;
	from: THREE.Vector3;
	to: THREE.Vector3;
	/** 0..1 progress of the current move; 1 when at rest. */
	t: number;
	/** When the current move began (the layer's clock) and how long it takes, ms. */
	start: number;
	duration: number;
}

/** Placeholder figures (0.7-1.24 u) drawn at human height under 2 u walls; #118 replaces it. */
const FIGURE_SCALE = 1.3;
const HOP_HEIGHT = 0.45;
/** How much of a hidden token the GM sees. */
const HIDDEN_OPACITY = 0.35;

// Shared by every mini; sized for a 1-unit cell and scaled per grid.
const bodyGeometry = withBake(new THREE.CylinderGeometry(0.2, 0.3, 0.62, 24));
const headGeometry = withBake(new THREE.SphereGeometry(0.19, 24, 16));

export class TokenLayer {
	readonly group = new THREE.Group();
	private entries = new Map<string, Entry>();
	private grid: SquareGrid | null = null;
	private selectedId: string | null = null;
	/** Every token's base (#265): their rings follow the hover, the selection and the turn. */
	readonly bases = new BaseLayer(this.group);
	/** Every mini's materials (#172): figure bodies, and parts in the token's colour. */
	private readonly materials = {
		figure: createMaterial('mini', { vertexColors: true, params: { roughness: 0.6 } }),
		coloured: createMaterial('mini')
	};
	/** A textured model part's own material (#188): its variant's, its maps in the slots. */
	private readonly textured = new Map<ModelPart, KindMaterial>();
	/** Whose turn it is in a fight: an arrow over that mini. */
	private activeId: string | null = null;
	private readonly marker = new THREE.Mesh(
		new THREE.ConeGeometry(0.14, 0.3, 4),
		new THREE.MeshBasicMaterial({ color: 0xe0a458 })
	);
	private standIns: THREE.Object3D[] | null = null;
	readonly rootOf = (id: string) => this.entries.get(id)?.root ?? null; // where a mini is now
	/** Names on demand and combat floats (#268), in the overlay. */
	readonly labels: LabelLayer;

	/**
	 * `onModel` is told when a figure's model has arrived and it has been drawn. Moves and
	 * floats run on `clock`, the tabletop's (ms), not on frame steps.
	 */
	constructor(
		/** Where labels, floats and the marker draw, untouched by post-processing. */
		private readonly overlay: OverlayLayer,
		private readonly onModel: () => void = () => {},
		private readonly clock: () => number = () => performance.now()
	) {
		this.marker.rotation.x = Math.PI; // point down at the mini
		this.marker.visible = false;
		this.marker.raycast = () => {};
		this.labels = new LabelLayer(overlay, this.rootOf, clock);
	}

	/**
	 * Brings the minis in line with `tokens`. Returns true if anything changed on
	 * screen. With `snap`, everything jumps to its place instead of gliding (a new table).
	 */
	sync(
		tokens: readonly Token[],
		grid: SquareGrid,
		ground: Ground | null = null,
		snap = false
	): boolean {
		const gridChanged =
			!this.grid ||
			this.grid.width !== grid.width ||
			this.grid.height !== grid.height ||
			this.grid.cellSize !== grid.cellSize;
		this.grid = { ...grid };
		let changed = gridChanged;
		const seen = new Set<string>();
		for (const token of tokens) {
			seen.add(token.id);
			const w = gridToWorld(grid, token.pos);
			// Standing on its cell's floor: up on a balcony, halfway up a stair; a flier above it.
			const lift = (token.lift ?? 0) * STEP_HEIGHT * grid.cellSize;
			const target = new THREE.Vector3(w.x, (ground?.floorY(token.pos) ?? w.y) + lift, w.z);
			let entry = this.entries.get(token.id);
			if (!entry) {
				entry = this.create(token, target);
				changed = true;
			}
			if (entry.color !== token.color) {
				entry.colour.set(token.color);
				entry.color = token.color;
				changed = true;
			}
			if (entry.hidden !== (token.hidden === true)) {
				entry.hidden = token.hidden === true;
				entry.look.opacity = entry.hidden ? HIDDEN_OPACITY : 1;
				changed = true;
			}
			if (entry.model !== (token.model ?? null)) {
				this.dress(token.id, entry, token.model ?? null);
				changed = true;
			}
			const size = grid.cellSize * (token.scale ?? 1);
			if (entry.root.scale.x !== size) {
				entry.root.scale.setScalar(size);
				changed = true;
			}
			if (gridChanged || snap) {
				entry.root.position.copy(target);
				entry.from.copy(target);
				entry.to.copy(target);
				entry.t = 1;
			} else if (!entry.to.equals(target)) {
				const cells = entry.root.position.distanceTo(target) / grid.cellSize;
				entry.from.copy(entry.root.position);
				entry.to.copy(target);
				entry.t = 0;
				entry.start = this.clock();
				entry.duration = Math.min(180 + cells * 70, 700);
				changed = true;
			}
			this.bases.place(token.id, entry.root.position, size, entry.hidden);
		}

		for (const [id, entry] of this.entries) {
			if (seen.has(id)) continue;
			this.group.remove(entry.root);
			this.entries.delete(id);
			this.bases.remove(id);
			changed = true;
		}
		this.bases.commit();
		const named = this.labels.setTokens(tokens);
		return this.updateRing() || named || changed;
	}

	setSelected(id: string | null): boolean {
		if (this.selectedId === id) return false;
		this.selectedId = id;
		this.bases.setSelected(id);
		this.labels.set({ selected: id });
		return true;
	}

	/** Marks whose turn it is (an enemy's in red), or nobody's. Returns true if anything changed. */
	setActive(id: string | null, enemy = false): boolean {
		const color = enemy ? 0xe27a6b : 0xe0a458;
		const material = this.marker.material as THREE.MeshBasicMaterial;
		if (this.activeId === id && material.color.getHex() === color) return false;
		this.activeId = id;
		this.bases.setActive(id);
		this.labels.set({ active: id });
		material.color.setHex(color);
		this.updateRing();
		return true;
	}

	/** Reduced motion: the turn's ring holds steady (#265). */
	setReducedMotion(still: boolean): void {
		this.bases.setReducedMotion(still);
		this.labels.setReducedMotion(still); // floats fade without rising (#268)
	}

	/** Whether the turn's ring pulses, asking for AMBIENT frames. */
	get pulsing(): boolean {
		return this.bases.pulsing;
	}

	/** Lays down the minis in `ids` (fallen characters) and stands the rest up. Returns true if any changed. */
	setFallen(ids: ReadonlySet<string>): boolean {
		let changed = false;
		for (const [id, entry] of this.entries) {
			const fallen = ids.has(id);
			if (entry.fallen === fallen) continue;
			entry.fallen = fallen;
			// Tip the figure over sideways so it lies on its base.
			entry.figure.rotation.z = fallen ? Math.PI / 2 : 0;
			entry.figure.position.set(
				fallen ? 0.38 * FIGURE_SCALE : 0,
				fallen ? 0.28 * FIGURE_SCALE : 0,
				0
			);
			changed = true;
		}
		return changed;
	}

	/** Floats `text` up from a mini and fades it out, e.g. damage dealt. */
	float(tokenId: string, text: string, color: string): boolean {
		return this.entries.has(tokenId) && this.labels.float(tokenId, text, color);
	}

	/** Moves minis to where they are at time `now`. Returns true while any is still moving. */
	tick(now: number): boolean {
		let [moving, placed] = [this.labels.tick(now), false];
		for (const [id, entry] of this.entries) {
			if (entry.t >= 1) continue;
			entry.t = Math.min((now - entry.start) / entry.duration, 1);
			const k = entry.t < 0.5 ? 2 * entry.t * entry.t : 1 - (-2 * entry.t + 2) ** 2 / 2;
			entry.root.position.lerpVectors(entry.from, entry.to, k);
			entry.root.position.y +=
				Math.sin(Math.PI * entry.t) * HOP_HEIGHT * (this.grid?.cellSize ?? 1);
			this.bases.place(id, entry.root.position, entry.root.scale.x, entry.hidden);
			placed = true;
			if (entry.t < 1) moving = true;
		}
		this.bases.tick(now);
		if (placed) this.bases.commit();
		this.updateRing();
		return moving;
	}

	/** Id of the frontmost mini under the ray, if any. */
	pick(raycaster: THREE.Raycaster): string | null {
		const hit = raycaster.intersectObject(this.group, true)[0];
		if (hit?.object === this.bases.mesh) return this.bases.owner(hit.instanceId);
		for (let o: THREE.Object3D | null = hit?.object ?? null; o; o = o.parent) {
			if (typeof o.userData.tokenId === 'string') return o.userData.tokenId;
		}
		return null;
	}

	/**
	 * A stand-in for the turn marker, which shows on a first turn, for the warm-up to compile in the
	 * overlay's pass (#180).
	 */
	gallery(): THREE.Object3D[] {
		return (this.standIns ??= [
			standIn(new THREE.Mesh(this.marker.geometry, this.marker.material)),
			...this.labels.gallery()
		]);
	}

	dispose(): void {
		this.labels.dispose();
		this.entries.clear();
		for (const m of [...Object.values(this.materials), ...this.textured.values()]) m.dispose();
		this.textured.clear();
		this.bases.dispose();
		this.marker.removeFromParent();
		this.marker.geometry.dispose();
		(this.marker.material as THREE.Material).dispose();
	}

	private create(token: Token, at: THREE.Vector3): Entry {
		const root = new THREE.Group();
		root.userData.tokenId = token.id;
		const look = { opacity: 1 };

		const figure = new THREE.Group();
		figure.scale.setScalar(FIGURE_SCALE);
		root.add(figure);
		root.position.copy(at);
		this.group.add(root);

		const entry: Entry = {
			root,
			figure,
			model: null,
			fallen: false,
			hidden: false,
			colour: new THREE.Color(token.color),
			look,
			color: token.color,
			from: at.clone(),
			to: at.clone(),
			t: 1,
			start: 0,
			duration: 0
		};
		this.entries.set(token.id, entry);
		this.dress(token.id, entry, token.model ?? null);
		return entry;
	}

	/** Draws the mini as `model` if loaded, else as the plain miniature until `model` arrives. */
	private dress(tokenId: string, entry: Entry, model: string | null): void {
		entry.model = model;
		entry.figure.clear();
		const was = entry.shows;
		const loaded = (entry.shows = model ? modelNow(model) : null);
		// A preview nobody shows any more frees its textured materials (#192).
		if (was?.preview && was !== loaded && ![...this.entries.values()].some((e) => e.shows === was))
			for (const part of was.parts) {
				this.textured.get(part)?.dispose();
				this.textured.delete(part);
			}
		const add = (geo: THREE.BufferGeometry, coloured: boolean, y: number, part?: ModelPart) => {
			const { figure, coloured: tinted } = this.materials;
			const material = this.materialOf(part) ?? (coloured ? tinted : figure);
			const mesh = pickable(new THREE.Mesh(geo, material));
			mesh.userData.mini = entry.look;
			if (coloured) mesh.userData.miniColor = entry.colour;
			mesh.position.y = y;
			mesh.castShadow = mesh.receiveShadow = true;
			entry.figure.add(mesh);
		};
		if (loaded) {
			// Figures stand on the base.
			for (const part of partsOf(loaded, 'body')) add(part.geometry, false, 0.08, part);
			for (const part of partsOf(loaded, 'accent')) add(part.geometry, true, 0.08, part);
		} else {
			add(bodyGeometry, true, 0.08 + 0.31);
			add(headGeometry, true, 0.08 + 0.62 + 0.14);
		}
		// Still coming (or only its preview is here): drawn again at each stage.
		if (model && (loaded === undefined || loaded?.preview)) {
			const redraw = () => {
				const now = modelNow(model);
				if (this.entries.get(tokenId) !== entry || entry.model !== model || now === entry.shows)
					return;
				this.dress(tokenId, entry, model);
				this.onModel();
			};
			void loadModel(model, redraw).then(redraw);
		}
	}

	/** A textured part's material, made once (figure bodies take their vertex colours too). */
	private materialOf(part: ModelPart | undefined): KindMaterial | null {
		if (!part?.maps) return null;
		let material = this.textured.get(part);
		if (!material) {
			const vertexColors = part.role !== 'accent';
			material = createMaterial('mini', { vertexColors, params: part.params, slots: part.maps });
			this.textured.set(part, material);
		}
		return material;
	}

	/** Keeps the turn arrow over the active mini, even mid-move. */
	private updateRing(): boolean {
		const active = this.activeId ? this.entries.get(this.activeId) : undefined;
		const markerWas = this.marker.visible;
		this.marker.visible = !!active;
		if (active) {
			if (!this.marker.parent) this.overlay.scene.add(this.marker);
			const size = this.grid?.cellSize ?? 1;
			this.marker.position.set(
				active.root.position.x,
				active.root.position.y + (LABEL_HEIGHT + 0.5) * size,
				active.root.position.z
			);
			this.marker.scale.setScalar(size);
		}
		return markerWas !== this.marker.visible;
	}
}
