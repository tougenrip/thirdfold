// Token miniatures for the three.js view: builds one mini per token, diffs
// incoming token state against what is on screen, and animates moves. The
// logical position always comes from the Token; the tween is cosmetic. Minis
// can also lie down (a fallen character) and show floating combat text.

import * as THREE from 'three';
import { gridToWorld, type SquareGrid } from '$lib/game/grid';
import type { Ground } from './ground';
import type { Token } from '$lib/game/token';

interface Entry {
	root: THREE.Group;
	/** Torso and head: tipped over when the character has fallen. */
	figure: THREE.Group;
	fallen: boolean;
	body: THREE.MeshStandardMaterial;
	label: THREE.Sprite;
	name: string;
	color: string;
	from: THREE.Vector3;
	to: THREE.Vector3;
	/** 0..1 progress of the current move; 1 when at rest. */
	t: number;
	duration: number;
}

const HOP_HEIGHT = 0.35;
const LABEL_HEIGHT = 1.3;
const FLOAT_MS = 1500;

interface Float {
	sprite: THREE.Sprite;
	tokenId: string;
	age: number;
}

// Shared by every mini; sized for a 1-unit cell and scaled per grid.
const baseGeometry = new THREE.CylinderGeometry(0.42, 0.44, 0.08, 32);
const bodyGeometry = new THREE.CylinderGeometry(0.2, 0.3, 0.62, 24);
const headGeometry = new THREE.SphereGeometry(0.19, 24, 16);
const ringGeometry = new THREE.RingGeometry(0.47, 0.56, 48);
const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1612, roughness: 0.6 });

function makeLabel(name: string, color = '#f2e6d0', bold = false): THREE.Sprite {
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = 64;
	const ctx = canvas.getContext('2d')!;
	ctx.font = bold ? '800 40px system-ui, sans-serif' : '600 30px system-ui, sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	const width = Math.min(ctx.measureText(name).width + 28, 256);
	ctx.fillStyle = 'rgba(20, 15, 11, 0.78)';
	ctx.beginPath();
	ctx.roundRect((256 - width) / 2, 8, width, 48, 12);
	ctx.fill();
	ctx.fillStyle = color;
	ctx.fillText(name, 128, 33, 232);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	const sprite = new THREE.Sprite(
		new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
	);
	sprite.scale.set(1.6, 0.4, 1);
	sprite.position.y = LABEL_HEIGHT;
	sprite.renderOrder = 1;
	// Labels are not part of the mini for picking purposes.
	sprite.raycast = () => {};
	return sprite;
}

function disposeLabel(sprite: THREE.Sprite): void {
	sprite.material.map?.dispose();
	sprite.material.dispose();
}

export class TokenLayer {
	readonly group = new THREE.Group();
	private entries = new Map<string, Entry>();
	private floats: Float[] = [];
	private grid: SquareGrid | null = null;
	private selectedId: string | null = null;
	private readonly ring = new THREE.Mesh(
		ringGeometry,
		new THREE.MeshBasicMaterial({ color: 0xe0a458, transparent: true, opacity: 0.95 })
	);

	constructor() {
		this.ring.rotation.x = -Math.PI / 2;
		this.ring.visible = false;
		this.ring.raycast = () => {};
	}

	/** Brings the minis in line with `tokens`. Returns true if anything changed on screen. */
	sync(tokens: readonly Token[], grid: SquareGrid, ground: Ground | null = null): boolean {
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
			// Standing on its cell's floor: up on a balcony, halfway up a stair.
			const target = new THREE.Vector3(w.x, ground?.floorY(token.pos) ?? w.y, w.z);
			let entry = this.entries.get(token.id);
			if (!entry) {
				entry = this.create(token, target);
				changed = true;
			}
			if (entry.color !== token.color) {
				entry.body.color.set(token.color);
				entry.color = token.color;
				changed = true;
			}
			if (entry.name !== token.name) {
				entry.root.remove(entry.label);
				disposeLabel(entry.label);
				entry.label = makeLabel(token.name);
				entry.root.add(entry.label);
				entry.name = token.name;
				changed = true;
			}
			entry.root.scale.setScalar(grid.cellSize);
			if (gridChanged) {
				entry.root.position.copy(target);
				entry.from.copy(target);
				entry.to.copy(target);
				entry.t = 1;
			} else if (!entry.to.equals(target)) {
				const cells = entry.root.position.distanceTo(target) / grid.cellSize;
				entry.from.copy(entry.root.position);
				entry.to.copy(target);
				entry.t = 0;
				entry.duration = Math.min(180 + cells * 70, 700);
				changed = true;
			}
		}

