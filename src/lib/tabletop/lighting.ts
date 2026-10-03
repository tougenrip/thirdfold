// Lighting for the three.js view (the sky's light is atmosphere.ts's): the rules' light level
// per cell (`levels`, which the cell maps carry to every material's `worldModify`, cell-maps.ts),
// the point lights, and the lights' fixtures, which take the world's fog and dark like everything
// else. Everything is derived from state the client was sent; the server already applied
// the rules about what darkness hides. The point lights are GridLights (#228, grid-light-layer.ts):
// every source that is on, placed or carried, K of them per cell by tier (`setTier`), lit where
// the rules light and never through a wall, on every tier (M67's fixed pool of 8 real point
// lights was removed at M68's close). Each light is drawn with its kind's fixture model, and
// carried light with a flame at the hand (light-fixtures.ts, #232); a light whose fixture is a
// prop on its cell sits on the prop's flame (`flameSeats`). Flames
// flicker in the shader (#231, materials/flicker.ts), the lights and their fixtures' flames
// together: `animating` sets its clock each frame and asks for AMBIENT frames only while a
// flickering light in view reads (after dark, or in a dark area), never under reduced motion. The
// sky's `nightGlow` (`setGlow`) only says whether flames read; the GridLights don't dim by day
// (the sky's exposure does). Bounce and cavity (#234) ride on the GridLights, at the tier's
// `BOUNCE_STRENGTH` under the `bounce` layer, and the hemisphere's ground takes the floors' hue.

import * as THREE from 'three/webgpu';
import type { SquareGrid } from '$lib/game/grid';
import { lightLevels, type Ambient, type Light } from '$lib/game/lights';
import { asObstacles, type Blockers } from '$lib/game/objects';
import type { Prop } from '$lib/game/props';
import type { Token } from '$lib/game/token';
import type { Ground } from './ground';
import { GridLighting, litSources } from './grid-light-layer';
import { HeroShadows, heroTier, type HeroStats } from './hero-shadows';
import { flameSeats, LightFixtures } from './light-fixtures';
import { LightHandles } from './light-handles';
import { setFlicker } from './materials/flicker';
import { groundTint as groundTintOf } from './grid-lights';
import { GridLight } from './materials/grid-light-node';
import type { QualitySettings, Tier } from './quality';
import { groundTint } from './sky-light';
export { ProbeLayer } from './probes'; // the probe grid (#235), made beside the lights

/** How strongly lit floors throw light back, per tier (#234): none on low. */
export const BOUNCE_STRENGTH: Record<Tier, number> = {
	low: 0,
	medium: 0.2,
	high: 0.25,
	ultra: 0.3
};
/** Point lights per cell before a tier says: medium's, the K of the scene's first GridLight. */
export const DEFAULT_K = 8;
/** Night glow past this, flames flicker: day's is 0.5 (atmosphere-curve.ts `nightGlow`). */
const NIGHT_FLICKERS = 0.5;
const VIEW = new THREE.Matrix4();
const FRUSTUM = new THREE.Frustum();
const REACH = new THREE.Sphere();

export class LightingLayer {
	readonly group = new THREE.Group();
	/** The lights' fixture models and carried flames (#232). */
	readonly fixtures: LightFixtures;
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
	/** The point lights as GridLights. */
	grid: GridLighting;
	/** The tier's bounce strength under the `bounce` layer, 0 off (#234). */
	private bounce = 0;
	/** The hero shadow slots near the camera's focus (#230), as many as the tier has. */
	heroes: HeroShadows;
	/** The minis carried lights and hero cubes follow, from the frame's `carry`. */
	private minis: { rootOf(id: string): THREE.Object3D | null } = { rootOf: () => null };

