// The sky (#214) and the environment captured from it (#216). A dome round the camera, pinned to
// the far plane: a zenith, horizon and ground gradient, the sun's disc and glow, the moon as a lit
// sphere impostor (its phase is where the sun stands), a cloud layer (the fbm of three's
// `SkyMesh.js`) and, apart, one instanced draw of seeded stars. Everything that varies is a
// uniform fed from `AtmosphereState` (atmosphere-curve.ts), so no hour, sky or weather compiles
// anything; the low tier keeps the objects but hides them, and the scene's background (the horizon
// colour) shows instead.
//
// It is not the world: it reads no cell map and writes "shown" to the scene pass's `hidden`
// attachment (as dice do, dice3d.ts), so the output stage's re-mask never stamps unexplored ground
// on it; and fog is off on it. Built only from the world look every viewer receives.
//
// The environment: `capture` renders `envScene` (a second dome sharing this one's geometry and
// material, and nothing else, so no geometry of the table can ever show in a reflection) into
// `SKY_CUBE`, which three's PMREM re-filters on the next frame. The target and camera are the
// module's, never disposed (like the blank textures), so every renderer's environment node reads
// one texture from its first frame. When to capture is `CaptureThrottle` (sky-maths.ts).

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { mrt, output, vec4 } from 'three/tsl';
import type { AtmosphereState } from './atmosphere-curve';
import type { N } from './materials/tsl';
import type { Tier } from './quality';
import { STAR_COUNT, STAR_COUNTS, starField } from './sky-maths';
import { standIn } from './warmup';

type Loose = N & ((...args: unknown[]) => N);
const L = T as unknown as Record<string, Loose>;
const { float, vec2, vec3, mix, smoothstep, pow, max, dot, normalize, exp, sin, sqrt } = L;
const { floor, fract, length, clamp, step, Fn, If, Loop, uv, instancedBufferAttribute } = L;
const v4 = L.vec4;
const n = (x: unknown) => x as N;
const fn = (body: (args: N[]) => unknown) => Fn(body) as unknown as Loose;

/** The environment's cube: 64 px, half float, never disposed. */
export const SKY_CUBE = new THREE.CubeRenderTarget(64, { type: THREE.HalfFloatType });
// Without an MRT set, a material's `mrtNode` is its whole output: this names the one attachment.
SKY_CUBE.texture.name = 'output';
const cubeCamera = new THREE.CubeCamera(0.1, 10, SKY_CUBE);

/** The sky is not the world: "shown" in the scene pass's `hidden` attachment, like dice. */
const SHOWN = mrt({ output, hidden: vec4(0, 0, 0, output.a) });

/** The moon's angular radius in radians (larger than life, as a miniature's would be). */
const MOON_R = 0.03;
const MOON_TINT = [0.92, 0.94, 1] as const;
/** The moon's brightness by day and in the dark (blended by the grade's dark weight). */
const MOON_DAY = 0.25;
const MOON_NIGHT = 1.4;
/** How far stars dim at the bottom of a twinkle. */
const TWINKLE = 0.35;
/** Stars stand this share of the camera's far plane away: inside it, behind everything drawn. */
const STAR_REACH = 0.95;
const STAR_SEED = 0x5ca1ab1e;

function skyUniforms() {
	return {
		zenith: T.uniform(new THREE.Color()),
		horizon: T.uniform(new THREE.Color()),
		ground: T.uniform(new THREE.Color()),
		sunDir: T.uniform(new THREE.Vector3(0, 1, 0)),
		sunColor: T.uniform(new THREE.Color(1, 1, 1)),
		sunGlow: T.uniform(0),
		moonDir: T.uniform(new THREE.Vector3(0, -1, 0)),
		moonBright: T.uniform(0),
		clouds: T.uniform(0),
		stars: T.uniform(0),
		/** Twinkle depth: 0 under reduced motion. */
		twinkle: T.uniform(TWINKLE),
		/** The stars' turn about the vertical with the hour, as (cos, sin). */
		starTurn: T.uniform(new THREE.Vector2(1, 0)),
		/** Seconds on the wall clock, held still under reduced motion: the clouds' drift, the twinkle. */
		skyTime: T.uniform(0),
		/** 1 while capturing the environment: no sun disc (it sparkles in rough reflections). */
		capture: T.uniform(0),
		/** An enclosed sky's rock (#221): 0 under open skies. */
		shell: T.uniform(0)
	};
}
export type SkyUniforms = ReturnType<typeof skyUniforms>;

