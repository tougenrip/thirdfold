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
//
// Ambient occlusion (#159) is SSAO from the prepass's depth and normals, fed to
// the scene pass's materials through `builtinAOContext`: it darkens indirect
// light only (the hemisphere), so creases and the ground under things darken
// while faces lit by torches, lamps and the sun keep their light.

import * as THREE from 'three/webgpu';
import {
	builtinAOContext,
	emissive,
	float,
	max,
	mix,
	mrt,
	normalView,
	output,
	packNormalToRGB,
	renderOutput,
	sample,
	screenUV,
	uniform,
	unpackRGBToNormal,
	vec4
} from 'three/tsl';
import type SSAONode from 'three/examples/jsm/tsl/display/SSAONode.js';
import { ssao } from 'three/examples/jsm/tsl/display/SSAONode.js';
import { GRADE_TONE_MAPPER, type ToneMapper } from '../assets/manifest';
import type { QualitySettings } from './quality';

const TONE_MAPPINGS: Record<ToneMapper, THREE.ToneMapping> = {
	agx: THREE.AgXToneMapping,
	aces: THREE.ACESFilmicToneMapping,
	neutral: THREE.NeutralToneMapping
};

/** What a pipeline is built with: the prepass, the scene pass's MSAA samples, the tone mapper. */
export interface Stages {
	prepass: boolean;
	samples: number;
	/** Compiled into the output stage, so a change rebuilds (#158). */
	toneMapper: ToneMapper;
}

/**
 * The stages a tier's settings call for. The overlay tests depth against a pass without MSAA:
 * the prepass, or on low (no prepass, no MSAA) the scene pass itself.
 */
