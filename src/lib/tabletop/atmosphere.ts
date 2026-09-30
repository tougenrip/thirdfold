// The sky's light on the table (#215, #217, #218): the one place the atmosphere curve's state
// (atmosphere-curve.ts) reaches the scene. Scene-level nodes are module singletons, like the cell
// maps' uniforms, set on every scene by `createScene` before anything compiles, so the lobby's
// warm-up (lobby.ts) and every table share their program keys and a change of hour, sky, haze or
// weather is uniforms only: the fog node (range and height fog, capped over the play area), the
// environment node (the captured sky, #216, scaled by the sky's reach, #219) and the background.
// `AtmosphereLayer` applies a state: the key light (sun or moon, raised to 12° for shadows), the
// hemisphere, the fog, the background and post's exposure, tweening the hour the short way round
// over about 3 s (snapped under reduced motion and on a new table), and says when the shadow map
// must be drawn again (the key light turned half a degree, or switched body). Presentation only:
// the world look is the same for every viewer and carries no cell data.

import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
	cameraPosition,
	dot,
	exponentialHeightFogFactor,
	float,
	fog,
	max,
	min,
	mix,
	normalize,
	pmremTexture,
	positionWorld,
	pow,
	rangeFogFactor,
	smoothstep,
	uniform
} from 'three/tsl';
import { loadManifest } from '$lib/assets/load';
import type { Manifest, SkyDef } from '$lib/assets/manifest';
import { resolveSky } from '$lib/assets/sky-parse';
import type { Ambient } from '$lib/game/lights';
import { canonicalTime, DAY_MINUTES, MAX_EXPOSURE, type WorldLook } from '$lib/game/world';
import {
	atmosphereAt,
	createAtmosphereState,
	fogRange,
	PLAY_FOG_BLEND,
	PLAY_FOG_CAP,
	presetOf,
	shadowDirection,
	shadowNeedsRedraw,
	type KeyLight,
	type SkyPreset,
	type Vec3,
	type WeatherNow
} from './atmosphere-curve';

/** How long a change of hour takes to play, in ms (ease-out; snapped under reduced motion). */
export const TWEEN_MS = 3000;
/** The world's haze at its densest adds this to the fog's density (per metre). */
const HAZE_DENSITY = 0.03;
/** The flash lifts the hemisphere by this at its peak (as before #222, which reshapes it). */
const FLASH_HEMI = 1.5;
/** How much of the key light's colour the haze takes looking toward the sun, at full glow. */
const INSCATTER = 0.5;

/** The scene-level uniforms the fog and environment nodes read. */
export const atmosphereUniforms = {
	fogColor: uniform(new THREE.Color(0x292421)),
	/** The haze's colour looking straight at the sun: the fog's toward the key light's. */
	inscatter: uniform(new THREE.Color(0x292421)),
	sunDir: uniform(new THREE.Vector3(0, 1, 0)),
	fogNear: uniform(40),
	fogFar: uniform(90),
	fogDensity: uniform(0),
	fogHeight: uniform(0),
	/** The play area as a circle round its centre (xz), past which the cap lifts to 1. */
	playCenter: uniform(new THREE.Vector2()),
	playRadius: uniform(1e6),
	ibl: uniform(0)
};

/** The scene's background: the fog's colour, so the world melts into it (the dome covers it, #214). */
export const skyBackground = new THREE.Color(0x292421);

/**
 * The captured sky (#216): a cube the sky layer (sky.ts) renders into, then flags
 * `texture.needsPMREMUpdate`, so the environment node prefilters it again. Never disposed, like
 * the kinds' blank textures: every program samples it through `skyEnvNode`.
 */
export const sharedSkyCube = new THREE.CubeRenderTarget(64, { type: THREE.HalfFloatType });

// SEAM(#219, sky-light and world-modify): `skyAmbient()` from materials/world-modify.ts, the sky's
// reach per cell (0 in a dark area, the fill indoors), so a dark cell never reflects noon. Until it
// lands the sky reaches everywhere.
const skyAmbient = () => float(1);

const u = atmosphereUniforms;
const pmrem = pmremTexture(sharedSkyCube.texture);
/** The environment light: the captured sky, by the sky's strength and reach. */
export const skyEnvNode = pmrem.mul(u.ibl).mul(skyAmbient());

/** The haze warms toward the sun (Inigo Quilez's inscatter), capped over the play area. */
export const skyFogNode = (() => {
	const view = normalize(positionWorld.sub(cameraPosition));
	const colour = mix(u.fogColor, u.inscatter, pow(max(dot(view, u.sunDir), 0), 8));
	const beyond = positionWorld.xz.sub(u.playCenter).length().sub(u.playRadius);
	const cap = mix(float(PLAY_FOG_CAP), float(1), smoothstep(0, PLAY_FOG_BLEND, beyond));
	const height = exponentialHeightFogFactor(u.fogDensity, u.fogHeight) as Node<'float'>;
	return fog(colour, min(max(rangeFogFactor(u.fogNear, u.fogFar), height), cap));
})();

