// The hero shadow slots' lights (#230, hero-shadows.ts has the pool): `HeroLight`, a point light
// that casts for its whole life, and its node, registered on the renderer's node library like
// GridLight's (grid-light-node.ts). The node draws the GridLights entry its `layer` names exactly
// as the GridLights draw it (`entryLight`: the falloff mirror, occlusion taps, flicker and floor),
// only on the cells whose lists hold it, times its `fade` and its cube's shadow (the light's colour
// node, its colour and intensity left at 1). The pool's cubes share one depth atlas (`HeroAtlas`, a
// row of six faces per slot), so it adds one texture to a lit fragment stage, not one per slot:
// `HeroShadowNode` draws its faces into its row, each after filling its tile with the far depth (a
// clear would clear every tile), and looks up the face the fragment's direction from the light
// falls in with the matrices it drew them with. Every slot's casters draw with one material, so a
// slot's first cube compiles nothing new after the pool's first.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { entryLight, fragmentCell, load, towardNode, type GridLight } from './grid-light-node';
import type { N } from './tsl';

const t = T as unknown as Record<string, N & ((...args: unknown[]) => N)>;

/** Where a cube starts, in cells from its light: past the fixture that holds it. */
const NEAR = 0.3;
/** How far toward the light the compared point is moved, in cells. */
const TOWARD_BIAS = 0.04;
/** The six faces: the direction each looks and its up. */
const FACES = [
	[1, 0, 0, 0, 1, 0],
	[-1, 0, 0, 0, 1, 0],
	[0, 1, 0, 0, 0, 1],
	[0, -1, 0, 0, 0, -1],
	[0, 0, 1, 0, 1, 0],
	[0, 0, -1, 0, 1, 0]
].map(([x, y, z, ux, uy, uz]) => [new THREE.Vector3(x, y, z), new THREE.Vector3(ux, uy, uz)]);

/**
 * The cubes' depth atlas: a row of six faces per slot, and the matrices and positions they were
 * drawn with, one uniform buffer each for the whole pool (a buffer per light took instanced lit
 * stages past WebGPU's 12 uniform buffers a stage on high, so the raised ground's failed to build).
 */
export class HeroAtlas {
	readonly target: THREE.RenderTarget;
	readonly depth: THREE.DepthTexture;
	/** Each slot's six face matrices (bias × projection × view) as its cube was last drawn. */
	readonly faces: ReturnType<typeof T.uniformArray>;
	// An array (its own buffer), not a vec3 uniform: vector uniforms in a light's object block read
	// back wrong on the WebGL2 backend (r186), as GridLight's slot uniforms did as vec4s.
	/** Where each slot's cube was last drawn from. */
	readonly drawnAt: ReturnType<typeof T.uniformArray>;

	constructor(
		readonly slots: number,
		readonly size: number
	) {
		this.depth = new THREE.DepthTexture(6 * size, slots * size);
		this.depth.name = 'HeroShadowAtlas';
		this.depth.compareFunction = THREE.LessEqualCompare;
		// The colour no one reads, one byte a texel: a render target always has one.
		this.target = new THREE.RenderTarget(6 * size, slots * size, { format: THREE.RedFormat });
		this.target.depthTexture = this.depth;
		const faces = Array.from({ length: slots * FACES.length }, () => new THREE.Matrix4());
		this.faces = T.uniformArray(faces, 'mat4');
		this.drawnAt = T.uniformArray(
			Array.from({ length: slots }, () => new THREE.Vector4()),
			'vec4'
		);
	}

	/** Bytes the cubes hold on the GPU (32-bit depth). */
	get bytes(): number {
		return this.slots * 6 * this.size * this.size * 4;
	}
}

/** One slot: a point light that casts for its whole life, drawn from a GridLights entry. */
export class HeroLight extends THREE.PointLight {
	readonly isHeroLight = true;
	/** The entry it draws, as its 1-based layer in the GridLight's data (0 while free). */
	readonly layer = T.uniform(0);
	/** How far it has faded in: its share of its entry's light (0 while free). */
	readonly fade = T.uniform(0);