export function stagesFor(settings: QualitySettings): Stages {
	return {
		prepass: settings.tier !== 'low' || settings.msaa > 0,
		samples: settings.msaa,
		toneMapper: settings.toneMapper ?? GRADE_TONE_MAPPER
	};
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

/**
 * The scene pass: it has what it reads drawn first, the prepass and then the AO, each once a frame.
 * Three keys a pass's render context by how deeply it is nested, so a prepass drawn sometimes from
 * here and sometimes from inside another pass (the AO's, or the overlay's) would compile all its
 * materials twice; and an AO drawn from inside the scene's own draw, when a material first asks for
 * it, made WebGPU pipelines for the wrong targets, which aborted the frame.
 */
class ScenePassNode extends THREE.PassNode {
	drawsFirst: THREE.Node[] = [];

	updateBefore(frame: THREE.NodeFrame) {
		for (const node of this.drawsFirst) frame.updateBeforeNode(node);
		return super.updateBefore(frame);
	}
}

/** Something to compile the table's materials for: a pass's target and outputs. */
export interface PassTarget {
	renderTarget: THREE.RenderTarget;
	mrt: THREE.MRTNode;
}

/** Ambient occlusion's reach and depth per environment, in cells (#159); unlisted ones get `default`. */
const AO_LOOKS: Record<string, { radius: number; intensity: number }> = {
	default: { radius: 0.5, intensity: 1 },
	// Open streets: a wider, softer darkening along walls and under eaves.
	village: { radius: 0.8, intensity: 0.9 },
	// Tight rock: crevices and the ground under things.
	cavern: { radius: 0.35, intensity: 1.2 },
	'living-cave': { radius: 0.35, intensity: 1.2 }
};
/** How much of the occlusion shows, when on. */
const AO_STRENGTH = 1;

export class Post {
	/** Linear exposure before tone mapping (the renderer's own stays 1). */
	readonly uniforms = { exposure: uniform(1), aoStrength: uniform(0) };
	private pipeline: THREE.RenderPipeline | null = null;
	private stages: Stages | null = null;
	/** The AO's resolution: half on medium, full above. */
	private aoScale = 1;
	private gates: { effect: THREE.Node; on: THREE.NodeUpdateType; strength: { value: number } }[] =
		[];
	prepass: THREE.PassNode | null = null;
	scenePass: THREE.PassNode | null = null;

	overlayPass: THREE.PassNode | null = null;
	ao: SSAONode | null = null;
	/** The environment and cell size the AO is sized for. */
	private look = { environment: null as string | null, cellSize: 1 };

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
		// Off on low (no prepass), by the tier's `ao` or `?off=ao`: a uniform, so no recompile.
		this.uniforms.aoStrength.value = settings.ao && settings.layers.ao ? AO_STRENGTH : 0;
		this.aoScale = settings.tier === 'medium' ? 0.5 : 1;
		const same =
			this.stages && this.stages.prepass === next.prepass && this.stages.samples === next.samples;
		// Drawing straight to the canvas (`?off=post`) tone maps with the renderer's own.
		this.renderer.toneMapping = TONE_MAPPINGS[next.toneMapper];
		if (!settings.layers.post) return this.teardown();
		if (!same || !this.pipeline) return this.build(next);
		// Only the output stage holds the tone mapper: recompose it and keep the passes, whose
		// materials would otherwise all compile again.
		if (this.ao) this.ao.resolutionScale = this.aoScale;
		if (this.stages!.toneMapper === next.toneMapper) return;
		this.stages = next;
		this.compose(this.pipeline);
	}

	/** Sizes the AO for a table: its environment's reach, in cells of `cellSize` world units. */
	setLook(environment: string | null, cellSize: number): void {
		this.look = { environment, cellSize };
		if (!this.ao) return;
		const look = AO_LOOKS[environment ?? ''] ?? AO_LOOKS.default;
		this.ao.radius.value = look.radius * cellSize;
		this.ao.intensity.value = look.intensity;
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
		const scenePass = new ScenePassNode(THREE.PassNode.COLOR, scene, camera, {
			samples: stages.samples
		});
		if (this.prepass) scenePass.drawsFirst.push(this.prepass);
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

		if (this.prepass) {
			const normals = this.prepass.getTextureNode('output');
			const normal = sample((uv) => unpackRGBToNormal(normals.sample(uv).rgb));
			const ao = ssao(this.prepass.getTextureNode('depth'), normal, camera);
			ao.resolutionScale = this.aoScale;
			this.ao = ao;
			this.setLook(this.look.environment, this.look.cellSize);
			// At strength 0 this is exactly 1, and the gate stops the AO's passes.
			const occlusion = mix(
				float(1),
				ao.getTextureNode().sample(screenUV).r,
				this.uniforms.aoStrength
			);
			scenePass.contextNode = builtinAOContext(occlusion);
			scenePass.drawsFirst.push(ao);
			this.gate(ao, this.uniforms.aoStrength);
		}

		const overlayPass = new OverlayPassNode(this.overlay, camera, this.prepass ?? scenePass);
		overlayPass.renderTarget.texture.type = halfFloat;
		this.overlayPass = overlayPass;

		const pipeline = new THREE.RenderPipeline(renderer);
		pipeline.outputColorTransform = false;
		this.compose(pipeline);
		this.pipeline = pipeline;
	}

	/** The output stage: exposure, the tone mapper and sRGB, then the overlay laid over it. */
	private compose(pipeline: THREE.RenderPipeline): void {
		const color = this.scenePass!.getTextureNode('output');
		const exposed = vec4(color.rgb.mul(this.uniforms.exposure), color.a);
		const toneMapping = TONE_MAPPINGS[this.stages!.toneMapper];
		const world = renderOutput(exposed, toneMapping, THREE.SRGBColorSpace);
		// The overlay is premultiplied and linear: straighten it, encode it to sRGB (no tone
		// mapping) and lay it over the finished image, as the classic renderer blended it.
		const over = this.overlayPass!.getTextureNode('output');
		const straight = vec4(over.rgb.div(max(over.a, 1e-4)), 1);
		const shown = renderOutput(straight, THREE.NoToneMapping, THREE.SRGBColorSpace);
		pipeline.outputNode = vec4(mix(world.rgb, shown.rgb, over.a), 1);
		pipeline.needsUpdate = true;
	}

	private teardown(): void {
		this.pipeline?.dispose();
		this.prepass?.dispose();
		this.scenePass?.dispose();
		this.overlayPass?.dispose();
		this.ao?.dispose();
		this.pipeline = this.prepass = this.scenePass = this.overlayPass = this.ao = null;
		this.stages = null;
		this.gates = [];
	}
}
