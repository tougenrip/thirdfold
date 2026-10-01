// Lighting for the three.js view (the sky's light is atmosphere.ts's): the rules' light level
// per cell (`levels`, which the cell maps carry to every material's `worldModify`, cell-maps.ts),
// the point lights, and the lights' fixtures, which take the world's fog and dark like everything
// else. Everything is derived from state the client was sent; the server already applied
// the rules about what darkness hides. The point lights are GridLights (#228, grid-light-layer.ts):
// every source that is on, placed or carried, K of them per cell by tier (`setTier`), lit where
// the rules light and never through a wall; `?off=manylights` puts back M67's fixed pool of 8 real
// point lights for the largest sources until the milestone's gates pass. Each light is drawn with
// its kind's fixture model, and carried light with a flame at the hand (light-fixtures.ts, #232);
// a light whose fixture is a prop on its cell sits on the prop's flame (`flameSeats`). Flames
// flicker in the shader (#231, materials/flicker.ts), the lights and their fixtures' flames
// together: `animating` sets its clock each frame and asks for AMBIENT frames only while a
// flickering light in view reads (after dark, or in a dark area), never under reduced motion. How
// strongly the pool shines follows the sky's `nightGlow` (`setGlow`); the GridLights don't dim by
// day (the sky's exposure does). Bounce and cavity (#234) ride on the GridLights, at the tier's
// `BOUNCE_STRENGTH` under the `bounce` layer, and the hemisphere's ground takes the floors' hue.

import * as THREE from 'three/webgpu';
import { gridToWorld, type SquareGrid } from '$lib/game/grid';
import {
	lightLevels,
	lightLook,
	renderedReach,
	type Ambient,
	type Light,
	type LightSource
} from '$lib/game/lights';
import { asObstacles, type Blockers } from '$lib/game/objects';
import type { Prop } from '$lib/game/props';
import type { Token } from '$lib/game/token';
import type { Ground } from './ground';
import { GridLighting, litSources } from './grid-light-layer';
import { flameSeats, LightFixtures } from './light-fixtures';
import { LightHandles } from './light-handles';
import { setFlicker } from './materials/flicker';
import { groundTint as groundTintOf } from './grid-lights';
import { GridLight } from './materials/grid-light-node';
import type { QualitySettings, Tier } from './quality';
import { groundTint } from './sky-light';

/** The pool's point lights (`?off=manylights`). Fixed so nothing recompiles as lights come and go. */
const POOL_SIZE = 8;
/** How strongly lit floors throw light back, per tier (#234): none on low. */
export const BOUNCE_STRENGTH: Record<Tier, number> = {
	low: 0,
	medium: 0.2,
	high: 0.25,
	ultra: 0.3
};
/** Point lights per cell before a tier says: medium's, the K of the scene's first GridLight. */
export const DEFAULT_K = 8;
/** A pool light's flame height without a seat, in cells: a fixture's, about human height. */
const FIXTURE_HEIGHT = 1.5;
/** Night glow past this, flames flicker: day's is 0.5 (atmosphere-curve.ts `nightGlow`). */
const NIGHT_FLICKERS = 0.5;
/** A pool light's height above its flame. */
const ABOVE_FLAME = 0.1;
const VIEW = new THREE.Matrix4();
const FRUSTUM = new THREE.Frustum();
const REACH = new THREE.Sphere();

export class LightingLayer {
	readonly group = new THREE.Group();
	private pool: THREE.PointLight[] = [];
	/** The lights' fixture models and carried flames (#232). */
	readonly fixtures: LightFixtures;
	/** Each pool light's intensity at full glow. */
	private steady: number[] = [];
	/** The sky's night glow (atmosphere-curve.ts): 0.5 by day, 1 at night, as the bands were. */
	private glow = 1;
	/** The rules' light level per cell from the last update, or null by day (the cell maps', #171). */
	levels: Float32Array | null = null;
	/** Whether each GridLight's cell is in a dark area (its flame reads, so flickers, by day). */
	private darkAt: boolean[] = [];
	/** Reduced motion: flames hold still and ask for no frames. */
	private still = false;
	/** The GM's handles on fixture-less lights (#209), made the first time a GM needs them. */
	private handles: LightHandles | null = null;
	/** The point lights as GridLights, or null for the pool (`?off=manylights`). */
	grid: GridLighting | null;
	/** The tier's bounce strength under the `bounce` layer, 0 off (#234). */
	private bounce = 0;