// Clouds: the hash, gradient noise and fbm of three's SkyMesh.js (sinless, so every GPU agrees).
const gradient = fn(([i]: N[]) => {
	const p = fract(i.xyx.mul(vec3(0.1031, 0.103, 0.0973))).toVar();
	p.addAssign(dot(p, p.yzx.add(33.33)));
	return fract(p.xx.add(p.yz).mul(p.zy)).mul(2).sub(1);
});
const noise = fn(([p]: N[]) => {
	const i = floor(p);
	const f = fract(p);
	const u = f
		.mul(f)
		.mul(f)
		.mul(f.mul(f.mul(6).sub(15)).add(10));
	const a = dot(gradient(i), f);
	const b = dot(gradient(i.add(vec2(1, 0))), f.sub(vec2(1, 0)));
	const c = dot(gradient(i.add(vec2(0, 1))), f.sub(vec2(0, 1)));
	const d = dot(gradient(i.add(vec2(1, 1))), f.sub(vec2(1, 1)));
	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y).mul(1.6);
});
const fbm = fn(([position, drift]: N[]) => {
	const p = vec2(position).toVar();
	const result = float(0).toVar();
	const amplitude = float(1).toVar();
	Loop(4, () => {
		result.addAssign(amplitude.mul(noise(p)));
		amplitude.mulAssign(0.5);
		p.mulAssign(2).addAssign(drift);
	});
	return result;
});

/**
 * The dome's vertices: its unit sphere round the camera (through its world matrix, so a warm-up
 * stand-in shrinks to nothing far below), pinned to the far plane as SkyMesh does.
 */
function farDome(): N {
	const world = n(T.modelWorldMatrix).mul(v4(n(T.positionGeometry), 1)).xyz;
	const at = world.add(n(T.cameraPosition));
	const clip = n(T.cameraProjectionMatrix).mul(n(T.cameraViewMatrix)).mul(v4(at, 1));
	return v4(clip.xy, clip.w, clip.w);
}

function domeColour(u: SkyUniforms): N {
	const [zenith, horizon, ground] = [n(u.zenith), n(u.horizon), n(u.ground)];
	const [sunDir, sunColor, sunGlow] = [n(u.sunDir), n(u.sunColor), n(u.sunGlow)];
	const [moonDir, clouds, time] = [n(u.moonDir), n(u.clouds), n(u.skyTime)];
	return fn(() => {
		const v = normalize(n(T.positionGeometry));
		const up = v.y;
		// Gradient: no hard line at the horizon, the ground below it.
		const above = mix(horizon, zenith, pow(smoothstep(0, 1, max(up, 0)), 0.5));
		const below = mix(horizon, ground, smoothstep(0, 0.25, up.negate()));
		const col = mix(below, above, smoothstep(-0.005, 0.005, up)).toVar();
		const shellNoise = noise(v.xz.mul(4).add(v.yy.mul(2.3)))
			.mul(0.5)
			.add(0.5);
		col.mulAssign(float(1).sub(n(u.shell).mul(0.6).mul(shellNoise)));
		const rim = smoothstep(-0.05, 0.02, up);
		// The sun: a wide glow and a tight one, and an HDR disc bloom catches.
		const toSun = dot(v, sunDir);
		const c = max(toSun, 0);
		const glow = pow(c, 6).mul(0.12).add(pow(c, 64).mul(0.5));
		const disc = smoothstep(0.99955, 0.9997, toSun)
			.mul(16)
			.mul(float(1).sub(n(u.capture)));
		col.addAssign(sunColor.mul(glow.add(disc).mul(sunGlow).mul(rim)));
		// The moon: a sphere facing the camera, lit from the sun (its phase for free).
		const along = dot(v, moonDir);
		const o = v.sub(moonDir.mul(along)).div(MOON_R);
		const r2 = dot(o, o);
		const inside = float(1)
			.sub(smoothstep(0.9, 1, r2))
			.mul(step(0, along));
		const normal = o.sub(moonDir.mul(sqrt(max(float(1).sub(r2), 0))));
		const lit = max(dot(normal, sunDir), 0).add(0.04);
		const moon = vec3(...MOON_TINT).mul(lit.mul(n(u.moonBright)).mul(inside).mul(rim));
		col.addAssign(moon);
		// Clouds over both, drifting on `skyTime`.
		If(up.greaterThan(0).and(clouds.greaterThan(0)), () => {
			const p = v.xz
				.div(up.mul(0.55))
				.mul(0.2)
				.add(vec2(time.mul(0.004), time.mul(0.0015)));
			const field = fbm(p, time.mul(0.0012)).mul(0.7).add(0.5).clamp(0, 1).toVar();
			const region = noise(p.mul(0.3)).mul(0.37).add(0.5);
			const cover = clamp(clouds.add(region.sub(0.5).mul(0.6)), 0, 1);
			const threshold = float(1).sub(cover).toVar();
			const fade = smoothstep(0, 0.08, up);
			const depth = max(field.sub(threshold), 0).toVar();
			const beer = exp(depth.mul(-4));
			const shade = mix(
				0.45,
				1,
				beer
					.mul(float(1).sub(beer.mul(beer)))
					.mul(2.6)
					.clamp(0, 1)
			);
			const sunLight = smoothstep(-0.08, 0.3, sunDir.y);
			const base = mix(horizon, zenith, 0.3).mul(0.9);
			const cloud = base.add(sunColor.mul(shade).mul(sunLight).mul(0.35));
			const alpha = float(1)
				.sub(exp(depth.mul(-7)))
				.mul(fade);
			col.assign(mix(col, cloud, alpha));
		});
		return v4(col, 1);
	})();
}