let boundTo: THREE.WebGPURenderer | null = null;
/**
 * The environment node prefilters with a generator of the renderer that first built it: a new
 * renderer (a lost device's rebuild, a table not adopting the lobby's) gets its own, and the sky
 * is prefiltered again. Called by `setUpRenderer` (loop.ts) for every renderer, made or adopted.
 */
export function bindSkyEnv(renderer: THREE.WebGPURenderer): void {
	if (boundTo === renderer) return;
	boundTo = renderer;
	const node = pmrem as unknown as { _generator: THREE.PMREMGenerator | null; _pmrem: unknown };
	node._generator?.dispose();
	node._generator = new THREE.PMREMGenerator(renderer);
	node._pmrem = null;
	sharedSkyCube.texture.needsPMREMUpdate = true;
}

/** A scene with the sky's fog, environment and background, set once and never replaced. */
export function createScene(): THREE.Scene {
	const scene = new THREE.Scene();
	scene.background = skyBackground;
	// Not in @types/three's Scene: the node renderer reads them (NodeManager).
	Object.assign(scene, { fogNode: skyFogNode, environmentNode: skyEnvNode });
	return scene;
}

/** A sky's preset, made once (the curve caches parsed colours per object). */
const presets = new WeakMap<object, SkyPreset>();
function presetFor(sky: SkyDef, band: Ambient): SkyPreset {
	// ponytail: an enclosed sky takes its band's key (they sit at the canonical hours) so a sunless
	// table keeps its band's light as before; the curve's first key alone once #221 tunes them.
	if (sky.kind === 'open') {
		let open = presets.get(sky);
		if (!open) presets.set(sky, (open = presetOf(sky)));
		return open;
	}
	const key = sky.keys.find((k) => k.minute === canonicalTime(band)) ?? sky.keys[0];
	let preset = presets.get(key);
	if (!preset) presets.set(key, (preset = { kind: 'enclosed', keys: [key] }));
	return preset;
}

