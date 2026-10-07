// Token miniatures for the three.js view: builds one mini per token, diffs incoming token state
// against what is on screen, and animates moves. The logical position always comes from the Token;
// the tween is cosmetic. Minis can also lie down (a fallen character) and show floating combat
// text. A token with a model (a character, a villager, a hound) is drawn as that figure once it has
// loaded (see models.ts); until then, and without one, it is the plain miniature: a torso and a
// head in its colour.
//
// Minis are the mini kind (#172). Figures are instanced batches by part (figures.ts, #266), their
// colour and how much of them shows per instance, so figure draws follow the distinct figures on the
// table, not the tokens, and hiding one (a screen-door see-through for the GM) compiles nothing.
// Bases are one instanced mesh of the
// base kind for every token (#265, base-layer.ts), each ring in its owner's colour.

import * as THREE from 'three/webgpu';
import { BaseLayer } from './base-layer';
import { ContactShadowLayer, tokenContact } from './contact';
import { baseDiameters, PICK_RADIUS, SMALL_BASE } from './bases';
import { gridToWorld, type SquareGrid } from '$lib/game/grid';
import { STEP_HEIGHT, type Ground } from './ground';
import type { Token } from '$lib/game/token';
import { LabelLayer } from './label-layer';
import { BASE_PROFILE } from './bases';
import { FigureBatches } from './figures';
import type { OverlayLayer } from './overlay';
import { TurnColumn } from './turn-column';
import { standIn } from './warmup';
import {
	bobs,
	fall,
	miniPose,
	pick,
	restingMotion,
	startMove,
	PICK_LIFT,
	PICK_TILT,
	LYING,
	type MiniMotion,
	type MiniPose
} from './mini-motion';

interface Entry {
	root: THREE.Group;
	/** Tipped over: a fallen character (figures.ts draws the figure). */
	fallen: boolean;
	/** Hidden from the players: the GM sees it see-through. */
	hidden: boolean;
	from: THREE.Vector3;
	to: THREE.Vector3;
	/** How far the figure stands above its floor (`Token.lift`), world units: the base stays down. */
	lift: number;
	/** Its base's diameter, cell units (#270: `baseDiameters`). */
	base: number;
	/** How it hops, lands, is picked up, bobs and tips over (#272). */
	motion: MiniMotion;
	/** Something in `motion` still to play: the layer poses it each frame until it rests. */
	awake: boolean;
	/** Just come onto the table: a fall shows at once. */
	fresh: boolean;
	/** The pick-up's tilt axis, turned toward the camera as it last animated. */
	tilt: THREE.Vector3;
}

/** Placeholder figures (0.7-1.24 u) drawn at human height under 2 u walls; #118 replaces it. */
const FIGURE_SCALE = 1.3;
/** How much of a hidden token the GM sees. */
const HIDDEN_OPACITY = 0.35;

