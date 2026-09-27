// Depth of field and tilt-shift (milestone 63, #165): the miniature, diorama
// feel. Depth of field (three's DepthOfFieldNode, on the prepass's view depth)
// focuses on the camera's pivot, which is the shot's focus during a cinematic
// shot; the tactical view, looking nearly straight down, gets a tilt-shift
// instead: a blur outside a band of rows round the pivot's row. Both sit after
// TRAA, on the HDR image, and both are strengths: at 0 their passes stop
// (Post.gate) and the output mixes them out, so nothing ever recompiles. How
// strong each is comes from `lensStrengths` (quality.ts): shots fade depth of
// field in and out, the Miniature option keeps it on in play, reduced motion
// keeps both off.

import * as THREE from 'three/webgpu';
import { mix, passTexture, smoothstep, uniform } from 'three/tsl';
import { dof } from 'three/examples/jsm/tsl/display/DepthOfFieldNode.js';
import { gaussianBlur } from 'three/examples/jsm/tsl/display/GaussianBlurNode.js';
import type { Tier } from './quality';

/** The bokeh's size per tier: larger where the passes can afford it. */
const BOKEH: Record<Tier, number> = { low: 1, medium: 1, high: 1.5, ultra: 2 };
/**
 * Full blur this far from the focal plane, as a share of the camera's distance to the focus: the
 * blur stays gentle zoomed in and still reads from far back (the Hollow's whole-table shot).
 */
export const FOCAL_SHARE = 0.4;
/** The tilt-shift: sharp within the first distance of the pivot's row, fully blurred past the second (of the screen's height). */
const TILT_BAND = [0.1, 0.4] as const;
const TILT_SIGMA = 4;

/** How a frame is seen (renderer.ts): grain and focus follow it. */
export interface FrameView {
	reduced: boolean;
	/** How much of a cinematic shot's depth of field shows (camera.ts `focusAt`). */
	shot: number;
	tactical: boolean;
	/** The camera's pivot, focused on. */
	target: THREE.Vector3;
}
export const STILL: FrameView = {
	reduced: false,
	shot: 0,
	tactical: false,
	target: new THREE.Vector3()
};

type Texture = THREE.TextureNode;
type Effect = THREE.Node & { getTextureNode(): Texture; dispose(): void; resolutionScale: number };

export class Focus {
	readonly uniforms = {
		dof: uniform(0),
		tilt: uniform(0),
		/** Along the camera's look direction, in world units. */
		distance: uniform(1),
		focalLength: uniform(1),
		bokeh: uniform(1),
		/** The pivot's row on screen (screenUV's y). */
		row: uniform(0.5)
	};
	/** Whether depth of field is built (it needs the prepass's depth). */
	hasDof = false;
	private nodes: Effect[] = [];
	private tiltNode: Effect | null = null;
	private tiltScale = 0.5;
	private readonly forward = new THREE.Vector3();
	private readonly point = new THREE.Vector3();

	/** The tier's bokeh, and the tilt-shift at a quarter of the resolution on low, half above. */
	setTier(tier: Tier): void {
		this.uniforms.bokeh.value = BOKEH[tier];
		this.tiltScale = tier === 'low' ? 0.25 : 0.5;
		if (this.tiltNode) this.tiltNode.resolutionScale = this.tiltScale;
	}

	/**
	 * Builds both over `sharp` (the scene, after TRAA), registering each with `gate`; returns how
	 * the output stage samples the picture through them.
	 */
	build(
		sharp: Texture,
		viewZ: THREE.Node | null,
		gate: (effect: THREE.Node, strength: { value: number }) => void
	): (uv: THREE.Node<'vec2'>) => THREE.Node<'vec4'> {
		this.dispose();
		const u = this.uniforms;
		const blurred = gaussianBlur(sharp, null, TILT_SIGMA, {
			resolutionScale: this.tiltScale
		}) as unknown as Effect;
		this.tiltNode = blurred;
		this.nodes.push(blurred);
		gate(blurred, u.tilt);
		const tilted = blurred.getTextureNode();
		let focused: Texture | null = null;
		if (viewZ) {
			const node = dof(sharp, viewZ, u.distance, u.focalLength, u.bokeh) as unknown as Effect;
			this.nodes.push(node);
			gate(node, u.dof);
			// Its own texture node is a plain texture, which would never draw the node: as a pass
			// texture, sampling it draws the node first, as the blur's does.
			const result = (node as unknown as { _compositeRT: THREE.RenderTarget })._compositeRT;
			focused = passTexture(node as unknown as THREE.PassNode, result.texture);
		}
		this.hasDof = focused !== null;
		// Mixed in by strength, not selected: a select is a branch, and a texture sampled in a
		// branch has no reliable derivatives. At 0 the mix is exactly the sharp picture.
		return (uv) => {
			let c = sharp.sample(uv) as THREE.Node<'vec4'>;
			if (focused) c = mix(c, focused.sample(uv), u.dof);
			const away = smoothstep(TILT_BAND[0], TILT_BAND[1], uv.y.sub(u.row).abs());
			return mix(c, tilted.sample(uv), away.mul(u.tilt)) as THREE.Node<'vec4'>;
		};
	}

	/** Focuses on `target` as `camera` sees it now, at these strengths. */
	aim(camera: THREE.Camera, target: THREE.Vector3, strengths: { dof: number; tilt: number }): void {
		const u = this.uniforms;
		u.dof.value = this.hasDof ? strengths.dof : 0;
		u.tilt.value = strengths.tilt;
		if (!u.dof.value && !u.tilt.value) return;
		camera.getWorldDirection(this.forward);
		const offset = this.point.subVectors(target, camera.position);
		u.distance.value = Math.max(offset.dot(this.forward), 0.01);
		u.focalLength.value = Math.max(offset.length() * FOCAL_SHARE, 0.01);
		// screenUV runs top to bottom; NDC bottom to top.
		u.row.value = 0.5 - this.point.copy(target).project(camera).y * 0.5;
	}

	dispose(): void {
		for (const node of this.nodes.splice(0)) node.dispose();
		this.tiltNode = null;
		this.hasDof = false;
	}
}