/** The signed minutes from `from` to `to` the short way round the clock. */
export function shortWay(from: number, to: number): number {
	const d = (((to - from) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
	return d > DAY_MINUTES / 2 ? d - DAY_MINUTES : d;
}

const NO_WEATHER: WeatherNow = { kind: 'none', intensity: 0 };

export interface AtmosphereLights {
	sun: THREE.DirectionalLight;
	hemisphere: THREE.HemisphereLight;
	/** Post's exposure (post.ts), linear. */
	exposure: { value: number };
	/** The point lights and flames, which shine and flicker by the night glow. */
	lighting: { setGlow(glow: number): void };
}

export class AtmosphereLayer {
	/** The state shown now (mid-tween, the tween's). */
	readonly state = createAtmosphereState();
	private manifest: Manifest | null = null;
	private preset: SkyPreset | null = null;
	private weather: WeatherNow = NO_WEATHER;
	private look: WorldLook | null = null;
	/** The hour shown, and the tween toward `to`: null when at rest. */
	private time = 0;
	private to = 0;
	private tween: { from: number; by: number; start: number } | null = null;
	/** The key light as the shadow map was last drawn with it; null before the first. */
	private drawn: KeyLight | null = null;
	private flash = 0;
	private readonly center = new THREE.Vector3();
	private distance = 50;
	private readonly dir: Vec3 = [0, 1, 0];
	private readonly haze = new THREE.Color();

	/** A new table: its first look snaps into place (as its tokens do). */
	private fresh = true;

	/** `onReady` once the manifest, and so the skies, arrived. */
	constructor(
		private readonly lights: AtmosphereLights,
		private readonly clock: () => number,
		onReady: () => void
	) {
		void loadManifest().then((m) => {
			this.manifest = m;
			onReady();
		});
	}

	/**
	 * Aims at the world's look on this table: its sky (the look's, else the environment's, else the
	 * default; `resolveSky`), its hour (a sunless table's band's), weather, haze and exposure. A new
	 * hour plays over `TWEEN_MS` unless `snap` (reduced motion) or on a new table; the sky, weather
	 * and haze apply at once.
	 */
	setWorld(world: WorldLook | null, band: Ambient, environment: string | null, reduced: boolean) {
		const sky = this.manifest && resolveSky(world, environment, this.manifest);
		if (!sky) return;
		const snap = reduced || this.fresh;
		this.fresh = false;
		const preset = presetFor(sky.sky, band);
		const time = world?.sun ? world.time : canonicalTime(band);
		const again = preset === this.preset && world === this.look && time === this.to;
		if (again && !(snap && this.tween)) return;
		const first = !this.preset;
		this.preset = preset;
		this.look = world;
		this.weather = world?.weather ?? NO_WEATHER;
		this.to = time;
		if (snap || first) this.tween = null;
		else if (time !== this.time) {
			this.tween = { from: this.time, by: shortWay(this.time, time), start: this.clock() };
		}
		if (!this.tween) this.time = time;
		this.apply();
	}

	/** Moves a tween to `now`; whether it still plays (the frame after needs drawing). */
	tick(now: number): boolean {
		const t = this.tween;
		if (!t) return false;
		const k = Math.min(1, Math.max(0, (now - t.start) / TWEEN_MS));
		const eased = 1 - (1 - k) ** 3;
		this.time = k >= 1 ? this.to : t.from + t.by * eased;
		if (k >= 1) this.tween = null;
		this.apply();
		return !!this.tween;
	}

	/** Fits the key light and the fog to a table: its play sphere, and `extent` across. */
	fit(center: { x: number; y: number; z: number }, radius: number, extent: number): void {
		this.fresh = true;
		this.center.set(center.x, center.y, center.z);
		this.distance = radius * 2;
		u.playCenter.value.set(center.x, center.z);
		u.playRadius.value = radius;
		const range = fogRange(extent);
		u.fogNear.value = range.near;
		u.fogFar.value = range.far;
		this.lights.sun.target.position.copy(this.center);
		this.apply();
	}

	/**
	 * Whether this frame draws the shadow map, which it sets on the key light: when the table
	 * changed (`dirty`, while the light shines), the light turned `SHADOW_STEP_DEG` or switched
	 * body (`shadowDue`), or `forced`.
	 */
	shadowFrame(dirty: boolean, forced: boolean): boolean {
		const sun = this.lights.sun;
		const due = (dirty && sun.intensity > 0) || this.shadowDue() || forced;
		sun.shadow.needsUpdate = due;
		if (due) this.shadowDrawn();
		return due;
	}

	/** Whether the shadow map needs drawing for the key light as it is now (turned or switched). */
	shadowDue(): boolean {
		return shadowNeedsRedraw(this.drawn, this.state.key);
	}

	/** The shadow map was drawn with the key light as it is now. */
	private shadowDrawn(): void {
		const key = this.state.key;
		const d = (this.drawn ??= { body: key.body, dir: [0, 0, 0], color: [0, 0, 0], intensity: 0 });
		d.body = key.body;
		d.intensity = key.intensity;
		d.dir[0] = key.dir[0];
		d.dir[1] = key.dir[1];
		d.dir[2] = key.dir[2];
	}

	/**
	 * A flash of light over the table (0 none, 1 full): the sky light rises for its moment.
	 * SEAM(#222, wave 3): exposure, bloom and the sky's reach join it, shaped by `flashPolicy`.
	 */
	setFlash(k: number): void {
		if (k === this.flash) return;
		this.flash = k;
		this.apply();
	}

	private apply(): void {
		if (!this.preset) return;
		const s = atmosphereAt(this.preset, this.time, this.weather, this.state);
		const { sun, hemisphere, exposure } = this.lights;
		// The key light, from the play area's centre toward the body; never lower than 12° (shadows).
		shadowDirection(s.key.dir, this.dir);
		const [x, y, z] = this.dir;
		const d = this.distance;
		sun.position.set(this.center.x + x * d, this.center.y + y * d, this.center.z + z * d);
		sun.color.setRGB(...s.key.color);
		sun.intensity = s.key.intensity;
		// The hemisphere, with an enclosed sky's fill as light from nowhere in particular.
		const { hemi, fill, fillColor } = s;
		const all = hemi.intensity + fill;
		const w = all > 0 ? fill / all : 0;
		hemisphere.color.setRGB(...hemi.sky).lerp(this.haze.setRGB(...fillColor), w);
		hemisphere.groundColor.setRGB(...hemi.ground).lerp(this.haze, w);
		hemisphere.intensity = all + this.flash * FLASH_HEMI;
		// The fog: the curve's, thickened and tinted by the world's haze.
		const haze = this.look?.haze ?? { density: 0, color: null };
		const fogColor = u.fogColor.value.setRGB(...s.fog.color);
		if (haze.color) fogColor.lerp(this.haze.set(haze.color), haze.density);
		u.inscatter.value.copy(fogColor).lerp(this.haze.setRGB(...s.key.color), INSCATTER * s.sunGlow);
		u.sunDir.value.set(...s.sunDir);
		u.fogDensity.value = s.fog.density + haze.density * HAZE_DENSITY;
		u.fogHeight.value = s.fog.height;
		u.ibl.value = s.ibl;
		this.lights.lighting.setGlow(s.nightGlow);
		skyBackground.copy(fogColor);
		// Exposure in EV: the sky's and the look's (SEAM(#222): the flash's joins it).
		const ev = s.exposure + (this.look?.grade.exposure ?? 0);
		exposure.value = 2 ** Math.min(MAX_EXPOSURE, Math.max(-MAX_EXPOSURE, ev));
	}
}