	/**
	 * With the scene's GridLight (scene-lights.ts); without one, the layer makes its own. `onModel`
	 * is told when a fixture's model arrives, to relight (and so draw it).
	 */
	constructor(light?: GridLight, onModel?: () => void) {
		this.fixtures = new LightFixtures(onModel);
		this.group.add(this.fixtures.group);
		this.grid = new GridLighting(light ?? new GridLight(DEFAULT_K));
		if (!light) this.group.add(this.grid.light);
	}

	/**
	 * The tier's K (`settings.lights`), or the pool with `manylights` off. A change swaps the light
	 * objects, a new program as any tier switch makes (true then); the next update rebuilds.
	 */
	setTier(settings: QualitySettings): boolean {
		this.bounce = settings.layers.bounce ? BOUNCE_STRENGTH[settings.tier] : 0;
		const k = settings.layers.manylights ? settings.lights : 0;
		if (k === (this.grid?.light.k ?? 0)) return false;
		const parent = this.grid?.light.parent ?? this.pool[0]?.parent ?? this.group;
		if (this.grid) parent.remove(this.grid.light);
		this.grid?.dispose();
		for (const light of this.pool) parent.remove(light);
		this.pool = [];
		this.grid = k ? new GridLighting(new GridLight(k)) : null;
		if (this.grid) parent.add(this.grid.light);
		for (let i = 0; !k && i < POOL_SIZE; i++) {
			this.pool.push(new THREE.PointLight(0xffffff, 0, 1, 2));
			parent.add(this.pool[i]);
		}
		return true;
	}

	/** Carried lights follow their gliding minis (GridLights only); returns `moving`. */
	carry(tokens: { rootOf(id: string): THREE.Object3D | null }, moving: boolean): boolean {
		this.grid?.carry(tokens);
		this.fixtures.carry(tokens);
		return moving;
	}

	/**
	 * Recomputes lighting. `dark` marks the table's dark areas, which are as
	 * dark as night whatever the ambient. What a fogged player sees is lit by
	 * definition; `worldModify` adds that fill in the shader.
	 * What the rules darken (`levels`, and the cell maps and grade the renderer keys on
	 * `ambient`) always follows the band, never the hour.
	 */
	update(
		grid: SquareGrid,
		ambient: Ambient,
		lights: readonly Light[],
		tokens: readonly Token[],
		blocked: Blockers,
		ground: Ground | null = null,
		dark: Uint8Array | null = null,
		props: readonly Prop[] = [],
		floor: Uint8Array | null = null
	): void {
		const lit = litSources(lights, tokens);
		const sources = lit.map((l) => l.source);
		this.darkAt = sources.map((s) => !!dark?.[s.pos.y * grid.width + s.pos.x]);
		// Light levels matter only where it can be dark: never by day outside dark areas.
		const dim = ambient !== 'day' || !!dark?.some((v) => v);
		this.levels = dim ? lightLevels(grid, blocked, sources) : null;
		const seats = flameSeats(grid, props);
		if (this.grid) this.grid.update(grid, lit, blocked, ground, seats, floor, this.bounce);
		else this.updatePool(grid, sources, ground, seats);
		const [r, g, b] = this.grid && this.bounce ? groundTintOf(floor) : [1, 1, 1];
		groundTint.value.setRGB(r, g, b);
		this.fixtures.update(grid, lights, tokens, asObstacles(blocked).edges, ground);
	}

