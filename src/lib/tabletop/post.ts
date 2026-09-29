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
// tier whose stages differ rebuilds the pipeline. There is no other way to
// draw: the direct render of before M63 went in #168.
//
// Ambient occlusion (#159, ao.ts) is SSAO or GTAO from the prepass's depth and
// normals, in the scene pass's materials, on indirect light only. TRAA or SMAA
// (#163, antialias.ts) resolve the HDR image before depth of field; FXAA runs
// on display colour in the output stage.
//
// Bloom (#160) glows from the emissive attachment plus the part of the exposed
// HDR image above 1 (a soft knee), so flames and what they light hot bloom
// while sunlit grass and plaster, below 1, do not. Lens dirt (dirt.ts) adds the
// bloom again through smudges, at a strength 0 by default.
//
// The output stage (#161) is one pass, in this order: exposure (scene plus
// bloom), radial chromatic aberration, a vignette tinted dark purple, the tone
// mapper and sRGB, film grain, the overlay, and a triangular dither. Every step
// maps 0 to 0 (the vignette multiplies; grain and dither are masked off at
// black), so unexplored cells, black under the fog, stay exactly black. Bloom,
// chromatic aberration, depth of field and FXAA carry light a little way over
// them, though, so the scene pass also writes `hidden` (1 where a player's fog
// hides the fragment's cell, `worldHidden` in materials/world-modify.ts) and the
// output stage multiplies the world by what it leaves shown, before the overlay
// goes on (#173).
// The colour grade (#162): the environment's table for the tone mapper and band,
// blended on the CPU into one 3D texture (grade.ts), so no shader changes.

