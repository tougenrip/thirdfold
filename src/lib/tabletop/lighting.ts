// Lighting for the three.js view: the ambient preset, the rules' light level
// per cell (`levels`, which the cell maps carry to every material's
// `worldModify`, cell-maps.ts; the darkness overlay plane that drew it went in
// #173), a fixed pool of real point lights for the nearest sources (so minis
// and walls glow), and lantern fixtures, which take the world's fog and dark
// like everything else (`inWorld`). Everything is derived from state the client
// was sent; the server already applied the rules about what darkness hides.
// After dark, flames flicker (`flicker`), which is cosmetic and costs no state.

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { gridToWorld, type SquareGrid } from '$lib/game/grid';
import { lightLevels, type Ambient, type Light, type LightSource } from '$lib/game/lights';
import type { Blockers } from '$lib/game/objects';
import type { Prop } from '$lib/game/props';
import type { Ground } from './ground';
import { inWorld } from './materials/world-modify';
import { modelNow } from './models';

/** Real point lights available. Fixed so three.js never recompiles shaders as lights come and go. */
const POOL_SIZE = 8;
const FIXTURE_HEIGHT = 1.5;
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

interface Preset {
	background: number;
	hemisphere: number;
	/** The hemisphere's sky and ground colours (#167): warm by day, warm over cool at dusk, moon-blue at night. */
	sky: number;
	ground: number;
	sun: number;
	lamp: number;
	/** How dark unlit cells are (cell-maps.ts `AMBIENT_DARK` shades them). */
	dark: number;
}

// The whole frame is tone mapped, background and overlays too, so these colours are the ones
// ACES turns into the sRGB 16120f, 120e10 and 07060a of before (#153).
// Interim (#167) until the sky (#114) and the art bible (#183): #208 blends these by the hour
// and #218 replaces them with atmosphere curves.
const PRESETS: Record<Ambient, Preset> = {
	day: {
		background: 0x292421,
		hemisphere: 0.9,
		sky: 0xfff1dc,
		ground: 0x1c140e,
		sun: 1.6,
		lamp: 30,
		dark: 0
	},
	dusk: {
		background: 0x221f28,
		hemisphere: 0.45,
		sky: 0xffd0a0,
		ground: 0x1a2438,
		sun: 0.55,
		lamp: 18,
		dark: 0.35
	},
	dark: {
		background: 0x121828,
		hemisphere: 0.1,
		sky: 0x9ab4ff,
		ground: 0x0a1230,
		sun: 0,
		lamp: 0,
		dark: 0.82
	}
};

export interface SceneLights {
	hemisphere: THREE.HemisphereLight;
	sun: THREE.DirectionalLight;
	lamp: THREE.PointLight;
	scene: THREE.Scene;
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
	/** Each pool light's steady intensity, which flicker varies around. */
	private steady: number[] = [];
	private ambient: Ambient = 'day';
	/** The rules' light level per cell from the last update, or null by day (the cell maps', #171). */
	levels: Float32Array | null = null;
	/** Whether the table has dark areas (they darken even by day, and their flames flicker). */
	private hasDark = false;
	private hemisphere = PRESETS.day.hemisphere;
	private flash = 0;

	constructor(private readonly base: SceneLights) {
		for (let i = 0; i < POOL_SIZE; i++) {
			const light = new THREE.PointLight(0xffffff, 0, 1, 2);
			this.pool.push(light);
			this.group.add(light);
		}
	}

	/**
	 * Recomputes lighting. `dark` marks the table's dark areas, which are as
	 * dark as night whatever the ambient. What a fogged player sees is lit by
	 * definition; `worldModify` adds that fill in the shader.
	 */
	update(
		grid: SquareGrid,
		ambient: Ambient,
		lights: readonly Light[],
		sources: readonly LightSource[],
		blocked: Blockers,
		ground: Ground | null = null,
		dark: Uint8Array | null = null,
		seats: ReadonlyMap<number, number> = new Map()
	): void {
		const preset = PRESETS[ambient];
		this.ambient = ambient;
		this.base.scene.background = new THREE.Color(preset.background);
		if (this.base.scene.fog instanceof THREE.Fog)
			this.base.scene.fog.color.setHex(preset.background);
		this.hemisphere = preset.hemisphere;
		this.base.hemisphere.intensity = preset.hemisphere + this.flash * 1.5;
		this.base.hemisphere.color.setHex(preset.sky);
		this.base.hemisphere.groundColor.setHex(preset.ground);
		this.hasDark = !!dark?.some((v) => v);
		this.base.sun.intensity = preset.sun;
		this.base.lamp.intensity = preset.lamp;

		// Light levels matter only where it can be dark: never by day outside dark areas.
		this.levels = preset.dark || this.hasDark ? lightLevels(grid, blocked, sources) : null;
		this.updatePool(grid, sources, ambient, ground, seats);
		this.updateFixtures(grid, lights, ground, seats);
	}

	/** Id of the light fixture under the ray, if any. */
	pick(raycaster: THREE.Raycaster): string | null {
		const hit = raycaster.intersectObjects([...this.fixtures.values()], true)[0];
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
	}

	/** Gives the pool's point lights to the strongest sources; the rest stay dark. */
	private updatePool(
		grid: SquareGrid,
		sources: readonly LightSource[],
		ambient: Ambient,
		ground: Ground | null,
		seats: ReadonlyMap<number, number>
	): void {
		const chosen = [...sources].sort((a, b) => b.radius - a.radius).slice(0, POOL_SIZE);
		const strength = ambient === 'day' ? 0.5 : 1;
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
			light.distance = (s.radius + 1.5) * grid.cellSize;
			// Raised to human height (#152), a lamp lights the floor a cell or two away about as
			// before (the light lands less slanted); only the spot right under it is dimmer.
			light.intensity = strength * (4 + s.radius * 2) * grid.cellSize * grid.cellSize;
			this.steady[i] = light.intensity;
		});
	}

	/** Whether anything flickers: lit flames after dark, or in a dark area. */
	get flickers(): boolean {
		return (this.ambient !== 'day' || this.hasDark) && this.steady.some((v) => v > 0);
	}

	/**
	 * A flash of light over the table (0 none, 1 full): the sky light rises for
	 * the moment a flash lasts, until the sky work (#222); the dark thins in
	 * `worldModify` (`CellMaps.setFlash`). Cosmetic; what the flash lets players
	 * see comes from the server as fog.
	 */
	setFlash(k: number): void {
		if (k === this.flash) return;
		this.flash = k;
		this.base.hemisphere.intensity = this.hemisphere + k * 1.5;
	}

	/**
	 * Makes flames waver for time `now` (ms): each light on its own slow,
	 * irregular beat. Returns whether there is anything to animate.
	 */
	flicker(now: number): boolean {
		if (!this.flickers) return false;
		const t = now / 1000;
		this.pool.forEach((light, i) => {
			const wave = Math.sin(t * 7.3 + i * 1.7) * 0.5 + Math.sin(t * 13.1 + i * 2.9) * 0.3;
			light.intensity = this.steady[i] * (1 + 0.08 * wave);
		});
		let i = 0;
		for (const fixture of this.fixtures.values()) {
			const flame = fixture.children[1];
			const wave = Math.sin(t * 9.7 + i++ * 2.3);
			flame.scale.set(1 - 0.05 * wave, 1 + 0.1 * wave, 1 - 0.05 * wave);
		}
		return true;
	}

	private updateFixtures(
		grid: SquareGrid,
		lights: readonly Light[],
		ground: Ground | null,
		seats: ReadonlyMap<number, number>
	): void {
		const seen = new Set<string>();
		for (const l of lights) {
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