	/**
	 * With the scene's GridLight (scene-lights.ts); without one, the layer makes its own. `onModel`
	 * is told when a fixture's model arrives, to relight (and so draw it).
	 */
	constructor(
		light?: GridLight,
		onModel?: () => void,
		heroes?: HeroShadows,
		/** Asks for another frame: a hero slot's handover or cube still due (#230). */
		private readonly request: () => void = () => {}
	) {
		this.fixtures = new LightFixtures(onModel);
		this.group.add(this.fixtures.group);
		this.grid = new GridLighting(light ?? new GridLight(DEFAULT_K));
		if (!light) this.group.add(this.grid.light);
		this.heroes = heroes ?? new HeroShadows(this.grid.light, 0, 0);
	}

	/**
	 * The tier's K (`settings.lights`). A change swaps the light object, a new program as any tier
	 * switch makes (true then); the next update rebuilds.
	 */
	setTier(settings: QualitySettings): boolean {
		this.bounce = settings.layers.bounce ? BOUNCE_STRENGTH[settings.tier] : 0;
		const parent = this.grid.light.parent ?? this.group;
		const swapped = settings.lights !== this.grid.light.k;
		if (swapped) {
			parent.remove(this.grid.light);
			this.grid.dispose();
			this.grid = new GridLighting(new GridLight(settings.lights));
			parent.add(this.grid.light);
		}
		// The tier's hero slots (#230), made with its GridLight: a new one is a new program too.
		if (this.heroes.fits(this.grid.light, settings)) return swapped;
		this.heroes.dispose();
		const { slots, size } = heroTier(settings);
		this.heroes = new HeroShadows(this.grid.light, slots, size);
		if (this.heroes.lights.length) parent.add(...this.heroes.lights);
		return true;
	}

	/** Carried lights follow their gliding minis; returns `moving`. */
	carry(tokens: { rootOf(id: string): THREE.Object3D | null }, moving: boolean): boolean {
		this.minis = tokens;
		this.grid.carry(tokens);
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
		this.grid.update(grid, lit, blocked, ground, seats, floor, this.bounce);
		const [r, g, b] = this.bounce ? groundTintOf(floor) : [1, 1, 1];
		groundTint.value.setRGB(r, g, b);
		this.heroes.update(grid, this.grid, tokens, props, asObstacles(blocked).levels ?? null);
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

	/** The hero slots' holders, redraws and cube memory, for `?perf`. */
	heroStats(): HeroStats {
		return this.heroes.stats();
	}

	dispose(): void {
		this.heroes.dispose();
		this.fixtures.dispose();
		this.handles?.dispose();
		this.grid.dispose();
	}

	/** The sky's night glow (0-1): past day's, flames flicker. A number, no program. */
	setGlow(glow: number): void {
		this.glow = glow;
	}

	setReducedMotion(reduced: boolean): void {
		this.still = reduced;
	}

	/**
	 * Sets the flicker's clock to `now` (ms) and says whether it needs AMBIENT frames: a GridLight
	 * that flickers, reads (night glows past day's, or it stands in a dark area) and reaches into
	 * `camera`'s view. Never under reduced motion. The hero
	 * slots (#230) follow `target`, the camera's focus, and request frames (reduced motion or not)
	 * while a handover fades or a cube waits its turn; `gallery`: a warm-up's gallery shows this
	 * frame (their shadow passes compile then).
	 */
	animating(camera: THREE.Camera, now: number, target?: THREE.Vector3, gallery = false): boolean {
		setFlicker(now, this.still);
		if (target && this.heroes.frame(now, target, this.minis, gallery, this.still)) this.request();
		return this.flickering(camera);
	}

	private flickering(camera: THREE.Camera): boolean {
		if (this.still) return false;
		const night = this.glow > NIGHT_FLICKERS;
		const cell = this.grid.light.cellSize.value;
		VIEW.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		FRUSTUM.setFromProjectionMatrix(VIEW, camera.coordinateSystem);
		const of = this.grid.sourceOf;
		return this.grid.entries.some(({ profile, visual: v, reach }, i) => {
			if (!profile || !(night || this.darkAt[of[i]])) return false;
			REACH.center.set(v.x, v.y, v.z);
			REACH.radius = reach * cell;
			return FRUSTUM.intersectsSphere(REACH);
		});
	}
}
