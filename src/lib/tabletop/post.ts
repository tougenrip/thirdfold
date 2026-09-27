// Post-processing (milestone 63, #156): one RenderPipeline per quality tier
// that every M63 effect plugs into. An opaque prepass (medium and up) writes
// depth, 8-bit view normals and velocity for AO, TRAA and depth of field; the
// scene pass draws half-float colour with an 8-bit emissive attachment for
// bloom; the output stage tone maps and converts to sRGB once. Inside the
// pipeline every pass renders linear with no tone mapping, so a material's
// `toneMapped: false` no longer means anything: the whole frame is tone mapped
// at the end. Every knob is a uniform, so changing one never recompiles; only a
// tier whose stages differ rebuilds the pipeline. `?off=post` (the `post`
// layer off) draws straight to the canvas as before, the kill switch until
// #168 removes it.

import * as THREE from 'three/webgpu';
import {
	emissive,
	mrt,
	normalView,
	output,
	packNormalToRGB,
	renderOutput,
	uniform,
	vec4,
	velocity
} from 'three/tsl';
import type { QualitySettings } from './quality';

/** The one tone mapper, applied once at the end (ACES until #158 decides). */
export const TONE_MAPPING = THREE.ACESFilmicToneMapping;

/** What a tier builds: the prepass, and the scene pass's MSAA samples. */
export interface Stages {
	prepass: boolean;
	samples: number;
}

/** The stages a tier's settings call for (low: none but the scene pass). */
export function stagesFor(settings: QualitySettings): Stages {
	return { prepass: settings.tier !== 'low', samples: settings.msaa };
}

/**
 * The opaque prepass: its colour attachment holds view normals, which fit in 8 bits.
 * `PassNode.setup` resets that attachment to the renderer's output type on every build,
 * so the 8-bit type is put back after it.
 */
class PrePassNode extends THREE.PassNode {
	setup(builder: THREE.NodeBuilder) {
		const node = super.setup(builder);
		this.renderTarget.texture.type = THREE.UnsignedByteType;
		return node;
	}
}

/** Something to compile the table's materials for: a pass's target and outputs. */
export interface PassTarget {
	renderTarget: THREE.RenderTarget;
	mrt: THREE.MRTNode;
}

export class Post {
	/** Linear exposure before tone mapping (the renderer's own stays 1). */
	readonly uniforms = { exposure: uniform(1) };
	private pipeline: THREE.RenderPipeline | null = null;
	private stages: Stages | null = null;
	private gates: { effect: THREE.Node; on: THREE.NodeUpdateType; strength: { value: number } }[] =
		[];
	prepass: THREE.PassNode | null = null;
	scenePass: THREE.PassNode | null = null;

	constructor(
		private readonly renderer: THREE.WebGPURenderer,
		private readonly scene: THREE.Scene,
		private readonly camera: THREE.Camera
	) {}

	/** Applies a tier: rebuilds the pipeline only when its stages change. */
	set(settings: QualitySettings): void {
		const next = stagesFor(settings);
		const same =
			this.stages && this.stages.prepass === next.prepass && this.stages.samples === next.samples;
		if (!settings.layers.post) return this.teardown();
		if (!same || !this.pipeline) this.build(next);
	}

	/**
	 * Switches an effect by its strength uniform: at 0 its passes stop (`updateBeforeType`
	 * NONE, which NodeFrame reads every frame), and the effect mixes its output by the same
	 * uniform, so off costs nothing and never recompiles. Effects register when built.
	 */
	gate(effect: THREE.Node, strength: { value: number }): void {
		this.gates.push({ effect, on: effect.updateBeforeType, strength });
	}

	/** Draws a frame: through the pipeline, or straight to the canvas with post off. */
	render(): void {
		for (const { effect, on, strength } of this.gates)
			effect.updateBeforeType = strength.value > 0 ? on : THREE.NodeUpdateType.NONE;
		if (this.pipeline) this.pipeline.render();
		else this.renderer.render(this.scene, this.camera);
	}

	/**
	 * The targets the table's materials draw into, for the warm-up to compile against. The
	 * prepass draws only once an effect samples it (AO, TRAA, depth of field), so it joins then.
	 */
	targets(): PassTarget[] {
		return [this.scenePass].flatMap((p) =>
			p ? [{ renderTarget: p.renderTarget, mrt: p.getMRT() as THREE.MRTNode }] : []
		);
	}

	dispose(): void {
		this.teardown();
	}

	private build(stages: Stages): void {
		this.teardown();
		this.stages = stages;
		const { renderer, scene, camera } = this;
		const halfFloat = renderer.getOutputBufferType();
		if (stages.prepass) {
			const prepass = new PrePassNode(THREE.PassNode.COLOR, scene, camera, { samples: 0 });
			prepass.name = 'prepass';
			prepass.transparent = false;
			prepass.setMRT(mrt({ output: packNormalToRGB(normalView), velocity }));
			// Velocity is cloned from the colour texture while it is still half-float.
			prepass.getTexture('velocity').type = halfFloat;
			prepass.renderTarget.texture.type = THREE.UnsignedByteType;
			this.prepass = prepass;
		}
		const scenePass = new THREE.PassNode(THREE.PassNode.COLOR, scene, camera, {
			samples: stages.samples
		});
		scenePass.name = 'scene';
		const outputs = mrt({ output, emissive: vec4(emissive, output.a) });
		// A transparent surface in front of a glow covers its emissive, as it covers its colour.
		outputs.setBlendMode('emissive', new THREE.BlendMode(THREE.NormalBlending));
		scenePass.setMRT(outputs);
		scenePass.getTexture('emissive').type = THREE.UnsignedByteType;
		// Set now (setup sets the same later) so a warm-up before the first frame compiles for them.
		scenePass.renderTarget.samples = stages.samples;
		scenePass.renderTarget.texture.type = halfFloat;
		this.scenePass = scenePass;

		const color = scenePass.getTextureNode('output');
		const pipeline = new THREE.RenderPipeline(renderer);
		pipeline.outputColorTransform = false;
		const exposed = vec4(color.rgb.mul(this.uniforms.exposure), color.a);
		pipeline.outputNode = renderOutput(exposed, TONE_MAPPING, THREE.SRGBColorSpace);
		this.pipeline = pipeline;
	}

	private teardown(): void {
		this.pipeline?.dispose();
		this.prepass?.dispose();
		this.scenePass?.dispose();
		this.pipeline = this.prepass = this.scenePass = null;
		this.stages = null;
		this.gates = [];
	}
}
