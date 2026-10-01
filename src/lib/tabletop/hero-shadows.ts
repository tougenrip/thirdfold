// Hero shadows (#230, docs/RENDERING.md "Hero shadows"): a fixed pool of shadow-casting point
// lights per tier (`shadowedTorches`: none on low, 2 on medium, 4 on high and ultra) that the
// GridLights nearest the camera's focus lend their light to, so minis throw shadows from the
// brazier the player looks at. Each slot is a `HeroLight` made with the pool and casting for its
// whole life (faded to 0 while free), so the lights' cache key never changes and handing a slot to
// another light compiles nothing. Its node draws the same light as the GridLights' entry (the
// falloff mirror, occlusion taps, flicker and floor, gated by the cell lists, so it never lights
// past the rules), times its cube's shadow, while the entry gives the slot the share it has faded
// in (`GridLight.heroIndex`/`heroFade`, uniforms: a handover uploads nothing, so the data's
// reserved `hero` flag stays 0): no light is lit twice, and an unshadowed pixel reads the same with
// or without a slot. Handovers cross-fade over HERO_FADE_MS (snapped under reduced motion), a new
// holder fading in once its cube is drawn.
//
// The cubes (materials/hero-light-node.ts) share one depth atlas, so the pool adds one texture to
// a lit fragment stage. A cube redraws only when something within its light's reach + 1 changed (a
// token, prop or the ground there, its sight (walls and doors), its own position, or a mini gliding
// through), at most `slots / 2` a frame (1 on medium, 2 on high); the rest wait their turn. A
// camera move redraws nothing. Built only from what the viewer was sent: its lights (GridLights'
// entries), its tokens and props, its ground.

import * as THREE from 'three/webgpu';
import type { GridPos, SquareGrid } from '$lib/game/grid';
import type { Prop } from '$lib/game/props';
import type { Token } from '$lib/game/token';
import type { GridLighting } from './grid-light-layer';
import { assignHeroSlots } from './hero-slots';
import type { GridLight } from './materials/grid-light-node';
import { HeroAtlas, HeroLight } from './materials/hero-light-node';
import type { QualitySettings } from './quality';

/** How long a slot's light fades in or out on a handover, in ms. */
export const HERO_FADE_MS = 200;
/** How long after a change in its reach a slot keeps redrawing (a door's swing, a prop's glide). */
const SETTLE_MS = 500;
/** How far past the light's reach a cube sees, in cells (and its height). */
const BEYOND = 2;
/** How far along its normal a fragment is moved before it is compared, in cells (no acne). */
const NORMAL_BIAS = 0.03;

/** A tier's slots and cube size: none on low, 2 at 256 px on medium, 4 at 512 on high and up. */
export function heroTier(settings: QualitySettings): { slots: number; size: number } {
	const slots = settings.layers.manylights ? settings.shadowedTorches : 0;
	return { slots, size: settings.tier === 'medium' ? 256 : 512 };
}

/** What `?perf` shows of the pool. */
export interface HeroStats {
	/** Each slot's light id, or null while free. */
	owners: (string | null)[];
	/** Cubes drawn since the pool was made, by slot, and in the last frame. */
	redraws: number[];
	lastRedraws: number;
	/** Bytes the cubes hold on the GPU. */
	cubeBytes: number;
}

interface Slot {
	/** The light it draws now (fading in, holding or fading out), and the one assigned. */
	id: string | null;
	want: string | null;
	fade: number;
	drawn: boolean;
	/** What its reach held at the last relight, and as its cube was last drawn. */
	region: string;
	drawnKey: string;
	/** A change in its reach still settling (a door swinging): redraw until then. */
	settle: boolean;
	settleUntil: number;
	/** The clock when its cube was last drawn: a settling slot redraws once per clock step. */
	drawnNow: number;
	/** Tokens in or lately in its reach, whose minis may glide through. */
	tokens: string[];
}

/** The pool's lights and atlas, and which lights hold them. */
export class HeroShadows {
	readonly lights: HeroLight[];
	private readonly atlas: HeroAtlas | null;
	private readonly slots: Slot[];
	private readonly budget: number;
	private grid: SquareGrid | null = null;
	private tokens: readonly Token[] = [];
	private props: readonly Prop[] = [];
	private levels: Uint8Array | null = null;
	private casters: GridPos[] = [];
	private lighting: GridLighting | null = null;
	private focus = { x: NaN, y: NaN };
	private assignStale = true;
	private last = 0;
	private next = 0;
	private readonly redraws: number[];
	private lastRedraws = 0;

