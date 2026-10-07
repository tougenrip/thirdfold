// Token names and combat floats (#268), in the overlay: never darkened, bloomed, graded or blurred.
// Every plate is rasterised once into one atlas canvas at the device pixel ratio and drawn by two
// instanced sprites (names, floats) at a fixed CSS pixel size, so an atlas texel lands on one
// device pixel at any zoom: two draws whatever the count. Both are always drawn (unused instances
// have no size), so showing a name, holding the key or a float compiles nothing. Which names show
// is `labelsShown` (labels.ts), over the tokens the viewer was sent.

import * as THREE from 'three/webgpu';
import { instancedDynamicBufferAttribute, texture, uniform, uv, vec4 } from 'three/tsl';
import { labelFont } from './label-font';
import {
	FLOAT_PX,
	LABEL_HEIGHT,
	LABEL_PX,
	labelsShown,
	NO_LABELS,
	PLATE,
	Shelves,
	TEXT_COLOUR,
	type LabelState
} from './labels';
import type { OverlayLayer } from './overlay';
import { standIn } from './warmup';

/** The atlas's side, in texels: about a hundred names at DPR 2; full, it repacks what shows. */
const ATLAS = 1024;
/** Floats per instance: anchor (xyz, w unused), CSS size (w, h), alpha, unused, atlas rect. */
const STRIDE = 12;
/** Instances per sprite. ponytail: names past this don't show; raise it if a table ever has more. */
const CAPACITY = { names: 256, floats: 64 };
const FLOAT_MS = 1500;
/** A float's rise over its life, and the step between floats over one mini, in cells. */
const [RISE, STACK] = [0.7, 0.35];
const anchorAt = new THREE.Vector3();

type Kind = 'name' | 'float';
interface Plate {
	x: number;
	y: number;
	w: number;
	h: number;
}
interface Float {
	tokenId: string;
	text: string;
	colour: string;
	born: number;
	stack: number;
}

/** Plates rasterised at one pixel ratio, packed into rows; a full atlas is cleared and refilled. */
class Atlas {
	readonly canvas = document.createElement('canvas');
	readonly texture = new THREE.CanvasTexture(this.canvas);
	private readonly ctx = this.canvas.getContext('2d')!;
	private readonly shelves = new Shelves(ATLAS, ATLAS);
	private plates = new Map<string, Plate>();
	ratio = 0;

	constructor() {
		this.canvas.width = this.canvas.height = ATLAS;
		const t = this.texture;
		t.colorSpace = THREE.SRGBColorSpace;
		t.minFilter = t.magFilter = THREE.NearestFilter; // texel for pixel: nothing to blend
		t.generateMipmaps = false;
	}

	reset(ratio = this.ratio): void {
		this.ratio = ratio;
		this.plates.clear();
		this.shelves.clear();
		this.ctx.clearRect(0, 0, ATLAS, ATLAS);
		this.texture.needsUpdate = true;
	}

	/** The plate for `text` in `colour`, drawn now if new; null when the atlas is full. */
	plate(kind: Kind, text: string, colour: string): Plate | null {
		const key = `${kind}|${colour}|${text}`;
		const had = this.plates.get(key);
		if (had) return had;
		const { ctx, ratio: r } = this;
		const px = kind === 'name' ? LABEL_PX : FLOAT_PX;
		ctx.font = labelFont(kind === 'name' ? 600 : 800, px.font * r);
		const textW = Math.min(ctx.measureText(text).width, (px.maxWidth - 2 * px.pad) * r);
		const [w, h] = [Math.ceil(textW + 2 * px.pad * r), Math.round(px.height * r)];
		const at = this.shelves.add(w, h);
		if (!at) return null;
		const plate = { ...at, w, h };
		ctx.fillStyle = `rgba(${PLATE.rgb.join(', ')}, ${PLATE.alpha})`;
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)'; // a device pixel's dark rim against bright ground
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.roundRect(at.x + 0.5, at.y + 0.5, w - 1, h - 1, h * 0.3);
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = colour;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, at.x + w / 2, at.y + h / 2 + r, textW);
		this.plates.set(key, plate);
		this.texture.needsUpdate = true;
		return plate;
	}

	dispose(): void {
		this.texture.dispose();
	}
}

