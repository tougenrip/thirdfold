// GridLights (#227's choice, #228): every point light on the table drawn from per-cell light lists
// and per-light polar occlusion rows (grid-lights.ts), as one custom light registered on the node
// library like `SkyLight` (sky-light.ts). Every lit fragment reads its cell's K-entry list with
// `textureLoad` (no compute, no storage buffers: one graph on WebGL2 and WebGPU), then for each
// light its data and three taps of its occlusion row, and adds the light through the lighting
// model (`LightsNode.setupDirectLight`), as r186's ClusteredLightsNode does per cluster. Its
// brightness is the TSL mirror of `lightFalloff` (game/lights.ts): the rules window on the
// horizontal distance from the rule origin, the body and hot core on the 3D distance from the
// visual position, never below `READABLE_EDGE` on a listed cell, so every cell the rules light
// reads and no other gets any. The set of light objects never changes (one GridLight per scene,
// per K: a tier with another K swaps it, which is a new program, like any tier switch), so lights
// coming and going only change texture data, and a light that changes uploads only its own layer.
// Not dimmed by the rules' darkness: the lights are where the light is (KindLightingModel). Each
// light wavers by its flicker profile and phase (#231, materials/flicker.ts): numbers, no program.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { CORE_MAX, CORE_RADIUS, LIGHT_DECAY, READABLE_EDGE } from '$lib/game/lights';
import type { SquareGrid } from '$lib/game/grid';
import { flickerNode } from './flicker';
import type { N } from './tsl';
import {
	DATA_TEXELS,
	GRID_LIGHT_CAPACITY,
	LIGHT_TEXELS,
	packLight,
	ROW_ANGLES,
	type LightEntry
} from '../grid-lights';

/** Cells per side the list texture holds: scene-file.ts's GRID_LIMITS.maxCells. */
const MAX_SIDE = 100;
/** Occlusion taps per light: the fragment's angle and one either side. */
const TAPS = [-1, 0, 1];
/** How far past the row's distance still counts as lit, in cells (the wall face's own side). */
const ROW_EPS = 0.02;
/** How far along its normal a fragment looks up its cell, in cells (each wall face its side). */
const NORMAL_LOOKUP = 0.3;

const t = T as unknown as Record<string, N & ((...args: unknown[]) => N)>;

/** A float array texture, `width` texels by `layers`, read with `textureLoad` only. */
function layered<A extends Float32Array | Uint8Array>(array: A, width: number, layers: number) {
	const texture = new THREE.DataArrayTexture(array, width, 1, layers);
	texture.type = array instanceof Float32Array ? THREE.FloatType : THREE.UnsignedByteType;
	texture.format = THREE.RGBAFormat;
	texture.magFilter = texture.minFilter = THREE.NearestFilter;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	return texture;
}

/** The one light that stands for every point light on the table. */
export class GridLight extends THREE.Light {
	readonly isGridLight = true;
	/**
	 * Data and occlusion rows in one RGBA32F array texture, a layer per light (`packLight`): two
	 * textures in all, not three, keep the largest fragment stage at 15 sampled textures (WebGPU's
	 * default limit is 16, docs/RENDERING.md "Many lights").
	 */
	readonly data = layered(
		new Float32Array(LIGHT_TEXELS * 4 * GRID_LIGHT_CAPACITY),
		LIGHT_TEXELS,
		GRID_LIGHT_CAPACITY
	);
	/** K light indices per cell, four to an RGBA8 texel, a layer per grid row. */
	readonly lists: THREE.DataArrayTexture;
	readonly gridSize = T.uniform(new THREE.Vector2(1, 1));
	readonly cellSize = T.uniform(1);
	/**
	 * The hero shadow slots (#230, hero-shadows.ts): each slot's light as its 1-based layer (0
	 * free) and how far it has faded in, the share of that light the slot draws instead. Uniforms,
	 * not the data's `hero` flag, so a handover's fade uploads nothing.
	 */
	readonly heroIndex = [0, 1, 2, 3].map(() => T.uniform(0));
	readonly heroFade = [0, 1, 2, 3].map(() => T.uniform(0));