import * as THREE from 'three/webgpu';
import {
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
	screenUV,
	uniform,
	velocity,
	vec4
} from 'three/tsl';
import { fxaa } from 'three/examples/jsm/tsl/display/FXAANode.js';
import { lut3D } from 'three/examples/jsm/tsl/display/Lut3DNode.js';
import { LUT_SIZE } from './environment';
import type { Grades } from './grades-load';
import { GradeBlend } from './grade';
import { aoScale, buildAo, sizeAo, type AoNode } from './ao';
import { morphological, temporal } from './antialias';
import { LensDirt } from './dirt';
import { Focus, STILL, type FrameView } from './focus';
import {
	OverlayPassNode,
	PrePassNode,
	ScenePassNode,
	stagesFor,
	TONE_MAPPINGS,
	type PassTarget,
	type Stages
} from './passes';
import type { Ambient } from '../game/lights';
import type BloomNode from 'three/examples/jsm/tsl/display/BloomNode.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { GRADE_TONE_MAPPER, type ToneMapper } from '../assets/manifest';
import { lensStrengths, type QualitySettings } from './quality';
import { worldHidden } from './materials/world-modify';

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
export const GRAIN_MS = 1000 / 24;

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
	readonly grade = new GradeBlend();
	/** Depth of field and tilt-shift (focus.ts), and how the output stage samples through them. */
	readonly focus = new Focus();
	/** Lens dirt (dirt.ts): `dirt.set(strength)`, 0 by default. */
	readonly dirt = new LensDirt();
	private settings: QualitySettings | null = null;
	private sample: ((uv: THREE.Node<'vec2'>) => THREE.Node<'vec4'>) | null = null;
	private pipeline: THREE.RenderPipeline | null = null;
	private stages: Stages | null = null;
	/** The AO's resolution: half, full on ultra. */
	private aoScale = 1;
	/** The grain's strength when on (0 under reduced motion). */
	private grain = 0;
	/** The bloom's resolution: a quarter on low, half above. */
	private bloomScale = 0.5;
	private gates: {
		effect: THREE.Node;
		on: THREE.NodeUpdateType;
		strength: { value: number };
		frames: number;
	}[] = [];
	prepass: THREE.PassNode | null = null;
	scenePass: THREE.PassNode | null = null;

	overlayPass: THREE.PassNode | null = null;
	ao: AoNode | null = null;
	/** TRAA's sharpened resolve, or SMAA's, which the output stage reads in place of the scene pass. */
	private resolved: THREE.TextureNode | null = null;
	/** The overlay's camera: the main one without TRAA's jitter. */
	private overlayCamera: THREE.Camera | null = null;
	/** Nodes with render targets of their own (TRAA, its sharpening, SMAA), disposed with the pipeline. */
	private owned: { dispose(): void }[] = [];
	private fxaaInput: THREE.Node | null = null;
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
		/** What the frame at `now` is seen as: reduced motion, the shot, the view, the pivot. */
		private readonly view: (now: number) => FrameView = () => STILL
	) {}

	/** Applies a tier: rebuilds the pipeline only when its stages change. */
	set(settings: QualitySettings): void {
		const next = stagesFor(settings);
		this.settings = settings;
		this.focus.setTier(settings.tier);
		// Off on low (no prepass), by the tier's `ao` or `?off=ao`: a uniform, so no recompile.
		this.uniforms.aoStrength.value = settings.ao && settings.layers.ao ? AO_STRENGTH : 0;
		this.aoScale = aoScale(settings.tier);
		this.uniforms.bloomStrength.value =
			settings.bloom && settings.layers.bloom ? BLOOM.strength : 0;
		this.bloomScale = settings.tier === 'low' ? 0.25 : 0.5;
		const lens = settings.layers.lens;
		this.uniforms.vignette.value = lens && settings.vignette ? LENS.vignette : 0;
		this.uniforms.aberration.value = lens && settings.aberration ? LENS.aberration : 0;
		this.grain = lens && settings.grain ? LENS.grain : 0;
		this.uniforms.grade.value = settings.grade && settings.layers.grade ? 1 : 0;
		const same =
			this.stages &&
			this.stages.prepass === next.prepass &&
			this.stages.samples === next.samples &&
			this.stages.aa === next.aa &&
			this.stages.ao === next.ao;
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
		grades: Grades | null = this.look.grades,
		band: Ambient = this.look.band
	): void {
		// A new environment's grade is put in place at once; a new band blends in.
		const snap = grades !== this.look.grades;
		const changed = snap || band !== this.look.band;
		this.look = { environment, cellSize, grades, band };
		if (changed) this.retarget(snap);
		if (this.ao) sizeAo(this.ao, environment, cellSize);
	}

	/** Whether a grade is still blending in (the tabletop keeps drawing while it is). */
	get blending(): boolean {
		return this.grade.blending;
	}

	/** The tone mapper in force: the one whose grades the table loads first. */
	get toneMapper(): ToneMapper {
		return this.stages?.toneMapper ?? GRADE_TONE_MAPPER;
	}

	/** Blends toward the grade for the environment, band and tone mapper now in force. */
	private retarget(snap = false): void {
		this.grade.aim(this.look.grades, this.toneMapper, this.look.band, snap);
	}

	/**
	 * Switches an effect by its strength uniform: at 0 its passes stop (`updateBeforeType`
	 * NONE, which NodeFrame reads every frame), and the effect mixes its output by the same
	 * uniform, so off costs nothing and never recompiles. Effects register when built, and draw
	 * their first frames even when off.
	 */
	gate(effect: THREE.Node, strength: { value: number }): void {
		this.gates.push({ effect, on: effect.updateBeforeType, strength, frames: 0 });
	}

	/** Draws a frame at `now` (the tabletop's clock): through the pipeline, or straight to the canvas. */
	render(now = 0): void {
		this.uniforms.frameIndex.value = Math.floor(now / GRAIN_MS) % 4096;
		this.grade.step(now);
		const view = this.view(now);
		this.uniforms.grain.value = view.reduced ? 0 : this.grain;
		if (this.settings) {
			const now = { ...view, hasDof: this.focus.hasDof };
			this.focus.aim(this.camera, view.target, lensStrengths(this.settings, now));
		}
		// Each effect draws its first two frames whatever its strength, so its passes compile with
		// the pipeline and turning it on later compiles nothing (#164): two, since the AO's
		// materials are set up while the scene pass builds, after the AO drew on the first.
		for (const gate of this.gates) {
			const on = gate.strength.value > 0 || gate.frames < 2;
			gate.effect.updateBeforeType = on ? gate.on : THREE.NodeUpdateType.NONE;
			gate.frames++;
		}
		// Nothing to draw with until the first `set`.
		if (!this.pipeline) return;
		(this.overlayCamera as THREE.PerspectiveCamera | null)?.copy(
			this.camera as THREE.PerspectiveCamera
		);
		this.pipeline.render();
	}

	/**
	 * The targets the table's materials draw into, for the warm-up to compile against: the scene
	 * pass. Not the prepass: compiled outside its pass on WebGPU, some of its pipelines come out
	 * invalid (a colour target the fragment stage never writes), so it compiles when first drawn.
	 */
	targets(): PassTarget[] {
		return this.passTargets(this.scenePass);
	}

	/** The overlay pass's target, for the warm-up to compile its marks against (#180). */
	overlayTargets(): PassTarget[] {
		return this.passTargets(this.overlayPass);
	}

	private passTargets(p: THREE.PassNode | null): PassTarget[] {
		return p ? [{ renderTarget: p.renderTarget, mrt: p.getMRT() }] : [];
	}

	dispose(): void {
		this.teardown();
		this.grade.dispose();
		this.dirt.dispose();
	}

	private build(stages: Stages): void {
		this.teardown();
		this.stages = stages;
		this.retarget(); // the tone mapper may have changed with the passes
		const { renderer, scene, camera } = this;
		const halfFloat = renderer.getOutputBufferType();
		if (stages.prepass) {
			const prepass = new PrePassNode(THREE.PassNode.COLOR, scene, camera, { samples: 0 });
			prepass.name = 'prepass';
			prepass.transparent = false;
			// View normals, and for TRAA each pixel's motion (half-float, cloned from the colour
			// texture before that turns 8-bit).
			const normals = packNormalToRGB(normalView);
			prepass.setMRT(
				mrt(stages.aa === 'traa' ? { output: normals, velocity } : { output: normals })
			);
			if (stages.aa === 'traa') prepass.getTexture('velocity').type = halfFloat;
			prepass.renderTarget.texture.type = THREE.UnsignedByteType;
			this.prepass = prepass;
		}
		const scenePass = new ScenePassNode(THREE.PassNode.COLOR, scene, camera, {
			samples: stages.samples
		});
		if (this.prepass) scenePass.drawsFirst.push(this.prepass);
		scenePass.name = 'scene';
		const hidden = worldHidden() as unknown as THREE.Node<'float'>;
		const outputs = mrt({
			output,
			emissive: vec4(emissive, output.a),
			hidden: vec4(hidden, hidden, hidden, output.a)
		});
		// A transparent surface in front of a glow covers its emissive, as it covers its colour.
		outputs.setBlendMode('emissive', new THREE.BlendMode(THREE.NormalBlending));
		outputs.setBlendMode('hidden', new THREE.BlendMode(THREE.NormalBlending));
		// Cleared to shown whatever the background (#176): a brighter sky must never read as hidden.
		outputs.setClearColor('hidden', 0x000000, 0);
		scenePass.setMRT(outputs);
		scenePass.getTexture('emissive').type = THREE.UnsignedByteType;
		// RGBA, though only red is read: blended by alpha, and three r186 declares a WebGPU fragment
		// output with the target's channels, so an R8 target has no alpha to blend with (#176).
		scenePass.getTexture('hidden').type = THREE.UnsignedByteType;
		// Set now (setup sets the same later) so a warm-up before the first frame compiles for them.
		scenePass.renderTarget.samples = stages.samples;
		scenePass.renderTarget.texture.type = halfFloat;
		this.scenePass = scenePass;

		if (this.prepass && stages.ao !== 'none') {
			const ao = buildAo(stages.ao, this.prepass, scenePass, camera, this.uniforms.aoStrength);
			ao.resolutionScale = this.aoScale;
			this.ao = ao;
			this.setLook(this.look.environment, this.look.cellSize);
			scenePass.drawsFirst.push(ao);
			this.gate(ao, this.uniforms.aoStrength);
		}

		const glow = bloom(this.bloomInput(scenePass), this.uniforms.bloomStrength, BLOOM.radius, 0);
		// The input is already only what should glow: no threshold of its own.
		glow.highPassFn = (({ input }: { input: THREE.Node }) => input) as typeof glow.highPassFn;
		glow.setResolutionScale(this.bloomScale);
		this.bloom = glow;
		this.gate(glow, this.uniforms.bloomStrength);

		const aa =
			stages.aa === 'traa'
				? temporal(scenePass, this.prepass!, camera)
				: stages.aa === 'smaa'
					? morphological(scenePass)
					: null;
		if (aa) {
			this.resolved = aa.resolved;
			this.owned.push(...aa.owned);
		}

		// Depth of field and tilt-shift, on the finished HDR image; the prepass's depth is never
		// multisampled.
		this.sample = this.focus.build(
			this.resolved ?? scenePass.getTextureNode('output'),
			this.prepass?.getViewZNode() ?? null,
			(effect, strength) => this.gate(effect, strength)
		);

		// TRAA jitters the camera for every pass: the overlay draws with a copy taken before.
		this.overlayCamera = camera.clone();
		const overlayPass = new OverlayPassNode(
			this.overlay,
			this.overlayCamera,
			this.prepass ?? scenePass
		);
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
		const sample = this.sample!;
		const bloomed = (
			this.bloom as unknown as { getTextureNode(): THREE.TextureNode }
		).getTextureNode();
		// Off, the bloom's texture keeps its last frame: mix it out by the same strength.
		const bloomOn = u.bloomStrength.greaterThan(0).select(float(1), float(0));
		// Chromatic aberration: red and blue pulled apart radially, by the square of the distance
		// from the centre, so the centre is untouched.
		const centred = screenUV.sub(0.5);
		const shift = centred.mul(dot(centred, centred)).mul(u.aberration);
		// Lens dirt: the bloom again, through the smudges; exactly nothing at strength 0.
		const dirt = float(1).add(this.dirt.map.sample(screenUV).r.mul(this.dirt.strength));
		const hdr = (uv: THREE.Node<'vec2'>) =>
			sample(uv).rgb.add(bloomed.sample(uv).rgb.mul(bloomOn).mul(dirt)).mul(u.exposure);
		const split = vec3(hdr(screenUV.add(shift)).r, hdr(screenUV).g, hdr(screenUV.sub(shift)).b);
		// Vignette: multiplied, toward the tint at the corners, so black stays black.
		const reach = smoothstep(0.2, 0.75, centred.length());
		const vignetted = split.mul(mix(vec3(1), u.vignetteTint, reach.mul(u.vignette)));
		const toneMapping = TONE_MAPPINGS[this.stages!.toneMapper];
		const mapped = renderOutput(vec4(vignetted, 1), toneMapping, THREE.SRGBColorSpace);
		// The grade: on the display colour, after the curve it was made for.
		const graded = lut3D(mapped, texture3D(this.grade.texture), LUT_SIZE, u.grade);
		// FXAA wants the finished display colour; grain, the overlay and dither come after it.
		const finished = graded as unknown as THREE.Node<'vec4'>;
		// FXAA reads its input from a render target of its own: the last one goes when recomposed.
		this.fxaaInput?.dispose();
		const smoothed = this.stages!.aa === 'fxaa' ? fxaa(finished) : finished;
		this.fxaaInput =
			smoothed === finished
				? null
				: (smoothed as unknown as { textureNode: THREE.Node }).textureNode;
		// Hidden cells back to exactly black, whatever spread over them. The attachment clears to 0
		// (shown), so the sky around the table stays; MSAA's resolve leaves edges in between.
		const covered = this.scenePass!.getTextureNode('hidden').sample(screenUV).r;
		const shownPart = float(1).sub(covered.saturate());
		const world = (smoothed as THREE.Node<'vec4'>).rgb.mul(shownPart);
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
		this.resolved = this.overlayCamera = null;
		for (const node of this.owned.splice(0)) node.dispose();
		this.fxaaInput?.dispose();
		this.fxaaInput = null;
		this.focus.dispose();
		this.sample = null;
		this.stages = null;
		this.gates = [];
	}
}