/** The base's inner disc, where a figure stands (cell units, bases.ts). */
const BASE_TOP = BASE_PROFILE[BASE_PROFILE.length - 1][1];
const figure = new THREE.Matrix4();
const scaled = new THREE.Matrix4();
const toEye = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class TokenLayer {
	readonly group = new THREE.Group();
	private entries = new Map<string, Entry>();
	private grid: SquareGrid | null = null;
	private selectedId: string | null = null;
	private reduced = false;
	/** A pick-up or squash still playing: frames, but no shadow redraw (#272). */
	posing = false;
	/** Every token's base (#265): their rings follow the hover, the selection and the turn. */
	readonly bases = new BaseLayer(this.group);
	/** Every token's contact shadow (#271), and the props' (PropLayer is handed it). */
	readonly contact = new ContactShadowLayer(this.group);
	/** The figures, batched by part (#266). */
	private readonly figures: FigureBatches;
	/** Whose turn it is in a fight: its ring pulses and a column of light rises from it (#269). */
	private activeId: string | null = null;
	readonly column = new TurnColumn();
	private standIns: THREE.Object3D[] | null = null;
	private readonly under = new THREE.Vector3();
	readonly rootOf = (id: string) => this.entries.get(id)?.root ?? null; // where a mini is now
	/** Names on demand and combat floats (#268), in the overlay. */
	readonly labels: LabelLayer;

	/**
	 * `onModel` is told when a figure's model has arrived and it has been drawn. Moves and
	 * floats run on `clock`, the tabletop's (ms), not on frame steps.
	 */
	constructor(
		/** Where labels, floats and the turn column draw, untouched by post-processing. */
		private readonly overlay: OverlayLayer,
		onModel: () => void = () => {},
		private readonly clock: () => number = () => performance.now()
	) {
		// A model arriving may bring a downed pose, which stands in for tipping over (#273).
		this.figures = new FigureBatches(this.group, () => {
			for (const [id, entry] of this.entries) if (entry.fallen) this.tip(id, entry, true);
			onModel();
		});
		overlay.scene.add(this.column.mesh);
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
		// Large bases (#270), shrunk where another mini stands: only from the tokens this viewer was sent.
		const bases = baseDiameters(tokens, (p) => ground?.level(p) ?? 0);
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
			const flier = (token.lift ?? 0) > 0;
			if (entry.motion.flier !== flier) entry.awake = true; // lands from its bob, or takes off
			entry.motion.flier = flier;
			entry.hidden = token.hidden === true;
			const opacity = entry.hidden ? HIDDEN_OPACITY : 1;
			if (this.figures.set(token.id, token.model ?? null, token.color, opacity)) {
				if (entry.fallen) this.tip(token.id, entry, true); // another model, maybe posed
				changed = true;
			}
			const size = grid.cellSize * (token.scale ?? 1);
			const resized = entry.root.scale.x !== size;
			if (resized) {
				entry.root.scale.setScalar(size);
				changed = true;
			}
			const base = bases.get(token.id) ?? SMALL_BASE;
			if (entry.base !== base || entry.lift !== lift) changed = true;
			entry.base = base;
			entry.lift = lift;
			if (gridChanged || snap) {
				entry.from.copy(target);
				entry.to.copy(target);
				entry.motion.moveMs = 0;
				this.placeMini(token.id, entry, this.clock());
			} else if (!entry.to.equals(target)) {
				const now = this.clock();
				const at = this.along(entry, miniPose(entry.motion, now, this.reduced));
				startMove(entry.motion, now, at.distanceTo(target) / grid.cellSize);
				entry.from.copy(at);
				entry.to.copy(target);
				entry.awake = changed = true;
			} else this.placeMini(token.id, entry, this.clock()); // a new base size, or lifted (#272)
		}

		for (const [id, entry] of this.entries) {
			if (seen.has(id)) continue;
			this.group.remove(entry.root);
			this.figures.remove(id);
			this.entries.delete(id);
			this.bases.remove(id);
			this.contact.token(id, null);
			changed = true;
		}
		this.bases.commit();
		this.contact.flush();
		const named = this.labels.setTokens(tokens);
		return this.updateColumn() || named || changed;
	}

	setSelected(id: string | null): boolean {
		if (this.selectedId === id) return false;
		// The viewer's selected mini is one they may move (RoomView): it is picked up (#272).
		for (const was of [this.selectedId, id]) this.pickUp(was, was === id);
		this.selectedId = id;
		this.bases.setSelected(id);
		this.labels.set({ selected: id });
		return true;
	}

	/**
	 * Marks whose turn it is (an enemy's banded red), or nobody's: only a token the viewer was sent
	 * shows it. Returns true if anything changed.
	 */
	setActive(id: string | null, enemy = false): boolean {
		const side = this.column.setEnemy(enemy);
		if (this.activeId === id && !side) return false;
		const was = this.activeId;
		this.activeId = id;
		for (const t of [was, id]) if (t) this.pose(t);
		this.bases.setActive(id);
		this.labels.set({ active: id });
		this.updateColumn();
		return true;
	}

	/** Reduced motion: the turn's ring holds steady (#265), minis glide flat and still (#272). */
	setReducedMotion(still: boolean): void {
		this.reduced = still;
		for (const entry of this.entries.values()) entry.awake = true; // into or out of their still pose
		this.bases.setReducedMotion(still);
		this.labels.setReducedMotion(still); // floats fade without rising (#268)
	}

	/** Whether the turn's ring pulses or a flier bobs (#272), asking for AMBIENT frames. */
	get pulsing(): boolean {
		if (this.bases.pulsing) return true;
		for (const entry of this.entries.values()) if (bobs(entry.motion, this.reduced)) return true;
		return false;
	}

	/**
	 * Lays down the minis in `ids` (fallen characters) and stands the rest up: they tip over (#272),
	 * or show a downed pose (#273); one only just come onto the table lies there already.
	 * Returns true if any changed.
	 */
	setFallen(ids: ReadonlySet<string>): boolean {
		let changed = false;
		for (const [id, entry] of this.entries) {
			const fallen = ids.has(id);
			const snap = entry.fresh;
			entry.fresh = false;
			if (entry.fallen === fallen) continue;
			entry.fallen = fallen;
			this.pose(id);
			this.tip(id, entry, snap);
			changed = true;
		}
		return changed;
	}

	/** Floats `text` up from a mini and fades it out, e.g. damage dealt. */
	float(tokenId: string, text: string, color: string): boolean {
		return this.entries.has(tokenId) && this.labels.float(tokenId, text, color);
	}

	/**
	 * Poses minis as they are at time `now` (#272), only those still moving, settling or bobbing;
	 * `eye` is the camera, which a picked-up mini tilts toward. Returns true while any moves from
	 * cell to cell or tips (what casts a changing shadow); `posing` says whether a pick-up or
	 * squash still plays.
	 */
	tick(now: number, eye?: THREE.Vector3): boolean {
		let [moving, placed, posing] = [this.labels.tick(now), false, false];
		for (const [id, entry] of this.entries) {
			if (!entry.awake && !bobs(entry.motion, this.reduced)) continue;
			toEye.subVectors(eye ?? entry.to, entry.to).setY(0); // straight overhead: keep the last
			if (toEye.lengthSq() > 1e-8) entry.tilt.crossVectors(UP, toEye).normalize();
			const pose = this.placeMini(id, entry, now);
			placed = true;
			if (pose.along < 1 || (pose.fall !== 0 && pose.fall !== LYING)) moving = true;
			else if (pose.busy) posing = true;
		}
		this.posing = posing;
		this.bases.tick(now);
		if (placed) {
			this.bases.commit();
			this.contact.flush();
		}
		this.updateColumn();
		return moving;
	}

	/**
	 * Id of the frontmost mini under the ray, if any. A base counts only within `PICK_RADIUS` of its
	 * token's centre (#270), so a large base's rim over a neighbouring cell leaves that cell (or a mini
	 * behind it) to be picked; figures count wherever they are hit.
	 */
	pick(raycaster: THREE.Raycaster): string | null {
		const meshes = this.bases.meshes;
		const cell = this.grid?.cellSize ?? 1;
		for (const hit of raycaster.intersectObject(this.group, true)) {
			if (meshes.includes(hit.object as THREE.InstancedMesh)) {
				const id = this.bases.owner(hit.object, hit.instanceId);
				const at = id ? this.entries.get(id)?.root.position : undefined;
				if (id && at && Math.hypot(hit.point.x - at.x, hit.point.z - at.z) <= PICK_RADIUS * cell)
					return id;
				continue;
			}
			const figure = this.figures.tokenOf(hit);
			if (figure) return figure;
			for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
				if (typeof o.userData.tokenId === 'string') return o.userData.tokenId;
			}
		}
		return null;
	}

	/**
	 * A stand-in for the turn column, which shows on a first turn, for the warm-up to compile in the
	 * overlay's pass (#180).
	 */
	gallery(): THREE.Object3D[] {
		return (this.standIns ??= [
			standIn(new THREE.Mesh(this.column.mesh.geometry, this.column.mesh.material)),
			...this.labels.gallery()
		]);
	}

	dispose(): void {
		this.labels.dispose();
		this.entries.clear();
		this.figures.dispose();
		this.bases.dispose();
		this.contact.dispose();
		this.column.dispose();
	}

	private create(token: Token, at: THREE.Vector3): Entry {
		const root = new THREE.Group();
		root.userData.tokenId = token.id;
		root.position.copy(at);
		this.group.add(root);

		const entry: Entry = {
			root,
			fallen: false,
			hidden: false,
			from: at.clone(),
			to: at.clone(),
			lift: 0,
			base: SMALL_BASE,
			motion: restingMotion(token.id),
			awake: false,
			fresh: true,
			tilt: new THREE.Vector3(1, 0, 0)
		};
		this.entries.set(token.id, entry);
		return entry;
	}

	/** Shows `id` in its model's pose for what it is doing (#273): down, or on its turn. */
	private pose(id: string): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		this.figures.setState(id, { downed: entry.fallen, active: id === this.activeId });
	}

	/** Picks the figures' levels for the camera (#274, figures.ts); true if any changed. */
	chooseLods(camera: THREE.PerspectiveCamera, viewportPx: number, bias: number): boolean {
		return this.figures.chooseLods(camera, viewportPx, bias);
	}

	/**
	 * Tips a fallen mini over, or stands it up (#272), unless a downed pose shows the fall (#273);
	 * `snap` puts it there at once (just come onto the table, or another model arrived).
	 */
	private tip(id: string, entry: Entry, snap: boolean): void {
		const down = entry.fallen && !this.figures.showsDowned(id);
		if (fall(entry.motion, down, this.clock(), snap)) entry.awake = true;
		this.placeMini(id, entry, this.clock());
	}

	/** Where a move has got to: on its line from `from` to `to`, exactly `to` at rest. */
	private along(entry: Entry, pose: MiniPose): THREE.Vector3 {
		if (pose.along >= 1) return entry.to;
		return toEye.lerpVectors(entry.from, entry.to, pose.along);
	}

	/**
	 * Poses a mini at `now` (#272): its root (and so its base, label and carried light) on its way
	 * between cells, hopping and lifted when picked up, and its figure on top. Puts it to sleep
	 * once nothing but a bob is left to play.
	 */
	private placeMini(id: string, entry: Entry, now: number): MiniPose {
		const pose = miniPose(entry.motion, now, this.reduced);
		const { root } = entry;
		const up = (pose.hop + pose.pick * PICK_LIFT) * root.scale.x; // off the floor: the shadow fades
		root.position.copy(this.along(entry, pose));
		root.position.y += up;
		this.placeBase(id, entry, up);
		this.placeFigure(id, entry, pose);
		entry.awake = pose.busy;
		return pose;
	}

	/**
	 * Puts a token's figure where its root is: standing on the base's inner disc, bobbing and
	 * tilted toward the camera as its pose says, or tipped over sideways onto the base as it falls
	 * (#272; a downed pose (#273) never tips). Root is in the layer's group, as the batches are;
	 * the squash is about the figure's feet.
	 */
	private placeFigure(id: string, entry: Entry, pose: MiniPose): void {
		const { root } = entry;
		root.updateMatrix();
		const f = FIGURE_SCALE;
		const lying = pose.fall / LYING; // the figure's offset onto the base follows its angle
		const wide = f * (1 + (1 - pose.squash) / 2);
		// The disc is as high at every base size and figure scale (#270): undo the token's scale.
		const top = BASE_TOP / (root.scale.y / (this.grid?.cellSize ?? 1));
		figure.makeTranslation(0, pose.bob, 0);
		if (pose.pick > 0) figure.multiply(scaled.makeRotationAxis(entry.tilt, pose.pick * PICK_TILT));
		figure
			.multiply(scaled.makeTranslation(0.38 * f * lying, 0.28 * f * lying, 0))
			.multiply(scaled.makeRotationZ(pose.fall))
			.multiply(scaled.makeTranslation(0, top, 0))
			.multiply(scaled.makeScale(wide, f * pose.squash, wide));
		this.figures.place(id, figure.premultiply(root.matrix));
	}

	/** Picks a mini up or puts it down (#272). */
	private pickUp(id: string | null, on: boolean): void {
		const entry = id ? this.entries.get(id) : undefined;
		if (entry && pick(entry.motion, on, this.clock(), this.reduced)) entry.awake = true;
	}

	/**
	 * Puts `id`'s base under its mini: on the floor however high the figure is lifted (#270), and
	 * its contact shadow (#271) on the floor under that, fading as the mini hops (`hop`) or flies.
	 */
	private placeBase(id: string, entry: Entry, hop = 0): void {
		const at = this.under.copy(entry.root.position);
		at.y -= entry.lift;
		const size = this.grid?.cellSize ?? 1;
		this.bases.place(id, at, size, entry.base, entry.hidden);
		const rise = hop + entry.lift;
		const shadow = tokenContact(at.x, at.y - hop, at.z, entry.base * size, rise, size);
		this.contact.token(id, shadow);
	}

	/**
	 * Keeps the turn column on the active mini's base, even mid-move or lifted, as wide as its base
	 * (#270): shown only while the mini is here.
	 */
	private updateColumn(): boolean {
		const id = this.activeId;
		const active = id ? this.entries.get(id) : undefined;
		if (!id || !active) return this.column.place(null);
		const at = this.under.copy(active.root.position);
		at.y -= active.lift;
		const size = ((this.grid?.cellSize ?? 1) * this.bases.diameter(id)) / SMALL_BASE;
		return this.column.place(at, size);
	}
}