	constructor(
		readonly grid: GridLight,
		readonly atlas: HeroAtlas,
		readonly slot: number
	) {
		super(0xffffff, 1, 1, 0);
		this.castShadow = true;
		this.shadow.autoUpdate = false;
		this.shadow.mapSize.set(atlas.size, atlas.size);
	}
}

/** Maps a clip position to the atlas: x and y to 0-1, and z to 0-1 on WebGL2 (it is on WebGPU). */
function biasFor(system: number): THREE.Matrix4 {
	const z = system === THREE.WebGLCoordinateSystem ? [0.5, 0.5] : [1, 0];
	return new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, z[0], z[1], 0, 0, 0, 1);
}

/** Fills a face's tile with the far depth before its casters draw (a clear would clear them all). */
const clearScene = new THREE.Scene();
{
	const material = new THREE.NodeMaterial();
	material.name = 'HeroShadowClear';
	material.vertexNode = t.vec4((T.positionGeometry as unknown as N).xy, 1, 1) as never;
	material.colorNode = t.vec4(0, 0, 0, 1) as never;
	material.depthFunc = THREE.AlwaysDepth;
	const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
	quad.frustumCulled = false;
	quad.castShadow = true; // drawn by the shadow pass's object filter
	clearScene.add(quad);
}

/** Every slot's casters draw with this one material, so a slot's first cube compiles nothing new. */
const casterMaterial = new THREE.NodeMaterial();
casterMaterial.name = 'HeroShadowCaster';
casterMaterial.colorNode = t.vec4(0, 0, 0, 1) as never;
(casterMaterial as unknown as { isShadowPassMaterial: boolean }).isShadowPassMaterial = true;
casterMaterial.blending = THREE.NoBlending;
casterMaterial.fog = false;

const lightAt = new THREE.Vector3();
const lookAt = new THREE.Vector3();

class HeroShadowNode extends THREE.ShadowNode {
	static get type() {
		return 'HeroShadowNode';
	}

	private get hero(): HeroLight {
		return (this as unknown as { light: HeroLight }).light;
	}

	getShadowMaterial() {
		return casterMaterial;
	}

	disposeShadowMaterial() {}

	/** The shared atlas: one texture for the whole pool. */
	setupRenderTarget() {
		const { target, depth } = this.hero.atlas;
		return { shadowMap: target, depthTexture: depth };
	}

	/** The fragment's world position, off its normal (the shadow matrix stays the identity). */
	setupShadowCoord(_builder: THREE.NodeBuilder, position: N) {
		return position;
	}

	/** Compares against the face of the atlas row the fragment's direction from the light falls in. */
	setupShadowFilter(_builder: THREE.NodeBuilder, inputs: { depthTexture: THREE.DepthTexture }) {
		const { shadowCoord } = inputs as unknown as { shadowCoord: N };
		const hero = this.hero;
		const { slots, size } = hero.atlas;
		const cell = hero.grid.cellSize as unknown as N;
		const { faces, drawnAt } = hero.atlas as unknown as { faces: N; drawnAt: N };
		const from = drawnAt.element(hero.slot).xyz;
		const p0 = shadowCoord.xyz;
		const p = p0.add(from.sub(p0).normalize().mul(cell.mul(TOWARD_BIAS)));
		const v = p.sub(from);
		const a = v.abs();
		const sign = (c: N, i: number) => c.greaterThan(0).select(t.int(i), t.int(i + 1));
		const xMajor = a.x.greaterThanEqual(a.y).and(a.x.greaterThanEqual(a.z));
		const face = xMajor.select(
			sign(v.x, 0),
			a.y.greaterThanEqual(a.z).select(sign(v.y, 2), sign(v.z, 4))
		);
		const clip = faces.element(face.add(hero.slot * FACES.length)).mul(t.vec4(p, 1));
		const s = clip.xyz.div(clip.w);
		const inset = 1 / size; // the filter's taps stay on this face's tile
		const u = t.clamp(s.x, inset, 1 - inset);
		const w = t.clamp(s.y.oneMinus(), inset, 1 - inset);
		const uv = t.vec2(t.float(face).add(u).div(6), w.add(hero.slot).div(slots));
		return (T.texture(inputs.depthTexture, uv as never) as unknown as N).compare(t.min(s.z, 1));
	}

