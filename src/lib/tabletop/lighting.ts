// Lighting for the three.js view (the sky's light is atmosphere.ts's): the rules' light level
// per cell (`levels`, which the cell maps carry to every material's `worldModify`, cell-maps.ts),
// the point lights, and lantern fixtures, which take the world's fog and dark like everything else
// (`inWorld`). Everything is derived from state the client was sent; the server already applied
// the rules about what darkness hides. The point lights are GridLights (#228, grid-light-layer.ts):
// every source that is on, placed or carried, K of them per cell by tier (`setTier`), lit where
// the rules light and never through a wall; `?off=manylights` puts back M67's fixed pool of 8 real
// point lights for the largest sources until the milestone's gates pass. Flames flicker in the
// shader (#231, materials/flicker.ts): `animating` sets its clock each frame and asks for AMBIENT
// frames only while a flickering light in view reads (after dark, or in a dark area), never under
// reduced motion. How strongly the pool shines follows the sky's `nightGlow` (`setGlow`); the
// GridLights don't dim by day (the sky's exposure does).

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { gridToWorld, type SquareGrid } from '$lib/game/grid';
import {
	lightLevels,
	lightLook,
	renderedReach,
	type Ambient,
	type Light,
	type LightSource
} from '$lib/game/lights';
import type { Blockers } from '$lib/game/objects';
import type { Prop } from '$lib/game/props';
import type { Token } from '$lib/game/token';
import type { Ground } from './ground';
import { GridLighting, litSources } from './grid-light-layer';
import { LightHandles } from './light-handles';
import { setFlicker } from './materials/flicker';
import { GridLight } from './materials/grid-light-node';
import { inWorld } from './materials/world-modify';
import { modelNow } from './models';
import type { QualitySettings } from './quality';

/** The pool's point lights (`?off=manylights`). Fixed so nothing recompiles as lights come and go. */
const POOL_SIZE = 8;
/** Point lights per cell before a tier says: medium's, the K of the scene's first GridLight. */
export const DEFAULT_K = 8;
const FIXTURE_HEIGHT = 1.5;
/** Night glow past this, flames flicker: day's is 0.5 (atmosphere-curve.ts `nightGlow`). */
const NIGHT_FLICKERS = 0.5;
/** A pool light's height above its flame. */
const ABOVE_FLAME = 0.1;
/**
 * Props that are a light's fixture themselves: a light on one draws only its flame, on the
 * prop's top, and hangs its pool light there (#367, until #232 gives lights fixtures by kind).
 */
const HOLDS_LIGHT = new Set(['sconce', 'brazier']);
/** A seat's height until its model, and so its size, has loaded. */
const SEAT_FALLBACK = 1;
/** A flame's glow over its colour: above 1 in HDR, so the core blooms (#160). */
const FLAME_GLOW = 4;

interface Flame {
	color: THREE.Color;
	glow: THREE.Color;
}
const BLACK = new THREE.Color(0);
const VIEW = new THREE.Matrix4();
const FRUSTUM = new THREE.Frustum();
const REACH = new THREE.Sphere();
/**
 * A flame's colour and glow, per flame mesh (`userData.flame`): one material draws every flame,
 * so lights coming and going never compile or drop a program.
 */
const flameOf = (object: THREE.Object3D | null) => object?.userData.flame as Flame | undefined;
const flameColour = uniform(new THREE.Color()).onObjectUpdate(
	({ object }: { object: THREE.Object3D | null }) => flameOf(object)?.color ?? BLACK
);
const flameGlow = uniform(new THREE.Color()).onObjectUpdate(
	({ object }: { object: THREE.Object3D | null }) => flameOf(object)?.glow ?? BLACK
);

/** Where a light's flame sits on the light-holding props, by cell index: the prop's top. */
export function lightSeats(grid: SquareGrid, props: readonly Prop[]): Map<number, number> {
	const seats = new Map<number, number>();
	for (const p of props) {
		if (!HOLDS_LIGHT.has(p.assetId)) continue;
		const top = modelNow(p.assetId)?.entry.bounds.max[1] ?? SEAT_FALLBACK;
		seats.set(p.pos.y * grid.width + p.pos.x, top * p.scale);
	}
	return seats;
}

export class LightingLayer {
	readonly group = new THREE.Group();
	private pool: THREE.PointLight[] = [];
	private fixtures = new Map<string, THREE.Group>();
	private postGeometry = new THREE.CylinderGeometry(0.05, 0.08, FIXTURE_HEIGHT, 8);
	private flameGeometry = new THREE.SphereGeometry(0.13, 16, 12);
	private postMaterial = inWorld(
		new THREE.MeshStandardNodeMaterial({ color: 0x2b2420, roughness: 0.8 })
	);
	private flameMaterial = flameMaterial();
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