	/**
	 * The GM's handles on lights without a fixture model (`gm`). Made with a GM's table, before any
	 * light needs one (so the warm-up compiles them), and never for a player's.
	 */
	showHandles(grid: SquareGrid, lights: readonly Light[], ground: Ground | null, gm: boolean) {
		if (!this.handles && gm) {
			this.handles = new LightHandles();
			this.group.add(this.handles.mesh);
		}
		this.handles?.update(grid, gm ? lights : [], ground);
	}

	/** Id of the light fixture or GM handle under the ray, if any: the nearer of the two. */
	pick(raycaster: THREE.Raycaster): string | null {
		const hit = this.fixtures.pick(raycaster);
		const handle = this.handles?.pick(raycaster);
		if (handle && !(hit && hit.distance < handle.distance)) return handle.id;
		return hit?.id ?? null;
	}

	dispose(): void {
		this.fixtures.dispose();
		this.handles?.dispose();
		this.grid?.dispose();
	}

	/** Gives the pool's point lights to the strongest sources; the rest stay dark. */
	private updatePool(
		grid: SquareGrid,
		sources: readonly LightSource[],
		ground: Ground | null,
		seats: ReadonlyMap<number, number>
	): void {
		const chosen = [...sources].sort((a, b) => b.radius - a.radius).slice(0, POOL_SIZE);
		this.pool.forEach((light, i) => {
			const s = chosen[i];
			if (!s) {
				light.intensity = this.steady[i] = 0;
				return;
			}
			const w = gridToWorld(grid, s.pos);
			const floor = ground?.floorY(s.pos) ?? 0;
			const flame = seats.get(s.pos.y * grid.width + s.pos.x) ?? FIXTURE_HEIGHT;
			light.position.set(w.x, floor + (flame + ABOVE_FLAME) * grid.cellSize, w.z);
			light.color.set(s.color);
			// The cutoff ends where the floor below meets the rules' rim (#226), until #228's grid
			// lights replace the pool.
			light.distance = Math.hypot(renderedReach(s.radius), flame + ABOVE_FLAME) * grid.cellSize;
			// Raised to human height (#152), a lamp lights the floor a cell or two away about as
			// before (the light lands less slanted); only the spot right under it is dimmer.
			// The look's intensity scales it (1 for every light before looks, #201); a number on a
			// pool light, never a new program. Height waits for #228.
			const look = lightLook(s);
			this.steady[i] = look.intensity * (4 + s.radius * 2) * grid.cellSize * grid.cellSize;
			light.intensity = this.steady[i] * this.glow;
		});
	}

	/** The sky's night glow (0-1): how strongly the pool shines. Numbers only, no program. */
	setGlow(glow: number): void {
		if (glow === this.glow) return;
		this.glow = glow;
		this.pool.forEach((light, i) => (light.intensity = (this.steady[i] ?? 0) * glow));
	}

	setReducedMotion(reduced: boolean): void {
		this.still = reduced;
	}

	/**
	 * Sets the flicker's clock to `now` (ms) and says whether it needs AMBIENT frames: a GridLight
	 * that flickers, reads (night glows past day's, or it stands in a dark area) and reaches into
	 * `camera`'s view. Never under reduced motion, nor for the pool (which holds still).
	 */
	animating(camera: THREE.Camera, now: number): boolean {
		setFlicker(now, this.still);
		if (this.still || !this.grid) return false;
		const night = this.glow > NIGHT_FLICKERS;
		const cell = this.grid.light.cellSize.value;
		VIEW.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		FRUSTUM.setFromProjectionMatrix(VIEW, camera.coordinateSystem);
		return this.grid.entries.some(({ profile, visual: v, reach }, i) => {
			if (!profile || !(night || this.darkAt[i])) return false;
			REACH.center.set(v.x, v.y, v.z);
			REACH.radius = reach * cell;
			return FRUSTUM.intersectsSphere(REACH);
		});
	}
}