	/** Draws the six faces into this slot's row, each after filling its tile with the far depth. */
	renderShadow(frame: { renderer: THREE.Renderer; scene: THREE.Scene }) {
		const { renderer, scene } = frame;
		const hero = this.hero;
		const { target, size } = hero.atlas;
		const camera = (this as unknown as { shadow: THREE.PointLightShadow }).shadow
			.camera as THREE.PerspectiveCamera;
		const cell = hero.grid.cellSize.value;
		hero.updateMatrixWorld();
		lightAt.setFromMatrixPosition(hero.matrixWorld);
		(hero.atlas.drawnAt as unknown as { array: THREE.Vector4[] }).array[hero.slot].set(
			lightAt.x,
			lightAt.y,
			lightAt.z,
			1
		);
		camera.fov = 90;
		camera.aspect = 1;
		camera.near = NEAR * cell;
		camera.far = hero.distance;
		camera.updateProjectionMatrix();
		const bias = biasFor(camera.coordinateSystem);
		const autoClear = renderer.autoClear;
		renderer.autoClear = false;
		FACES.forEach(([dir, up], f) => {
			target.viewport.set(f * size, hero.slot * size, size, size);
			camera.position.copy(lightAt);
			camera.up.copy(up);
			camera.lookAt(lookAt.copy(lightAt).add(dir));
			camera.updateMatrixWorld();
			const faces = (hero.atlas.faces as unknown as { array: THREE.Matrix4[] }).array;
			const m = faces[hero.slot * FACES.length + f];
			m.multiplyMatrices(bias, camera.projectionMatrix).multiply(camera.matrixWorldInverse);
			renderer.render(clearScene, camera);
			renderer.render(scene, camera);
		});
		target.viewport.set(0, 0, target.width, target.height);
		renderer.autoClear = autoClear;
	}
}

class HeroLightNode extends THREE.PointLightNode {
	static get type() {
		return 'HeroLightNode';
	}

	setupShadowNode() {
		const light = (this as unknown as { light: HeroLight }).light;
		return new HeroShadowNode(light, light.shadow) as never;
	}

	/**
	 * The slot's entry as the GridLights draw it (only on the cells that list it), times its fade
	 * and the light's colour node: its cube's shadow where the object takes shadows, else 1.
	 */
	setupDirect() {
		const hero = (this as unknown as { light: HeroLight }).light;
		const colorNode = (this as unknown as { colorNode: N }).colorNode;
		const grid = hero.grid;
		const k = grid.k;
		const index = t.int(hero.layer);
		const li = t.max(index.sub(1), 0);
		const Fn = t.Fn as unknown as (f: () => N) => () => N;
		const colour = Fn(() => {
			const { cell, c, inside } = fragmentCell(grid);
			let listed: N = t.float(0);
			for (let j = 0; j < k / 4; j++) {
				const texel = load(grid.lists, c.x.mul(k / 4).add(j), c.y);
				const m = t.max(t.round(texel.mul(255)).sub(t.float(index)).abs().oneMinus(), 0);
				listed = t.max(listed, t.max(t.max(m.x, m.y), t.max(m.z, m.w)));
			}
			// Only where the slot's light is listed (none while free): elsewhere, nothing to work out.
			const lit = t.vec3(0).toVar();
			t.If(inside.and(listed.greaterThan(0.5)).and(index.greaterThan(0)), () => {
				lit.assign(entryLight(grid, cell, li).colour);
			});
			return lit;
		})();
		// The GridLight's own colour and intensity, which scale every point light.
		const all = t.reference('color', 'color', grid).mul(t.reference('intensity', 'float', grid));
		const at = load(grid.data, t.int(0), li);
		// The light's colour node is its cube's shadow (its colour and intensity stay 1).
		const lit = colorNode.mul(colour).mul(all).mul(hero.fade);
		return { lightDirection: towardNode(at), lightColor: lit } as never;
	}
}

const registered = new WeakSet<object>();

/** Maps HeroLight to its node on a renderer: before its first compile, once each. */
export function registerHeroLights(renderer: THREE.WebGPURenderer): void {
	if (registered.has(renderer.library)) return;
	registered.add(renderer.library);
	renderer.library.addLight(HeroLightNode as never, HeroLight as never);
}