function domeMaterial(u: SkyUniforms): THREE.NodeMaterial {
	// A plain node material: no lights, and no environment (it is what the environment is made of).
	const material = new THREE.NodeMaterial();
	material.name = 'sky dome';
	material.side = THREE.BackSide;
	material.depthWrite = false;
	material.fog = false;
	// Transparent, so the opaque prepass (normals, velocity) leaves it out; its alpha is always 1.
	material.transparent = true;
	material.vertexNode = farDome() as never;
	material.colorNode = domeColour(u) as never;
	material.mrtNode = SHOWN;
	return material;
}

function starMaterial(u: SkyUniforms): THREE.PointsNodeMaterial {
	const field = starField(STAR_SEED, STAR_COUNT);
	const dir = instancedBufferAttribute(field.directions, 'vec3');
	const size = instancedBufferAttribute(field.sizes, 'float');
	const tint = instancedBufferAttribute(field.colors, 'vec3');
	const turn = n(u.starTurn);
	const d = vec3(
		dir.x.mul(turn.x).sub(dir.z.mul(turn.y)),
		dir.y,
		dir.x.mul(turn.y).add(dir.z.mul(turn.x))
	);
	const phase = dir.x.mul(91.7).add(dir.z.mul(47.3));
	const twinkle = sin(n(u.skyTime).mul(2.3).add(phase)).mul(0.5).add(0.5);
	const round = float(1).sub(smoothstep(0.2, 0.5, length(uv().sub(0.5))));
	const material = new THREE.PointsNodeMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		sizeAttenuation: false,
		fog: false
	});
	material.name = 'sky stars';
	const reach = n(T.cameraFar).mul(STAR_REACH);
	material.positionNode = d.mul(reach).add(n(T.cameraPosition)) as never;
	material.sizeNode = size as never;
	material.colorNode = tint as never;
	const fade = smoothstep(-0.02, 0.12, d.y);
	const dim = float(1).sub(n(u.twinkle).mul(twinkle));
	material.opacityNode = n(u.stars).mul(fade).mul(dim).mul(round) as never;
	material.mrtNode = SHOWN;
	return material;
}

/** Nothing picks the sky, and it is everywhere, so never culled. */
function unpickable<O extends THREE.Object3D>(o: O, order: number): O {
	o.raycast = () => {};
	o.frustumCulled = false;
	o.renderOrder = order;
	return o;
}

export class SkyLayer {
	/** The dome and the stars, for the scene. */
	readonly group = new THREE.Group();
	/** What only the environment is captured from: the dome again, and nothing else. */
	readonly envScene = new THREE.Scene();
	/** The horizon colour: the scene's background, what shows where the dome is hidden (low). */
	readonly background = new THREE.Color();
	readonly uniforms = skyUniforms();
	readonly dome: THREE.Mesh;
	readonly stars: THREE.Sprite;
	private readonly geometry = new THREE.SphereGeometry(1, 32, 16);
	private readonly domeMaterial: THREE.NodeMaterial;
	private readonly starMaterial: THREE.PointsNodeMaterial;
	private readonly standIns: THREE.Object3D[];
	private shown = true;
	private reduced = false;