	/** `count` slots of `size` px cubes drawing `gridLight`'s entries (none without one). */
	constructor(
		readonly gridLight: GridLight | null,
		readonly count: number,
		readonly size: number
	) {
		this.atlas = count && gridLight ? new HeroAtlas(count, size) : null;
		this.lights = this.atlas ? Array.from({ length: count }, (_, i) => this.make(i)) : [];
		this.slots = this.lights.map(() => ({
			id: null,
			want: null,
			fade: 0,
			drawn: false,
			region: '',
			drawnKey: '',
			settle: false,
			settleUntil: 0,
			drawnNow: NaN,
			tokens: []
		}));
		this.budget = Math.max(1, count / 2);
		this.redraws = this.slots.map(() => 0);
	}

	private make(slot: number): HeroLight {
		const light = new HeroLight(this.gridLight!, this.atlas!, slot);
		light.name = `hero-${slot}`;
		return light;
	}

	/** Whether this pool is the one a tier and GridLight want. */
	fits(gridLight: GridLight | null, settings: QualitySettings): boolean {
		const { slots, size } = heroTier(settings);
		const count = gridLight ? slots : 0;
		return gridLight === this.gridLight && count === this.count && (!count || size === this.size);
	}

	/** What the pool may cast from and with, after GridLights' update: its regions and casters. */
	update(
		grid: SquareGrid,
		lighting: GridLighting,
		tokens: readonly Token[],
		props: readonly Prop[],
		levels: Uint8Array | null
	): void {
		if (!this.atlas) return;
		this.grid = grid;
		this.tokens = tokens;
		this.props = props;
		this.levels = levels;
		const casters: GridPos[] = [...tokens.map((k) => k.pos), ...props.map((p) => p.pos)];
		// Raised ground casts where it steps down to a neighbour.
		const level = (x: number, y: number) => levels?.[y * grid.width + x] ?? 0;
		for (let y = 0; levels && y < grid.height; y++)
			for (let x = 0; x < grid.width; x++) {
				const h = level(x, y);
				if (h && (x === 0 || y === 0 || level(x - 1, y) < h || level(x, y - 1) < h))
					casters.push({ x, y });
			}
		this.casters = casters;
		this.assignStale = true;
		this.lighting = lighting;
		for (const slot of this.slots) if (slot.id) this.refreshRegion(slot);
	}

	/** The key of what stands within a slot's light's reach + 1: what its cube shows. */
	private refreshRegion(slot: Slot): void {
		const i = this.indexOf(slot.id);
		const e = this.lighting?.entries[i];
		const grid = this.grid;
		if (!e || !grid) return;
		const { x, y } = e.ruleOrigin;
		const r = e.reach + 1;
		const near = (p: GridPos) => Math.hypot(p.x - x, p.y - y) <= r;
		const tokens = this.tokens.filter((k) => near(k.pos));
		const props = this.props.filter((p) => near(p.pos));
		const cells: number[] = [];
		const sight = this.lighting!.entrySights[i];
		for (let cy = Math.max(0, Math.floor(y - r)); cy <= Math.min(grid.height - 1, y + r); cy++)
			for (let cx = Math.max(0, Math.floor(x - r)); cx <= Math.min(grid.width - 1, x + r); cx++) {
				const c = cy * grid.width + cx;
				cells.push(this.levels?.[c] ?? 0, sight?.[c] ?? 0);
			}
		const region = JSON.stringify([e.reach, tokens, props, cells]);
		if (region !== slot.region) slot.settle = true;
		slot.region = region;
		slot.tokens = [...new Set([...slot.tokens, ...tokens.map((k) => k.id)])];
	}

	private indexOf(id: string | null): number {
		return id === null ? -1 : (this.lighting?.entries.findIndex((e) => e.id === id) ?? -1);
	}