/** One instanced sprite over the atlas: `count` stays at least 2, so it never changes shape. */
class Batch {
	readonly data: Float32Array;
	readonly buffer: THREE.InstancedInterleavedBuffer;
	readonly sprite: THREE.Sprite;
	/** What each used instance shows: its mini and how far above its label anchor, in cells. */
	slots: { tokenId: string; lift: number }[] = [];

	constructor(capacity: number, atlas: Atlas, pixel: THREE.UniformNode<'float', number>) {
		this.data = new Float32Array(capacity * STRIDE);
		this.buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE);
		this.buffer.setUsage(THREE.DynamicDrawUsage);
		const field = (offset: number) =>
			instancedDynamicBufferAttribute(this.buffer, 'vec4', STRIDE, offset) as THREE.Node<'vec4'>;
		const [anchor, look, rect] = [field(0), field(4), field(8)];
		const material = new THREE.SpriteNodeMaterial({ transparent: true });
		material.depthTest = material.depthWrite = false;
		material.sizeAttenuation = false; // scaled by depth below: a fixed size in pixels
		material.positionNode = anchor.xyz;
		material.scaleNode = look.xy.mul(pixel);
		const texel = texture(atlas.texture, rect.xy.add(uv().mul(rect.zw)));
		material.colorNode = vec4(texel.rgb, texel.a.mul(look.z));
		this.sprite = new THREE.Sprite(material);
		this.sprite.count = 2;
		this.sprite.frustumCulled = false; // its instances are everywhere; the sprite is at 0
		this.sprite.raycast = () => {};
		this.sprite.renderOrder = 1;
	}

	/** Lays out `plates` (null: not in the atlas, drawn as nothing). */
	set(
		entries: { tokenId: string; lift: number; plate: Plate | null; alpha?: number }[],
		r: number
	) {
		const n = Math.min(entries.length, this.data.length / STRIDE);
		this.data.fill(0);
		this.slots = entries.slice(0, n);
		for (let i = 0; i < n; i++) {
			const { plate, alpha = 1 } = entries[i];
			if (!plate) continue;
			const o = i * STRIDE;
			this.data.set([plate.w / r, plate.h / r, alpha, 0], o + 4);
			// The canvas is flipped on upload: its rows run down from v = 1.
			const [u, v] = [plate.x / ATLAS, 1 - (plate.y + plate.h) / ATLAS];
			this.data.set([u, v, plate.w / ATLAS, plate.h / ATLAS], o + 8);
		}
		this.sprite.count = Math.max(n, 2);
		this.buffer.needsUpdate = true;
	}

	/** Puts each instance over its mini as it stands now. */
	place(rootOf: (id: string) => THREE.Object3D | null): void {
		this.slots.forEach(({ tokenId, lift }, i) => {
			const root = rootOf(tokenId);
			if (!root) return;
			root.updateWorldMatrix(true, false);
			const at = anchorAt.setFromMatrixPosition(root.matrixWorld);
			at.y += (LABEL_HEIGHT + lift) * root.scale.y;
			this.data.set([at.x, at.y, at.z], i * STRIDE);
		});
		this.buffer.needsUpdate = true;
	}

	dispose(): void {
		this.sprite.removeFromParent();
		this.sprite.material.dispose();
	}
}

export class LabelLayer {
	private readonly atlas = new Atlas();
	/** World units per CSS pixel at one unit from the camera (2 / (P11 * height)), set per draw. */
	private readonly pixel = uniform(0.01);
	private readonly names: Batch;
	private readonly floats: Batch;
	private tokens: { id: string; name: string }[] = [];
	private state: LabelState = { ...NO_LABELS };
	private live: Float[] = [];
	private shown = new Set<string>();
	private dirty = true;
	private reduced = false;
	private standIns: THREE.Object3D[] | null = null;
	private readonly size = new THREE.Vector2();

	constructor(
		overlay: OverlayLayer,
		private readonly rootOf: (id: string) => THREE.Object3D | null,
		private readonly clock: () => number
	) {
		this.names = new Batch(CAPACITY.names, this.atlas, this.pixel);
		this.floats = new Batch(CAPACITY.floats, this.atlas, this.pixel);
		overlay.scene.add(this.names.sprite, this.floats.sprite);
		overlay.before.push((renderer, camera) => this.draw(renderer, camera));
	}