	constructor() {
		this.domeMaterial = domeMaterial(this.uniforms);
		this.starMaterial = starMaterial(this.uniforms);
		// Drawn first among the transparent, behind everything else there.
		this.dome = unpickable(new THREE.Mesh(this.geometry, this.domeMaterial), -2);
		this.stars = unpickable(new THREE.Sprite(this.starMaterial as THREE.SpriteNodeMaterial), -1);
		this.stars.count = STAR_COUNT;
		this.dome.name = this.stars.name = 'sky';
		this.group.add(this.dome, this.stars);
		this.envScene.name = 'pmrem';
		this.envScene.add(unpickable(new THREE.Mesh(this.geometry, this.domeMaterial), -2));
		this.standIns = [
			standIn(new THREE.Mesh(this.geometry, this.domeMaterial)),
			standIn(new THREE.Sprite(this.starMaterial as THREE.SpriteNodeMaterial))
		];
		this.stars.visible = false;
	}

	/** The sky at an hour, a sky and a weather: uniforms only. */
	apply(s: AtmosphereState): void {
		const u = this.uniforms;
		u.zenith.value.setRGB(...s.zenith);
		u.horizon.value.setRGB(...s.horizon);
		u.ground.value.setRGB(...s.ground);
		this.background.setRGB(...s.horizon);
		u.sunDir.value.set(...s.sunDir);
		// The key's colour is the moon's below the handover; the sun keeps its last there.
		if (s.key.body === 'sun') u.sunColor.value.setRGB(...s.key.color);
		u.sunGlow.value = s.sunGlow;
		u.moonDir.value.set(...s.moonDir);
		u.moonBright.value = MOON_DAY + (MOON_NIGHT - MOON_DAY) * s.lut.dark;
		u.clouds.value = s.clouds;
		u.stars.value = s.stars;
		const turn = Math.atan2(s.sunDir[0], s.sunDir[2]);
		u.starTurn.value.set(Math.cos(turn), Math.sin(turn));
		this.stars.visible = this.shown && s.stars > 0;
	}

	/** The wall clock (ms), set on frames drawn anyway: the sky never asks for a frame. */
	setTime(ms: number): void {
		if (!this.reduced) this.uniforms.skyTime.value = (ms / 1000) % 100_000;
	}

	/** Under reduced motion stars don't twinkle and clouds hold still. */
	setReducedMotion(on: boolean): void {
		this.reduced = on;
		this.uniforms.twinkle.value = on ? 0 : TWINKLE;
	}

	/**
	 * The tier, and the `sky` layer (`?off=sky`): low (and so compat WebGPU and software GL) hides
	 * the dome for the background colour. Visibility and a count only: nothing compiles.
	 */
	setTier(tier: Tier, on = true): void {
		this.shown = on && tier !== 'low';
		this.dome.visible = this.shown;
		this.stars.visible = this.shown && this.uniforms.stars.value > 0;
		this.stars.count = Math.max(1, STAR_COUNTS[tier]);
	}

	/** Stand-ins for the warm-up's gallery (warmup.ts), so showing the sky later compiles nothing. */
	gallery(): THREE.Object3D[] {
		return this.standIns;
	}

	/**
	 * Captures the sky into `SKY_CUBE` (no sun disc), as the pipeline's passes draw: linear, no
	 * tone mapping, no MRT. PMREM re-filters it on the next frame drawn with it.
	 */
	capture(renderer: THREE.WebGPURenderer): void {
		const { toneMapping, outputColorSpace } = renderer;
		const outputs = renderer.getMRT();
		renderer.toneMapping = THREE.NoToneMapping;
		renderer.outputColorSpace = THREE.ColorManagement.workingColorSpace;
		renderer.setMRT(null);
		this.uniforms.capture.value = 1;
		try {
			cubeCamera.update(renderer, this.envScene);
		} finally {
			this.uniforms.capture.value = 0;
			renderer.setMRT(outputs);
			renderer.toneMapping = toneMapping;
			renderer.outputColorSpace = outputColorSpace;
		}
	}

	/** Frees this layer's geometry and materials; `SKY_CUBE` stays. */
	dispose(): void {
		this.group.removeFromParent();
		this.geometry.dispose();
		this.domeMaterial.dispose();
		this.starMaterial.dispose();
	}
}