	/**
	 * A frame at `now`: assigns the slots for the camera's `target` (world), fades handovers,
	 * redraws the cubes due within the budget (every slot's at once on a warm-up's gallery frame,
	 * `gallery`, so their passes compile then), and says whether more frames are needed.
	 */
	frame(
		now: number,
		target: THREE.Vector3,
		tokens: { rootOf(id: string): THREE.Object3D | null },
		gallery: boolean,
		reduced: boolean
	): boolean {
		if (!this.atlas || !this.grid || !this.lighting) return false;
		const grid = this.grid;
		const dt = Math.min(Math.max(now - this.last, 0), 100);
		this.last = now;
		const focus = {
			x: target.x / grid.cellSize + grid.width / 2,
			y: target.z / grid.cellSize + grid.height / 2
		};
		if (this.assignStale || Math.hypot(focus.x - this.focus.x, focus.y - this.focus.y) > 0.25) {
			this.focus = focus;
			this.assignStale = false;
			const sources = this.lighting.entries.map((e) => ({
				id: e.id,
				pos: e.ruleOrigin,
				reach: e.reach
			}));
			const owners = assignHeroSlots(
				sources,
				focus,
				this.casters,
				this.count,
				this.slots.map((s) => s.want)
			);
			owners.forEach((id, i) => (this.slots[i].want = id));
		}
		// At least a twelfth a frame, so a fade ends on a held clock (tests) or a slow device.
		const step = reduced ? 1 : Math.max(dt / HERO_FADE_MS, 1 / 12);
		let busy = false;
		const due: number[] = [];
		this.slots.forEach((slot, i) => {
			if (slot.want !== slot.id) {
				if (slot.id && slot.fade > 0 && !reduced) slot.fade = Math.max(0, slot.fade - step);
				if (!slot.id || slot.fade === 0 || reduced) {
					Object.assign(slot, { id: slot.want, fade: 0, drawn: false, drawnKey: '' });
					slot.tokens = [];
					if (slot.id) this.refreshRegion(slot);
				}
			}
			if (slot.settle) [slot.settle, slot.settleUntil] = [false, now + SETTLE_MS];
			const key = slot.id ? this.frameKey(slot, tokens) : '';
			const settling = now < slot.settleUntil && now !== slot.drawnNow;
			if (slot.id && (key !== slot.drawnKey || settling)) due.push(i);
			const want = slot.id && slot.drawn ? 1 : 0;
			slot.fade =
				slot.fade < want ? Math.min(want, slot.fade + step) : Math.max(want, slot.fade - step);
			busy ||= slot.fade !== want || slot.want !== slot.id;
		});
		// The budget's worth of due cubes, taking turns from the slot after the last drawn.
		const turn = (i: number) => (i - this.next + this.count) % this.count;
		due.sort((a, b) => turn(a) - turn(b));
		const drawn = gallery ? this.slots.map((_, i) => i) : due.slice(0, this.budget);
		for (const i of drawn) this.draw(i, gallery, tokens, now);
		if (drawn.length) this.next = (drawn[drawn.length - 1] + 1) % this.count;
		this.lastRedraws = drawn.length;
		for (const i of drawn) this.redraws[i]++;
		this.write();
		return busy || due.length > drawn.length || gallery;
	}

	/** What the cube shows that moves without a relight: the light, and minis gliding in its reach. */
	private frameKey(slot: Slot, tokens: { rootOf(id: string): THREE.Object3D | null }): string {
		const e = this.lighting!.entries[this.indexOf(slot.id)];
		if (!e) return '';
		const parts = [slot.region, e.visual.x, e.visual.y, e.visual.z];
		for (const id of slot.tokens) {
			const p = tokens.rootOf(id)?.position;
			if (p) parts.push(p.x.toFixed(3), p.y.toFixed(3), p.z.toFixed(3));
		}
		return parts.join();
	}

	/** Queues slot `i`'s cube for this frame's draw, from its light (warming, over everything). */
	private draw(
		i: number,
		warm: boolean,
		tokens: { rootOf(id: string): THREE.Object3D | null },
		now: number
	) {
		const slot = this.slots[i];
		const light = this.lights[i];
		const grid = this.grid!;
		const e = this.lighting!.entries[this.indexOf(slot.id)];
		if (e) light.position.set(e.visual.x, e.visual.y, e.visual.z);
		else light.position.set(0, grid.cellSize, 0);
		if (e && !warm) {
			light.distance = (e.reach + BEYOND) * grid.cellSize;
			slot.drawnKey = this.frameKey(slot, tokens);
			slot.drawn = true;
			slot.drawnNow = now;
		} else {
			// Seeing the whole table, so every caster's shadow pass is made while the gallery shows:
			// a true cube, if coarser in depth, until it draws again at its reach on the next frame.
			light.distance = (grid.width + grid.height) * grid.cellSize;
			slot.drawnKey = '';
		}
		light.shadow.normalBias = NORMAL_BIAS * grid.cellSize;
		light.shadow.needsUpdate = true;
	}

	/** The slots' layers and fades into the lights and the GridLight (numbers: no upload). */
	private write(): void {
		const { heroIndex, heroFade } = this.gridLight!;
		this.slots.forEach((slot, i) => {
			const layer = this.indexOf(slot.id) + 1;
			const f = layer ? slot.fade : 0;
			this.lights[i].layer.value = layer;
			this.lights[i].fade.value = f;
			heroIndex[i].value = layer;
			heroFade[i].value = f;
		});
	}

	stats(): HeroStats {
		return {
			owners: this.slots.map((s) => s.id),
			redraws: [...this.redraws],
			lastRedraws: this.lastRedraws,
			cubeBytes: this.atlas?.bytes ?? 0
		};
	}

	dispose(): void {
		for (const light of this.lights) {
			light.removeFromParent();
			light.dispose();
		}
		this.atlas?.target.dispose();
	}
}