	/** The tokens the viewer was sent. Returns true if a name that shows changed. */
	setTokens(tokens: readonly { id: string; name: string }[]): boolean {
		const same =
			tokens.length === this.tokens.length &&
			tokens.every((t, i) => t.id === this.tokens[i].id && t.name === this.tokens[i].name);
		if (same) return false;
		this.tokens = tokens.map(({ id, name }) => ({ id, name }));
		this.dirty = true; // a name may have changed
		return this.refresh();
	}

	/** Hover, selection, the turn, the held key and the Graphics option. True if what shows changed. */
	set(patch: Partial<LabelState>): boolean {
		this.state = { ...this.state, ...patch };
		return this.refresh();
	}

	/** Floats `text` up from a mini and fades it out (damage dealt, healing, a status). */
	float(tokenId: string, text: string, colour: string): boolean {
		const stack = this.live.filter((f) => f.tokenId === tokenId).length;
		this.live.push({ tokenId, text, colour, born: this.clock(), stack });
		return (this.dirty = true);
	}

	/** Drops finished floats; true while any is still in the air. */
	tick(now: number): boolean {
		const before = this.live.length;
		this.live = this.live.filter((f) => now - f.born < FLOAT_MS && this.rootOf(f.tokenId));
		if (this.live.length !== before) this.dirty = true;
		return this.live.length > 0;
	}

	/** Under reduced motion floats fade where they appear, without rising. */
	setReducedMotion(reduced: boolean): void {
		this.reduced = reduced;
	}

	/** Rasterises every plate again (the label font has arrived). */
	redraw(): void {
		this.atlas.reset();
		this.dirty = true;
	}

	/** Stand-ins for the warm-up to compile in the overlay's pass (#180). */
	gallery(): THREE.Object3D[] {
		return (this.standIns ??= [this.names, this.floats].map(({ sprite }) => {
			const s = standIn(new THREE.Sprite(sprite.material));
			s.count = 2;
			return s;
		}));
	}

	dispose(): void {
		this.names.dispose();
		this.floats.dispose();
		this.atlas.dispose();
	}

	private refresh(): boolean {
		const shown = labelsShown(this.tokens, this.state);
		const same = shown.size === this.shown.size && [...shown].every((id) => this.shown.has(id));
		this.shown = shown;
		if (same && !this.dirty) return false;
		return (this.dirty = true);
	}

	/** Before each overlay draw: the plates if anything changed, then where each mini is now. */
	private draw(renderer: THREE.Renderer, camera: THREE.Camera): void {
		const ratio = renderer.getPixelRatio();
		if (ratio !== this.atlas.ratio) {
			this.atlas.reset(ratio);
			this.dirty = true;
		}
		const height = renderer.getSize(this.size).y;
		this.pixel.value = 2 / (camera.projectionMatrix.elements[5] * Math.max(height, 1));
		if (this.dirty) this.layout();
		const now = this.clock();
		this.floats.slots.forEach((slot, i) => {
			const f = this.live[i];
			const t = f ? Math.min((now - f.born) / FLOAT_MS, 1) : 1;
			slot.lift = STACK * (f?.stack ?? 0) + STACK + (this.reduced ? 0 : t * RISE);
			if (this.floats.data[i * STRIDE + 4] > 0)
				this.floats.data[i * STRIDE + 6] = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
		});
		this.names.place(this.rootOf);
		this.floats.place(this.rootOf);
	}

	/** Every shown name and live float into the atlas (refilled once if full) and the batches. */
	private layout(retry = true): void {
		this.dirty = false;
		const r = this.atlas.ratio || 1;
		const names = this.tokens
			.filter((t) => this.shown.has(t.id))
			.map((t) => ({
				tokenId: t.id,
				lift: 0,
				plate: this.atlas.plate('name', t.name, TEXT_COLOUR)
			}));
		const floats = this.live.map((f) => ({
			tokenId: f.tokenId,
			lift: 0,
			plate: this.atlas.plate('float', f.text, f.colour)
		}));
		if (retry && [...names, ...floats].some((e) => !e.plate)) {
			this.atlas.reset();
			return this.layout(false);
		}
		this.names.set(names, r);
		this.floats.set(floats, r);
	}
}
