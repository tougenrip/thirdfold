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
// Bounce and cavity (#234) ride in the lists texture's tail, a texel per cell after each row's
// lists, so they add no binding: the node reads them at the fragment's normal-offset cell as
// `min(own cell, bilinear of four)`, so nothing filters across a wall, and hands them to the kinds'
// lighting model (`KindLightingModel.gridIndirect`) for its indirect term. Their gains are uniforms.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { CORE_MAX, CORE_RADIUS, LIGHT_DECAY, READABLE_EDGE } from '$lib/game/lights';
import type { SquareGrid } from '$lib/game/grid';
import { groundFlat } from '../cell-maps';
import { STEP_HEIGHT } from '../ground';
import { flickerNode } from './flicker';
import type { GridIndirect } from './lighting-model';
import type { N } from './tsl';
import {
	BOUNCE_RANGE,
	CAVITY_PER_SIDE,
	DATA_TEXELS,
	GRID_LIGHT_CAPACITY,
	LIGHT_TEXELS,
	OPEN_BITS,
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
/** Cavity fades out this far over the floor, in cells: half a level, so wall tops stay clean. */
const CAVITY_REACH = 0.5 * STEP_HEIGHT;

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
	/**
	 * A layer per grid row: K light indices per cell, four to an RGBA8 texel, then (from texel
	 * `tail`) a texel per cell of bounce (RGB) and cavity (A), `packIndirect` (#234).
	 */
	readonly lists: THREE.DataArrayTexture;
	/** The first bounce and cavity texel of a row. */
	readonly tail: number;
	readonly gridSize = T.uniform(new THREE.Vector2(1, 1));
	readonly cellSize = T.uniform(1);
	/** How strongly bounce lights (the tier's, 0 off) and cavity shades (1 on, 0 off). */
	readonly bounceGain = T.uniform(0);
	readonly cavityGain = T.uniform(0);

	/** `k`, light indices per cell (a multiple of 4), is fixed: another K is another GridLight. */
	constructor(readonly k: number) {
		super(0xffffff, 1);
		this.tail = (MAX_SIDE * k) / 4;
		const width = this.tail + MAX_SIDE;
		this.lists = layered(new Uint8Array(width * 4 * MAX_SIDE), width, MAX_SIDE);
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
		this.setRows(grid, lists, grid.width * this.k, 0, this.tail * 4);
		this.gridSize.value.set(grid.width, grid.height);
		this.cellSize.value = grid.cellSize;
	}

	/** Each cell's bounce and cavity (`packIndirect`): only the grid rows that changed upload. */
	setIndirect(grid: SquareGrid, texels: Uint8Array): void {
		this.setRows(grid, texels, grid.width * 4, this.tail * 4, MAX_SIDE * 4);
	}

	/** Writes `w` bytes a grid row of `data` at byte `at` of each layer, `size` bytes, zero past it. */
	private setRows(grid: SquareGrid, data: Uint8Array, w: number, at: number, size: number) {
		const out = this.lists.image.data as unknown as Uint8Array;
		const stride = (this.tail + MAX_SIDE) * 4;
		const next = new Uint8Array(size);
		for (let y = 0; y < MAX_SIDE; y++) {
			next.fill(0);
			if (y < grid.height) next.set(data.subarray(y * w, y * w + w));
			const row = out.subarray(y * stride + at, y * stride + at + size);
			if (row.every((v, i) => v === next[i])) continue;
			row.set(next);
			this.lists.addLayerUpdate(y);
		}
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
		const { int, ivec2, float, vec4, textureLoad, cameraViewMatrix, positionView } = t;
		const k = light.k;
		const cellSize = light.cellSize as unknown as N;
		const gridSize = light.gridSize as unknown as N;
		const load = (texture: THREE.Texture, x: N, layer: N) =>
			textureLoad(texture, ivec2(x, 0)).depth(layer);
		const model = (b.context as { lightingModel?: { gridIndirect?: GridIndirect } }).lightingModel;
		if (model && 'gridIndirect' in model) model.gridIndirect = indirectNode(light, load);
		(t.Fn as unknown as (f: () => void, type: string) => () => void)(() => {
			const p = t.positionWorld.add(t.normalWorld.mul(cellSize.mul(NORMAL_LOOKUP)));
			const cell = p.xz.div(cellSize).add(gridSize.mul(0.5)).toVar();
			const c = ivec2(t.floor(cell)).toVar();
			const inside = c.x
				.greaterThanEqual(0)
				.and(c.y.greaterThanEqual(0))
				.and(c.x.lessThan(int(gridSize.x)))
				.and(c.y.lessThan(int(gridSize.y)));
			t.If(inside, () => {
				t.Loop(k, ({ i }: { i: N }) => {
					const texel = load(light.lists, c.x.mul(k / 4).add(i.div(4)), c.y);
					const index = int(t.round(texel.element(i.mod(4)).mul(255)));
					t.If(index.equal(0), () => {
						t.Break();
					});
					const li = index.sub(1);
					const at = load(light.data, int(0), li);
					const col = load(light.data, int(1), li);
					const rule = load(light.data, int(2), li);
					const rel = cell.sub(rule.xy);
					const d = rel.length();
					const turn = t
						.atan(rel.y, rel.x)
						.mul(ROW_ANGLES / (2 * Math.PI))
						.add(ROW_ANGLES + 0.5);
					const angle = int(t.floor(turn));
					let occ: N = float(0);
					for (const o of TAPS) {
						const a = angle.add(o).mod(ROW_ANGLES);
						const row = load(light.data, a.div(4).add(DATA_TEXELS), li).element(a.mod(4));
						occ = occ.add(t.step(d, row.add(ROW_EPS)));
					}
					const d3 = t.positionWorld.distance(at.xyz).div(cellSize);
					// The flicker (#231) scales the light, never its floor at READABLE_EDGE.
					const flicker = flickerNode(rule.z, rule.w);
					const lit = falloffNode(d, at.w, d3).mul(occ.div(TAPS.length)).mul(flicker);
					const lightVector = cameraViewMatrix.mul(vec4(at.xyz, 1)).xyz.sub(positionView);
					b.lightsNode.setupDirectLight(builder, this, {
						lightDirection: lightVector.normalize(),
						lightColor: col.rgb.mul(colorNode).mul(t.max(lit, READABLE_EDGE))
					});
				});
			});
		}, 'void')();
		return undefined as unknown as ReturnType<THREE.AnalyticLightNode<THREE.Light>['setup']>;
	}
}

