// The pipeline's own passes (post.ts): the prepass, whose normals are 8-bit;
// the overlay's, which keeps the world's depth; and the scene's, which has
// what it reads drawn first.

import * as THREE from 'three/webgpu';

/**
 * The opaque prepass: its colour attachment holds view normals, which fit in 8 bits.
 * `PassNode.setup` resets that attachment to the renderer's output type on every build,
 * so the 8-bit type is put back after it.
 */
export class PrePassNode extends THREE.PassNode {
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
export class OverlayPassNode extends THREE.PassNode {
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
export class ScenePassNode extends THREE.PassNode {
	drawsFirst: THREE.Node[] = [];

	updateBefore(frame: THREE.NodeFrame) {
		for (const node of this.drawsFirst) frame.updateBeforeNode(node);
		return super.updateBefore(frame);
	}
}