	/** With the scene's GridLight (scene-lights.ts); without one, the layer makes its own. */
	constructor(light?: GridLight) {
		this.grid = new GridLighting(light ?? new GridLight(DEFAULT_K));
		if (!light) this.group.add(this.grid.light);
	}

	/**
	 * The tier's K (`settings.lights`), or the pool with `manylights` off. A change swaps the light
	 * objects, a new program as any tier switch makes (true then); the next update rebuilds.
	 */
	setTier(settings: QualitySettings): boolean {
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
		seats: ReadonlyMap<number, number> = new Map()
	): void {
		const lit = litSources(lights, tokens);
		const sources = lit.map((l) => l.source);
		this.darkAt = sources.map((s) => !!dark?.[s.pos.y * grid.width + s.pos.x]);
		// Light levels matter only where it can be dark: never by day outside dark areas.
		const dim = ambient !== 'day' || !!dark?.some((v) => v);
		this.levels = dim ? lightLevels(grid, blocked, sources) : null;
		if (this.grid) this.grid.update(grid, lit, blocked, ground, seats);
		else this.updatePool(grid, sources, ground, seats);
		this.updateFixtures(grid, lights, ground, seats);
	}

	/**
	 * The GM's handles on lights without a fixture (`gm`). Made the first time a GM needs them,
	 * so a player's table never builds or draws them.
	 */
	showHandles(grid: SquareGrid, lights: readonly Light[], ground: Ground | null, gm: boolean) {
		if (!this.handles && gm && lights.some((l) => !lightLook(l).fixture)) {
			this.handles = new LightHandles();
			this.group.add(this.handles.mesh);
		}
		this.handles?.update(grid, gm ? lights : [], ground);
	}

	/** Id of the light fixture or GM handle under the ray, if any: the nearer of the two. */
	pick(raycaster: THREE.Raycaster): string | null {
		const hit = raycaster.intersectObjects([...this.fixtures.values()], true)[0];
		const handle = this.handles?.pick(raycaster);
		if (handle && !(hit && hit.distance < handle.distance)) return handle.id;
		for (let o: THREE.Object3D | null = hit?.object ?? null; o; o = o.parent) {
			if (typeof o.userData.lightId === 'string') return o.userData.lightId;
		}
		return null;
	}

	dispose(): void {
		this.postGeometry.dispose();
		this.flameGeometry.dispose();
		this.postMaterial.dispose();
		this.flameMaterial.dispose();
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

	private updateFixtures(
		grid: SquareGrid,
		lights: readonly Light[],
		ground: Ground | null,
		seats: ReadonlyMap<number, number>
	): void {
		const seen = new Set<string>();
		for (const l of lights) {
			// A light without a fixture (a glow) draws none: its pool light and the cells it
			// lights are all there is of it (#201). The GM still picks it by its cell.
			const look = lightLook(l);
			if (!look.fixture) continue;
			seen.add(l.id);
			let fixture = this.fixtures.get(l.id);
			if (!fixture) {
				fixture = this.createFixture(l.id);
				this.fixtures.set(l.id, fixture);
				this.group.add(fixture);
			}
			const w = gridToWorld(grid, l.pos);
			fixture.position.set(w.x, ground?.floorY(l.pos) ?? 0, w.z);
			fixture.scale.setScalar(grid.cellSize);
			fixture.userData.still = look.flicker === 'none';
			// On a sconce or brazier the prop is the post: only the flame, on its top.
			const seat = seats.get(l.pos.y * grid.width + l.pos.x);
			fixture.children[0].visible = seat === undefined;
			fixture.children[1].position.y = seat ?? FIXTURE_HEIGHT;
			const flame = fixture.children[1].userData.flame as Flame;
			flame.color.set(l.on ? l.color : '#3a3530');
			flame.glow.set(l.on ? l.color : '#000000').multiplyScalar(FLAME_GLOW);
		}
		for (const [id, fixture] of this.fixtures) {
			if (seen.has(id)) continue;
			this.group.remove(fixture);
			this.fixtures.delete(id);
		}
	}

	private createFixture(lightId: string): THREE.Group {
		const post = new THREE.Mesh(this.postGeometry, this.postMaterial);
		post.position.y = FIXTURE_HEIGHT / 2;
		post.castShadow = true;
		const flame = new THREE.Mesh(this.flameGeometry, this.flameMaterial);
		flame.userData.flame = { color: new THREE.Color(), glow: new THREE.Color() } satisfies Flame;
		flame.position.y = FIXTURE_HEIGHT;
		const fixture = new THREE.Group();
		fixture.add(post, flame);
		fixture.userData.lightId = lightId;
		return fixture;
	}
}

/** The one material every flame is drawn with: its colour and glow are the flame's own. */
function flameMaterial(): THREE.MeshStandardNodeMaterial {
	const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.3 });
	material.colorNode = flameColour;
	return inWorld(material, flameGlow);
}