/**
 * Bounce (irradiance) and cavity (the factor on the indirect light) at the fragment (#234), from the
 * lists' tail at its normal-offset cell: the bilinear of that cell and its three nearest, each
 * neighbour taken only across open sides (`OPEN_BITS`, else the cell's own), then `min` with the
 * cell's own, so a value never rises past its cell's and nothing filters across a wall. Cavity
 * fades out over `CAVITY_REACH` above that cell's floor (the ground map's level). Off the grid:
 * no bounce and no cavity.
 */
function indirectNode(light: GridLight, load: (t: THREE.Texture, x: N, layer: N) => N) {
	const { int, ivec2, float, floor, fract, mix, min, max, abs, step, smoothstep, vec4 } = t;
	const cellSize = light.cellSize as unknown as N;
	const gridSize = light.gridSize as unknown as N;
	const p = t.positionWorld.add(t.normalWorld.mul(cellSize.mul(NORMAL_LOOKUP)));
	const cell = p.xz.div(cellSize).add(gridSize.mul(0.5));
	const last = ivec2(gridSize).sub(1);
	const fit = (c: N) => max(min(c, last), ivec2(0, 0));
	/** A cell's texel as (bounce, cavity) and its open-side bits, 0-15. */
	const read = (c: N) => {
		const texel = load(light.lists, fit(c).x.add(int(light.tail)), fit(c).y);
		const a = t.round(texel.w.mul(255));
		const shut = floor(a.div(16));
		return { value: vec4(texel.xyz, shut.mul(CAVITY_PER_SIDE)), bits: a.sub(shut.mul(16)) };
	};
	const bit = (bits: N, value: number) => floor(bits.div(value)).mod(2);
	// Toward the nearer neighbours: east or west, south or north, and how far (0 at the centre).
	const u = fract(cell);
	const [east, south] = [step(0.5, u.x), step(0.5, u.y)];
	const k = abs(u.sub(0.5));
	const dx = ivec2(int(east.mul(2).sub(1)), int(0));
	const dy = ivec2(int(0), int(south.mul(2).sub(1)));
	const ownAt = ivec2(floor(cell));
	const across = (bits: N) => ({
		x: mix(bit(bits, OPEN_BITS.west), bit(bits, OPEN_BITS.east), east),
		y: mix(bit(bits, OPEN_BITS.north), bit(bits, OPEN_BITS.south), south)
	});
	const own = read(ownAt);
	const [h, v, d] = [read(ownAt.add(dx)), read(ownAt.add(dy)), read(ownAt.add(dx).add(dy))];
	const [o, oh, ov] = [across(own.bits), across(h.bits), across(v.bits)];
	const diagonal = max(o.x.mul(oh.y), o.y.mul(ov.x));
	const taken = (n: { value: N }, open: N) => mix(own.value, n.value, open);
	const smooth = mix(
		mix(own.value, taken(h, o.x), k.x),
		mix(taken(v, o.y), taken(d, diagonal), k.x),
		k.y
	);
	const inside = float(cell.x.greaterThanEqual(0))
		.mul(float(cell.y.greaterThanEqual(0)))
		.mul(float(cell.x.lessThan(gridSize.x)))
		.mul(float(cell.y.lessThan(gridSize.y)));
	const value = min(own.value, smooth).mul(inside);
	const level = (groundFlat as unknown as { load(c: N): N }).load(fit(ownAt)).y.mul(255);
	const above = t.positionWorld.y.div(cellSize).sub(level.mul(STEP_HEIGHT));
	const near = smoothstep(float(0), float(CAVITY_REACH), above).oneMinus();
	return {
		bounce: value.xyz.mul((light.bounceGain as unknown as N).mul(BOUNCE_RANGE)),
		cavity: value.w
			.mul(light.cavityGain as unknown as N)
			.mul(near)
			.oneMinus()
	};
}

const registered = new WeakSet<object>();

/** Maps GridLight to its node on a renderer: before its first compile, once each. */
export function registerGridLights(renderer: THREE.WebGPURenderer): void {
	if (registered.has(renderer.library)) return;
	registered.add(renderer.library);
	renderer.library.addLight(GridLightNode as never, GridLight as never);
}
