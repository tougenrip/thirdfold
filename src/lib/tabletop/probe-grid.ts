// The probe grid (#235), a lazy chunk loaded only where `wantsProbes` (light-model.ts): three's
// LightProbeGrid baked from the client's own scene, which holds only what this viewer was sent and
// draws it through `worldModify`, so unexplored cells capture black and nothing leaves the client.
// One grid and one atlas for the renderer's life, at the most probes a table uses: a new table
// only changes its box and how many probes it uses (the atlas texture, the light object and so
// every program stay as they are; a replaced texture would strand bindings, as #380 found). Its
// node is ours, registered for three's grid class before anything compiles: three's sampling over
// the atlas's own size rather than the used lattice's, times `skyAmbient`, so dark areas get none
// (cavity and the rules' darkness come after, in KindLightingModel's indirect term). A capture
// renders with tokens, dice, effects and the fog cloud hidden and carried light zeroed (`baking`).
// Only the first pass (direct light on what the probes see); three's indirect passes would need a
// second atlas. The renderer's own nodes come in as arguments, not imports: this chunk imports
// nothing of the renderer's, so none of its modules is split out of the renderer's chunk.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { LightProbeGrid } from 'three/examples/jsm/lighting/LightProbeGrid.js';
import type { SquareGrid } from '$lib/game/grid';
import type { ProbeLayout } from './light-model';
import type { N } from './materials/tsl';

/** Atlas padding slices at each end of a sub-volume (three's ATLAS_PADDING). */
const PAD = 1;
/** Each probe's cube faces, in px, and its near plane in cells. */
const CUBE_SIZE = 8;
const NEAR = 0.05;

const t = T as unknown as Record<string, N & ((...args: unknown[]) => N)>;

/** The renderer's nodes the grid reads: the sky's reach per fragment, and the bake's flag. */
export interface ProbeNodes {
	skyAmbient: () => N;
	baking: { value: number };
}

type Grid = LightProbeGrid & {
	_ensureTextures(): void;
	_renderTarget: THREE.RenderTarget3D;
	texture: THREE.Data3DTexture;
};

/** three's LightProbeGridNode over the atlas's fixed size, masked by `skyAmbient`. */
function nodeClass({ skyAmbient }: ProbeNodes) {
	return class ProbeGridNode extends THREE.AnalyticLightNode<THREE.Light> {
		static get type() {
			return 'ProbeGridNode';
		}

		private readonly min = T.uniform(new THREE.Vector3());
		private readonly max = T.uniform(new THREE.Vector3());
		private readonly res = T.uniform(new THREE.Vector3(2, 2, 2));
		private readonly intensity = T.uniform(0);

		update(): undefined {
			const light = (this as unknown as { light: Grid }).light;
			this.min.value.copy(light.boundingBox.min);
			this.max.value.copy(light.boundingBox.max);
			this.res.value.copy(light.resolution);
			this.intensity.value = light.intensity;
			return undefined;
		}

		setup(builder: THREE.NodeBuilder) {
			const light = (this as unknown as { light: Grid }).light;
			const none = undefined as unknown as ReturnType<
				THREE.AnalyticLightNode<THREE.Light>['setup']
			>;
			if (!light.texture) return none;
			const [min, max, res] = [this.min, this.max, this.res] as unknown as N[];
			const { image } = light.texture;
			const range = max.sub(min);
			const p = t.positionWorld.add(t.normalWorld.mul(range.div(res.sub(1))).mul(0.5));
			// The probe's index along each axis, then its texel's centre in the atlas.
			const at = p.sub(min).div(range).clamp(0, 1).mul(res.sub(1)).add(0.5);
			const slices = res.z.add(2 * PAD);
			const uv = at.xy.div(t.vec2(image.width, image.height));
			const atlas = t.texture3D(light.texture);
			const slice = (k: number) =>
				atlas.sample(t.vec3(uv, at.z.add(PAD).add(slices.mul(k)).div(image.depth)));
			const [s0, s1, s2, s3, s4, s5, s6] = [0, 1, 2, 3, 4, 5, 6].map(slice);
			const sh = t.array([
				s0.xyz,
				t.vec3(s0.w, s1.xy),
				t.vec3(s1.zw, s2.x),
				s2.yzw,
				s3.xyz,
				t.vec3(s3.w, s4.xy),
				t.vec3(s4.zw, s5.x),
				s5.yzw,
				s6.xyz
			]);
			const irradiance = t.getShIrradianceAt(t.normalWorld, sh).max(t.vec3(0));
			const masked = irradiance.mul(this.intensity as unknown as N).mul(skyAmbient());
			(builder.context as unknown as { irradiance: N }).irradiance.addAssign(masked);
			return none;
		}
	};
}

