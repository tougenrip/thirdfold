// Post-processing (milestone 63, #156): one RenderPipeline per quality tier
// that every M63 effect plugs into. An opaque prepass (medium and up) writes
// depth and 8-bit view normals for the overlay, AO and depth of field; the
// scene pass draws half-float colour with an 8-bit emissive attachment for
// bloom; the output stage tone maps and converts to sRGB once; then the overlay
// (overlay.ts: labels, markers, highlights, previews, grid lines) is laid over
// it, depth-tested against the world and untouched by any of it. Inside the
// pipeline every pass renders linear with no tone mapping, so a material's
// `toneMapped: false` no longer means anything: the whole frame is tone mapped
// at the end. Every knob is a uniform, so changing one never recompiles; only a
// tier whose stages differ rebuilds the pipeline. `?off=post` (the `post`
// layer off) draws straight to the canvas as before, the kill switch until
// #168 removes it.

import * as THREE from 'three/webgpu';
import {
	emissive,
	max,
	mix,
	mrt,
	normalView,
	output,
	packNormalToRGB,
	renderOutput,
	uniform,
	vec4
} from 'three/tsl';
import type { QualitySettings } from './quality';

/** The one tone mapper, applied once at the end (ACES until #158 decides). */
export const TONE_MAPPING = THREE.ACESFilmicToneMapping;

/** What a tier builds: the prepass, and the scene pass's MSAA samples. */
export interface Stages {
	prepass: boolean;
	samples: number;
}

/**
 * The stages a tier's settings call for. The overlay tests depth against a pass without MSAA:
 * the prepass, or on low (no prepass, no MSAA) the scene pass itself.
 */
export function stagesFor(settings: QualitySettings): Stages {
	return { prepass: settings.tier !== 'low' || settings.msaa > 0, samples: settings.msaa };
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

/**
 * The overlay's pass: it keeps the world's depth (the depth source's texture, not cleared) and
 * has that pass drawn first; NodeFrame draws a pass once a frame, however often it is asked.
 */
class OverlayPassNode extends THREE.PassNode {
	constructor(
		scene: THREE.Scene,
		camera: THREE.Camera,
		private readonly depthFrom: THREE.PassNode
	) {
		super(THREE.PassNode.COLOR, scene, camera, {
			samples: 0,
			depthTexture: depthFrom.renderTarget.depthTexture!
		});
		this.name = 'overlay';
		this.autoClearDepth = false;
	}

	updateBefore(frame: THREE.NodeFrame) {
		frame.updateBeforeNode(this.depthFrom);
		return super.updateBefore(frame);
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

	overlayPass: THREE.PassNode | null = null;

	constructor(
		private readonly renderer: THREE.WebGPURenderer,
		private readonly scene: THREE.Scene,
		private readonly camera: THREE.Camera,
		/** The overlay's scene: no background, so its pass clears to transparent. */
		private readonly overlay: THREE.Scene
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
		if (this.pipeline) return this.pipeline.render();
		const { renderer } = this;
		renderer.render(this.scene, this.camera);
		// Over it, on the same depth, not tone mapped.
		const { autoClear, toneMapping } = renderer;
		renderer.autoClear = false;
		renderer.toneMapping = THREE.NoToneMapping;
		renderer.render(this.overlay, this.camera);
		renderer.autoClear = autoClear;
		renderer.toneMapping = toneMapping;
	}

	/**
	 * The targets the table's materials draw into, for the warm-up to compile against: the scene
	 * pass. Not the prepass: compiled outside its pass on WebGPU, some of its pipelines come out
	 * invalid (a colour target the fragment stage never writes), so it compiles when first drawn.
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
			// View normals only for now. A velocity attachment (for TRAA, #163) made WebGPU
			// pipelines that write fewer outputs than the target has, which aborts the frame.
			prepass.setMRT(mrt({ output: packNormalToRGB(normalView) }));
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

		const overlayPass = new OverlayPassNode(this.overlay, camera, this.prepass ?? scenePass);
		overlayPass.renderTarget.texture.type = halfFloat;
		this.overlayPass = overlayPass;

		const color = scenePass.getTextureNode('output');
		const pipeline = new THREE.RenderPipeline(renderer);
		pipeline.outputColorTransform = false;
		const exposed = vec4(color.rgb.mul(this.uniforms.exposure), color.a);
		const world = renderOutput(exposed, TONE_MAPPING, THREE.SRGBColorSpace);
		// The overlay is premultiplied and linear: straighten it, encode it to sRGB (no tone
		// mapping) and lay it over the finished image, as the classic renderer blended it.
		const over = overlayPass.getTextureNode('output');
		const straight = vec4(over.rgb.div(max(over.a, 1e-4)), 1);
		const shown = renderOutput(straight, THREE.NoToneMapping, THREE.SRGBColorSpace);
		pipeline.outputNode = vec4(mix(world.rgb, shown.rgb, over.a), 1);
		this.pipeline = pipeline;
	}

	private teardown(): void {
		this.pipeline?.dispose();
		this.prepass?.dispose();
		this.scenePass?.dispose();
		this.overlayPass?.dispose();
		this.pipeline = this.prepass = this.scenePass = this.overlayPass = null;
		this.stages = null;
		this.gates = [];
	}
}