	/** `k`, light indices per cell (a multiple of 4), is fixed: another K is another GridLight. */
	constructor(readonly k: number) {
		super(0xffffff, 1);
		this.lists = layered(new Uint8Array(MAX_SIDE * k * MAX_SIDE), (MAX_SIDE * k) / 4, MAX_SIDE);
	}

	/** Light `index`'s data and row, uploaded (its layer only) before the next frame. */
	setLight(index: number, entry: LightEntry | null, row: Float32Array | null): void {
		const out = this.data.image.data as unknown as Float32Array;
		const at = index * LIGHT_TEXELS * 4;
		if (entry && row) packLight(entry, row, out, at);
		else out.fill(0, at, at + LIGHT_TEXELS * 4);
		this.data.addLayerUpdate(index);
		this.data.needsUpdate = true;
	}

	/** The cells' lists (`buildLists`' layout, `k` per cell): only the grid rows that changed upload. */
	setLists(grid: SquareGrid, lists: Uint8Array): void {
		const out = this.lists.image.data as unknown as Uint8Array;
		const [w, stride] = [grid.width * this.k, MAX_SIDE * this.k];
		const next = new Uint8Array(stride);
		for (let y = 0; y < MAX_SIDE; y++) {
			next.fill(0);
			if (y < grid.height) next.set(lists.subarray(y * w, y * w + w));
			const row = out.subarray(y * stride, y * stride + stride);
			if (row.every((v, i) => v === next[i])) continue;
			row.set(next);
			this.lists.addLayerUpdate(y);
		}
		this.gridSize.value.set(grid.width, grid.height);
		this.cellSize.value = grid.cellSize;
		if (this.lists.layerUpdates.size) this.lists.needsUpdate = true;
	}

	dispose(): void {
		this.data.dispose();
		this.lists.dispose();
		super.dispose();
	}
}

type Builder = THREE.NodeBuilder & {
	context: { reflectedLight: Record<'directDiffuse' | 'directSpecular', N> };
	lightsNode: { setupDirectLight(b: unknown, node: unknown, data: unknown): void };
};

/**
 * The TSL mirror of `lightFalloff` (game/lights.ts), in cells: the rules window on `dxz` from the
 * rule origin, times the body and hot core on `d3` from the visual position.
 */
export function falloffNode(dxz: N, reach: N, d3: N): N {
	// Squares as products, not `pow` (cheaper on the integrated GPUs); the decay is a constant.
	const r2 = dxz.div(reach).toVar();
	const q = r2.mul(r2).mul(r2.mul(r2));
	const open = t.max(q.oneMinus(), 0);
	const far = t.max(d3, CORE_RADIUS);
	const body = LIGHT_DECAY === 1 ? far.reciprocal() : far.pow(-LIGHT_DECAY);
	const near = t.div(CORE_RADIUS, t.max(d3, 1e-3));
	const core = t.clamp(near.mul(near), 1, CORE_MAX);
	return open.mul(open).mul(body).mul(core);
}

/** Reads texel `x` of layer `layer` of one of a GridLight's array textures. */
export const load = (texture: THREE.Texture, x: N, layer: N): N =>
	t.textureLoad(texture, t.ivec2(x, 0)).depth(layer);

/**
 * The fragment's cell on `light`'s grid, looked up a little along its normal (each wall face its
 * own side): in cells (`cell`, a cell's centre at + 0.5), as integers (`c`), and whether it is on
 * the grid. Inside a `Fn` (it declares variables).
 */
export function fragmentCell(light: GridLight): { cell: N; c: N; inside: N } {
	const cellSize = light.cellSize as unknown as N;
	const gridSize = light.gridSize as unknown as N;
	const p = t.positionWorld.add(t.normalWorld.mul(cellSize.mul(NORMAL_LOOKUP)));
	const cell = p.xz.div(cellSize).add(gridSize.mul(0.5)).toVar();
	const c = t.ivec2(t.floor(cell)).toVar();
	const inside = c.x
		.greaterThanEqual(0)
		.and(c.y.greaterThanEqual(0))
		.and(c.x.lessThan(t.int(gridSize.x)))
		.and(c.y.lessThan(t.int(gridSize.y)));
	return { cell, c, inside };
}