const registered = new WeakSet<object>();

/** The renderer's one probe grid: laid out per table, captured a range of probes at a time. */
export class ProbeGrid {
	readonly light: Grid;
	private far = 100;
	private cell = 1;

	/** `size`: the atlas, the most probes along x, y and z any layout uses. */
	constructor(
		private readonly renderer: THREE.WebGPURenderer,
		private readonly nodes: ProbeNodes,
		size: readonly [number, number, number]
	) {
		// Ours for three's class (its bake then registers nothing), before anything compiles.
		if (!registered.has(renderer.library)) {
			registered.add(renderer.library);
			renderer.library.addLight(nodeClass(nodes) as never, LightProbeGrid as never);
		}
		const light = new LightProbeGrid(1, 1, 1, ...size) as Grid;
		light.intensity = 0;
		light._ensureTextures(); // the atlas, so the node's graph is whole from the warm-up on
		renderer.initRenderTarget(light._renderTarget);
		this.light = light;
	}

	/** The probes' lattice for a table, in world units; returns how many it uses. */
	layout(grid: SquareGrid, { counts, min, max }: ProbeLayout): number {
		const c = (this.cell = grid.cellSize);
		const [w, d] = [grid.width / 2, grid.height / 2];
		const lo = new THREE.Vector3((min[0] - w) * c, min[1] * c, (min[2] - d) * c);
		const hi = new THREE.Vector3((max[0] - w) * c, max[1] * c, (max[2] - d) * c);
		const light = this.light;
		light.position.addVectors(lo, hi).multiplyScalar(0.5);
		light.width = hi.x - lo.x;
		light.height = hi.y - lo.y;
		light.depth = hi.z - lo.z;
		light.resolution.set(...counts);
		light.updateBoundingBox();
		light.updateMatrixWorld();
		this.far = lo.distanceTo(hi) + c;
		return counts[0] * counts[1] * counts[2];
	}

	/** Bakes probes `start` to `start + count` from `scene`, with `unbaked` out of the picture. */
	capture(scene: THREE.Scene, start: number, count: number, unbaked: readonly THREE.Object3D[]) {
		const r = this.renderer;
		const { toneMapping, outputColorSpace } = r;
		const mrt = r.getMRT();
		const shown = unbaked.filter((o) => o.visible);
		for (const o of shown) o.visible = false;
		// As the pipeline's passes draw: linear, no tone mapping, one output.
		r.toneMapping = THREE.NoToneMapping;
		r.outputColorSpace = THREE.ColorManagement.workingColorSpace;
		r.setMRT(null);
		// The sky's and dice's `mrtNode` names its output `output` (sky.ts): name the bake's cube so.
		const setTarget = r.setRenderTarget;
		r.setRenderTarget = (target, ...rest) => {
			if (target && 'isCubeRenderTarget' in target) target.texture.name ||= 'output';
			return setTarget.call(r, target, ...rest);
		};
		this.nodes.baking.value = 1;
		try {
			const near = NEAR * this.cell;
			this.light.bake(r, scene, { start, count, cubemapSize: CUBE_SIZE, near, far: this.far });
		} finally {
			this.nodes.baking.value = 0;
			r.setRenderTarget = setTarget;
			r.setMRT(mrt);
			r.toneMapping = toneMapping;
			r.outputColorSpace = outputColorSpace;
			for (const o of shown) o.visible = true;
		}
	}

	dispose(): void {
		this.light.removeFromParent();
		this.light.dispose();
	}
}
