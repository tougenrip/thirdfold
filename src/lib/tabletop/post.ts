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
//
// Bloom (#160) glows from the emissive attachment plus the part of the exposed
// HDR image above 1 (a soft knee), so flames and what they light hot bloom
// while sunlit grass and plaster, below 1, do not.
//
// The output stage (#161) is one pass, in this order: exposure (scene plus
// bloom), radial chromatic aberration, a vignette tinted dark purple, the tone
// mapper and sRGB, film grain, the overlay, and a triangular dither. Every step
// maps 0 to 0 (the vignette multiplies; grain and dither are masked off at
// black), so unexplored cells, black under the fog, stay exactly black.
// The colour grade (#162) follows the tone mapper: the environment's lookup
// table for the tone mapper and band, blended on the CPU into one 3D texture
// over GRADE_BLEND_MS when any of them changes, so the shader never does.

import * as THREE from 'three/webgpu';
import {
	builtinAOContext,
	clamp,
	dot,
	emissive,
	float,
	interleavedGradientNoise,
	luminance,
	max,
	screenCoordinate,
	smoothstep,
	vec2,
	texture3D,
	vec3,
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
import { lut3D } from 'three/examples/jsm/tsl/display/Lut3DNode.js';
import { LUT_SIZE, type Grades } from './environment';
import { GradeBlend } from './grade';
import type { Ambient } from '../game/lights';
import type BloomNode from 'three/examples/jsm/tsl/display/BloomNode.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { GRADE_TONE_MAPPER, type ToneMapper } from '../assets/manifest';
import { needsPrepass, type QualitySettings } from './quality';

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
 * The stages settings call for. The overlay tests depth against a pass without MSAA: the prepass
 * (drawn with MSAA or AO on, `needsPrepass`), else the scene pass itself.
 */
export function stagesFor(settings: QualitySettings): Stages {
	return {
		prepass: needsPrepass(settings),
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
/** Bloom, when on: a tight, restrained glow (TaleWeaver blooms at 1 with a soft knee of 0.5). */
const BLOOM = { strength: 0.3, radius: 0.2, knee: 0.5 };
/**
 * The lens, when on: a vignette toward TaleWeaver's dark purple at about its intensity, chromatic
 * aberration a few pixels wide at the corners, and a faint grain (in display values).
 */
const LENS = {
	vignette: 0.33,
	tint: new THREE.Color(0.09, 0.038, 0.208),
	aberration: 0.008,
	grain: 0.035
};
/** The grain's pattern moves on at most this often, by the tabletop's clock (ms). */
const GRAIN_MS = 1000 / 24;

export class Post {
	/** Linear exposure before tone mapping (the renderer's own stays 1). */
	/** The knobs: exposure and bloom are the cues' too (the toll and the flash, #222). */
	readonly uniforms = {
		exposure: uniform(1),
		aoStrength: uniform(0),
		bloomStrength: uniform(0),
		vignette: uniform(0),
		vignetteTint: uniform(LENS.tint),
		aberration: uniform(0),
		grain: uniform(0),
		/** Seeds grain and dither: from the tabletop's clock, so a held clock holds them still. */
		frameIndex: uniform(0),
		/** How much of the grade shows: 1 on, 0 with the Colour grading option off. */
		grade: uniform(1)
	};
	/** The grade drawn, blending toward the one in force (grade.ts). */
	private readonly grade = new GradeBlend();
	private pipeline: THREE.RenderPipeline | null = null;
	private stages: Stages | null = null;
	/** The AO's resolution: half on medium, full above. */
	private aoScale = 1;
	/** The grain's strength when on (0 under reduced motion). */
	private grain = 0;
	/** The bloom's resolution: a quarter on low, half above. */
	private bloomScale = 0.5;
	private gates: { effect: THREE.Node; on: THREE.NodeUpdateType; strength: { value: number } }[] =
		[];
	prepass: THREE.PassNode | null = null;
	scenePass: THREE.PassNode | null = null;

	overlayPass: THREE.PassNode | null = null;
	ao: SSAONode | null = null;
	bloom: BloomNode | null = null;
	/** The environment and cell size the AO is sized for. */
	private look = {
		environment: null as string | null,
		cellSize: 1,
		grades: null as Grades | null,
		band: 'day' as Ambient
	};

	constructor(
		private readonly renderer: THREE.WebGPURenderer,
		private readonly scene: THREE.Scene,
		private readonly camera: THREE.Camera,
		/** The overlay's scene: no background, so its pass clears to transparent. */
		private readonly overlay: THREE.Scene,
		/** Whether motion is reduced (grain is off then). */
		private readonly reducedMotion: () => boolean = () => false
	) {}

	/** Applies a tier: rebuilds the pipeline only when its stages change. */
	set(settings: QualitySettings): void {
		const next = stagesFor(settings);
		// Off on low (no prepass), by the tier's `ao` or `?off=ao`: a uniform, so no recompile.
		this.uniforms.aoStrength.value = settings.ao && settings.layers.ao ? AO_STRENGTH : 0;
		this.aoScale = settings.tier === 'medium' ? 0.5 : 1;
		this.uniforms.bloomStrength.value =
			settings.bloom && settings.layers.bloom ? BLOOM.strength : 0;
		this.bloomScale = settings.tier === 'low' ? 0.25 : 0.5;
		const lens = settings.layers.lens;
		this.uniforms.vignette.value = lens && settings.vignette ? LENS.vignette : 0;
		this.uniforms.aberration.value = lens && settings.aberration ? LENS.aberration : 0;
		this.grain = lens && settings.grain ? LENS.grain : 0;
		this.uniforms.grade.value = settings.grade && settings.layers.grade ? 1 : 0;
		const same =
			this.stages && this.stages.prepass === next.prepass && this.stages.samples === next.samples;
		// Drawing straight to the canvas (`?off=post`) tone maps with the renderer's own.
		this.renderer.toneMapping = TONE_MAPPINGS[next.toneMapper];
		if (!settings.layers.post) return this.teardown();
		if (!same || !this.pipeline) return this.build(next);
		// Only the output stage holds the tone mapper: recompose it and keep the passes, whose
		// materials would otherwise all compile again.
		if (this.ao) this.ao.resolutionScale = this.aoScale;
		this.bloom?.setResolutionScale(this.bloomScale);
		if (this.stages!.toneMapper === next.toneMapper) return;
		this.stages = next;
		this.compose(this.pipeline);
		this.retarget();
	}

	/** Sizes the AO for a table: its environment's reach, in cells of `cellSize` world units. */
	setLook(
		environment: string | null,
		cellSize: number,
		grades: Grades | null = null,
		band: Ambient = 'day'
	): void {
		// A new environment's grade is put in place at once; a new band blends in.
		const snap = grades !== this.look.grades;
		const changed = snap || band !== this.look.band;
		this.look = { environment, cellSize, grades, band };
		if (changed) this.retarget(snap);
		if (!this.ao) return;
		const look = AO_LOOKS[environment ?? ''] ?? AO_LOOKS.default;
		this.ao.radius.value = look.radius * cellSize;
		this.ao.intensity.value = look.intensity;
	}

	/** Whether a grade is still blending in (the tabletop keeps drawing while it is). */
	get blending(): boolean {
		return this.grade.blending;
	}

	/** Blends toward the grade for the environment, band and tone mapper now in force. */
	private retarget(snap = false): void {
		const { grades, band } = this.look;
		const tm = this.stages?.toneMapper ?? GRADE_TONE_MAPPER;
		this.grade.target(grades?.[tm][band] ?? null, snap);
	}

	/**
	 * Switches an effect by its strength uniform: at 0 its passes stop (`updateBeforeType`
	 * NONE, which NodeFrame reads every frame), and the effect mixes its output by the same
	 * uniform, so off costs nothing and never recompiles. Effects register when built.
	 */
	gate(effect: THREE.Node, strength: { value: number }): void {
		this.gates.push({ effect, on: effect.updateBeforeType, strength });
	}

	/** Draws a frame at `now` (the tabletop's clock): through the pipeline, or straight to the canvas. */
	render(now = 0): void {
		this.uniforms.frameIndex.value = Math.floor(now / GRAIN_MS) % 4096;
		this.grade.step(now);
		this.uniforms.grain.value = this.reducedMotion() ? 0 : this.grain;
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
		this.grade.dispose();
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

		const glow = bloom(this.bloomInput(scenePass), this.uniforms.bloomStrength, BLOOM.radius, 0);
		// The input is already only what should glow: no threshold of its own.
		glow.highPassFn = (({ input }: { input: THREE.Node }) => input) as typeof glow.highPassFn;
		glow.setResolutionScale(this.bloomScale);
		this.bloom = glow;
		this.gate(glow, this.uniforms.bloomStrength);

		const overlayPass = new OverlayPassNode(this.overlay, camera, this.prepass ?? scenePass);
		overlayPass.renderTarget.texture.type = halfFloat;
		this.overlayPass = overlayPass;

		const pipeline = new THREE.RenderPipeline(renderer);
		pipeline.outputColorTransform = false;
		this.compose(pipeline);
		this.pipeline = pipeline;
	}

	/**
	 * What glows: the emissive attachment, plus the exposed HDR colour above 1 with a soft knee
	 * (quadratic from 1 - knee to 1 + knee, as Unity's bloom), by the brightest channel.
	 */
	private bloomInput(scenePass: THREE.PassNode) {
		const hdr = scenePass.getTextureNode('output').rgb.mul(this.uniforms.exposure);
		const bright = max(hdr.r, max(hdr.g, hdr.b));
		const { knee } = BLOOM;
		const soft = clamp(bright.sub(1 - knee), 0, 2 * knee);
		const curve = soft.mul(soft).div(4 * knee);
		const excess = max(curve, bright.sub(1)).div(max(bright, 1e-4));
		return vec4(scenePass.getTextureNode('emissive').rgb.add(hdr.mul(excess)), 1);
	}

	/** The output stage, one pass: see the top of this file for its order and the black rule. */
	private compose(pipeline: THREE.RenderPipeline): void {
		const u = this.uniforms;
		const color = this.scenePass!.getTextureNode('output');
		const bloomed = (this.bloom as unknown as { getTextureNode(): typeof color }).getTextureNode();
		// Off, the bloom's texture keeps its last frame: mix it out by the same strength.
		const bloomOn = u.bloomStrength.greaterThan(0).select(float(1), float(0));
		// Chromatic aberration: red and blue pulled apart radially, by the square of the distance
		// from the centre, so the centre is untouched.
		const centred = screenUV.sub(0.5);
		const shift = centred.mul(dot(centred, centred)).mul(u.aberration);
		const hdr = (uv: THREE.Node<'vec2'>) =>
			color.sample(uv).rgb.add(bloomed.sample(uv).rgb.mul(bloomOn)).mul(u.exposure);
		const split = vec3(hdr(screenUV.add(shift)).r, hdr(screenUV).g, hdr(screenUV.sub(shift)).b);
		// Vignette: multiplied, toward the tint at the corners, so black stays black.
		const reach = smoothstep(0.2, 0.75, centred.length());
		const vignetted = split.mul(mix(vec3(1), u.vignetteTint, reach.mul(u.vignette)));
		const toneMapping = TONE_MAPPINGS[this.stages!.toneMapper];
		const mapped = renderOutput(vec4(vignetted, 1), toneMapping, THREE.SRGBColorSpace);
		// The grade: on the display colour, after the curve it was made for.
		const graded = lut3D(mapped, texture3D(this.grade.texture), LUT_SIZE, u.grade);
		const world = (graded as unknown as THREE.Node<'vec4'>).rgb;
		// Nothing is added where the picture is black.
		const lit = smoothstep(0, 2 / 255, luminance(world));
		const cell = screenCoordinate.xy;
		const seed = vec2(u.frameIndex.mul(5.588), u.frameIndex.mul(3.1));
		const grain = interleavedGradientNoise(cell.add(seed)).sub(0.5).mul(u.grain).mul(lit);
		const grained = world.add(grain);
		// The overlay is premultiplied and linear: straighten it, encode it to sRGB (no tone
		// mapping) and lay it over the finished image, as the classic renderer blended it.
		const over = this.overlayPass!.getTextureNode('output');
		const straight = vec4(over.rgb.div(max(over.a, 1e-4)), 1);
		const shown = renderOutput(straight, THREE.NoToneMapping, THREE.SRGBColorSpace).rgb;
		const composed = mix(grained, shown, over.a);
		// A triangular dither of ±1 step against banding, never on the overlay or on black.
		const tpdf = interleavedGradientNoise(cell.add(seed))
			.add(interleavedGradientNoise(cell.add(seed).add(vec2(47.3, 19.1))))
			.sub(1)
			.div(255);
		const dithered = composed.add(tpdf.mul(float(1).sub(over.a)).mul(lit));
		pipeline.outputNode = vec4(dithered, 1);
		pipeline.needsUpdate = true;
	}

	private teardown(): void {
		this.pipeline?.dispose();
		this.prepass?.dispose();
		this.scenePass?.dispose();
		this.overlayPass?.dispose();
		this.ao?.dispose();
		this.bloom?.dispose();
		this.pipeline = this.prepass = this.scenePass = this.overlayPass = this.ao = this.bloom = null;
		this.stages = null;
		this.gates = [];
	}
}