/**
 * Light `li`'s (its 0-based layer) light on the fragment at `cell`: where it is drawn from
 * (`at`: xyz, reach in w), its data's colour texel (`col`: rgb, flags in w), and the colour it
 * lends (`colour`): the falloff, three occlusion taps and the flicker, never below READABLE_EDGE.
 */
export function entryLight(light: GridLight, cell: N, li: N): { at: N; col: N; colour: N } {
	const at = load(light.data, t.int(0), li);
	const col = load(light.data, t.int(1), li);
	const rule = load(light.data, t.int(2), li);
	const rel = cell.sub(rule.xy);
	const d = rel.length();
	const turn = t
		.atan(rel.y, rel.x)
		.mul(ROW_ANGLES / (2 * Math.PI))
		.add(ROW_ANGLES + 0.5);
	const angle = t.int(t.floor(turn));
	let occ: N = t.float(0);
	for (const o of TAPS) {
		const a = angle.add(o).mod(ROW_ANGLES);
		const row = load(light.data, a.div(4).add(DATA_TEXELS), li).element(a.mod(4));
		occ = occ.add(t.step(d, row.add(ROW_EPS)));
	}
	const d3 = t.positionWorld.distance(at.xyz).div(light.cellSize as unknown as N);
	// The flicker (#231) scales the light, never its floor at READABLE_EDGE.
	const flicker = flickerNode(rule.z, rule.w);
	const lit = falloffNode(d, at.w, d3).mul(occ.div(TAPS.length)).mul(flicker);
	return { at, col, colour: col.rgb.mul(t.max(lit, READABLE_EDGE)) };
}

/** The light's direction from the fragment toward `at` (world), in view space. */
export const towardNode = (at: N): N =>
	t.cameraViewMatrix.mul(t.vec4(at.xyz, 1)).xyz.sub(t.positionView).normalize();

class GridLightNode extends THREE.AnalyticLightNode<THREE.Light> {
	static get type() {
		return 'GridLightNode';
	}

	/** Overridden whole: three's shadow setup for the light never runs (it casts none). */
	setup(builder: THREE.NodeBuilder) {
		const b = builder as Builder;
		const light = (this as unknown as { light: GridLight }).light;
		const colorNode = (this as unknown as { colorNode: N }).colorNode;
		const { directDiffuse, directSpecular } = b.context.reflectedLight;
		directDiffuse.toStack();
		directSpecular.toStack();
		const k = light.k;
		const heroIndex = light.heroIndex as unknown as N[];
		const heroFade = light.heroFade as unknown as N[];
		(t.Fn as unknown as (f: () => void, type: string) => () => void)(() => {
			const { cell, c, inside } = fragmentCell(light);
			t.If(inside, () => {
				t.Loop(k, ({ i }: { i: N }) => {
					const texel = load(light.lists, c.x.mul(k / 4).add(i.div(4)), c.y);
					const index = t.int(t.round(texel.element(i.mod(4)).mul(255)));
					t.If(index.equal(0), () => {
						t.Break();
					});
					const { at, colour } = entryLight(light, cell, index.sub(1));
					// A light a hero shadow slot holds (#230, `heroIndex`) gives the share the slot
					// has faded in to its shadowed light (hero-shadows.ts), so it is never lit twice.
					let hero: N = t.float(0);
					for (let s = 0; s < heroIndex.length; s++) {
						const slot = t.max(heroIndex[s].sub(t.float(index)).abs().oneMinus(), 0);
						hero = hero.add(slot.mul(heroFade[s]));
					}
					b.lightsNode.setupDirectLight(builder, this, {
						lightDirection: towardNode(at),
						lightColor: colour.mul(colorNode).mul(hero.oneMinus())
					});
				});
			});
		}, 'void')();
		return undefined as unknown as ReturnType<THREE.AnalyticLightNode<THREE.Light>['setup']>;
	}
}

const registered = new WeakSet<object>();

/** Maps GridLight to its node on a renderer: before its first compile, once each. */
export function registerGridLights(renderer: THREE.WebGPURenderer): void {
	if (registered.has(renderer.library)) return;
	registered.add(renderer.library);
	renderer.library.addLight(GridLightNode as never, GridLight as never);
}