		for (const [id, entry] of this.entries) {
			if (seen.has(id)) continue;
			this.dropFloats(id);
			this.group.remove(entry.root);
			disposeLabel(entry.label);
			entry.body.dispose();
			this.entries.delete(id);
			changed = true;
		}
		return this.updateRing() || changed;
	}

	setSelected(id: string | null): boolean {
		if (this.selectedId === id) return false;
		this.selectedId = id;
		this.updateRing();
		return true;
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
			entry.figure.position.set(fallen ? 0.38 : 0, fallen ? 0.28 : 0, 0);
			changed = true;
		}
		return changed;
	}

	/** Floats `text` up from a mini and fades it out, e.g. damage dealt. */
	float(tokenId: string, text: string, color: string): boolean {
		const entry = this.entries.get(tokenId);
		if (!entry) return false;
		const sprite = makeLabel(text, color, true);
		sprite.scale.set(1.3, 0.33, 1);
		// Several at once stack instead of overlapping.
		const stacked = this.floats.filter((f) => f.tokenId === tokenId).length;
		sprite.position.y = LABEL_HEIGHT + 0.35 + stacked * 0.35;
		sprite.renderOrder = 2;
		entry.root.add(sprite);
		this.floats.push({ sprite, tokenId, age: 0 });
		return true;
	}

	/** Advances move animations by `dt` ms. Returns true while any mini is still moving. */
	tick(dt: number): boolean {
		let moving = this.tickFloats(dt);
		for (const entry of this.entries.values()) {
			if (entry.t >= 1) continue;
			entry.t = Math.min(entry.t + dt / entry.duration, 1);
			const k = entry.t < 0.5 ? 2 * entry.t * entry.t : 1 - (-2 * entry.t + 2) ** 2 / 2;
			entry.root.position.lerpVectors(entry.from, entry.to, k);
			entry.root.position.y +=
				Math.sin(Math.PI * entry.t) * HOP_HEIGHT * (this.grid?.cellSize ?? 1);
			if (entry.t < 1) moving = true;
		}
		this.updateRing();
		return moving;
	}

	/** Id of the frontmost mini under the ray, if any. */
	pick(raycaster: THREE.Raycaster): string | null {
		const hit = raycaster.intersectObject(this.group, true)[0];
		for (let o: THREE.Object3D | null = hit?.object ?? null; o; o = o.parent) {
			if (typeof o.userData.tokenId === 'string') return o.userData.tokenId;
		}
		return null;
	}

	dispose(): void {
		for (const f of this.floats) disposeLabel(f.sprite);
		this.floats = [];
		for (const entry of this.entries.values()) {
			disposeLabel(entry.label);
			entry.body.dispose();
		}
		this.entries.clear();
		(this.ring.material as THREE.Material).dispose();
	}

	private create(token: Token, at: THREE.Vector3): Entry {
		const body = new THREE.MeshStandardMaterial({ color: token.color, roughness: 0.45 });
		const root = new THREE.Group();
		root.userData.tokenId = token.id;

		const base = new THREE.Mesh(baseGeometry, baseMaterial);
		base.position.y = 0.04;
		const torso = new THREE.Mesh(bodyGeometry, body);
		torso.position.y = 0.08 + 0.31;
		const head = new THREE.Mesh(headGeometry, body);
		head.position.y = 0.08 + 0.62 + 0.14;
		for (const m of [base, torso, head]) {
			m.castShadow = true;
			m.receiveShadow = true;
		}
		const figure = new THREE.Group();
		figure.add(torso, head);
		const label = makeLabel(token.name);
		root.add(base, figure, label);
		root.position.copy(at);
		this.group.add(root);

		const entry: Entry = {
			root,
			figure,
			fallen: false,
			body,
			label,
			name: token.name,
			color: token.color,
			from: at.clone(),
			to: at.clone(),
			t: 1,
			duration: 0
		};
		this.entries.set(token.id, entry);
		return entry;
	}

	private tickFloats(dt: number): boolean {
		for (const f of this.floats) {
			f.age += dt;
			const t = Math.min(f.age / FLOAT_MS, 1);
			f.sprite.position.y += (dt / FLOAT_MS) * 0.7;
			f.sprite.material.opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
		}
		const done = this.floats.filter((f) => f.age >= FLOAT_MS);
		for (const f of done) {
			f.sprite.removeFromParent();
			disposeLabel(f.sprite);
		}
		this.floats = this.floats.filter((f) => f.age < FLOAT_MS);
		return this.floats.length > 0;
	}

	private dropFloats(tokenId: string): void {
		for (const f of this.floats) if (f.tokenId === tokenId) disposeLabel(f.sprite);
		this.floats = this.floats.filter((f) => f.tokenId !== tokenId);
	}

	/** Keeps the selection ring under the selected mini, even mid-move. */
	private updateRing(): boolean {
		const entry = this.selectedId ? this.entries.get(this.selectedId) : undefined;
		const wasVisible = this.ring.visible;
		this.ring.visible = !!entry;
		if (entry) {
			if (!this.ring.parent) this.group.add(this.ring);
			this.ring.position.set(
				entry.root.position.x,
				entry.root.position.y + 0.012,
				entry.root.position.z
			);
			this.ring.scale.setScalar(this.grid?.cellSize ?? 1);
		}
		return wasVisible !== this.ring.visible;
	}
}
